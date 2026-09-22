"""The OCR engine, and the one call that runs it.

RapidOCR holds three ONNX models — detection, angle classification,
recognition — so one engine is built for the process and kept. Building it is
the model load, and the models are the only large thing this service holds.

That engine may not be shared between concurrent calls. `RapidOCR.__call__`
writes its per-call overrides onto `self` before running, so two requests in
flight would read each other's thresholds. Inference is CPU-bound and blocking
besides, so the lock costs little that a thread pool would have given back: one
image at a time, the same posture as `OLLAMA_NUM_PARALLEL`.

The three default models ship inside the rapidocr wheel, so building an engine
opens no connection. That stops being true the moment `Det`, `Rec` or `Cls` is
pointed at another language, size or OCR version: those are fetched from
ModelScope on first use, and this service is deployed with nothing to fetch
them over. Changing a model here means baking the new one into the image.
"""

import asyncio
from functools import lru_cache

from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool
from PIL import Image
import numpy as np
from rapidocr import LoadImageError, ModelType, RapidOCR

from .config import Settings, get_settings
from .layout import lay_out
from .models import Line, Reading

# Guards the engine, not the image: see the module docstring.
_lock = asyncio.Lock()

# A blank line between blocks, which is what a blank line already means inside
# one: a gap on the page. The model needs no new vocabulary to read it.
BLOCK_SEPARATOR = "\n\n"


@lru_cache
def get_engine() -> RapidOCR:
    """The process's engine. Also the dependency the endpoint asks for."""
    settings = get_settings()
    return RapidOCR(
        params={
            "Global.text_score": settings.text_score,
            "Global.max_side_len": settings.max_side_len,
            "EngineConfig.onnxruntime.intra_op_num_threads": settings.intra_op_threads,
            # Both default to the models that ship in the wheel. Anything else
            # is fetched from ModelScope on first use, so it has to be baked in
            # at build time; see the Dockerfile and the README's measurements.
            "Det.model_type": ModelType(settings.det_model_type),
            "Rec.model_type": ModelType(settings.rec_model_type),
        }
    )


async def read_image(engine: RapidOCR, image: Image.Image) -> Reading:
    """Recognise a decoded image, or say why it could not be."""
    async with _lock:
        try:
            output = await run_in_threadpool(engine, image)
        except LoadImageError as error:
            # `image.py` has already ruled out everything a caller can cause;
            # what is left is a mode this build cannot convert, such as CMYK.
            raise HTTPException(
                status_code=415,
                detail="That image is in a format this service cannot read.",
            ) from error

    # Also the guard for `to_markdown`, which answers a sentence in Chinese
    # rather than an empty string when there is nothing to lay out.
    if len(output) == 0:
        raise HTTPException(
            status_code=422,
            detail="No text could be read from that image.",
        )

    # Not RapidOCR's `to_markdown`, which groups boxes into rows across the
    # full page width: on a two-column recipe that concatenates an ingredient
    # with a step and alternates between the columns as it descends. See
    # layout.py for what replaces it and why the two axes are found differently.
    blocks = lay_out(np.array(output.boxes), list(output.txts))

    return Reading(
        # Laid out as the photo was, one block per region of the page, in
        # reading order. The shape of a recipe — which lines are the ingredient
        # list, which are the steps — is most of what it says.
        text=BLOCK_SEPARATOR.join(block.text for block in blocks if block.text),
        # One ambiguous block makes the whole reading ambiguous. The caller's
        # only use for this is a sentence of prompt, and that sentence reads
        # the same whether one block or three could not be told apart.
        layout_uncertain=any(block.uncertain for block in blocks),
        lines=[
            Line(text=text, confidence=float(score))
            for text, score in zip(output.txts, output.scores)
        ],
        elapsed=output.elapse,
    )


async def warm(settings: Settings) -> None:
    """Build the engine before the first caller pays for it."""
    if settings.warm_start:
        await run_in_threadpool(get_engine)
