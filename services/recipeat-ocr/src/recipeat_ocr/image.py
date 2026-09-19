"""Reading an upload into something the models can take.

RapidOCR accepts raw bytes, but that path is not the one to use. It skips the
EXIF orientation tag, which is how nearly every phone stores a portrait photo —
the pixels are landscape and a flag says which way is up — so a recipe held
upright would be recognised sideways. It also lets Pillow's
`UnidentifiedImageError` escape, where the same failure on a path comes back as
`LoadImageError`, leaving no single exception to answer 415 on.

What is handed on is the decoded image rather than an array, because RapidOCR
converts RGB to the BGR its models were trained on only when it did the decode
itself. An array is assumed to be BGR already and passed straight through, so
decoding to one here would quietly swap every red and blue channel.

HEIC is registered because it is what an iPhone saves by default, and a photo
of a cookbook page is the most likely thing this service is ever given.
"""

from io import BytesIO

from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError
from pillow_heif import register_heif_opener

# Teaches Pillow the format; `Image.open` handles it from here like any other.
register_heif_opener()


def decode(data: bytes) -> Image.Image:
    """The uploaded image, turned the right way up."""
    try:
        image = Image.open(BytesIO(data))
        # Pillow decodes lazily, so this is where a truncated file is noticed.
        image.load()
    except UnidentifiedImageError as error:
        raise HTTPException(
            status_code=415,
            detail="That file is not an image this service can read.",
        ) from error
    except Image.DecompressionBombError as error:
        # Pixels, not bytes: a few hundred kilobytes of PNG can decode to
        # gigabytes, and the upload limit never sees it coming.
        raise HTTPException(
            status_code=413,
            detail="That image is too large to read.",
        ) from error
    except OSError as error:
        raise HTTPException(
            status_code=415,
            detail="That image could not be read; it may be damaged.",
        ) from error

    # Returns a copy where the tag needed applying, the original where it did
    # not, and the original again where the tag is unreadable.
    return ImageOps.exif_transpose(image) or image
