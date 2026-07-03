// Postbuild step: SvelteKit's SPA bootstrap emits an unavoidable inline
// <script> (no src, no nonce) to hydrate the app. A static site cannot use
// per-request nonces, so instead we allowlist that exact script by its
// SHA-256 hash — keeping CSP strict (no 'unsafe-inline') while still
// letting the one required inline script run.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BUILD_DIR = join(import.meta.dirname, '..', 'build');
const INDEX_HTML = join(BUILD_DIR, 'index.html');
const HEADERS_FILE = join(BUILD_DIR, '_headers');

const html = readFileSync(INDEX_HTML, 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) {
	throw new Error(`No inline <script> found in ${INDEX_HTML}`);
}

const hash = createHash('sha256').update(scriptMatch[1], 'utf8').digest('base64');
const cspSource = `'sha256-${hash}'`;

let headers = readFileSync(HEADERS_FILE, 'utf8');
if (!headers.includes('script-src')) {
	throw new Error(`No script-src directive found in ${HEADERS_FILE}`);
}
headers = headers.replace(
	/script-src ([^;]*);/,
	(_match, existing) => `script-src ${existing.trim()} ${cspSource};`
);
writeFileSync(HEADERS_FILE, headers);

console.log(`Injected CSP script hash: ${cspSource}`);
