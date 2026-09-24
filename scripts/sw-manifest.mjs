/**
 * Post-build step for the Service Worker (T195). Runs after `vite build`.
 *
 * 1. Lists the app shell in dist/: index.html, every file under dist/assets/
 *    except the ORT .wasm copies, plus the fonts and icons that index.html
 *    and the built CSS reference. ORT (/ort-wasm-*) and Tesseract
 *    (/tesseract/*) are deliberately NOT in the list: the worker caches them
 *    at runtime, on first use.
 * 2. Computes a build id: sha256 over each shell path and its content hash,
 *    so any shell change produces a new cache name.
 * 3. Writes dist/sw-manifest.json (for inspection) and rewrites dist/sw.js:
 *    the manifest literal replaces the @@SW_MANIFEST@@ marker and the body
 *    of sw-logic.js replaces the @@SW_LOGIC@@ importScripts line, so the
 *    deployed worker is one self-contained file. dist/sw-logic.js is
 *    removed because it is now inlined.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const swPath = join(dist, 'sw.js');
const logicPath = join(dist, 'sw-logic.js');

if (!existsSync(join(dist, 'index.html'))) {
  console.error('[sw-manifest] dist/index.html not found; run vite build first');
  process.exit(1);
}
if (!existsSync(swPath) || !existsSync(logicPath)) {
  console.error('[sw-manifest] dist/sw.js or dist/sw-logic.js missing (expected from public/)');
  process.exit(1);
}

const SHELL_EXCLUDE = /\.wasm$/i;

/** @type {string[]} pathnames, always with a leading slash */
const paths = new Set(['/index.html']);

for (const name of readdirSync(join(dist, 'assets')).sort()) {
  if (SHELL_EXCLUDE.test(name)) continue;
  if (!statSync(join(dist, 'assets', name)).isFile()) continue;
  paths.add(`/assets/${name}`);
}

// Fonts and icons referenced by the shell (index.html + built CSS).
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const css = [...paths]
  .filter((p) => p.endsWith('.css'))
  .map((p) => readFileSync(join(dist, p), 'utf8'))
  .join('\n');
const refPattern = /(?:href|src|url)\s*[=(]\s*["']?(\/(?:fonts\/[^"')\s]+\.woff2|favicon-[^"')\s]+\.png|apple-touch-icon\.png))/g;
for (const source of [html, css]) {
  for (const match of source.matchAll(refPattern)) {
    if (existsSync(join(dist, match[1]))) paths.add(match[1]);
  }
}

const precache = [...paths].sort();
const hash = createHash('sha256');
let bytes = 0;
for (const p of precache) {
  const content = readFileSync(join(dist, p));
  bytes += content.length;
  hash.update(p).update('\0').update(createHash('sha256').update(content).digest()).update('\n');
}
const buildId = hash.digest('hex').slice(0, 16);

// '/' is precached as well (served identically to /index.html on both hosts)
// so a cache lookup for the bare origin also hits; it is not part of the hash.
const manifest = { buildId, precache: ['/', ...precache], bytes };
writeFileSync(join(dist, 'sw-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

let sw = readFileSync(swPath, 'utf8');
const manifestMarker = /\/\* @@SW_MANIFEST@@ \*\/\n[^\n]*\n/;
const logicMarker = /\/\* @@SW_LOGIC@@ \*\/\nimportScripts\('\/sw-logic\.js'\);\n/;
if (!manifestMarker.test(sw) || !logicMarker.test(sw)) {
  // A kill-switch sw.js (see the header of public/sw.js) has no markers:
  // ship it untouched instead of failing the build.
  console.warn('[sw-manifest] markers not found in dist/sw.js; leaving it untouched (kill switch build?)');
  process.exit(0);
}
const logic = readFileSync(logicPath, 'utf8');
sw = sw
  .replace(manifestMarker, `/* build ${buildId} */\nself.__DOCCLOAK_SW_MANIFEST__ = ${JSON.stringify(manifest)};\n`)
  .replace(logicMarker, `/* inlined sw-logic.js */\n${logic}\n`);
writeFileSync(swPath, sw);
rmSync(logicPath, { force: true });

console.log(
  `[sw-manifest] build ${buildId}: ${precache.length} shell files, ${(bytes / 1024 / 1024).toFixed(2)} MB precache`,
);
