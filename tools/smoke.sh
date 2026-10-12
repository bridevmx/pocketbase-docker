#!/usr/bin/env bash
# Levanta instancias temporales de PocketBase con las migraciones y hooks de este repo y corre las pruebas.
#   PB_BIN=/ruta/a/pocketbase tools/smoke.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PB_BIN="${PB_BIN:-pocketbase}"
export SU_EMAIL=admin@test.mx SU_PASS=superpass-12345
FAILED=0
run() { # run <script> <puerto>
  local TMP; TMP="$(mktemp -d)"
  export PB_URL="http://127.0.0.1:$2"
  "$PB_BIN" migrate up --dir="$TMP/pb_data" --migrationsDir="$ROOT/pb_migrations" >/dev/null
  "$PB_BIN" superuser upsert "$SU_EMAIL" "$SU_PASS" --dir="$TMP/pb_data" --migrationsDir="$ROOT/pb_migrations" >/dev/null
  "$PB_BIN" serve --http=127.0.0.1:"$2" --dir="$TMP/pb_data" --migrationsDir="$ROOT/pb_migrations" --hooksDir="$ROOT/pb_hooks" >"$TMP/pb.log" 2>&1 &
  local PID=$!
  for i in $(seq 1 40); do curl -sf "$PB_URL/api/health" >/dev/null && break; sleep 0.5; done
  echo "=== $1 ==="
  node "$ROOT/tools/$1" || { FAILED=1; echo '--- log de PocketBase (errores) ---'; grep -E "ERROR|└─" "$TMP/pb.log" | tail -25; }
  kill $PID 2>/dev/null || true; wait $PID 2>/dev/null || true
  rm -rf "$TMP"
}
run smoke-test.mjs 8099
run smoke-sales.mjs 8100
run smoke-inventory.mjs 8101
run smoke-cashier.mjs 8102
exit $FAILED
