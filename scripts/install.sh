#!/usr/bin/env bash
set -euo pipefail

# Run:
#   bash install.sh
#   bash install.sh universal
#   bash install.sh arm64
#   bash install.sh x64
#   bash install.sh /full/path/to/gu-binary

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

BIN_UNI="$SCRIPT_DIR/gu-macos-universal"
BIN_ARM="$SCRIPT_DIR/gu-macos-arm64"
BIN_X64="$SCRIPT_DIR/gu-macos-x64"

INSTALL_DIR="$HOME/.local/bin"
TARGET="$INSTALL_DIR/gu"

BIN_INPUT="${1:-}"
BIN_PATH=""

machine_arch() { uname -m 2>/dev/null || echo ""; }

autodetect_choice() {
  local arch; arch="$(machine_arch)"
  if [[ "$arch" == "arm64" ]]; then echo "arm64"
  elif [[ "$arch" == "x86_64" ]]; then echo "x64"
  else echo "universal"
  fi
}

resolve_keyword_to_path() {
  local keyword="$1"
  case "$keyword" in
    universal) [[ -f "$BIN_UNI" ]] && echo "$BIN_UNI" || echo "" ;;
    arm64)     [[ -f "$BIN_ARM" ]] && echo "$BIN_ARM" || echo "" ;;
    x64)       [[ -f "$BIN_X64" ]] && echo "$BIN_X64" || echo "" ;;
    *)         echo "" ;;
  esac
}

pick_binary_menu() {
  echo "Select which gu binary to install:"
  echo

  local options=()
  local labels=()

  if [[ -f "$BIN_UNI" ]]; then options+=("$BIN_UNI"); labels+=("universal"); fi
  if [[ -f "$BIN_ARM" ]]; then options+=("$BIN_ARM"); labels+=("arm64"); fi
  if [[ -f "$BIN_X64" ]]; then options+=("$BIN_X64"); labels+=("x64"); fi

  if [[ ${#options[@]} -eq 0 ]]; then
    echo "❌ No binaries found next to this installer."
    echo "Expected one of:"
    echo "  - gu-macos-universal"
    echo "  - gu-macos-arm64"
    echo "  - gu-macos-x64"
    exit 1
  fi

  for idx in "${!options[@]}"; do
    printf "  %d) %s\n" "$((idx + 1))" "${labels[$idx]}"
  done
  echo

  while true; do
    read -r -p "Enter a number (1-${#options[@]}): " choice
    if [[ "$choice" =~ ^[0-9]+$ ]] && (( choice >= 1 && choice <= ${#options[@]} )); then
      BIN_PATH="${options[$((choice - 1))]}"
      break
    fi
    echo "Invalid selection. Try again."
  done
}

# Absolute path given
if [[ -n "$BIN_INPUT" && "$BIN_INPUT" = /* ]]; then
  BIN_PATH="$BIN_INPUT"
  [[ -f "$BIN_PATH" ]] || { echo "❌ Provided binary not found: $BIN_PATH"; exit 1; }
fi

# Keyword or filename given
if [[ -z "$BIN_PATH" && -n "$BIN_INPUT" ]]; then
  kw_path="$(resolve_keyword_to_path "$BIN_INPUT" || true)"
  if [[ -n "$kw_path" ]]; then
    BIN_PATH="$kw_path"
  else
    candidate="$SCRIPT_DIR/$BIN_INPUT"
    if [[ -f "$candidate" ]]; then
      BIN_PATH="$candidate"
    else
      echo "⚠️  Could not resolve '$BIN_INPUT' to a binary. Switching to interactive selection..."
      echo
      pick_binary_menu
    fi
  fi
fi

# No input: autodetect
if [[ -z "$BIN_PATH" ]]; then
  default="$(autodetect_choice)"
  echo "Auto-detected $(machine_arch) → default '$default'"

  BIN_PATH="$(resolve_keyword_to_path "$default" || true)"
  if [[ -z "$BIN_PATH" ]]; then
    BIN_PATH="$(resolve_keyword_to_path "universal" || true)"
  fi
  if [[ -z "$BIN_PATH" ]]; then
    pick_binary_menu
  fi
fi

[[ -n "${BIN_PATH:-}" && -f "$BIN_PATH" ]] || { echo "❌ Could not determine which binary to install."; exit 1; }

mkdir -p "$INSTALL_DIR"

echo
echo "✅ Selected binary: $BIN_PATH"
echo "📦 Installing to:   $TARGET"
echo

if command -v xattr >/dev/null 2>&1; then
  echo "🔓 Removing quarantine attribute (best-effort)..."
  xattr -dr com.apple.quarantine "$BIN_PATH" 2>/dev/null || true
fi

if [[ -f "$TARGET" ]]; then
  echo "♻️  Existing install found at $TARGET — updating it."
fi

cp -f "$BIN_PATH" "$TARGET"

if command -v xattr >/dev/null 2>&1; then
  xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null || true
fi

chmod +x "$TARGET"

ensure_path_block() {
  local rcfile="$1"
  [[ -f "$rcfile" ]] || touch "$rcfile"
  if grep -q "gu installer PATH block" "$rcfile" 2>/dev/null; then
    return 0
  fi
  cat >> "$rcfile" <<'EOF'

# --- gu installer PATH block (do not remove) ---
# Added by gu installer so the 'gu' command is available.
if [ -d "$HOME/.local/bin" ] && [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
  export PATH="$HOME/.local/bin:$PATH"
fi
# --- end gu installer PATH block ---
EOF
}

case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *)
    echo "🧩 Adding ~/.local/bin to PATH in your shell rc files..."
    ensure_path_block "$HOME/.zshrc"
    ensure_path_block "$HOME/.bash_profile"
    ensure_path_block "$HOME/.bashrc"
    ;;
esac

# Make it available RIGHT NOW in the current shell session (this script process)
export PATH="$HOME/.local/bin:$PATH"

echo
echo "✅ Installed! Running: gu --help"
echo

if command -v gu >/dev/null 2>&1; then
  gu --help || true
else
  echo "⚠️  Installed, but 'gu' not found on PATH in this shell."
  echo "   Running directly instead:"
  echo
  "$TARGET" --help || true
fi

echo
echo "✅ Installation complete."
echo
echo "IMPORTANT:"
echo "You ran this installer via 'bash install.sh'."
echo "That means PATH changes were written to your shell rc files,"
echo "but your *current* terminal session won't see them until you reload."
echo
echo "Run ONE of these now:"
echo
echo "  # zsh (most macOS users)"
echo "  source ~/.zshrc && rehash"
echo
echo "  # bash"
echo "  source ~/.bash_profile && hash -r"
echo "  # or: source ~/.bashrc && hash -r"
echo
echo "Then try:"
echo "  gu --help"
echo "  gu configure"
echo "  gu clean-branches"
echo "  gu commit"
