# Matches .python-version, so a container and a checkout run the same thing.
# Not the fetcher's 3.10: onnxruntime publishes no wheel below 3.11.
FROM python:3.12-slim

# uv resolves from the lockfile, so the image gets what the tests ran against.
COPY --from=ghcr.io/astral-sh/uv:0.12.6 /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/usr/local \
    PYTHONUNBUFFERED=1

# RapidOCR pulls in opencv-python rather than its headless build, so the import
# needs the GUI libraries that the slim image leaves out. Without them the
# service fails at startup on libGL.so.1, not at the first image.
RUN apt-get update \
    && apt-get install --no-install-recommends -y libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first: they change far less often than the source does, and
# pyproject.toml names the README, so it has to come along.
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --locked --no-dev --no-install-project

COPY src ./src
RUN uv sync --locked --no-dev

# The three default models come with the wheel, so nothing is downloaded here.
# Building the engine anyway is a build-time check: it proves the models load
# and the ONNX sessions construct — a missing libGL, a renamed config key or a
# model pointed somewhere this image cannot reach all fail the build rather
# than the first request. Built the way the service builds it, not with
# RapidOCR's defaults, so it is the service's own configuration being checked.
RUN python -c "from recipeat_ocr.engine import get_engine; get_engine()"

RUN useradd --create-home --uid 10001 ocr
USER ocr

EXPOSE 8102

# Answers, rather than merely running: the app loads the models during startup,
# so this stays unhealthy until an image could actually be read.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8102/health').read()"]

CMD ["uvicorn", "recipeat_ocr.app:app", "--host", "0.0.0.0", "--port", "8102"]
