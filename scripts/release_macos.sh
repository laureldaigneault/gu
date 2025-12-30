#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTDIR="$ROOT/dist"
ENTRY="$ROOT/gu.ts"

mkdir -p "$OUTDIR"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "❌ Missing required command: $1"
    exit 1
  }
}

need_cmd deno
need_cmd lipo
need_cmd zip

PERMS=(
  --allow-run=git
  --allow-read
  --allow-write
  --allow-env
  --allow-net=api.github.com
)

echo "Building gu for macOS..."
echo "ROOT:   $ROOT"
echo "OUTDIR: $OUTDIR"

ARM_OUT="$OUTDIR/gu-macos-arm64"
X64_OUT="$OUTDIR/gu-macos-x64"
UNI_OUT="$OUTDIR/gu-macos-universal"

echo "-> arm64"
deno compile "${PERMS[@]}" \
  --target aarch64-apple-darwin \
  --output "$ARM_OUT" \
  "$ENTRY"

echo "-> x86_64"
deno compile "${PERMS[@]}" \
  --target x86_64-apple-darwin \
  --output "$X64_OUT" \
  "$ENTRY"

echo "-> universal (lipo)"
lipo -create "$ARM_OUT" "$X64_OUT" -output "$UNI_OUT"

chmod +x "$ARM_OUT" "$X64_OUT" "$UNI_OUT"

# --- package zip (all binaries + install/uninstall scripts) ---
INSTALL_SRC="$ROOT/scripts/install.sh"
UNINSTALL_SRC="$ROOT/scripts/uninstall.sh"

if [[ ! -f "$INSTALL_SRC" ]]; then
  echo "❌ Missing installer script at: $INSTALL_SRC"
  echo "Create it at scripts/install.sh and re-run."
  exit 1
fi

if [[ ! -f "$UNINSTALL_SRC" ]]; then
  echo "❌ Missing uninstall script at: $UNINSTALL_SRC"
  echo "Create it at scripts/uninstall.sh and re-run."
  exit 1
fi

STAGE_DIR="$OUTDIR/gu-macos"
ZIP_PATH="$OUTDIR/gu-macos.zip"

rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"

# Copy ALL binaries into the zip staging directory
cp -f "$ARM_OUT" "$STAGE_DIR/gu-macos-arm64"
cp -f "$X64_OUT" "$STAGE_DIR/gu-macos-x64"
cp -f "$UNI_OUT" "$STAGE_DIR/gu-macos-universal"

# Copy scripts
cp -f "$INSTALL_SRC" "$STAGE_DIR/install.sh"
cp -f "$UNINSTALL_SRC" "$STAGE_DIR/uninstall.sh"

# Ensure executability survives unzip (nice-to-have)
chmod +x "$STAGE_DIR/gu-macos-arm64" "$STAGE_DIR/gu-macos-x64" "$STAGE_DIR/gu-macos-universal"
chmod +x "$STAGE_DIR/install.sh" "$STAGE_DIR/uninstall.sh" || true

rm -f "$ZIP_PATH"

echo "-> zipping to $ZIP_PATH"
(
  cd "$OUTDIR"
  zip -r "gu-macos.zip" "gu-macos"
)

# Verify zip exists
if [[ ! -f "$ZIP_PATH" ]]; then
  echo "❌ Zip was not created: $ZIP_PATH"
  echo "Contents of dist:"
  ls -la "$OUTDIR"
  exit 1
fi

echo
echo "✅ Done. Artifacts:"
ls -lh "$ZIP_PATH"

echo
echo "Zip contents:"
zipinfo -1 "$ZIP_PATH" | sed 's/^/  - /'
