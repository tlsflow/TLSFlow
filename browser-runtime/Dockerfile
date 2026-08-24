FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    chromium \
    dumb-init \
    fluxbox \
    fonts-noto-cjk \
    novnc \
    websockify \
    x11vnc \
    xvfb \
  && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin browser-runtime \
  && mkdir -p /run/gcac-browser-sessions /app/container \
  && chown -R browser-runtime:browser-runtime /run/gcac-browser-sessions /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY container/start-session.sh ./container/start-session.sh
RUN chmod 0555 ./container/start-session.sh
ENV NODE_ENV=production
ENV BROWSER_SESSION_ROOT=/run/gcac-browser-sessions
ENV BROWSER_SESSION_SCRIPT=/app/container/start-session.sh
ENV BROWSER_CHROMIUM_EXECUTABLE=/usr/bin/chromium
USER browser-runtime
EXPOSE 8787
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
