from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration, read from the environment or a local .env file."""

    model_config = SettingsConfigDict(env_prefix="OCR_", env_file=".env")

    host: str = "127.0.0.1"
    # 8102 in the 8100-8103 block: 8100 the app, 8101 Ollama, 8103 the
    # fetcher, all published on loopback on the same host.
    port: int = 8102
    reload: bool = False

    # The upload, counted while reading rather than trusted from Content-Length.
    # A phone photo is a few megabytes; this leaves room for a scan.
    max_bytes: int = 10_000_000

    # RapidOCR scales the longer side down to this before detection. A
    # full-resolution photo is far larger than the models read, and shrinking it
    # is most of the difference between seconds and minutes.
    max_side_len: int = 2000

    # Recognitions below this confidence are dropped rather than guessed at.
    text_score: float = 0.5

    # ONNX Runtime takes every core on the host at -1, its own default, and
    # Ollama is already capped at four of six. Keep this at the container's
    # `cpus` so the two do not fight.
    intra_op_threads: int = 2

    # Load the models during startup rather than on the first request, so
    # /health answers ok only once an image could actually be read.
    warm_start: bool = True

    # Which size of PP-OCRv6 model to run: tiny, small or medium. Only `small`
    # ships inside the rapidocr wheel — the others are fetched from ModelScope
    # on first use, and this service is deployed with no egress, so changing
    # either of these means rebuilding the image with the matching build arg.
    #
    # Measured on IMG_5239 at two threads: both small 4.0s, medium recogniser
    # 50s, medium detector 32s. Detection already finds every line on that
    # page, so the detector buys nothing; the medium recogniser fixes the
    # quantities that matter (1EL, 2 Zwiebeln, Knoblauch) and truncates the
    # three longest instruction lines, which the model can repair from context.
    det_model_type: str = "small"
    rec_model_type: str = "small"


@lru_cache
def get_settings() -> Settings:
    return Settings()
