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

The container pulls its own model. The entrypoint starts a background shell
that waits for the server to answer, pulls `$RECIPEAT_MODEL` into the persistent
volume, and exits; the server is `exec`ed rather than run under that shell, so
`docker stop` reaches the server itself. `init: true` puts `docker-init` at PID 1
to forward the signal and reap the finished pull. The pull is idempotent, so a restart with the model already in the volume
costs one `list` call. Pulling a model does not make it an API default —
requests still name the model, which the app supplies from
`runtimeConfig.ollamaModel`.

`RECIPEAT_MODEL` is not read by Ollama. It is what this deployment pulls and
reports healthy on, and it has to match `runtimeConfig.ollamaModel`.

The health check greps `ollama list` for that tag, so healthy means the model is
installed, not merely that the server answers. It still does not prove inference
completes. The first pull happens inside `start_period` (10 minutes), during
which the container reports `starting` rather than unhealthy — raise it if the
VPS pulls slowly.

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
docker compose -f compose.ollama.yaml logs -f ollama
```

The pull is logged by the `ollama` container itself. Wait for the container to
report healthy before sending any request:

```sh
docker inspect ollama --format '{{.State.Health.Status}}'
```

If the pull fails, the container keeps serving without the model and never turns
healthy. Read its logs, then retry the pull by hand with
`docker exec ollama ollama pull qwen3.5:2b`, or restart the container.

Measured on a developer machine, not the VPS: 5m43s from `up -d` to healthy,
almost all of it the 2.7 GB model download, with the container reporting
`starting` throughout and never `unhealthy`. A later start is 5s — the pull
re-fetches a 473-byte manifest and stops there. `docker stop` returns in 0.8s
with exit code 0, which is the `exec` doing its job; a shell holding the signal
would take the full ten-second grace and exit 137.

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
curl http://127.0.0.1:8101/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"model":"qwen3.5:2b","stream":false,"think":false,
       "messages":[{"role":"user","content":"Reply with: Recipeat is ready."}],
       "options":{"num_predict":64}}'
```

The first request is slow while the model loads.

## Local development

Keep a tunnel open:

```sh
ssh -N -L 8101:127.0.0.1:8101 root@YOUR_VPS_IP
```

The app's default `ollamaBaseUrl` is `http://127.0.0.1:8101`, so nothing else
needs configuring while the tunnel runs.

If Nuxt is containerized on the VPS, both sit on the `coolify` network — the
shared one every resource with "Connect To Predefined Network" enabled joins —
and `NUXT_OLLAMA_BASE_URL=http://ollama:11434` finds it there. Inside a separate
container, `localhost` means that container, not Ollama. Outside Coolify,
`docker network create coolify` once is all the setup there is.

`ollama` is a network alias this file declares, not the container name. Coolify
renames containers, which would otherwise take the DNS name with it. The
project's own `<project>_default` network is no use either: Coolify runs Compose
with `--project-name <resource-uuid>`, overriding the `name:` above, so that
network's name is neither stable nor knowable from the repository.

Sharing a network with the rest of the install costs Ollama little — it only
ever receives connections. The [fetcher](../services/recipeat-fetcher/README.md)
is the exception and stays off it.

The [fetcher](../services/recipeat-fetcher/README.md) is a separate Compose
project and deliberately not on this network. It opens connections to URLs a
user supplies, and this API is unauthenticated.

That separation is weaker on Docker Desktop than on the VPS, and it was measured
rather than assumed. From inside the fetcher container, `ollama` does not resolve
and `172.17.0.1:8101` — the gateway a Linux host would present — is refused, so
the loopback publishing holds there. `host.docker.internal:8101` answers with
the model list. Docker Desktop provides that name as a gateway that forwards to
published ports, loopback-bound ones included; a Linux host has no such name
unless `extra_hosts: host-gateway` adds it. So an SSRF through the fetcher
reaches Ollama on a developer machine and not on the VPS.

## Manage

```sh
docker compose -f compose.ollama.yaml ps
docker compose -f compose.ollama.yaml logs --tail 100 -f
docker stats ollama
docker compose -f compose.ollama.yaml up -d      # apply config changes
docker compose -f compose.ollama.yaml pull       # update Ollama, interrupts inference
docker compose -f compose.ollama.yaml down       # keeps the external volume
```

The image tracks `latest`. Pin a version tag or digest once you need
reproducible deployments.

Changing models means editing `RECIPEAT_MODEL` and `runtimeConfig.ollamaModel`,
then recreating the container so the new tag is pulled. Old models stay on
disk; delete the volume only if you mean to lose them.

References: [Ollama Docker](https://docs.ollama.com/docker),
[configuration](https://docs.ollama.com/faq),
[Compose services](https://docs.docker.com/reference/compose-file/services/),
[external volumes](https://docs.docker.com/reference/compose-file/volumes/).
