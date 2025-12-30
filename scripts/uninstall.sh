#!/usr/bin/env bash
set -euo pipefail

TARGET="$HOME/.local/bin/gu"

ZSHRC="$HOME/.zshrc"
ZPROFILE="$HOME/.zprofile"
BASHRC="$HOME/.bashrc"
BASH_PROFILE="$HOME/.bash_profile"

CONFIG_MAC="$HOME/Library/Application Support/gu"
CONFIG_XDG="$HOME/.config/gu"
CONFIG_XDG_HOME="${XDG_CONFIG_HOME:-}"

CONFIG_DIR=""
if [[ -d "$CONFIG_MAC" ]]; then
  CONFIG_DIR="$CONFIG_MAC"
elif [[ -n "$CONFIG_XDG_HOME" && -d "$CONFIG_XDG_HOME/gu" ]]; then
  CONFIG_DIR="$CONFIG_XDG_HOME/gu"
elif [[ -d "$CONFIG_XDG" ]]; then
  CONFIG_DIR="$CONFIG_XDG"
else
  # default guess
  if [[ "$(uname -s)" == "Darwin" ]]; then
    CONFIG_DIR="$CONFIG_MAC"
  else
    CONFIG_DIR="$CONFIG_XDG"
  fi
fi

remove_path_block() {
  local rcfile="$1"
  [[ -f "$rcfile" ]] || return 0

  # Remove the exact block inserted by installer.
  # We use perl because macOS sed has awkward multiline deletion.
  /usr/bin/perl -0777 -i -pe 's/\n# --- gu installer PATH block \(do not remove\) ---.*?# --- end gu installer PATH block ---\n//s' "$rcfile" 2>/dev/null || true
}

echo "This will uninstall 'gu' from:"
echo "  $TARGET"
echo
read -r -p "Continue? (y/N): " yn
case "${yn:-}" in
  y|Y|yes|YES) ;;
  *) echo "Cancelled."; exit 0 ;;
esac

# 1) Remove binary
if [[ -f "$TARGET" ]]; then
  rm -f "$TARGET"
  echo "✅ Removed binary: $TARGET"
else
  echo "ℹ️  Binary not found at: $TARGET"
fi

# 2) Remove PATH block (optional)
echo
read -r -p "Remove PATH block from shell rc files? (y/N): " yn2
case "${yn2:-}" in
  y|Y|yes|YES)
    remove_path_block "$ZSHRC"
    remove_path_block "$ZPROFILE"
    remove_path_block "$BASH_PROFILE"
    remove_path_block "$BASHRC"
    echo "✅ Removed PATH block (if present) from rc files."
    ;;
  *)
    echo "ℹ️  Skipped PATH block removal."
    ;;
esac

# 3) Remove config (optional)
echo
echo "Config directory (detected/assumed):"
echo "  $CONFIG_DIR"
read -r -p "Remove gu config file(s) too? This deletes tokens. (y/N): " yn3
case "${yn3:-}" in
  y|Y|yes|YES)
    if [[ -d "$CONFIG_DIR" ]]; then
      rm -rf "$CONFIG_DIR"
      echo "✅ Removed config dir: $CONFIG_DIR"
    else
      echo "ℹ️  Config dir not found: $CONFIG_DIR"
    fi
    ;;
  *)
    echo "ℹ️  Kept config."
    ;;
esac

echo
echo "✅ Uninstall complete."
echo "You may need to reload your shell if you removed PATH blocks:"
echo "  source ~/.zshrc && rehash"
