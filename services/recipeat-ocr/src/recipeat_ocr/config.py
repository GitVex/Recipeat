from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration, read from the environment or a local .env file."""

    model_config = SettingsConfigDict(env_prefix="OCR_", env_file=".env")

    host: str = "127.0.0.1"
    # 8000 is the fetcher's, and both publish on loopback on the same host.
    port: int = 8001
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


@lru_cache
def get_settings() -> Settings:
    return Settings()
