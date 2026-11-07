#!/usr/bin/env bash
# Builds dist/extension-<version>.zip for upload to the Chrome Web Store.
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
mkdir -p dist
out="dist/extension-$version.zip"
rm -f "$out"
zip -q "$out" manifest.json *.js *.css *.html icons/*.png
echo "$out"
