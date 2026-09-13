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

The website includes an import preview for links, photos, and text, sample recipe details, and a collection persisted in localStorage. Imports show explicitly labeled sample recipes; no files are uploaded and no LLM or backend is connected. Photography is hosted on Unsplash and fonts on Google Fonts, so those assets require internet access.

## Self-hosted Ollama

[compose.ollama.yaml](compose.ollama.yaml) provides a CPU-only Ollama service for the VPS. See [the setup guide](docs/ollama.md) for migrating the existing container while preserving downloaded models, API testing, and SSH access. This service is not yet connected to the mockup.
