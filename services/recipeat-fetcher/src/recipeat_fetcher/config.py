from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration, read from the environment or a local .env file."""

    model_config = SettingsConfigDict(env_prefix="FETCHER_", env_file=".env")

    host: str = "127.0.0.1"
    # 8103 in the 8100-8103 block: 8100 the app, 8101 Ollama, 8102 the OCR
    # service, all published on loopback on the same host.
    port: int = 8103
    reload: bool = False

    # The page fetch. recipe-scrapers' own urllib call has none of these.
    fetch_timeout: float = 10.0
    fetch_max_bytes: int = 5_000_000
    fetch_max_redirects: int = 3


@lru_cache
def get_settings() -> Settings:
    return Settings()
