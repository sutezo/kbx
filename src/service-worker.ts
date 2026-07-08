/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />
// Offline-first service worker: precaches the whole app shell so the vault
// works with no network at all. Uses SvelteKit's built-in SW integration.
import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE_NAME = `kbx-${version}`;
/**
 * The SPA fallback page; served for all navigations. Deliberately '/' and
 * not '/index.html' — static hosts (and Vite's own preview server) don't
 * all serve the latter at that literal path, which would make
 * `cache.addAll` below reject and silently break offline support entirely.
 */
const APP_SHELL = '/';
const PRECACHE = [...build, ...files, APP_SHELL];

sw.addEventListener('install', (event) => {
	// No skipWaiting here: a newly installed worker parks in "waiting" until
	// the page explicitly asks for it (see the SKIP_WAITING message below),
	// so an update never swaps the running app out from under the user.
	event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)));
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
			)
			.then(() => sw.clients.claim())
	);
});

sw.addEventListener('message', (event) => {
	if (event.data === 'SKIP_WAITING') {
		sw.skipWaiting();
	}
});

sw.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') {
		return;
	}
	const url = new URL(request.url);
	if (url.origin !== sw.location.origin) {
		// Foreign origins are blocked by CSP anyway; never touch them here.
		return;
	}

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE_NAME);
			// Navigations to a real precached file (e.g. /manual.html) must get
			// that file, not the SPA shell — only fall back to the shell when
			// there's no exact match, mirroring the Netlify _redirects rule
			// (/* /index.html 200) which likewise prefers real files.
			// ignoreSearch: precache keys have no query strings, so a navigation
			// like /manual.html?x=1 must still hit the file, not the shell.
			if (request.mode === 'navigate') {
				const direct = await cache.match(request, { ignoreSearch: true });
				if (direct) {
					return direct;
				}
				const shell = await cache.match(APP_SHELL);
				if (shell) {
					return shell;
				}
			}
			const cached = await cache.match(request);
			if (cached) {
				return cached;
			}
			return fetch(request);
		})()
	);
});
