from fastapi import FastAPI

from .routers import fetch, health, sites


def create_app() -> FastAPI:
    app = FastAPI(
        title="Recipeat Fetcher",
        description="Fetches recipes from the web and parses their ingredients.",
        version="0.1.0",
    )

    app.include_router(health.router)
    app.include_router(fetch.router)
    app.include_router(sites.router)

    return app


app = create_app()
