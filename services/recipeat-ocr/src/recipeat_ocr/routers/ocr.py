"""The OCR endpoint.

One multipart upload in, one reading out. The caller is the Nuxt app, which
posts the photo a user picked and sends the text on to the extraction pipeline.

Nothing about the upload is taken on trust. The declared content type is not
checked, because a browser's guess is worth less than the answer Pillow gives by
trying to decode the bytes; the length is counted while reading rather than read
off Content-Length, which the fetcher does for the same reason.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from rapidocr import RapidOCR

from ..config import Settings, get_settings
from ..engine import get_engine, read_image
from ..image import decode
from ..models import Reading

router = APIRouter(tags=["ocr"])

CHUNK = 1024 * 1024


async def _read_upload(file: UploadFile, max_bytes: int) -> bytes:
    body = bytearray()
    while chunk := await file.read(CHUNK):
        body.extend(chunk)
        if len(body) > max_bytes:
            raise HTTPException(
                status_code=413,
                detail="That image is too large to read.",
            )

    if not body:
        raise HTTPException(status_code=422, detail="That upload was empty.")

    return bytes(body)


@router.post("/ocr")
async def ocr(
    file: Annotated[UploadFile, File(description="The photo to read.")],
    settings: Annotated[Settings, Depends(get_settings)],
    engine: Annotated[RapidOCR, Depends(get_engine)],
) -> Reading:
    data = await _read_upload(file, settings.max_bytes)
    return await read_image(engine, decode(data))
