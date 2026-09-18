"""The endpoints.

Whether the models read a photograph correctly is RapidOCR's business and its
own test suite. What belongs here is everything this service does around them:
what it decodes, what it forwards, how a reading is laid out, and how the
caller's own mistakes come back.
"""

from io import BytesIO

import pytest
from PIL import Image
from rapidocr import LoadImageError

from conftest import box, output, png


def upload(data: bytes = None, name: str = "photo.png", content_type: str = "image/png"):
    return {"file": (name, png() if data is None else data, content_type)}


def test_health_answers_ok(client):
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_reads_lines_in_the_order_the_photo_has_them(client, engine):
    engine.answer = output(
        ("Zutaten", 0.99, box(10, 10, 120, 40)),
        ("2 Eier", 0.95, box(10, 60, 100, 90)),
    )

    response = client.post("/ocr", files=upload())

    assert response.status_code == 200
    body = response.json()
    assert body["text"] == "Zutaten\n2 Eier"
    assert body["lines"] == [
        {"text": "Zutaten", "confidence": 0.99},
        {"text": "2 Eier", "confidence": 0.95},
    ]
    # Summed across detection, classification and recognition.
    assert body["elapsed"] == pytest.approx(0.3)


def test_keeps_boxes_on_one_row_on_one_line(client, engine):
    """Two detections at the same height are one line, not two."""
    engine.answer = output(
        ("Mehl", 0.9, box(10, 10, 60, 40)),
        ("500 g", 0.9, box(300, 12, 380, 42)),
    )

    response = client.post("/ocr", files=upload())

    assert response.status_code == 200
    text = response.json()["text"]
    assert text.startswith("Mehl")
    assert text.endswith("500 g")
    assert "\n" not in text


def test_the_engine_is_given_a_decoded_image(client, engine):
    """Not the raw bytes: RapidOCR converts colour only for what it decoded."""
    engine.answer = output(("Mehl", 0.9, box(10, 10, 60, 40)))

    client.post("/ocr", files=upload(png(width=40, height=30)))

    assert isinstance(engine.calls[0], Image.Image)
    assert engine.calls[0].size == (40, 30)


def test_a_photo_taken_in_portrait_is_turned_upright(client, engine):
    """A phone stores it landscape with a tag saying which way is up."""
    engine.answer = output(("Mehl", 0.9, box(10, 10, 60, 40)))
    exif = Image.Exif()
    exif[0x0112] = 6  # rotate 90° clockwise
    buffer = BytesIO()
    Image.new("RGB", (40, 30), "white").save(buffer, format="JPEG", exif=exif)

    client.post("/ocr", files=upload(buffer.getvalue(), "photo.jpg", "image/jpeg"))

    assert engine.calls[0].size == (30, 40)


def test_an_image_with_no_text_is_a_422(client, engine):
    engine.answer = output()

    response = client.post("/ocr", files=upload())

    assert response.status_code == 422
    assert "No text" in response.json()["detail"]


def test_a_mode_the_models_cannot_take_is_a_415(client, engine):
    engine.answer = LoadImageError("The channel(5) of the img is not in [1, 2, 3, 4]")

    response = client.post("/ocr", files=upload())

    assert response.status_code == 415


def test_something_that_is_not_an_image_is_a_415(client, engine):
    response = client.post("/ocr", files=upload(b"%PDF-1.4", "notes.pdf", "application/pdf"))

    assert response.status_code == 415
    assert engine.calls == []


def test_a_truncated_image_is_a_415(client, engine):
    response = client.post("/ocr", files=upload(png()[:60]))

    assert response.status_code == 415
    assert engine.calls == []


def test_an_upload_over_the_limit_is_a_413(client, engine):
    response = client.post("/ocr", files=upload(b"x" * 2000, "big.jpg", "image/jpeg"))

    assert response.status_code == 413
    assert engine.calls == []


def test_an_empty_upload_is_a_422(client, engine):
    response = client.post("/ocr", files=upload(b"", "empty.jpg", "image/jpeg"))

    assert response.status_code == 422
    assert engine.calls == []


def test_the_file_field_is_required(client):
    response = client.post("/ocr")

    assert response.status_code == 422
