FROM node:22-alpine

RUN apk add --no-cache openssl openjdk17-jre-headless ca-certificates

WORKDIR /app

COPY package.json ./
COPY src ./src

ENV TLS_INSPECTOR_HOST=0.0.0.0
ENV TLS_INSPECTOR_PORT=8788
ENV TLS_INSPECTOR_DATA_DIR=/data/tls-inspector

VOLUME ["/data/tls-inspector"]

EXPOSE 8788

CMD ["node", "src/index.js"]
