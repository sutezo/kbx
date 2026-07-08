// Throwaway static server that applies build/_headers CSP rules, so CSP
// enforcement (which `vite preview` skips) can be verified locally before
// deploying — this is what caught the inline-script CSP block bug.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const BUILD_DIR = join(import.meta.dirname, '..', 'build');
const headersText = readFileSync(join(BUILD_DIR, '_headers'), 'utf8');
const globalHeaders = {};
for (const line of headersText.split('\n').slice(1)) {
	const m = line.match(/^\s+([\w-]+):\s*(.+)$/);
	if (m) globalHeaders[m[1]] = m[2];
}

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain' };

createServer((req, res) => {
	let path = join(BUILD_DIR, decodeURIComponent(req.url.split('?')[0]));
	if (!existsSync(path) || statSync(path).isDirectory()) {
		path = join(BUILD_DIR, 'index.html');
	}
	for (const [k, v] of Object.entries(globalHeaders)) res.setHeader(k, v);
	res.setHeader('Content-Type', MIME[extname(path)] ?? 'application/octet-stream');
	res.end(readFileSync(path));
}).listen(6506, () => console.log('serving build/ with CSP headers on http://localhost:6506'));
