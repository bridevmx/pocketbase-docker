#!/usr/bin/env bash
# Lint de código de aplicación pbmini. Uso: lint.sh <archivo|directorio>...
#  - .js (routes.js, pages/**): sólo la API `c`; prohíbe primitivas del sistema y evaluación dinámica.
#  - .html (pages, views): prohíbe `raw` (desactiva el autoescape de $template) y funciones de inclusión externas.
# Se ignoran lib/ y *.pb.js (infraestructura del framework).
set -u; fail=0
JS='\$app|\$os|\$http|\$security|\$apis|\$template|routerAdd|routerUse|require\(|\be\.(request|response|fileFS|html|blob|json|string)|\beval\b|new Function|\bFunction\(|__hooks'
HTML='(\|[[:space:]]*raw\b)|(\{\{[^}]*\braw\b)|\{\{[[:space:]]*(js|html)[[:space:]]'
files=(); for t in "$@"; do
  if [[ -d $t ]]; then while IFS= read -r f; do files+=("$f"); done < <(find "$t" -type f \( -name '*.js' -o -name '*.html' \) -not -path '*/lib/*' -not -name '*.pb.js' | sort)
  else files+=("$t"); fi; done
for f in "${files[@]}"; do
  case $f in *.js) re=$JS;; *.html) re=$HTML;; *) continue;; esac
  # ignora líneas de comentario // puro
  bad=$(grep -nE "$re" "$f" | grep -vE '^[0-9]+:[[:space:]]*//' )
  if [[ -n $bad ]]; then echo "LINT FAIL $f:"; echo "$bad" | sed 's/^/   /'; fail=1; fi
done
[[ $fail == 0 ]] && echo "ok   lint (${#files[@]} archivos)"; exit $fail
