# Matches .python-version, so a container and a checkout run the same thing.
FROM python:3.10-slim

# uv resolves from the lockfile, so the image gets what the tests ran against.
COPY --from=ghcr.io/astral-sh/uv:0.12.6 /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/usr/local \
    NLTK_DATA=/usr/share/nltk_data \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Dependencies first: they change far less often than the source does, and
# pyproject.toml names the README, so it has to come along.
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --locked --no-dev --no-install-project

COPY src ./src
RUN uv sync --locked --no-dev

# ingredient-parser downloads a part-of-speech tagger from the internet the
# first time it is imported. Doing it here makes the image self-contained, keeps
# the first request from paying for it, and turns a missing tagger into a build
# failure rather than a runtime one.
RUN python -c "import ingredient_parser"

RUN useradd --create-home --uid 10001 fetcher
USER fetcher

EXPOSE 8000

# Answers, rather than merely running: the CRF model loads on first import.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health').read()"]

CMD ["uvicorn", "recipeat_fetcher.app:app", "--host", "0.0.0.0", "--port", "8000"]
