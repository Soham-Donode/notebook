#!/usr/bin/env bash
# Build the macOS .app, zip it and wrap it in a DMG.
# Output: builds/macos/
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version")"
case "$(uname -m)" in
  arm64)  ARCH=aarch64 ;;
  x86_64) ARCH=x86_64 ;;
  *)      ARCH="$(uname -m)" ;;
esac

APP="src-tauri/target/release/bundle/macos/Notebook.app"
OUT="builds/macos"
DMG="$OUT/Notebook_${VERSION}_${ARCH}.dmg"

echo "==> Building macOS app ($ARCH)"
npx tauri build --bundles app

mkdir -p "$OUT"
rm -f "$DMG" "$OUT/Notebook_${VERSION}_${ARCH}.app.zip"

echo "==> Creating DMG"
hdiutil create -volname "Notebook" -srcfolder "$APP" -ov -format UDZO "$DMG"

echo "==> Creating zipped app"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$OUT/Notebook_${VERSION}_${ARCH}.app.zip"

( cd "$OUT" && shasum -a 256 ./*.dmg ./*.zip > SHA256SUMS.txt )

echo "==> macOS artifacts:"
ls -lh "$OUT"
