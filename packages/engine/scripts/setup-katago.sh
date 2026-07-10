#!/usr/bin/env bash
# Instala KataGo 1.16.5 y descarga los checkpoints oficiales para generar
# vectores de referencia. Los .bin.gz NO se commitean (gitignored).
set -euo pipefail
cd "$(dirname "$0")/.."
command -v katago >/dev/null || brew install katago
katago version | grep -q '1.16' || echo "AVISO: se esperaba KataGo 1.16.x"
mkdir -p models/katago-bin
dl() { # url dest bytes
  [[ -f "$2" && "$(stat -f%z "$2")" == "$3" ]] && { echo "OK $2"; return; }
  curl -fL --retry 3 -o "$2.part" "$1" && mv "$2.part" "$2"
}
dl "https://media.katagotraining.org/uploaded/networks/models/kata1/kata1-b18c384nbt-s9996604416-d4316597426.bin.gz" \
   "models/katago-bin/b18c384nbt.bin.gz" 97898094
dl "https://github.com/lightvector/KataGo/releases/download/v1.15.0/b18c384nbt-humanv0.bin.gz" \
   "models/katago-bin/humanv0.bin.gz" 99066230
echo "KataGo listo. Redes en models/katago-bin/ (gitignored)."
