#!/usr/bin/env bash
# Descarga el material de https://www.fedibergo.org/ensananza (página + PDFs
# de /files/ensenanza/) a esta carpeta. Herramienta local, no producto —
# contenido de terceros sin veredicto de licencia, ver .gitignore.
set -euo pipefail

cd "$(dirname "$0")"

BASE="https://www.fedibergo.org"
PAGE="$BASE/ensananza"

echo "Descargando página $PAGE..."
curl -sL "$PAGE" -o ensananza.html

echo "Extrayendo enlaces a PDFs..."
grep -oE 'href="/files/ensenanza/[^"]*"' ensananza.html \
  | sed 's/href="//;s/"$//' \
  | sort -u > pdfs.txt

mkdir -p files/ensenanza
total=$(wc -l < pdfs.txt | tr -d ' ')
echo "Descargando $total PDFs..."

i=0
while IFS= read -r path; do
  i=$((i + 1))
  name="$(basename "$path")"
  printf '[%d/%d] %s\n' "$i" "$total" "$name"
  curl -sL "$BASE$path" -o "files/ensenanza/$name"
done < pdfs.txt

echo "Listo. $total PDFs en files/ensenanza/, página en ensananza.html."
