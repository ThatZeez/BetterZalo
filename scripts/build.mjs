// BetterZalo distribution build: validates sources, stages patcher files,
// writes manifest.json + checksums.txt, and zips dist/BetterZalo-v<version>.zip.
// Single source of truth for the version is package.json.
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, statSync, createWriteStream } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import archiver from 'archiver';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'dist');
const STAGE = path.join(DIST, 'stage');

// Allowlisted payload: exact source files the patcher must install, mapped to
// their in-package paths. Nothing else from the repo enters the package.
const PAYLOAD = [
  { src: 'src/betterzalo-core.js', dest: 'files/betterzalo-core.js', stampVersion: true },
  { src: 'src/plugins/dont-track-me/dont-track-me.js', dest: 'files/plugins/dont-track-me/dont-track-me.js', stampVersion: false },
];

// Zalo builds BetterZalo has actually been reverse-engineered and verified
// against. Do not extend this list without verifying the new Zalo version.
const SUPPORTED_ZALO_VERSIONS = ['26.9.10'];

const fail = (msg) => { console.error('[build] FATAL: ' + msg); process.exit(1); };
const sha256File = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

async function main() {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const version = pkg.version;
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) fail('invalid package.json version: ' + version);
  console.log(`[build] BetterZalo v${version}`);

  // 1. Validate sources (fail fast on syntax errors).
  for (const { src } of PAYLOAD) {
    const abs = path.join(ROOT, src);
    if (!statSync(abs, { throwIfNoEntry: false })) fail('missing required source file: ' + src);
    try {
      execFileSync(process.execPath, ['--check', abs], { stdio: 'pipe' });
    } catch {
      fail('syntax check failed: ' + src);
    }
  }

  // 2. Stage payload (clean first so stale files can never leak into a package).
  rmSync(STAGE, { recursive: true, force: true });
  mkdirSync(STAGE, { recursive: true });
  const staged = [];
  for (const { src, dest, stampVersion } of PAYLOAD) {
    const destAbs = path.join(STAGE, dest);
    mkdirSync(path.dirname(destAbs), { recursive: true });
    if (stampVersion) {
      let text = readFileSync(path.join(ROOT, src), 'utf8');
      if (!/const VERSION = '[^']*'/.test(text)) fail('VERSION stamp pattern not found in ' + src);
      text = text.replace(/const VERSION = '[^']*'/, `const VERSION = '${version}'`);
      writeFileSync(destAbs, text);
    } else {
      copyFileSync(path.join(ROOT, src), destAbs);
    }
    staged.push(dest);
  }

  // 3. manifest.json (extensible: unknown future keys must be ignored by the patcher).
  const manifest = {
    manifestVersion: 1,
    name: 'BetterZalo',
    version,
    supportedZaloVersions: SUPPORTED_ZALO_VERSIONS,
    files: staged.map((rel) => {
      const abs = path.join(STAGE, rel);
      return { path: rel, size: statSync(abs).size, sha256: sha256File(abs) };
    }),
  };
  writeFileSync(path.join(STAGE, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  // 4. checksums.txt (BSD-style, sorted for determinism; covers payload + manifest).
  const entries = [...staged, 'manifest.json'].sort().map((rel) => `${sha256File(path.join(STAGE, rel))}  ${rel}`);
  writeFileSync(path.join(STAGE, 'checksums.txt'), entries.join('\n') + '\n');

  // 5. Verify stage contents before zipping (never ship a silent partial package).
  const parsed = JSON.parse(readFileSync(path.join(STAGE, 'manifest.json'), 'utf8'));
  if (parsed.name !== 'BetterZalo' || parsed.version !== version) fail('manifest identity mismatch');
  if (!Array.isArray(parsed.supportedZaloVersions) || parsed.supportedZaloVersions.length === 0) fail('manifest has no supported Zalo versions');
  if (parsed.files.length !== PAYLOAD.length) fail(`manifest lists ${parsed.files.length} files, expected ${PAYLOAD.length}`);
  for (const f of parsed.files) {
    const abs = path.join(STAGE, f.path);
    if (!statSync(abs, { throwIfNoEntry: false })) fail('manifest file missing from stage: ' + f.path);
    if (sha256File(abs) !== f.sha256) fail('checksum mismatch for: ' + f.path);
  }

  // 6. Zip it.
  const zipName = `BetterZalo-v${version}.zip`;
  const zipPath = path.join(DIST, zipName);
  rmSync(zipPath, { force: true });
  let entryCount = 0;
  await new Promise((resolve, reject) => {
    const out = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    out.on('close', resolve);
    archive.on('warning', reject);
    archive.on('error', reject);
    archive.on('entry', () => { entryCount++; });
    archive.pipe(out);
    archive.file(path.join(STAGE, 'manifest.json'), { name: 'manifest.json' });
    archive.file(path.join(STAGE, 'checksums.txt'), { name: 'checksums.txt' });
    archive.directory(path.join(STAGE, 'files'), 'files');
    archive.finalize();
  });
  const bytes = statSync(zipPath).size;
  if (bytes === 0 || entryCount === 0) fail('produced an empty package');
  console.log(`[build] wrote dist/${zipName} (${entryCount} entries, ${bytes} bytes)`);
  console.log('[build] package OK');
}

main().catch((e) => fail(e && e.message ? e.message : String(e)));
