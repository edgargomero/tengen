#!/usr/bin/env bash
# Descarga los ONNX publicados a packages/engine/models/ y valida bytes.
# Los de conversión propia (bytes=0 en registry.ts) no se tocan aquí.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p models

download() { # id url bytes
  local id="$1" url="$2" bytes="$3"
  if [[ -f "models/$id" && "$(stat -f%z "models/$id")" == "$bytes" ]]; then
    echo "OK  $id (ya descargado)"
    return
  fi
  echo "GET $id"
  curl -fL --retry 3 -o "models/$id.part" "$url"
  local got
  got="$(stat -f%z "models/$id.part")"
  if [[ "$got" != "$bytes" ]]; then
    echo "ERROR: $id esperaba $bytes bytes, llegó $got" >&2
    exit 1
  fi
  mv "models/$id.part" "models/$id"
}

download b28c512nbt-kaya.fp16.onnx \
  "https://huggingface.co/kaya-go/kaya/resolve/main/kata1-b28c512nbt-s12043015936-d5616446734/kata1-b28c512nbt-s12043015936-d5616446734.fp16.onnx" 146963282
download b28c512nbt-kaya.fp32.onnx \
  "https://huggingface.co/kaya-go/kaya/resolve/main/kata1-b28c512nbt-s12043015936-d5616446734/kata1-b28c512nbt-s12043015936-d5616446734.fp32.onnx" 293099607
download b18c384-weiqiplayground.fp32.onnx \
  "https://huggingface.co/WeiqiPlayground/b18c384/resolve/main/model.onnx" 118065568
download b18c384nbt-humanv0-misopa.uint8.onnx \
  "https://huggingface.co/Misopa/baduk-human-sl/resolve/main/b18c384nbt-humanv0.uint8.onnx" 28418918
echo "Modelos listos en packages/engine/models/"
