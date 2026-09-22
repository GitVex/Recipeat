"""The wire contract.

Field names are camelCase on the wire because there is exactly one consumer and
it is TypeScript, the same as the fetcher.

`text` is the field that matters: it is what gets posted on to the text
extraction pipeline, so it is laid out the way the photo was rather than
concatenated in detection order. `lines` is the same reading broken up, kept
because a confidence per line is the only signal the Nuxt side has for telling
a clean scan from a blurry one. `layoutUncertain` is the other signal: it says
the reading may have columns merged into it, which is the one OCR failure the
model downstream can undo and only if it is told to look.

Nothing here is a RapidOCR type. Boxes, word boxes, the cropped images and the
per-stage timings all stay in this service; narrowing to these fields is what
keeps the response stable across a model or library upgrade.
"""

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class Wire(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class Line(Wire):
    """One recognised line, with how sure the model is of it."""

    text: str
    confidence: float


class Reading(Wire):
    text: str
    lines: list[Line]
    # Whether `text` may have two columns merged into single lines. The layout
    # found a boundary it could not tell from an indent, so it left the block
    # whole — the safe half of the choice, and the half the caller can repair,
    # because the model reading this can separate an ingredient from a step by
    # sense where geometry could not by position. False on a page that is
    # plainly one column, so that the warning stays worth something.
    layout_uncertain: bool
    # Seconds the three models spent on this image. The photo import path is the
    # slow one; this is what makes it measurable without a stopwatch.
    elapsed: float
