#!/usr/bin/env node
/**
 * Cross-platform production build runner for Notebook.
 *
 *   npm run build:current        # installers for the OS you are on
 *   npm run build:macos          # .dmg + .app.zip
 *   npm run build:windows        # NSIS .exe installer
 *   npm run build:linux          # .deb + .AppImage
 *   npm run build:all            # every target this host can produce
 *
 * Everything is written to builds/<platform>/ with a SHA256SUMS.txt.
 * See `node scripts/build.mjs --help` for options.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TAURI_CLI = path.join(ROOT, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
const HOST = process.platform; // 'darwin' | 'win32' | 'linux'
const HOST_ARCH = { arm64: 'aarch64', x64: 'x86_64' }[os.arch()] ?? os.arch();
const RUST_TARGETS = {
  macos: (arch) => (arch === 'universal' ? 'universal-apple-darwin' : `${arch}-apple-darwin`),
  windows: (arch) => `${arch}-pc-windows-msvc`,
  linux: (arch) => `${arch}-unknown-linux-gnu`,
};
const DEFAULT_BUNDLES = {
  macos: 'app,dmg',
  windows: 'nsis',
  linux: 'deb,appimage',
};
const PLATFORM_LABEL = { macos: 'macOS', windows: 'Windows', linux: 'Linux' };
const NODE_VERSION = process.env.NODE_VERSION ?? '24.10.0';
const APP_VERSION = JSON.parse(readFileSync(path.join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8')).version;

// ── tiny CLI ────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const options = {
    target: 'current',
    arch: HOST_ARCH,
    archExplicit: false,
    quality: false,
    ci: false,
    bundles: null,
    verbose: false,
    dryRun: false,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--arch') {
      options.arch = argv[++i];
      options.archExplicit = true;
    } else if (arg.startsWith('--arch=')) {
      options.arch = arg.slice(7);
      options.archExplicit = true;
    } else if (arg === '--bundles') options.bundles = argv[++i];
    else if (arg.startsWith('--bundles=')) options.bundles = arg.slice(10);
    else if (arg === '--quality') options.quality = true;
    else if (arg === '--ci') options.ci = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '-v' || arg === '--verbose') options.verbose = true;
    else if (arg === '-h' || arg === '--help') options.help = true;
    else if (arg.startsWith('-')) fail(`Unknown option: ${arg}`);
    else positional.push(arg);
  }
  if (positional[0]) options.target = positional[0];
  if (options.target === 'current' || options.target === 'host') options.target = HOST;
  if (!['macos', 'windows', 'linux', 'all', 'darwin', 'win32'].includes(options.target)) {
    fail(`Unknown target "${options.target}". Use macos, windows, linux, all or current.`);
  }
  options.target = { darwin: 'macos', win32: 'windows' }[options.target] ?? options.target;
  if (!['aarch64', 'x86_64', 'universal'].includes(options.arch)) {
    fail(`Unknown architecture "${options.arch}". Use aarch64, x86_64 or universal.`);
  }
  if (options.arch === 'universal' && options.target !== 'macos') {
    fail('--arch universal is only supported for macOS.');
  }
  return options;
}

function help() {
  console.log(`
Notebook production build

Usage:
  node scripts/build.mjs [target] [options]

Targets:
  current (default)  Build installers for the host OS
  macos              .dmg (drag-to-Applications window) + .app.zip
  windows            NSIS .exe installer
  linux              .deb + .AppImage
  all                Every target this host can produce

Options:
  --arch <arch>      aarch64 | x86_64 | universal (macOS only). Default: host
  --bundles <list>   Comma-separated Tauri bundles (overrides the platform default)
  --quality          Fat LTO + 1 codegen unit: slower build, smallest binary
  --ci               Non-interactive (passed to the Tauri CLI)
  --dry-run          Print what would be built without compiling anything
  -v, --verbose      Verbose Tauri output
  -h, --help         Show this help

Artifacts are written to builds/<platform>/ with SHA256SUMS.txt.
`.trim());
}

// ── logging / process helpers ───────────────────────────────────────────────
const startedAt = Date.now();
const log = (msg) => console.log(msg);
const step = (msg) => console.log(`\n\x1b[1m==>\x1b[0m ${msg}`);
const warn = (msg) => console.log(`\x1b[33mwarning:\x1b[0m ${msg}`);
const ok = (msg) => console.log(`\x1b[32m✓\x1b[0m ${msg}`);
const fail = (msg) => {
  console.error(`\x1b[31merror:\x1b[0m ${msg}`);
  process.exit(1);
};

function findCommand(name) {
  const suffixes = HOST === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    for (const suffix of suffixes) {
      const candidate = path.join(dir, name + suffix);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function run(command, args, { env = {}, allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: 'inherit',
      shell: false,
    });
    child.on('error', (error) => (allowFailure ? resolve(1) : reject(error)));
    child.on('exit', (code, signal) => {
      if (code === 0 || allowFailure) resolve(code ?? 1);
      else reject(new Error(`${path.basename(command)} exited with ${signal ?? code}`));
    });
  });
}

async function capture(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', () => resolve(null));
    child.on('exit', (code) => resolve(code === 0 ? out.trim() : null));
  });
}

// ── prerequisites ───────────────────────────────────────────────────────────
async function checkBaseTools() {
  if (!existsSync(TAURI_CLI)) {
    fail('Tauri CLI is missing. Run `npm ci` first.');
  }
  if (!findCommand('cargo') || !findCommand('rustc')) {
    fail('Rust is not installed. Install it from https://rustup.rs and reopen your terminal.');
  }
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  const nodeMinor = Number(process.versions.node.split('.')[1]);
  if (nodeMajor < 20 || (nodeMajor === 20 && nodeMinor < 19)) {
    fail(`Node.js 20.19+ is required (found ${process.version}).`);
  }
}

async function checkNativeTools(platform) {
  if (platform === 'macos') {
    if (HOST !== 'darwin') fail('macOS installers can only be built on macOS.');
    if (!findCommand('xcode-select') || !(await capture('xcode-select', ['-p']))) {
      fail('Xcode Command Line Tools are missing. Run `xcode-select --install`.');
    }
  }
  if (platform === 'windows' && HOST === 'win32') {
    if (!(await capture('rustc', ['-vV']))?.includes('windows-msvc')) {
      warn('Rust host is not the MSVC toolchain. Install the Visual Studio Build Tools if linking fails.');
    }
  }
  if (platform === 'linux' && HOST === 'linux') {
    const webkit = await capture('pkg-config', ['--modversion', 'webkit2gtk-4.1']);
    if (!webkit) {
      fail(
        'webkit2gtk-4.1 development headers are missing.\n' +
          '  Debian/Ubuntu: sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf\n' +
          '  Fedora: sudo dnf install webkit2gtk4.1-devel gtk3-devel libappindicator-gtk3-devel librsvg2-devel patchelf'
      );
    }
  }
}

async function rustTargetsInstalled() {
  const out = await capture('rustup', ['target', 'list', '--installed']);
  return out ? out.split(/\s+/).filter(Boolean) : [];
}

async function checkRustTargets(platform, arch) {
  if (!findCommand('rustup')) return;
  const installed = await rustTargetsInstalled();
  const needed =
    platform === 'macos' && arch === 'universal'
      ? ['aarch64-apple-darwin', 'x86_64-apple-darwin']
      : [RUST_TARGETS[platform](arch)];
  for (const target of needed) {
    if (HOST === 'darwin' && platform === 'macos' && arch === HOST_ARCH) continue; // host target is implicit
    if (!installed.includes(target)) {
      fail(`Rust target ${target} is not installed. Run \`rustup target add ${target}\`.`);
    }
  }
}

async function checkWindowsCrossTools() {
  if (!findCommand('cargo-xwin')) {
    fail('Cross-compiling for Windows needs cargo-xwin. Run `cargo install cargo-xwin`.');
  }
  if (!findCommand('makensis')) {
    fail('Cross-compiling for Windows needs NSIS. Install it with `brew install nsis` (macOS) or `apt install nsis` (Linux).');
  }
  const llvmDir = ['/opt/homebrew/opt/llvm/bin', '/usr/local/opt/llvm/bin'].find(existsSync);
  if (llvmDir) return { PATH: `${llvmDir}${path.delimiter}${process.env.PATH ?? ''}` };
  if (!findCommand('clang-cl') && !findCommand('lld-link')) {
    fail('Cross-compiling for Windows needs LLVM. Install it with `brew install llvm` (macOS) or `apt install llvm` (Linux).');
  }
  return {};
}

async function checkDocker() {
  if (!findCommand('docker')) {
    fail('Building Linux bundles from macOS needs Docker. Install Docker Desktop or build on Linux.');
  }
  if ((await capture('docker', ['info'])) === null) {
    fail('Docker is installed but the daemon is not running. Start Docker and try again.');
  }
}

// ── artifacts ───────────────────────────────────────────────────────────────
async function walk(dir) {
  const files = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else files.push(full);
  }
  return files;
}

async function cleanOutDir(outDir) {
  await mkdir(outDir, { recursive: true });
  for (const entry of await readdir(outDir, { withFileTypes: true })) {
    if (entry.name === '.gitkeep') continue;
    await rm(path.join(outDir, entry.name), { recursive: true, force: true });
  }
}

async function copyArtifacts(platform, bundleRoot, outDir, arch) {
  await cleanOutDir(outDir);
  if (!existsSync(bundleRoot)) {
    fail(`Tauri did not produce a bundle directory at ${path.relative(ROOT, bundleRoot)}.`);
  }

  const patterns = {
    macos: [/\.dmg$/i],
    windows: [/\.exe$/i, /\.msi$/i],
    linux: [/\.deb$/i, /\.AppImage$/i, /\.rpm$/i],
  }[platform];
  const files = (await walk(bundleRoot)).filter((file) => patterns.some((re) => re.test(file)));
  if (files.length === 0) {
    fail(`No ${PLATFORM_LABEL[platform]} installers were produced in ${path.relative(ROOT, bundleRoot)}.`);
  }
  for (const file of files) {
    await copyFile(file, path.join(outDir, path.basename(file)));
    ok(`packaged ${path.basename(file)}`);
  }

  if (platform === 'macos') {
    const macosDir = path.join(bundleRoot, 'macos');
    let apps = [];
    try {
      apps = (await readdir(macosDir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && entry.name.endsWith('.app'))
        .map((entry) => path.join(macosDir, entry.name));
    } catch {
      /* app bundle was not requested */
    }
    for (const app of apps) {
      const appName = path.basename(app, '.app');
      const zip = path.join(outDir, `${appName}_${APP_VERSION}_${arch}.app.zip`);
      await run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip]);
      ok(`packaged ${path.basename(zip)}`);
    }
  }

  await writeChecksums(outDir);
}

async function writeChecksums(outDir) {
  const files = (await readdir(outDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name !== 'SHA256SUMS.txt' && entry.name !== '.gitkeep')
    .map((entry) => entry.name)
    .sort();
  const lines = [];
  for (const name of files) {
    const hash = await sha256(path.join(outDir, name));
    lines.push(`${hash}  ${name}`);
  }
  const checksumFile = path.join(outDir, 'SHA256SUMS.txt');
  await writeFile(checksumFile, lines.join('\n') + '\n');
  ok(`wrote ${path.relative(ROOT, checksumFile)}`);
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function report(outDir) {
  const entries = (await readdir(outDir, { withFileTypes: true })).filter(
    (entry) => entry.isFile() && entry.name !== '.gitkeep'
  );
  if (entries.length === 0) return;
  log(`\n\x1b[1mArtifacts in ${path.relative(ROOT, outDir)}:\x1b[0m`);
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const info = await stat(path.join(outDir, entry.name));
    log(`  ${entry.name.padEnd(44)} ${(info.size / 1024 / 1024).toFixed(1)} MB`);
  }
}

// ── build strategies ────────────────────────────────────────────────────────
function tauriBuildArgs(platform, arch, options, { crossWindows = false } = {}) {
  const args = [TAURI_CLI, 'build'];
  if (options.ci) args.push('--ci');
  if (options.verbose) args.push('--verbose');
  if (crossWindows) {
    args.push('--runner', 'cargo-xwin');
  }
  const needsExplicitTarget = crossWindows || arch !== HOST_ARCH || arch === 'universal';
  if (needsExplicitTarget) args.push('--target', RUST_TARGETS[platform](arch));
  args.push('--bundles', options.bundles ?? DEFAULT_BUNDLES[platform]);
  return args;
}

function describeCommand(args) {
  const quoted = args.map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg));
  step(`[dry run] ${process.execPath} ${quoted.join(' ')}`);
}

function buildEnv(options) {
  if (options.quality) {
    return { CARGO_PROFILE_RELEASE_LTO: 'fat', CARGO_PROFILE_RELEASE_CODEGEN_UNITS: '1' };
  }
  return {};
}

function bundleRoot(platform, arch, forceTarget = false) {
  const needsTarget = forceTarget || arch !== HOST_ARCH || arch === 'universal';
  const targetDir = needsTarget ? RUST_TARGETS[platform](arch) : '';
  return path.join(ROOT, 'src-tauri', 'target', targetDir, 'release', 'bundle');
}

function archFor(platform, options) {
  if (options.archExplicit) return options.arch;
  // Cross-compiled Windows installers target Intel/AMD by default; native
  // builds use the host architecture.
  if (platform === 'windows' && HOST !== 'win32') return 'x86_64';
  return HOST_ARCH;
}

async function buildMacos(options) {
  const arch = archFor('macos', options);
  const outDir = path.join(ROOT, 'builds', 'macos');
  step(`Building macOS (${arch}) installers`);
  if (options.dryRun) {
    describeCommand(tauriBuildArgs('macos', arch, options));
    log(`      artifacts → ${path.relative(ROOT, outDir)}`);
    return;
  }
  await checkNativeTools('macos');
  await checkRustTargets('macos', arch);
  await run(process.execPath, tauriBuildArgs('macos', arch, options), { env: buildEnv(options) });
  await copyArtifacts('macos', bundleRoot('macos', arch), outDir, arch);
}

async function buildWindows(options) {
  const arch = archFor('windows', options);
  const cross = HOST !== 'win32';
  const outDir = path.join(ROOT, 'builds', 'windows');
  step(`Building Windows (${arch}) installer${cross ? ' via cargo-xwin' : ''}`);
  if (options.dryRun) {
    describeCommand(tauriBuildArgs('windows', arch, options, { crossWindows: cross }));
    log(`      artifacts → ${path.relative(ROOT, outDir)}`);
    return;
  }
  await checkNativeTools('windows');
  let env = buildEnv(options);
  if (cross) {
    await checkRustTargets('windows', arch);
    env = { ...env, ...(await checkWindowsCrossTools()) };
  }
  await run(process.execPath, tauriBuildArgs('windows', arch, options, { crossWindows: cross }), { env });
  await copyArtifacts('windows', bundleRoot('windows', arch, cross), outDir, arch);
}

async function buildLinux(options) {
  const arch = archFor('linux', options);
  const outDir = path.join(ROOT, 'builds', 'linux');
  if (HOST === 'linux') {
    step(`Building Linux (${arch}) bundles`);
    if (options.dryRun) {
      describeCommand(tauriBuildArgs('linux', arch, options));
      log(`      artifacts → ${path.relative(ROOT, outDir)}`);
      return;
    }
    await checkNativeTools('linux');
    await checkRustTargets('linux', arch);
    await run(process.execPath, tauriBuildArgs('linux', arch, options), { env: buildEnv(options) });
    await copyArtifacts('linux', bundleRoot('linux', arch), outDir, arch);
    return;
  }

  if (HOST !== 'darwin') {
    fail('Linux bundles must be built on Linux, or from macOS with Docker.');
  }
  step(`Building Linux (${arch}) bundles in Docker`);
  const platform = arch === 'aarch64' ? 'linux/arm64' : 'linux/amd64';
  const bundles = options.bundles ?? DEFAULT_BUNDLES.linux;
  if (options.dryRun) {
    describeCommand([
      'docker',
      'run',
      '--rm',
      '--platform',
      platform,
      '-v',
      `${ROOT}:/app`,
      '-w',
      '/app',
      process.env.RUST_IMAGE ?? 'rust:1.98-bookworm',
      'bash',
      '-lc',
      `npx tauri build --bundles ${bundles}`,
    ]);
    log(`      artifacts → ${path.relative(ROOT, outDir)}`);
    return;
  }
  await checkDocker();
  await cleanOutDir(outDir);
  const quality = options.quality ? '1' : '0';
  const script = `
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
      *) echo "Unsupported container architecture: $(uname -m)" >&2; exit 1 ;;
    esac
    if ! command -v node >/dev/null 2>&1; then
      curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-\${NODE_ARCH}.tar.xz" -o /tmp/node.tar.xz
      tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1
    fi
    if [ "${quality}" = "1" ]; then
      export CARGO_PROFILE_RELEASE_LTO=fat
      export CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1
    fi
    npm ci --no-audit --no-fund
    npx tauri build --bundles ${bundles}${options.ci ? ' --ci' : ''}
    mkdir -p builds/linux
    find src-tauri/target/release/bundle -maxdepth 2 -type f \
      \\( -name '*.deb' -o -name '*.AppImage' -o -name '*.rpm' \\) \\
      -exec cp -f {} builds/linux/ \\;
  `;
  await run(
    'docker',
    [
      'run',
      '--rm',
      '--platform',
      platform,
      '-e',
      `CARGO_BUILD_JOBS=${process.env.CARGO_BUILD_JOBS ?? Math.min(6, os.cpus().length)}`,
      '-v',
      `${ROOT}:/app`,
      '-v',
      'notebook_node_modules:/app/node_modules',
      '-v',
      'notebook_npm_cache:/root/.npm',
      '-v',
      'notebook_cargo_registry:/usr/local/cargo/registry',
      '-v',
      'notebook_linux_target:/app/src-tauri/target',
      '-w',
      '/app',
      process.env.RUST_IMAGE ?? 'rust:1.98-bookworm',
      'bash',
      '-lc',
      script,
    ],
    { env: buildEnv(options) }
  );
  await writeChecksums(outDir);
}

// ── main ────────────────────────────────────────────────────────────────────
const options = parseArgs(process.argv.slice(2));
if (options.help) {
  help();
  process.exit(0);
}

await checkBaseTools();

const bannerArch = options.target === 'all' ? `host ${HOST_ARCH}` : archFor(options.target, options);
const banner = `Notebook build · ${options.target === 'all' ? 'all available targets' : PLATFORM_LABEL[options.target]} · ${bannerArch}${options.quality ? ' · quality (fat LTO)' : ''}`;
log(`\n\x1b[1m${banner}\x1b[0m`);
if (options.target === 'all') {
  warn('`all` only builds targets this host can produce. macOS installers require macOS; use the CI workflow for all three.');
}

const failures = [];
if (options.target === 'all') {
  const plan = [];
  if (HOST === 'darwin') plan.push('macos', 'linux', 'windows');
  else if (HOST === 'linux') plan.push('linux', 'windows');
  else plan.push('windows');

  for (const platform of plan) {
    try {
      if (platform === 'macos') await buildMacos(options);
      else if (platform === 'windows') {
        if (HOST !== 'win32' && (!findCommand('cargo-xwin') || !findCommand('makensis'))) {
          warn('Skipping Windows: cargo-xwin and NSIS are required to cross-compile.');
          continue;
        }
        await buildWindows(options);
      } else {
        if (HOST === 'darwin' && !findCommand('docker')) {
          warn('Skipping Linux: Docker is required to build Linux bundles from macOS.');
          continue;
        }
        await buildLinux(options);
      }
    } catch (error) {
      failures.push({ platform, error });
      console.error(`\x1b[31m${PLATFORM_LABEL[platform]} build failed:\x1b[0m ${error.message}`);
    }
  }
  if (HOST !== 'darwin') warn('Skipping macOS: macOS installers can only be built on macOS.');
} else {
  try {
    if (options.target === 'macos') await buildMacos(options);
    else if (options.target === 'windows') await buildWindows(options);
    else await buildLinux(options);
  } catch (error) {
    failures.push({ platform: options.target, error });
    console.error(`\x1b[31mBuild failed:\x1b[0m ${error.message}`);
  }
}

if (failures.length === 0) {
  if (!options.dryRun) {
    if (options.target === 'all') {
      for (const platform of ['macos', 'windows', 'linux']) {
        const dir = path.join(ROOT, 'builds', platform);
        if (existsSync(dir)) await report(dir);
      }
    } else {
      await report(path.join(ROOT, 'builds', options.target));
    }
  }
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(0);
  ok(options.dryRun ? 'dry run complete' : `done in ${seconds}s`);
  process.exit(0);
}
process.exit(1);
