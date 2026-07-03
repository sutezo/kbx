// Dropbox sync client: OAuth 2.0 PKCE (no client secret — safe for a static
// SPA), scoped to a single "App folder" so a leaked token exposes only the
// encrypted vault file, never the rest of the user's Dropbox account.
import {
	clearDropboxAuth,
	loadDropboxAuth,
	saveDropboxAuth,
	type DropboxAuth
} from './storage';

const AUTHORIZE_URL = 'https://www.dropbox.com/oauth2/authorize';
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const UPLOAD_URL = 'https://content.dropboxapi.com/2/files/upload';
const DOWNLOAD_URL = 'https://content.dropboxapi.com/2/files/download';
const REVOKE_URL = 'https://api.dropboxapi.com/2/auth/token/revoke';

/** Path inside the app's dedicated Dropbox folder. */
const VAULT_PATH = '/vault.kdbx';

/** sessionStorage keys used only during the OAuth redirect round-trip. */
const PKCE_VERIFIER_KEY = 'kbx-dropbox-pkce-verifier';
const PKCE_STATE_KEY = 'kbx-dropbox-pkce-state';

/** Thrown when Dropbox is not connected yet. */
export class DropboxNotConnectedError extends Error {
	constructor() {
		super('Dropbox is not connected');
		this.name = 'DropboxNotConnectedError';
	}
}

/**
 * Starts the OAuth PKCE flow by redirecting to Dropbox's authorize page.
 * Resumed by {@link completeAuthorization} after the user approves and
 * Dropbox redirects back to this same page.
 * @param clientId - The Dropbox app key (public, not secret)
 */
export async function startAuthorization(clientId: string): Promise<void> {
	const verifier = randomUrlSafeString(64);
	const state = randomUrlSafeString(32);
	const challenge = base64UrlEncode(await sha256(verifier));

	sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
	sessionStorage.setItem(PKCE_STATE_KEY, state);

	const url = new URL(AUTHORIZE_URL);
	url.searchParams.set('client_id', clientId);
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('code_challenge', challenge);
	url.searchParams.set('code_challenge_method', 'S256');
	url.searchParams.set('redirect_uri', redirectUri());
	url.searchParams.set('token_access_type', 'offline'); // request a refresh token
	url.searchParams.set('state', state);
	location.assign(url);
}

/**
 * Completes the OAuth flow if the current URL is a Dropbox redirect
 * callback (has `code` and `state` query params). Safe to call on every
 * page load — it's a no-op otherwise. Cleans the query string either way.
 * @param clientId - The Dropbox app key (public, not secret)
 * @returns Whether a connection was completed
 */
export async function completeAuthorization(clientId: string): Promise<boolean> {
	const params = new URL(location.href).searchParams;
	const code = params.get('code');
	const state = params.get('state');
	if (!code || !state) {
		return false;
	}

	const expectedState = sessionStorage.getItem(PKCE_STATE_KEY);
	const verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);
	sessionStorage.removeItem(PKCE_STATE_KEY);
	sessionStorage.removeItem(PKCE_VERIFIER_KEY);
	history.replaceState(null, '', location.pathname);

	if (!verifier || state !== expectedState) {
		throw new Error('Dropbox authorization state mismatch (possible CSRF); please retry');
	}

	const body = new URLSearchParams({
		code,
		grant_type: 'authorization_code',
		client_id: clientId,
		redirect_uri: redirectUri(),
		code_verifier: verifier
	});
	const tokens = await tokenRequest(body);
	await saveDropboxAuth({
		refreshToken: tokens.refresh_token,
		accessToken: tokens.access_token,
		accessTokenExpiresAt: Date.now() + tokens.expires_in * 1000
	});
	return true;
}

/** Disconnects Dropbox: revokes the token remotely and clears it locally. */
export async function disconnect(clientId: string): Promise<void> {
	const auth = await loadDropboxAuth();
	if (auth) {
		try {
			await fetch(REVOKE_URL, {
				method: 'POST',
				headers: { Authorization: `Bearer ${auth.accessToken}` }
			});
		} catch {
			// Best-effort: proceed to forget the token locally regardless.
		}
	}
	await clearDropboxAuth();
	void clientId; // kept in the signature for symmetry with startAuthorization
}

/** Whether Dropbox is currently connected. */
export async function isConnected(): Promise<boolean> {
	return (await loadDropboxAuth()) !== null;
}

/**
 * Downloads the vault file from the app folder.
 * @param clientId - The Dropbox app key (public, not secret)
 * @returns The file bytes, or null when no file has been synced yet
 * @throws {DropboxNotConnectedError} When not connected
 */
export async function downloadVault(clientId: string): Promise<ArrayBuffer | null> {
	const accessToken = await ensureAccessToken(clientId);
	const res = await fetch(DOWNLOAD_URL, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Dropbox-API-Arg': JSON.stringify({ path: VAULT_PATH })
		}
	});
	if (res.status === 409) {
		return null; // path/not_found — nothing synced yet
	}
	if (!res.ok) {
		throw new Error(`Dropbox download failed: ${res.status} ${await res.text()}`);
	}
	return res.arrayBuffer();
}

/**
 * Uploads the vault file to the app folder, overwriting any existing copy.
 * @param clientId - The Dropbox app key (public, not secret)
 * @param bytes - Encrypted .kdbx content
 * @throws {DropboxNotConnectedError} When not connected
 */
export async function uploadVault(clientId: string, bytes: ArrayBuffer): Promise<void> {
	const accessToken = await ensureAccessToken(clientId);
	const res = await fetch(UPLOAD_URL, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/octet-stream',
			'Dropbox-API-Arg': JSON.stringify({ path: VAULT_PATH, mode: 'overwrite' })
		},
		body: bytes
	});
	if (!res.ok) {
		throw new Error(`Dropbox upload failed: ${res.status} ${await res.text()}`);
	}
}

/** Returns a valid access token, refreshing it first if it has expired. */
async function ensureAccessToken(clientId: string): Promise<string> {
	const auth = await loadDropboxAuth();
	if (!auth) {
		throw new DropboxNotConnectedError();
	}
	// Refresh a little early to avoid racing the expiry during the request.
	if (Date.now() < auth.accessTokenExpiresAt - 60_000) {
		return auth.accessToken;
	}
	const body = new URLSearchParams({
		grant_type: 'refresh_token',
		refresh_token: auth.refreshToken,
		client_id: clientId
	});
	const tokens = await tokenRequest(body);
	const updated: DropboxAuth = {
		refreshToken: auth.refreshToken, // refresh tokens don't rotate
		accessToken: tokens.access_token,
		accessTokenExpiresAt: Date.now() + tokens.expires_in * 1000
	};
	await saveDropboxAuth(updated);
	return updated.accessToken;
}

interface TokenResponse {
	access_token: string;
	refresh_token: string;
	expires_in: number;
}

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
	const res = await fetch(TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body
	});
	if (!res.ok) {
		throw new Error(`Dropbox token request failed: ${res.status} ${await res.text()}`);
	}
	return res.json();
}

/** The redirect target: this app's own root, so the SPA handles the return leg. */
function redirectUri(): string {
	return `${location.origin}/`;
}

function randomUrlSafeString(length: number): string {
	const bytes = crypto.getRandomValues(new Uint8Array(length));
	return base64UrlEncode(bytes.buffer).slice(0, length);
}

async function sha256(text: string): Promise<ArrayBuffer> {
	return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
}

function base64UrlEncode(data: ArrayBuffer): string {
	let binary = '';
	for (const byte of new Uint8Array(data)) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
