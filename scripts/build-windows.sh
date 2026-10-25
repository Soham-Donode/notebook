#!/usr/bin/env bash
# Cross-compile the Windows installer from macOS/Linux using cargo-xwin + NSIS.
# Output: builds/windows/
#
# One-time setup:
#   rustup target add x86_64-pc-windows-msvc
#   cargo install cargo-xwin
#   brew install llvm nsis          # macOS
#   sudo apt install nsis llvm     # Linux
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version")"
TARGET="${TARGET:-x86_64-pc-windows-msvc}"
OUT="builds/windows"

if ! command -v cargo-xwin >/dev/null 2>&1; then
  echo "cargo-xwin is required: cargo install cargo-xwin" >&2
  exit 1
fi
if ! command -v makensis >/dev/null 2>&1; then
  echo "NSIS is required: brew install nsis (macOS) / apt install nsis (Linux)" >&2
  exit 1
fi

# cargo-xwin uses clang-cl/lld-link from LLVM.
if [ -d /opt/homebrew/opt/llvm/bin ]; then
  export PATH="/opt/homebrew/opt/llvm/bin:$PATH"
fi

echo "==> Building Windows installer ($TARGET)"
npx tauri build --runner cargo-xwin --target "$TARGET" --bundles nsis

mkdir -p "$OUT"
find "src-tauri/target/$TARGET/release/bundle/nsis" -maxdepth 1 -type f -name '*.exe' \
  -exec cp -f {} "$OUT/" \;

echo "==> Windows artifacts:"
ls -lh "$OUT"
