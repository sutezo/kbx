// Tracks the app's service worker registration and exposes a reactive
// "update available" flag; the new version only takes over once the user
// explicitly triggers apply() (never automatically), keeping the offline
// app shell stable while a vault may be unlocked.

class PwaUpdate {
	available = $state(false);

	#registration: ServiceWorkerRegistration | null = null;
	#reloading = false;

	/** Starts watching the active service worker registration for updates. */
	async init(): Promise<void> {
		if (!('serviceWorker' in navigator)) {
			return;
		}
		navigator.serviceWorker.addEventListener('controllerchange', () => {
			// A reload we triggered ourselves via apply(); anything else is
			// out of scope (e.g. devtools-driven updates) and is ignored.
			if (this.#reloading) {
				location.reload();
			}
		});

		const registration = await navigator.serviceWorker.ready;
		this.#registration = registration;

		if (registration.waiting) {
			this.available = true;
		}

		registration.addEventListener('updatefound', () => {
			const installing = registration.installing;
			if (!installing) {
				return;
			}
			installing.addEventListener('statechange', () => {
				if (installing.state === 'installed' && navigator.serviceWorker.controller) {
					this.available = true;
				}
			});
		});
	}

	/** Hands control to the waiting worker and reloads once it activates. */
	apply(): void {
		const waiting = this.#registration?.waiting;
		if (!waiting) {
			return;
		}
		this.#reloading = true;
		waiting.postMessage('SKIP_WAITING');
	}
}

export const pwaUpdate = new PwaUpdate();
