FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime-dependencies
WORKDIR /app
COPY package.json package-lock.json* ./
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci --omit=dev --ignore-scripts

FROM node:22-bookworm-slim AS novnc-assets
WORKDIR /tmp/novnc
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
  set -eux; \
  for attempt in 1 2 3 4 5; do \
    apt-get \
      -o Acquire::Retries=5 \
      -o Acquire::http::Timeout=30 \
      -o Acquire::https::Timeout=30 \
      update \
      && apt-get \
        -o Acquire::Retries=5 \
        -o Acquire::http::Timeout=30 \
        -o Acquire::https::Timeout=30 \
        install -y --no-install-recommends ca-certificates novnc \
      && break; \
    if [ "$attempt" = 5 ]; then exit 1; fi; \
    rm -rf /var/lib/apt/lists/*; \
    sleep 5; \
  done; \
  rm -rf /var/lib/apt/lists/* \
  && mkdir -p /novnc \
  && cp -a /usr/share/novnc/. /novnc/

FROM node:22-bookworm-slim
WORKDIR /app
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
  set -eux; \
  for attempt in 1 2 3 4 5; do \
    apt-get \
      -o Acquire::Retries=5 \
      -o Acquire::http::Timeout=30 \
      -o Acquire::https::Timeout=30 \
      update \
      && apt-get \
        -o Acquire::Retries=5 \
        -o Acquire::http::Timeout=30 \
        -o Acquire::https::Timeout=30 \
        install -y --no-install-recommends ca-certificates \
      && break; \
    if [ "$attempt" = 5 ]; then exit 1; fi; \
    rm -rf /var/lib/apt/lists/*; \
    sleep 5; \
  done; \
  sed -i 's|http://deb.debian.org/debian|https://deb.debian.org/debian|g' /etc/apt/sources.list.d/debian.sources; \
  sed -i 's|http://deb.debian.org/debian-security|https://deb.debian.org/debian-security|g' /etc/apt/sources.list.d/debian.sources; \
  for attempt in 1 2 3 4 5; do \
    apt-get \
      -o Acquire::Retries=5 \
      -o Acquire::http::Timeout=30 \
      -o Acquire::https::Timeout=30 \
      update \
      && apt-get \
        -o Acquire::Retries=5 \
        -o Acquire::http::Timeout=30 \
        -o Acquire::https::Timeout=30 \
        install -y --no-install-recommends \
          chromium \
          dumb-init \
          fluxbox \
          fonts-noto-cjk \
          x11vnc \
          xvfb \
      && break; \
    if [ "$attempt" = 5 ]; then exit 1; fi; \
    rm -rf /var/lib/apt/lists/*; \
    sleep 5; \
  done; \
  rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin browser-runtime \
  && mkdir -p /run/gcac-browser-sessions /app/container \
  && chown -R browser-runtime:browser-runtime /run/gcac-browser-sessions /app
COPY --from=runtime-dependencies /app/node_modules ./node_modules
COPY --from=novnc-assets /novnc ./novnc
COPY --from=build /app/dist ./dist
COPY container/start-session.sh ./container/start-session.sh
RUN chmod 0555 ./container/start-session.sh
ENV NODE_ENV=production
ENV BROWSER_SESSION_ROOT=/run/gcac-browser-sessions
ENV BROWSER_SESSION_SCRIPT=/app/container/start-session.sh
ENV BROWSER_CHROMIUM_EXECUTABLE=/usr/bin/chromium
ENV BROWSER_NOVNC_ROOT=/app/novnc
USER browser-runtime
EXPOSE 8787
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
