# Ollama on the VPS

This configuration targets the existing CPU-only VPS with 6 vCPUs and 12 GB RAM. Ollama is capped at 4 CPUs and 8 GB RAM, with no container swap allowance. It loads one model and processes one inference request at a time. The context window is 16384 tokens, sized for the 20 000-character upper bound the extraction API accepts; its KV cache costs roughly 2 GB on top of the model weights, and CPU prompt processing grows with the amount of context actually used. The API is published only on the VPS loopback interface.

The configuration uses an existing external Docker volume named `ollama`, preserving models downloaded with the earlier `docker run` command. The health check verifies that Ollama responds; it does not verify that a particular model is installed or can complete inference.

The `ollama-init` service explicitly declares `qwen3.5:4b` in its `command`. It waits for Ollama to be healthy, asks that server to pull the model into the persistent volume, and exits. Exit code 0 means the pull succeeded. This service is a CLI client, not a second inference server. Pulling can check for model updates and reuses existing matching layers. API requests still need to specify `"model": "qwen3.5:4b"`; downloading a model does not configure an API default or preload it into RAM.

## Transfer the configuration

Docker and Docker Compose v2 must be installed on the VPS. Check with `docker compose version`.

From the local project directory, copy the file to the VPS (replace `YOUR_VPS_IP`):

```sh
scp docker/compose.ollama.yaml root@YOUR_VPS_IP:/root/compose.ollama.yaml
```

Run the remaining deployment commands over SSH, in `/root`:

```sh
cd /root
docker compose -f compose.ollama.yaml config --quiet
```

## Move the existing container to Compose

First verify that `/root/.ollama` is mounted from the named volume `ollama`:

```sh
docker inspect ollama --format '{{json .Mounts}}'
docker volume inspect ollama
```

If it uses a different volume or a bind mount, adapt the Compose volume configuration to match before proceeding. If there is no mount, the model is inside the container and must be backed up before removing that container.

After confirming the existing named volume, replace the container. This briefly interrupts the API. Removing the container below preserves its named volume:

```sh
docker stop ollama
docker rm ollama
docker compose -f compose.ollama.yaml up -d
docker compose -f compose.ollama.yaml logs -f ollama-init
docker compose -f compose.ollama.yaml ps -a
docker compose -f compose.ollama.yaml exec ollama ollama list
```

Wait for `ollama-init` to finish with exit code 0 before sending inference requests. Existing matching model layers are reused; updated layers may be downloaded.

## Fresh installation instead

If there is no existing container or model volume:

```sh
docker volume create ollama
docker compose -f compose.ollama.yaml up -d
docker compose -f compose.ollama.yaml logs -f ollama-init
docker compose -f compose.ollama.yaml ps -a
```

Wait for `ollama-init` to exit with code 0. If the pull fails, inspect its logs and retry with `docker compose -f compose.ollama.yaml run --rm ollama-init`.

## Test the API

```sh
curl http://127.0.0.1:11434/api/chat \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "qwen3.5:4b",
    "stream": false,
    "think": false,
    "messages": [{"role": "user", "content": "Reply with: Recipeat is ready."}],
    "options": {"num_predict": 64}
  }'
```

The first request may take longer while loading the model. The model unloads after five idle minutes; change `OLLAMA_KEEP_ALIVE` if needed. CPU and memory limits are starting values, not a guarantee that every image or context will fit.

## Local development access

From your own computer, keep this SSH tunnel running:

```sh
ssh -N -L 11434:127.0.0.1:11434 root@YOUR_VPS_IP
```

Your local Nuxt server can then call `http://127.0.0.1:11434/api/chat`. Ollama is not yet wired into the landing-page mockup.

If Nuxt is containerized on the VPS, attach it to the same Docker network (`recipeat-ai_default`) and use `http://ollama:11434` from its server code. Inside a separate container, `localhost` refers to that container, not Ollama. The Ollama API is unauthenticated; keep it private and route user requests through your application.

## Manage the service

```sh
docker compose -f compose.ollama.yaml ps
docker compose -f compose.ollama.yaml logs --tail 100 -f
docker stats ollama
```

Apply configuration changes:

```sh
docker compose -f compose.ollama.yaml up -d
```

Update Ollama deliberately (this can interrupt inference), then repeat the API test:

```sh
docker compose -f compose.ollama.yaml pull
docker compose -f compose.ollama.yaml up -d
```

Both services use `latest` for initial setup. Pin both to the same tested version tag or image digest when you need reproducible deployments. The initialization service runs `ollama pull` when started by Compose and may update model weights. To explicitly pull again, run `docker compose -f compose.ollama.yaml run --rm ollama-init`. Changing the model means changing the initializer's `command` and the model name in your API requests; existing models remain on disk.

Stop and remove the Compose container and network:

```sh
docker compose -f compose.ollama.yaml down
```

The external model volume remains. Do not delete it unless you intend to remove the downloaded models.

References: [Ollama Docker](https://docs.ollama.com/docker), [Ollama configuration](https://docs.ollama.com/faq), [Compose services](https://docs.docker.com/reference/compose-file/services/), [external volumes](https://docs.docker.com/reference/compose-file/volumes/).
