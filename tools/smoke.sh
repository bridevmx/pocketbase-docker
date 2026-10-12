#!/usr/bin/env bash
# Levanta un PocketBase temporal con las migraciones y hooks de este repo y corre la prueba de humo.
#   PB_BIN=/ruta/a/pocketbase tools/smoke.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PB_BIN="${PB_BIN:-pocketbase}"
TMP="$(mktemp -d)"
trap 'kill $PB_PID 2>/dev/null || true; rm -rf "$TMP"' EXIT
export SU_EMAIL=admin@test.mx SU_PASS=superpass-12345 PB_URL=http://127.0.0.1:8099
"$PB_BIN" migrate up --dir="$TMP/pb_data" --migrationsDir="$ROOT/pb_migrations" >/dev/null
"$PB_BIN" superuser upsert "$SU_EMAIL" "$SU_PASS" --dir="$TMP/pb_data" --migrationsDir="$ROOT/pb_migrations" >/dev/null
"$PB_BIN" serve --http=127.0.0.1:8099 --dir="$TMP/pb_data" --migrationsDir="$ROOT/pb_migrations" --hooksDir="$ROOT/pb_hooks" >"$TMP/pb.log" 2>&1 &
PB_PID=$!
for i in $(seq 1 40); do curl -sf "$PB_URL/api/health" >/dev/null && break; sleep 0.5; done
node "$ROOT/tools/smoke-test.mjs" || { echo '--- log de PocketBase ---'; tail -40 "$TMP/pb.log"; exit 1; }
