# Builds

Production installers for Notebook, grouped by platform.

```
builds/
├── macos/    Notebook_<version>_<arch>.dmg, .app.zip
├── linux/    Notebook_<version>_<arch>.deb, .AppImage
└── windows/  Notebook_<version>_<arch>-setup.exe
```

Artifacts from each build are also checksummed where the platform tooling allows it.

## Regenerating

```bash
npm run build:macos     # native, on macOS
npm run build:linux     # Docker (Debian bookworm) — works from macOS or Linux
npm run build:windows   # cross-compiled with cargo-xwin + NSIS
```

Windows cross-compilation needs a one-time setup:

```bash
rustup target add x86_64-pc-windows-msvc
cargo install cargo-xwin
brew install llvm nsis
```

Linux builds use the `scripts/build-linux.sh` Docker wrapper, so no Linux packages are
installed on the host. Pass `PLATFORM=linux/amd64` to target Intel/AMD machines.

Binaries in this folder are ignored by git — rebuild them when you need a release.
