# Recipeat OCR

A small FastAPI service that reads the text out of a recipe photo, using
[RapidOCR][rapidocr] — PaddleOCR's detection, angle classification and
recognition models, run through ONNX Runtime on the CPU. It recognises text; it
does not understand it. Turning the reading into a recipe is the model's job,
one hop later.

It is internal: the Nuxt app is the only caller, and nothing here is
authenticated. Keep it off published ports.

[rapidocr]: https://github.com/RapidAI/RapidOCR

## Run

```sh
uv sync
uv run fastapi dev src/recipeat_ocr/app.py   # reload, docs at /docs
uv run recipeat-ocr                          # or serve with the settings below
```

Needs Python 3.12; onnxruntime publishes no wheel below 3.11, which is why this
service does not sit on the fetcher's 3.10.

The three default models (~31 MB) ship inside the rapidocr wheel, so a fresh
`uv sync` needs nothing further and building an engine opens no connection.
Pointing `Det`, `Rec` or `Cls` at another language, size or OCR version changes
that: those are downloaded from ModelScope on first use.

`GET /health` answers `{"status": "ok"}` once the models are loaded, not merely
once the process is up.

## Test

```sh
uv run pytest
```

No model is loaded. The engine is a dependency the app asks for, so the tests
supply their own and assert on what this service does around RapidOCR: what it
decodes, what it forwards, how a reading is laid out, and how a caller's
mistakes come back.

## Read a photo

`POST /ocr` takes one multipart upload and returns what it read.

```sh
curl -X POST http://localhost:8102/ocr -F 'file=@page.jpg'
```

```jsonc
{
  // Laid out as the photo was, which is what gets posted on to the model.
  "text": "Pfannkuchen\n\n250 g Mehl\n3 Eier",
  "lines": [
    { "text": "Pfannkuchen", "confidence": 0.99 },
    { "text": "250 g Mehl", "confidence": 0.99 }
  ],
  "elapsed": 0.9,   // seconds across all three models
  "layoutUncertain": false
}
```

| Status | Meaning |
|---|---|
| 413 | The upload is over the byte limit, or decodes to more pixels than Pillow allows |
| 415 | The bytes are not an image, are damaged, or are in a mode the models cannot take |
| 422 | The `file` part is missing or empty, or no text could be read |
| 502 | — (nothing upstream to fail; this service reaches nothing) |

`text` is the page laid out the way it was written: one block per region, a
blank line between them, boxes joined into rows inside each. Detection order
would give the same words with the recipe's shape thrown away, and the shape of
a recipe — which lines are the ingredient list, which are the steps — is most
of what it says. [`layout.py`](./src/recipeat_ocr/layout.py) does that, and its
docstring covers why RapidOCR's own `to_markdown` could not: it groups boxes
into rows across the full page width, so a two-column recipe comes back with
each ingredient welded to whichever step happened to sit beside it.

`layoutUncertain` says the layout found a left-edge boundary it could not tell
from an indent — a gutter too tight to cut on, or two columns that run beside
each other too briefly. The block is returned whole in that case, which is the
recoverable half of the choice: two columns merged into one line can be pulled
apart again by sense, where a block wrongly torn in two cannot be put back. The
app turns this into one extra sentence of prompt, so the model knows to look
for the seam; on a page that is plainly one column it stays false, which is
what keeps the warning worth reading.

`lines` is the same reading, unjoined. The confidence per line is the only
signal the app has for telling a clean scan from a blurry one.

Nothing from RapidOCR is passed through. Boxes, word boxes, cropped images and
per-stage timings all stay here; narrowing to these fields is what keeps the
response stable across a model or library upgrade.

## What the upload goes through

The declared content type is ignored. A browser's guess is worth less than the
answer Pillow gives by trying to decode the bytes, and the length is counted
while reading rather than read off `Content-Length`, which the sender chooses.

The image is decoded here rather than handed to RapidOCR as bytes, for three
reasons, all in `image.py`:

- **Orientation.** RapidOCR's bytes path does not apply the EXIF orientation
  tag. Nearly every phone stores a portrait photo as landscape pixels plus a
  tag saying which way is up, so a cookbook page held upright would be
  recognised sideways.
- **Colour.** RapidOCR converts RGB to the BGR its models were trained on only
  for input it decoded itself; an array is assumed to be BGR already. Handing
  over the decoded image rather than an array is what keeps red and blue from
  quietly swapping.
- **Errors.** That same path lets Pillow's `UnidentifiedImageError` escape,
  where the equivalent failure on a file path arrives as `LoadImageError`. One
  place to decode is one place to answer 415 from.

HEIC is registered through `pillow-heif`, because it is what an iPhone saves by
default.

## Settings

Read from the environment with an `OCR_` prefix, or from a local `.env`.

| Setting | Default | Why |
|---|---|---|
| `OCR_MAX_BYTES` | 10000000 | A phone photo is a few megabytes; this leaves room for a scan |
| `OCR_MAX_SIDE_LEN` | 2000 | The longer side is scaled to this before detection; most of the difference between seconds and minutes |
| `OCR_TEXT_SCORE` | 0.5 | Recognitions below this are dropped rather than guessed at |
| `OCR_INTRA_OP_THREADS` | 2 | ONNX Runtime takes every core at its own default of -1, and Ollama already has four of six |
| `OCR_WARM_START` | true | Build the engine during startup, so `/health` means ready |
| `OCR_DET_MODEL_TYPE` | small | Which PP-OCRv6 detector. Build-time; see below |
| `OCR_REC_MODEL_TYPE` | small | Which PP-OCRv6 recogniser. Build-time; see below |
| `OCR_HOST` / `OCR_PORT` | 127.0.0.1 / 8102 | In the 8100-8103 block: 8100 the app, 8101 Ollama, 8103 the fetcher, all on the same host |

One image is recognised at a time. `RapidOCR.__call__` writes its per-call
overrides onto the engine before running, so a shared engine with two requests
in flight would have them reading each other's thresholds; a lock also keeps
CPU-bound inference from competing with itself, the same posture as
`OLLAMA_NUM_PARALLEL`.

### Model size

PP-OCRv6 comes in `tiny`, `small` and `medium`. Only `small` ships inside the
rapidocr wheel; the others are fetched from ModelScope the first time an engine
is built, and this service is deployed with no egress. So the two settings
above are really build-time choices, and the Dockerfile takes them as build
args to fetch the model while the network is still available:

```sh
docker compose -f docker/compose.ocr.yaml build --build-arg OCR_REC_MODEL_TYPE=medium
```

Measured on one handwritten German page, 1536x2048, at two threads:

| | Wall | What changes |
|---|---|---|
| det small, rec small | 4.0s | The default |
| det small, rec **medium** | 50s | The quantities come out right |
| det **medium**, rec small | 32s | One more box out of 54 |

Detection already finds every line on that page, so a larger detector buys
essentially nothing for twelve times the time. The recogniser is the real
choice, and it is not free either way. `medium` fixes what `small` gets wrong
about **amounts** — `AEL` becomes `1EL`, `MEL` becomes `1EL`, `2Zmiebeln`
becomes `2 Zwiebeln`, and `Vinoblanch` becomes `Knoblauch` — and those are the
errors that matter, because a misread quantity becomes a wrong recipe while a
misread word stays a typo the model repairs from context.

It is worse in one specific way: it truncates the three longest instruction
lines on that page, where `small` reads them through. Those are prose, so the
model recovers them. The trade is twelve times the OCR time for correct amounts
and slightly worse prose, and it is left off by default because the photo path
is already the slow one.

One page is not a benchmark. Re-measure before trusting any of this on a
different hand.

## Deploy

[`docker/compose.ocr.yaml`](../../docker/compose.ocr.yaml) builds this directory
and publishes the service on loopback, the way Ollama and the fetcher are
published.

`build:` in that file is `../services/recipeat-ocr`, relative to the Compose
file's own directory. Compose only resolves it that way when no
`--project-directory` is passed. Coolify always passes one, so a resource
deploying this file must set **Base Directory** to `/docker` and **Docker
Compose Location** to `/compose.ocr.yaml`. With Base Directory left at `/`, the
context resolves one level above the checkout and the build fails with
`unable to prepare context: path "/artifacts/services/recipeat-ocr" not found`.

It is a separate Compose project, for the opposite reason to the fetcher's. The
fetcher must reach the internet and is kept away from anything private; this
service never opens an outbound connection at all, because its models come with
its wheel.

**That is a property of the image, not of the Compose file.** `internal: true`
looks like the way to enforce it and is not — Docker drops every published port
for a container on an internal network, so the app can no longer reach the
service. This was tried, and the container came up healthy with `8102/tcp` bound
to nothing. Compose has no way to say "ingress but no egress".

Enforcing it needs a host rule. On the VPS, after the stack is up:

```sh
for NET in recipeat-ocr_default coolify; do
  IP=$(docker inspect recipeat-ocr --format "{{(index .NetworkSettings.Networks \"$NET\").IPAddress}}")
  SUBNET=$(docker network inspect "$NET" --format '{{(index .IPAM.Config 0).Subnet}}')
  iptables -I DOCKER-USER -s "$IP" ! -d "$SUBNET" -j DROP
done
```

Both networks, because the container is on two and egress can leave by either:
its own project default, and `coolify`, which it shares with the app. And the
container's own address rather than the whole subnet — a subnet-wide rule on
`coolify` would cut off every other resource there along with this one.

Note what this does and does not buy on the `coolify` leg. `! -d "$SUBNET"`
exempts the network itself, so the service can still reach anything else on
`coolify`. What the rule stops is egress to the internet, which is all this
service should ever have been able to do anyway.

The addresses are assigned at container start, so this has to run after every
recreate, not once.

Untested — Docker Desktop on Windows has no DOCKER-USER chain to try it on.
Verify with `docker exec recipeat-ocr python -c "import socket;
socket.create_connection(('1.1.1.1', 53), 3)"`, which succeeds without the
rule.

The build runs the service's own engine factory rather than RapidOCR's
defaults. Nothing is downloaded, so what it buys is a build-time check: the
models load, the ONNX sessions construct, and the service's own configuration
is the one proved to work.

The build context is this directory, so the repository has to be on the host.

```sh
git clone https://github.com/GitVex/Recipeat.git
cd Recipeat
docker compose -f docker/compose.ocr.yaml up -d --build
docker compose -f docker/compose.ocr.yaml logs -f
```

RapidOCR installs `opencv-python` rather than its headless build, so the image
adds `libgl1` and `libglib2.0-0`; without them the import fails on `libGL.so.1`
at startup.

The app finds the service at `NUXT_OCR_BASE_URL`, which defaults to
`http://127.0.0.1:8102`. If Nuxt is containerized on the same host, attach it to
the `coolify` network and set `NUXT_OCR_BASE_URL=http://recipeat-ocr:8102` —
inside a container, `localhost` means that container.

```sh
docker compose -f docker/compose.ocr.yaml ps
docker stats recipeat-ocr                    # against the 2g cap
docker compose -f docker/compose.ocr.yaml down
```

Measured in the container: 164 MiB at rest with the models loaded, a 649 MiB
peak reading a 3024x4032 photo, 3.5s for that photo and 1.0s for a 680x460
one.

## Known rough edges

- **No queue in front of the lock.** A second caller waits for the first with no
  feedback, and a third waits behind both. The app is the only caller, and it
  has the same problem in front of Ollama.
- **Handwriting.** These are print models. A handwritten recipe card reads
  badly, and the confidence per line is the only warning of it.
- **No deskewing.** A photo taken at an angle loses lines the detector cannot
  box. Angle classification handles 180° rotation, not perspective.
