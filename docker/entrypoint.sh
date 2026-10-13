#!/bin/sh
set -eu

: "${PB_EMAIL:?Define PB_EMAIL (correo del superusuario)}"
: "${PB_PASS:?Define PB_PASS (contrasena del superusuario, minimo 10 caracteres)}"
PB_PORT="${PB_PORT:-8090}"
PB_DATA_DIR="${PB_DATA_DIR:-/pb_data}"
PB_HOOKS_DIR="${PB_HOOKS_DIR:-/app/pb_hooks}"

# El require() de los hooks se resuelve desde el directorio de trabajo: debe ser /app (ahi esta node_modules).
cd /app

# Superusuario: crea o actualiza (idempotente) antes de levantar el servidor.
pocketbase superuser upsert "$PB_EMAIL" "$PB_PASS" --dir="$PB_DATA_DIR"

set -- serve --http="0.0.0.0:${PB_PORT}" --dir="$PB_DATA_DIR" --hooksDir="$PB_HOOKS_DIR" \
       --migrationsDir="${PB_DATA_DIR}/pb_migrations" --automigrate=false --origins="${PB_ORIGINS:-*}"
[ -n "${PB_ENCRYPTION_KEY:-}" ] && set -- "$@" --encryptionEnv=PB_ENCRYPTION_KEY

pocketbase "$@" &
PB_PID=$!
trap 'kill -TERM "$PB_PID" 2>/dev/null' TERM INT

# Esquema inicial y primer usuario (solo si faltan); no tumba el servidor si falla.
PB_URL="http://127.0.0.1:${PB_PORT}" python3 -I /app/init.py || echo "init: fallo, revisa el log" >&2

wait "$PB_PID"
