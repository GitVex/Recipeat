from contextlib import asynccontextmanager

from fastapi import FastAPI

from .config import get_settings
from .engine import warm
from .routers import health, ocr


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Before anything is served, so /health — which the container's health check
    # reads — does not answer ok while a model load still stands between it and
    # the first caller.
    await warm(get_settings())
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="Recipeat OCR",
        description="Reads text out of recipe photos.",
        version="0.1.0",
        lifespan=lifespan,
    )

    app.include_router(health.router)
    app.include_router(ocr.router)

    return app


app = create_app()
