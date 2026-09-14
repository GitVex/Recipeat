# Ollama

[`docker/compose.ollama.yaml`](../docker/compose.ollama.yaml) runs a CPU-only
Ollama on the VPS (6 vCPU, 12 GB RAM), capped at 4 CPUs and 8 GB with no swap.
It loads one model and answers one request at a time, and publishes the API on
the loopback interface only.

The API is unauthenticated. Keep it private and route every user request
through the application.

| Setting | Value | Why |
|---|---|---|
| `OLLAMA_NUM_PARALLEL` | 1 | One inference at a time; callers queue |
| `OLLAMA_MAX_LOADED_MODELS` | 1 | Only one model fits the memory cap |
| `OLLAMA_CONTEXT_LENGTH` | 16384 | Sized for the API's 20 000-character limit |
| `OLLAMA_KEEP_ALIVE` | 5m | Model unloads after five idle minutes |

The KV cache for the context window is allocated in full on every request, so a
short paste costs the same memory as a full page scrape. Watch it with
`docker stats ollama` against the 8 GB limit.

The `ollama-init` service declares the model in its `command`. It waits for the
server to be healthy, asks it to pull `qwen3.5:4b` into the persistent volume,
and exits 0. It is a CLI client, not a second server. Pulling a model does not
make it an API default — requests still name the model, which the app supplies
from `runtimeConfig.ollamaModel`.

The health check only proves Ollama responds. It does not prove the model is
installed or that inference completes.

## Deploy

Needs Docker Compose v2 (`docker compose version`).

```sh
scp docker/compose.ollama.yaml root@YOUR_VPS_IP:/root/compose.ollama.yaml
```

Then over SSH in `/root`:

```sh
docker compose -f compose.ollama.yaml config --quiet
docker volume create ollama          # only if it does not exist yet
docker compose -f compose.ollama.yaml up -d
docker compose -f compose.ollama.yaml logs -f ollama-init
```

Wait for `ollama-init` to exit 0 before sending any request. If the pull fails,
read its logs and retry with
`docker compose -f compose.ollama.yaml run --rm ollama-init`.

**Replacing an existing container.** The volume is declared `external`, so it
survives. First confirm the old container really uses it:

```sh
docker inspect ollama --format '{{json .Mounts}}'
```

If it uses a different volume or a bind mount, adapt the Compose file to match.
If it has no mount at all, the model lives inside the container and must be
backed up before you remove it. Then `docker stop ollama && docker rm ollama`
and bring Compose up as above. Matching layers are reused.

## Check it works

```sh
curl http://127.0.0.1:11434/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"model":"qwen3.5:4b","stream":false,"think":false,
       "messages":[{"role":"user","content":"Reply with: Recipeat is ready."}],
       "options":{"num_predict":64}}'
```

The first request is slow while the model loads.

## Local development

Keep a tunnel open:

```sh
ssh -N -L 11434:127.0.0.1:11434 root@YOUR_VPS_IP
```

The app's default `ollamaBaseUrl` is `http://127.0.0.1:11434`, so nothing else
needs configuring while the tunnel runs.

If Nuxt is containerized on the VPS, attach it to the `recipeat-ai_default`
network and set `NUXT_OLLAMA_BASE_URL=http://ollama:11434`. Inside a separate
container, `localhost` means that container, not Ollama.

## Manage

```sh
docker compose -f compose.ollama.yaml ps
docker compose -f compose.ollama.yaml logs --tail 100 -f
docker stats ollama
docker compose -f compose.ollama.yaml up -d      # apply config changes
docker compose -f compose.ollama.yaml pull       # update Ollama, interrupts inference
docker compose -f compose.ollama.yaml down       # keeps the external volume
```

Both services track `latest`. Pin a version tag or digest once you need
reproducible deployments.

Changing models means editing the initializer's `command` and
`runtimeConfig.ollamaModel`. Old models stay on disk; delete the volume only if
you mean to lose them.

References: [Ollama Docker](https://docs.ollama.com/docker),
[configuration](https://docs.ollama.com/faq),
[Compose services](https://docs.docker.com/reference/compose-file/services/),
[external volumes](https://docs.docker.com/reference/compose-file/volumes/).
