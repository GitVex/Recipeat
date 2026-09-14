# Recipeat

A responsive Nuxt 4 landing-page mockup for a multimodal recipe collection app.

## Run

```sh
npm install
npm run dev
```

## Production

```sh
npm run build
npm run preview
```

The website includes an import preview for links, photos, and text, sample recipe details, and a collection persisted in localStorage. The import UI still shows explicitly labeled sample recipes and does not upload files. A separate authenticated [text extraction API](docs/extraction.md) connects to Ollama and returns recipe drafts. Photography is hosted on Unsplash and fonts on Google Fonts, so those assets require internet access.

## Self-hosted Ollama

[compose.ollama.yaml](docker/compose.ollama.yaml) provides a CPU-only Ollama service for the VPS and an initialization service that pulls `qwen3.5:4b`. See [the setup guide](docs/ollama.md) for migrating the existing container while preserving downloaded models, API testing, and SSH access. This service is not yet connected to the mockup.

## Authentication

Zitadel login uses `nuxt-oidc-auth`. See [authentication setup](docs/authentication.md) for the Zitadel application, `.env` values, and Coolify deployment. Requires Node.js 22.19+ and a running Nuxt server; static generation does not support authentication. The recipe demo remains public and local to the browser.
