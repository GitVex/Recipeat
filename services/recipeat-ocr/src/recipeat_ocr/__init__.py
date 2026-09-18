from .app import create_app

__all__ = ["create_app", "main"]


def main() -> None:
    """Serve the app. `fastapi dev src/recipeat_ocr/app.py` works too."""
    import uvicorn

    from .config import get_settings

    settings = get_settings()
    uvicorn.run(
        "recipeat_ocr.app:app",
        host=settings.host,
        port=settings.port,
        reload=settings.reload,
    )
