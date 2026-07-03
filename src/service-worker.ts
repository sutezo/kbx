/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />
// Offline-first service worker: precaches the whole app shell so the vault
// works with no network at all. Uses SvelteKit's built-in SW integration.
import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE_NAME = `kbx-${version}`;
/** The SPA fallback page; served for all navigations. */
const APP_SHELL = '/index.html';
const PRECACHE = [...build, ...files, APP_SHELL, '/'];

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE_NAME)
			.then((cache) => cache.addAll(PRECACHE))
			.then(() => sw.skipWaiting())
	);
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
			// Navigations always get the cached app shell (offline-first SPA).
			if (request.mode === 'navigate') {
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
