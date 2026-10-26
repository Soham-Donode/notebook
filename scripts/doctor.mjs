#!/usr/bin/env node
/**
 * Checks everything a local production build needs and prints next steps.
 * Run with `npm run doctor`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statfsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = process.platform;
const ARCH = os.arch();
const MIN_NODE = [20, 19];
const results = [];

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

function command(name, args = []) {
  const resolved = findCommand(name) ?? name;
  // Windows needs a shell for .cmd shims such as npm; quote paths with spaces.
  const executable = HOST === 'win32' && /\s/.test(resolved) ? `"${resolved}"` : resolved;
  const result = spawnSync(executable, args, { encoding: 'utf8', shell: HOST === 'win32' });
  if (result.error || result.status !== 0) return null;
  return (result.stdout ?? '').trim();
}

function findCommand(name) {
  const suffixes = HOST === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    for (const suffix of suffixes) {
      if (existsSync(path.join(dir, name + suffix))) return path.join(dir, name + suffix);
    }
  }
  return null;
}

function record(level, label, detail = '') {
  results.push({ level, label, detail });
  const icon = level === 'pass' ? green('✓') : level === 'warn' ? yellow('!') : red('✗');
  console.log(`  ${icon} ${label}${detail ? dim(` — ${detail}`) : ''}`);
}

function required(label, value, detail, hint = detail) {
  if (value) record('pass', label, detail);
  else record('fail', label, hint);
  return Boolean(value);
}

function optional(label, value, detail, hint = detail) {
  if (value) record('pass', label, detail);
  else record('warn', label, hint);
  return Boolean(value);
}

function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

const label = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }[HOST] ?? HOST;
console.log(`\x1b[1mNotebook build doctor\x1b[0m  ${label} ${ARCH} · Node ${process.version}`);

// ── baseline ────────────────────────────────────────────────────────────────
section('Required');
const [major, minor] = process.versions.node.split('.').map(Number);
required(
  'Node.js 20.19+',
  major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]),
  process.version
);
const npmVersion = command('npm', ['--version']);
required('npm', npmVersion, npmVersion ?? '', 'install Node.js from https://nodejs.org');
required(
  'Project dependencies',
  existsSync(path.join(ROOT, 'node_modules', '@tauri-apps', 'cli', 'tauri.js')),
  'installed',
  'run `npm ci`'
);
const cargo = command('cargo', ['--version']);
required('Rust toolchain', cargo, cargo ?? 'install from https://rustup.rs');
const rustc = command('rustc', ['--version']);
if (rustc) record('pass', 'rustc', rustc.replace(/^rustc\s+/, ''));

const tauriPkg = path.join(ROOT, 'node_modules', '@tauri-apps', 'cli', 'package.json');
if (existsSync(tauriPkg)) {
  try {
    record('pass', 'Tauri CLI', `v${JSON.parse(readFileSync(tauriPkg, 'utf8')).version}`);
  } catch {
    /* ignore */
  }
}

const config = JSON.parse(readFileSync(path.join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'));
record('pass', 'App', `${config.productName} ${config.version} (${config.identifier})`);

// ── platform toolchain ──────────────────────────────────────────────────────
section(`Platform toolchain (${label})`);
if (HOST === 'darwin') {
  const xcode = command('xcode-select', ['-p']);
  required('Xcode Command Line Tools', xcode, xcode ?? '', 'xcode-select --install');
  required('hdiutil', findCommand('hdiutil'), findCommand('hdiutil') ?? '', 'bundled with macOS');
  required('ditto', findCommand('ditto'), findCommand('ditto') ?? '', 'bundled with macOS');
  optional('codesign', findCommand('codesign'), findCommand('codesign') ?? '', 'required only for signed releases');
} else if (HOST === 'win32') {
  const vswhere = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';
  const msvc = existsSync(vswhere)
    ? command(vswhere, [
        '-latest',
        '-products',
        '*',
        '-requires',
        'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
        '-property',
        'installationPath',
      ])
    : null;
  required('Visual Studio C++ build tools', msvc, msvc ?? '', 'install "Desktop development with C++"');
  optional('WebView2 runtime', true, 'included with Windows 11 and current Windows 10');
} else {
  const webkit = command('pkg-config', ['--modversion', 'webkit2gtk-4.1']);
  const gtk = command('pkg-config', ['--modversion', 'gtk+-3.0']);
  const rsvg = command('pkg-config', ['--modversion', 'librsvg-2.0']);
  required('webkit2gtk-4.1', webkit, webkit ?? '', 'sudo apt install libwebkit2gtk-4.1-dev');
  required('GTK 3', gtk, gtk ?? '', 'libgtk-3-dev');
  required('librsvg', rsvg, rsvg ?? '', 'librsvg2-dev');
  required('patchelf', findCommand('patchelf'), findCommand('patchelf') ?? '', 'needed for AppImage');
  required('dpkg-deb', findCommand('dpkg-deb'), findCommand('dpkg-deb') ?? '', 'needed for .deb');
}

// ── rust targets ────────────────────────────────────────────────────────────
section('Rust targets');
const installed = (command('rustup', ['target', 'list', '--installed']) ?? '').split(/\s+/).filter(Boolean);
if (installed.length) {
  record('pass', 'Installed', installed.join(', '));
  if (HOST === 'darwin') {
    optional(
      'Universal macOS target set',
      installed.includes('aarch64-apple-darwin') && installed.includes('x86_64-apple-darwin'),
      'installed',
      'rustup target add aarch64-apple-darwin x86_64-apple-darwin'
    );
  }
  if (HOST !== 'win32') {
    optional(
      'Windows target',
      installed.includes('x86_64-pc-windows-msvc'),
      'installed',
      'rustup target add x86_64-pc-windows-msvc'
    );
  }
} else {
  record('warn', 'rustup not found', 'install from https://rustup.rs to manage targets');
}

// ── optional cross-build tools ──────────────────────────────────────────────
if (HOST !== 'win32') {
  section('Optional cross-build tools');
  optional('Docker', findCommand('docker'), findCommand('docker') ?? '', 'builds Linux bundles from macOS');
  const xwin = findCommand('cargo-xwin');
  const nsis = findCommand('makensis');
  const llvm = findCommand('clang-cl') || findCommand('lld-link') ||
    (existsSync('/opt/homebrew/opt/llvm/bin') ? '/opt/homebrew/opt/llvm/bin' : null) ||
    (existsSync('/usr/local/opt/llvm/bin') ? '/usr/local/opt/llvm/bin' : null);
  optional('cargo-xwin', xwin, xwin ?? '', 'cargo install cargo-xwin');
  optional('NSIS', nsis, nsis ?? '', 'brew install nsis / apt install nsis');
  optional('LLVM (clang-cl/lld-link)', llvm, llvm, 'brew install llvm / apt install llvm');
}

// ── disk space ──────────────────────────────────────────────────────────────
section('Disk');
try {
  const stats = statfsSync(path.join(ROOT, 'src-tauri'));
  const freeGb = (stats.bavail * stats.bsize) / 1024 ** 3;
  if (freeGb >= 6) record('pass', 'Free space', `${freeGb.toFixed(1)} GB`);
  else record('warn', 'Free space', `${freeGb.toFixed(1)} GB — a first Rust build needs roughly 5–6 GB`);
} catch {
  record('warn', 'Free space', 'could not determine');
}

// ── summary ─────────────────────────────────────────────────────────────────
section('Next steps');
const recommended = {
  darwin: 'npm run build:macos',
  win32: 'npm run build:windows',
  linux: 'npm run build:linux',
}[HOST];
console.log(`
  ${dim('Build for this machine:')}  ${recommended}
  ${dim('Frontend only:')}          npm run build
  ${dim('Everything this host can build:')} npm run build:all

  ${dim('macOS:')}   DMG opens with a drag-to-Applications window.
  ${dim('Windows:')} NSIS installer, no admin rights required.
  ${dim('Linux:')}   .deb and .AppImage.

  ${dim('Unsigned builds are fine locally. For public releases set the signing')}
  ${dim('environment variables documented in README.md.')}
`);

const failures = results.filter((result) => result.level === 'fail');
if (failures.length) {
  console.log(red(`\n${failures.length} required item${failures.length === 1 ? '' : 's'} missing. Fix the ✗ items above and re-run.`));
  process.exit(1);
}
console.log(green('All required tools are present.'));
