# syntax=docker/dockerfile:1
# Agenda de decoración: PocketBase + PocketPages, listo para arrancar solo.
ARG PB_VERSION=0.40.0

# 1) Binario de PocketBase
FROM alpine:3 AS pocketbase
ARG PB_VERSION
ARG TARGETOS=linux
ARG TARGETARCH=amd64
ARG TARGETVARIANT
RUN apk add --no-cache ca-certificates \
 && wget -q "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_${TARGETOS}_${TARGETARCH}${TARGETVARIANT}.zip" -O /tmp/pb.zip \
 && unzip /tmp/pb.zip pocketbase -d /out \
 && chmod +x /out/pocketbase

# 2) Dependencias de PocketPages
FROM node:22-alpine AS deps
WORKDIR /app
COPY app/package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# 3) Imagen final
FROM alpine:3
RUN apk add --no-cache ca-certificates tzdata python3 tini

COPY --from=pocketbase /out/pocketbase /usr/local/bin/pocketbase
COPY --from=deps /app/node_modules /app/node_modules
COPY app/package.json /app/package.json
COPY app/pb_hooks /app/pb_hooks
COPY esquema /app/esquema
COPY docker/init.py /app/init.py
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
WORKDIR /app
RUN chmod +x /usr/local/bin/entrypoint.sh && mkdir -p /pb_data

# --- Variables de entorno ---------------------------------------------------
# Obligatorias (superusuario de PocketBase; se crea/actualiza en cada arranque):
#   PB_EMAIL, PB_PASS            (PB_PASS mínimo 10 caracteres)
# Opcionales:
#   OWNER_EMAIL, OWNER_PASSWORD, OWNER_NAME   primer usuario con rol "dueno"
#   PB_ENCRYPTION_KEY            32 caracteres; cifra los ajustes de PocketBase
#   PB_PORT (8090)  PB_ORIGINS (*)  TZ
ENV PB_PORT=8090 \
    PB_DATA_DIR=/pb_data \
    PB_HOOKS_DIR=/app/pb_hooks \
    TZ=America/Mexico_City

VOLUME /pb_data
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PB_PORT}/api/health" >/dev/null || exit 1

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]
