#!/usr/bin/env bash
# Las rutas de aplicación sólo deben usar la API `c` de pbmini. Falla si usan primitivas peligrosas.
f=${1:?routes.js}; bad=$(grep -nE '\$app|\$os|\$http|\$security|routerAdd|routerUse|require\(|\be\.(request|response|fileFS|html|blob)|\beval\b|new Function|\.innerHTML' "$f")
if [[ -n $bad ]]; then echo "LINT FAIL en $f:"; echo "$bad"; exit 1; fi; echo "ok   lint $f"
