#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT/dist"
ZIP="$DIST/gu-macos.zip"
STAGE="$DIST/gu-macos"
INSTALL="$STAGE/install.sh"

echo "🚀 Building + packaging release zip..."
deno task release:mac

if [[ ! -f "$ZIP" ]]; then
  echo "❌ Expected zip not found: $ZIP"
  exit 1
fi

echo "📦 Unzipping fresh staging dir..."
rm -rf "$STAGE"
mkdir -p "$DIST"
unzip -q "$ZIP" -d "$DIST"

if [[ ! -f "$INSTALL" ]]; then
  echo "❌ install.sh not found at: $INSTALL"
  echo "Zip contents:"
  zipinfo -1 "$ZIP" | sed 's/^/  - /'
  exit 1
fi

echo "🛠  Running installer (auto-detect)…"
bash "$INSTALL"

echo "✅ Done."
