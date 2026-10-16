#!/usr/bin/env bash
# Pruebas de seguridad de pbmini. Uso: security/run-mini.sh /ruta/a/pocketbase
set -u
PB=${1:?ruta al binario pocketbase}; HERE=$(cd "$(dirname "$0")" && pwd); ROOT=$(dirname "$HERE"); fail=0
W=$(mktemp -d); PORT=8095; B=http://127.0.0.1:$PORT; PID=
stop(){ [[ -n $PID ]] && kill $PID 2>/dev/null && wait $PID 2>/dev/null; PID=; }
trap 'stop; rm -rf "$W"' EXIT
setup(){ # $1 = archivo routes.js
  stop; rm -rf "$W"/*; mkdir -p "$W/outside" "$W/pb_data" "$W/pb_public/sub" "$W/pb_hooks"
  cp -r "$ROOT/pb_hooks/lib" "$ROOT/pb_hooks/views" "$W/pb_hooks/"; cp "$ROOT/pb_hooks/main.pb.js" "$W/pb_hooks/"; cp "$1" "$W/pb_hooks/routes.js"
  echo TOP-SECRET-OUTSIDE > "$W/outside/secret.txt"; echo ENV=hunter2 > "$W/pb_public/.env"; echo pub > "$W/pb_public/pub.txt"; echo sub > "$W/pb_public/sub/a.txt"
  echo "<h1>idx</h1>" > "$W/pb_public/index.html"; ln -s "$W/outside/secret.txt" "$W/pb_public/link.txt"; ln -s "$W/outside" "$W/pb_public/dirlink"
  (cd "$W" && "$PB" serve --http=127.0.0.1:$PORT --dir="$W/pb_data" --publicDir="$W/pb_public" --hooksDir="$W/pb_hooks" >"$W/log" 2>&1 </dev/null) &
  PID=$!; sleep 4; }
# chk <no-debe-contener|-> <código> <ruta> [args curl]
chk(){ local leak=$1 code=$2 path=$3; shift 3; local out c
  out=$(curl -s --path-as-is -m5 -w '\n%{http_code}' "$@" "$B$path"); c=${out##*$'\n'}
  if [[ $c != "$code" ]] || { [[ $leak != - ]] && grep -q -- "$leak" <<<"$out"; }; then echo "FAIL ${*:0:60} $path (got $c)"; fail=1; else echo "ok   $path ($c)"; fi; }
hdr(){ if curl -sI -m5 "$B$2" | grep -qi -- "$1"; then echo "ok   header $1 en $2"; else echo "FAIL falta header $1 en $2"; fail=1; fi; }

echo "## Rutas válidas y ataques"; setup "$HERE/mini/routes.js"
chk - 200 /assets/pub.txt; chk - 200 /assets/sub/a.txt
for p in /assets/.env /assets/link.txt /assets/dirlink/secret.txt /assets/sub /assets/..%2foutside%2fsecret.txt /assets/%2e%2e/outside/secret.txt /assets/sub/..%2f..%2foutside%2fsecret.txt '/assets/..\outside\secret.txt' '/assets/pub.txt%00.png' /assets/%252e%252e%252foutside/secret.txt /assets/sub/.%2e/pub.txt; do chk 'TOP-SECRET\|hunter2' 404 "$p"; done
chk - 200 /u/abcdefghijklmno; chk - 404 /u/abc; chk - 404 /u/%2e%2e; chk - 404 '/u/ABCDEFGHIJKLMNO'
chk - 200 /blog/hola-mundo; chk - 404 /blog/Hola; chk - 404 '/blog/a%2fb'
chk - 401 /me; chk - 401 /admin/
chk '<script>' 200 '/hi?name=<script>alert(1)</script>'
for to in https://evil.example //evil.example '/\evil.example' 'javascript:alert(1)'; do chk - 500 "/go?to=$to"; done
chk - 302 '/go?to=/dashboard'
chk hunter2 500 /boom
head -c 5000 /dev/zero | tr '\0' a > "$W/big"; chk - 413 /form -X POST --data-binary @"$W/big"; chk - 200 /form -X POST -d ok
for i in 1 2 3; do curl -s -o /dev/null "$B/rl"; done; chk - 429 /rl
for h in content-security-policy referrer-policy x-content-type-options permissions-policy; do hdr $h /u/abcdefghijklmno; done

echo "## Rutas mal declaradas deben abortar el arranque"
bad(){ # $1 descripción, $2 cuerpo de routes
  printf 'module.exports = (app) => { %s };\n' "$2" > "$W.bad.js"; setup "$W.bad.js"
  if grep -q 'pbmini: ' "$W/log" && ! kill -0 $PID 2>/dev/null; then echo "ok   rechazada: $1"; else echo "FAIL aceptada: $1"; fail=1; fi; }
bad "sin auth" 'app.get("/x", {}, (c) => c.text("x"));'
bad "sin opts" 'app.get("/x", (c) => c.text("x"));'
bad "auth inválido" 'app.get("/x", {auth:"admin"}, (c) => c.text("x"));'
bad "comodín '/' accidental" 'app.get("/", {auth:"public"}, (c) => c.text("x"));'
bad "prefijo con barra final" 'app.get("/files/", {auth:"public"}, (c) => c.text("x"));'
bad "prefijo /api/" 'app.get("/api/x", {auth:"public"}, (c) => c.text("x"));'
bad "duplicada" 'app.get("/x", {auth:"public"}, (c) => c.text("x")); app.get("/x", {auth:"public"}, (c) => c.text("y"));'
bad "tipo de parámetro desconocido" 'app.get("/x/{id}", {auth:"public", params:{id:"nope"}}, (c) => c.text("x"));'
rm -f "$W.bad.js"; exit $fail
