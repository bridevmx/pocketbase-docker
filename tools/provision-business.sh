#!/usr/bin/env bash
# Crea e inicia la instancia de un negocio nuevo (una por negocio).
#   tools/provision-business.sh <slug> [dir-base=/srv/tpv]
# Requiere docker, la red `tpv` (docker network create tpv) y el proxy de deploy/Caddyfile.
# Imprime las credenciales del superusuario de ESA instancia: guárdalas en tu panel de control.
set -euo pipefail
SLUG="${1:?uso: provision-business.sh <slug> [dir-base]}"
[[ "$SLUG" =~ ^[a-z0-9]+$ ]] || { echo "slug: solo minúsculas y números" >&2; exit 2; }
BASE="${2:-/srv/tpv}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$BASE/instances/$SLUG"
[ -e "$DIR" ] && { echo "ya existe $DIR" >&2; exit 1; }
mkdir -p "$DIR/pb_data"
ENCRYPTION="$(openssl rand -hex 16)"
SU_PASS="$(openssl rand -hex 16)"
sed "s#../../pb_migrations#$ROOT/pb_migrations#; s#../../pb_hooks#$ROOT/pb_hooks#" "$ROOT/deploy/docker-compose.business.yml" > "$DIR/docker-compose.yml"
printf 'SLUG=%s\nENCRYPTION=%s\n' "$SLUG" "$ENCRYPTION" > "$DIR/.env"
chmod 600 "$DIR/.env"
(cd "$DIR" && docker compose up -d)
for i in $(seq 1 60); do docker exec "pb-$SLUG" wget -qO- http://localhost:8090/api/health >/dev/null 2>&1 && break; sleep 1; done
docker exec "pb-$SLUG" /usr/local/bin/pocketbase superuser upsert "admin@$SLUG.local" "$SU_PASS" --dir=/pb_data >/dev/null
echo "instancia:    pb-$SLUG  ($DIR)"
echo "superusuario: admin@$SLUG.local / $SU_PASS"
echo "siguiente:    node tools/set-license.mjs --url https://$SLUG.tpv.ejemplo.com --email admin@$SLUG.local --pass '$SU_PASS' --plan pro ..."
