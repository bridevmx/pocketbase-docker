#!/usr/bin/env bash
# Descarga PocketBase (verificando SHA-256 oficial) y ejecuta lint + suites de seguridad.
# Uso: security/ci.sh <versión|latest> [directorio-de-trabajo]
set -euo pipefail
VER=${1:?versión (p. ej. 0.40.5) o "latest"}; HERE=$(cd "$(dirname "$0")" && pwd); WORK=${2:-$(mktemp -d)}
if [[ $VER == latest ]]; then
  AUTH=(); [[ -n ${GITHUB_TOKEN:-} ]] && AUTH=(-H "Authorization: Bearer $GITHUB_TOKEN")
  VER=$(curl -fsSL "${AUTH[@]}" https://api.github.com/repos/pocketbase/pocketbase/releases/latest 2>/dev/null | python3 -c 'import sys,json;print(json.load(sys.stdin)["tag_name"].lstrip("v"))' 2>/dev/null || true)
  if [[ -z $VER ]]; then # alternativa sin API: /releases/latest redirige a /releases/tag/vX.Y.Z
    VER=$(curl -fsSL -o /dev/null -w '%{url_effective}' https://github.com/pocketbase/pocketbase/releases/latest | sed -n 's|.*/tag/v||p')
  fi
  [[ -n $VER ]] || { echo "no se pudo resolver la última versión"; exit 2; }
fi
[[ $VER =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "versión inválida: $VER"; exit 2; }
case "$(uname -m)" in x86_64) ARCH=amd64;; aarch64|arm64) ARCH=arm64;; *) echo "arquitectura no soportada"; exit 2;; esac
ZIP="pocketbase_${VER}_linux_${ARCH}.zip"; URL="https://github.com/pocketbase/pocketbase/releases/download/v${VER}"
mkdir -p "$WORK/bin"; cd "$WORK"
curl -fsSL -o "$ZIP" "$URL/$ZIP"; curl -fsSL -o checksums.txt "$URL/checksums.txt"
grep " $ZIP\$" checksums.txt | sha256sum -c - >/dev/null || { echo "CHECKSUM INVÁLIDO para $ZIP"; exit 3; }
unzip -oq "$ZIP" -d bin; chmod +x bin/pocketbase
echo "== PocketBase $(bin/pocketbase --version) =="
"$HERE/lint.sh" "$HERE/../pb_hooks"
echo "== suite 1: router nativo (debilidades documentadas) =="; "$HERE/run.sh" "$WORK/bin/pocketbase"
echo "== suite 2: pbmini =="; "$HERE/run-mini.sh" "$WORK/bin/pocketbase"
echo "== suite 3: laboratorio de ataques (objetivo/meta) =="; python3 "$HERE/../lab/lab.py" --headless --pb "$WORK/bin/pocketbase"
