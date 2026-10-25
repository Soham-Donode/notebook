#!/usr/bin/env bash
# Build the Linux bundles (deb + AppImage) inside a Debian container.
# Works from macOS/arm64 and CI. Output is copied to builds/linux/.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NODE_VERSION="${NODE_VERSION:-24.10.0}"
RUST_IMAGE="${RUST_IMAGE:-rust:1.98-bookworm}"
PLATFORM="${PLATFORM:-linux/arm64}"

echo "==> Building Linux bundles in Docker ($PLATFORM, node $NODE_VERSION)"

docker run --rm \
  --platform "$PLATFORM" \
  -e NODE_VERSION="$NODE_VERSION" \
  -e CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-6}" \
  -v "$ROOT":/app \
  -v notebook_node_modules:/app/node_modules \
  -v notebook_linux_target:/app/src-tauri/target \
  -w /app \
  "$RUST_IMAGE" \
  bash -lc '
    set -euo pipefail
    export PATH="/usr/local/cargo/bin:$PATH"

    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      build-essential pkg-config curl wget file ca-certificates \
      libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
      librsvg2-dev libssl-dev libxdo-dev patchelf dpkg-dev xdg-utils

    case "$(uname -m)" in
      aarch64|arm64) NODE_ARCH=arm64 ;;
      x86_64|amd64)  NODE_ARCH=x64 ;;
      *) echo "Unsupported arch: $(uname -m)" >&2; exit 1 ;;
    esac

    if ! command -v node >/dev/null 2>&1; then
      curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" -o /tmp/node.tar.xz
      tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1
    fi

    npm ci --no-audit --no-fund
    npx tauri build --bundles deb,appimage

    mkdir -p builds/linux
    find src-tauri/target/release/bundle -maxdepth 2 -type f \
      \( -name "*.deb" -o -name "*.AppImage" -o -name "*.rpm" \) \
      -exec cp -f {} builds/linux/ \;
  '

echo "==> Linux artifacts:"
ls -lh builds/linux
