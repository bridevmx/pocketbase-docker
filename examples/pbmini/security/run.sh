#!/usr/bin/env bash
# Levanta PocketBase aislado con rutas deliberadamente inseguras y verifica el comportamiento.
# Uso: security/run.sh /ruta/a/pocketbase
set -u
PB=${1:?ruta al binario pocketbase}; HERE=$(cd "$(dirname "$0")" && pwd); W=$(mktemp -d)
mkdir -p "$W/outside" "$W/pb_data" && cp -r "$HERE/fixtures/pb_hooks" "$HERE/fixtures/pb_public" "$W/"
echo TOP-SECRET-OUTSIDE > "$W/outside/secret.txt"; echo ENV=hunter2 > "$W/pb_public/.env"
ln -s "$W/outside/secret.txt" "$W/pb_public/link.txt"
"$PB" serve --http=127.0.0.1:8098 --dir="$W/pb_data" --publicDir="$W/pb_public" --hooksDir="$W/pb_hooks" >"$W/log" 2>&1 </dev/null &
PID=$!; trap 'kill $PID; rm -rf "$W"' EXIT; sleep 4
B=http://127.0.0.1:8098; fail=0
# expect <fragmento-que-NO-debe-aparecer|-> <código esperado> <ruta> [args curl]
chk(){ local leak=$1 code=$2 path=$3; shift 3
  out=$(curl -s --path-as-is -m5 -w '\n%{http_code}' "$@" "$B$path"); c=${out##*$'\n'}
  if [[ $c != "$code" ]] || { [[ $leak != - ]] && grep -q "$leak" <<<"$out"; }; then echo "FAIL $path (got $c)"; fail=1; else echo "ok   $path ($c)"; fi; }
echo "# Estático nativo: traversal bloqueado"
chk TOP-SECRET 307 /../outside/secret.txt; chk TOP-SECRET 200 /%2e%2e/outside/secret.txt; chk TOP-SECRET 200 /..%2foutside/secret.txt
echo "# \$apis.static: traversal bloqueado"; chk TOP-SECRET 404 /st/%2e%2e/outside/secret.txt
echo "# Conocidos: dotfiles y symlinks SÍ se sirven (debe auditarse el contenido de pb_public)"
chk - 200 /.env; chk - 200 /link.txt
echo "# Ruta insegura a propósito: %2f decodificado -> traversal real (debe FALLAR el chequeo)"
chk TOP-SECRET 200 /bad/read/..%2foutside%2fsecret.txt
echo "# Auth"; chk - 401 /admin/users; chk - 401 /area/x/y; chk - 200 /admin/open
echo "# XSS"; chk '<script>' 200 '/xss/auto?q=<script>x</script>'
echo "# Errores enmascarados"; chk hunter2 400 /throw
echo "# Sin ámbito externo"; chk - 200 /scope
exit $fail
