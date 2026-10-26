#!/usr/bin/env node
/**
 * Removes generated files. Handy when a build cache gets stale.
 *
 *   npm run clean             # dist/ and unpacked installers
 *   npm run clean -- --target # also src-tauri/target (next build is a full rebuild)
 *   npm run clean -- --all    # also node_modules (run `npm ci` afterwards)
 */
import { readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const targets = [path.join(ROOT, 'dist')];

for (const platform of ['macos', 'windows', 'linux']) {
  targets.push(path.join(ROOT, 'builds', platform));
}

if (args.has('--target') || args.has('--all')) targets.push(path.join(ROOT, 'src-tauri', 'target'));
if (args.has('--all')) targets.push(path.join(ROOT, 'node_modules'));

for (const target of targets) {
  try {
    await stat(target);
  } catch {
    continue;
  }
  await rm(target, { recursive: true, force: true });
  console.log(`removed ${path.relative(ROOT, target)}`);
}

// Keep the placeholder files that make empty build folders trackable.
for (const platform of ['macos', 'windows', 'linux']) {
  const dir = path.join(ROOT, 'builds', platform);
  try {
    const entries = await readdir(dir);
    if (!entries.includes('.gitkeep')) {
      await writeFile(path.join(dir, '.gitkeep'), '');
    }
  } catch {
    /* folder does not exist */
  }
}

console.log('done');
