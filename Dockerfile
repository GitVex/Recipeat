# package.json asks for >=22.19.0, so the container and a checkout run the same
# major. Alpine because the built server is plain JavaScript with no native
# dependencies to compile.
FROM node:22-alpine AS build

WORKDIR /app

# @playwright/test is the only devDependency, and installing it downloads
# browsers this image will never run. The build still installs devDependencies
# so that adding a build-time one later does not silently break the image.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Dependencies first: the lockfile changes far less often than the source does.
COPY package.json package-lock.json ./
RUN npm ci

COPY nuxt.config.ts ./
COPY app ./app
COPY server ./server
RUN npm run build

# .output is self-contained: it carries its own node_modules and needs neither
# Nuxt nor the lockfile at runtime, so nothing else crosses from the build.
FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8100

COPY --from=build --chown=node:node /app/.output ./.output

# nuxt-oidc-auth keeps sessions in a filesystem store under .data, resolved
# against the working directory. It has to exist and be owned by the runtime
# user before a volume covers it: Docker seeds a fresh named volume from what
# the image has at that path, ownership included.
RUN mkdir -p /app/.data/oidc && chown -R node:node /app/.data

USER node

EXPOSE 8100

# The landing page is public — globalMiddlewareEnabled is false — so a 200 here
# means routing and rendering both work. /api/me would answer 401 without a
# session and could never go healthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8100/').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["node", ".output/server/index.mjs"]
