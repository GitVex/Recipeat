"""Fixtures for the service's own tests.

Nothing here loads a model. The engine is a dependency the app asks for, so a
test supplies its own; what is under test is the mapping on top of RapidOCR —
which fields are forwarded, how a reading is laid out, and how the caller's own
mistakes come back — and none of that needs 30 MB of ONNX to answer.

The warm start is off for the same reason: the app builds its engine during
startup, and `TestClient` runs the lifespan.
"""

import os
from io import BytesIO

os.environ.setdefault("OCR_WARM_START", "false")

import numpy as np  # noqa: E402 - after the environment is set
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402
from rapidocr.utils.output import RapidOCROutput  # noqa: E402

from recipeat_ocr.app import app  # noqa: E402
from recipeat_ocr.config import Settings, get_settings  # noqa: E402
from recipeat_ocr.engine import get_engine  # noqa: E402


def png(width: int = 40, height: int = 30, **save: object) -> bytes:
    """A real image, because the upload is really decoded before the engine."""
    buffer = BytesIO()
    Image.new("RGB", (width, height), "white").save(buffer, format="PNG", **save)
    return buffer.getvalue()


def box(left: float, top: float, right: float, bottom: float) -> list[list[float]]:
    """One detection box, corners clockwise from the top left."""
    return [[left, top], [right, top], [right, bottom], [left, bottom]]


def output(*lines: tuple[str, float, list[list[float]]]) -> RapidOCROutput:
    """A RapidOCR result, as the real engine would return one."""
    txts, scores, boxes = zip(*lines) if lines else ((), (), ())
    return RapidOCROutput(
        boxes=np.array(boxes, dtype=float) if boxes else None,
        txts=txts or None,
        scores=scores or None,
        elapse_list=[0.1, 0.2],
    )


class StubEngine:
    """Whatever a test says the engine answers, or raises."""

    def __init__(self, answer):
        self.answer = answer
        self.calls: list[bytes] = []

    def __call__(self, image):
        self.calls.append(image)
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer


@pytest.fixture
def engine():
    """An engine a test sets the answer on. Empty until it does."""
    stub = StubEngine(output())
    app.dependency_overrides[get_engine] = lambda: stub
    yield stub
    app.dependency_overrides.pop(get_engine, None)


@pytest.fixture
def client(engine):
    """The app, with a limit small enough that a test can exceed it."""
    app.dependency_overrides[get_settings] = lambda: Settings(max_bytes=1000)
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
