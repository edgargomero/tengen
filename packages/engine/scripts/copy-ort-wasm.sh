#!/usr/bin/env bash
# ORT-web necesita servir sus .wasm/.mjs desde la MISMA versión que el bundle JS.
# node_modules/onnxruntime-web puede vivir en el workspace hoisteado (raíz del
# monorepo) en vez de packages/engine/node_modules — se resuelve con Node en
# vez de asumir una ruta relativa fija.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p public/wasm
ORT_DIST="$(dirname "$(node -p "require.resolve('onnxruntime-web')")")"
cp "$ORT_DIST"/*.wasm "$ORT_DIST"/*.mjs public/wasm/
echo "runtime ORT copiado a public/wasm/"
