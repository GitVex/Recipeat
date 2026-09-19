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
from rapidocr import LoadImageError, RapidOCR

from .config import Settings, get_settings
from .models import Line, Reading

# Guards the engine, not the image: see the module docstring.
_lock = asyncio.Lock()


@lru_cache
def get_engine() -> RapidOCR:
    """The process's engine. Also the dependency the endpoint asks for."""
    settings = get_settings()
    return RapidOCR(
        params={
            "Global.text_score": settings.text_score,
            "Global.max_side_len": settings.max_side_len,
            "EngineConfig.onnxruntime.intra_op_num_threads": settings.intra_op_threads,
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

    return Reading(
        # Laid out as the photo was: lines grouped by their boxes, a blank line
        # where the image leaves a gap. An ingredient list read in detection
        # order would arrive as words in roughly the right order and nothing
        # else, and the shape of a recipe is most of what it says.
        text=output.to_markdown(),
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
