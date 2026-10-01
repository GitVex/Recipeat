# The settings are baked in rather than bind-mounted. A bind mount whose source
# is missing on the host (Coolify runs Compose from its own directory, not the
# checkout) becomes an empty directory, and SearXNG refuses to start.
#
# They live outside /etc/searxng on purpose. The image declares that a volume,
# and Compose keeps a container's anonymous volumes when it recreates it, so a
# file there would stay at its first deploy's version forever. The entrypoint
# still writes a template into the volume; nothing reads it.
FROM searxng/searxng:latest
COPY settings.yml /usr/local/searxng/recipeat-settings.yml
ENV SEARXNG_SETTINGS_PATH=/usr/local/searxng/recipeat-settings.yml
