#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTDIR="$ROOT/dist"
ENTRY="$ROOT/gu.ts"

mkdir -p "$OUTDIR"

# Permissions baked into the compiled binary (match what gu needs)
PERMS=(
  --allow-run=git
  --allow-read
  --allow-write
  --allow-env
  --allow-net=api.github.com
)

echo "Building gu binaries into: $OUTDIR"

echo "-> Building arm64 (Apple Silicon)..."
deno compile "${PERMS[@]}" \
  --target aarch64-apple-darwin \
  --output "$OUTDIR/gu-macos-arm64" \
  "$ENTRY"

echo "-> Building x86_64 (Intel)..."
deno compile "${PERMS[@]}" \
  --target x86_64-apple-darwin \
  --output "$OUTDIR/gu-macos-x64" \
  "$ENTRY"

echo "-> Creating universal binary (gu-macos-universal) via lipo..."
lipo -create \
  "$OUTDIR/gu-macos-arm64" \
  "$OUTDIR/gu-macos-x64" \
  -output "$OUTDIR/gu-macos-universal"

echo "Done."
echo
echo "Artifacts:"
ls -lh "$OUTDIR"/gu-macos-*

echo
echo "Verify architectures:"
lipo -info "$OUTDIR/gu-macos-universal" || true
