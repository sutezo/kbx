// IndexedDB persistence for the encrypted vault blob and app metadata.
// Only ciphertext ever reaches this layer — never plaintext or passwords.
import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'kbx';
const DB_VERSION = 1;
const VAULT_STORE = 'vault';
const META_STORE = 'meta';
const VAULT_KEY = 'current';

/** Backup bookkeeping used to decide when to nag the user to export. */
export interface BackupMeta {
	lastExportedAt: number | null;
	changesSinceExport: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
	dbPromise ??= openDB(DB_NAME, DB_VERSION, {
		upgrade(db) {
			db.createObjectStore(VAULT_STORE);
			db.createObjectStore(META_STORE);
		}
	});
	return dbPromise;
}

/**
 * Persists the encrypted vault bytes, replacing the previous version.
 * @param bytes - Encrypted .kdbx content
 */
export async function saveVaultBytes(bytes: ArrayBuffer): Promise<void> {
	const db = await getDb();
	await db.put(VAULT_STORE, bytes, VAULT_KEY);
}

/**
 * Loads the encrypted vault bytes.
 * @returns The stored ciphertext, or null when no vault exists yet
 */
export async function loadVaultBytes(): Promise<ArrayBuffer | null> {
	const db = await getDb();
	const bytes: unknown = await db.get(VAULT_STORE, VAULT_KEY);
	return bytes instanceof ArrayBuffer ? bytes : null;
}

/**
 * Reads backup bookkeeping.
 * @returns Stored metadata, or defaults when absent
 */
export async function loadBackupMeta(): Promise<BackupMeta> {
	const db = await getDb();
	const meta: unknown = await db.get(META_STORE, 'backup');
	if (meta && typeof meta === 'object' && 'changesSinceExport' in meta) {
		return meta as BackupMeta;
	}
	return { lastExportedAt: null, changesSinceExport: 0 };
}

/**
 * Writes backup bookkeeping.
 * @param meta - New metadata state
 */
export async function saveBackupMeta(meta: BackupMeta): Promise<void> {
	const db = await getDb();
	await db.put(META_STORE, meta, 'backup');
}

/**
 * Permanently deletes the stored vault and its metadata (backup
 * bookkeeping and biometric unlock record). Used when the master
 * password is lost beyond recovery — there is no password reset,
 * so starting over is the only way forward.
 */
export async function clearVault(): Promise<void> {
	const db = await getDb();
	await db.delete(VAULT_STORE, VAULT_KEY);
	await db.delete(META_STORE, 'backup');
	await db.delete(META_STORE, 'biometric');
	await db.delete(META_STORE, 'dropbox');
}

/**
 * Biometric unlock record: the master password wrapped (AES-GCM) with a
 * key derived from the WebAuthn PRF output. Useless without a successful
 * platform-authenticator assertion (Face ID / Touch ID).
 */
export interface BiometricRecord {
	/** base64: WebAuthn credential rawId */
	credentialId: string;
	/** base64: PRF eval input */
	prfSalt: string;
	/** base64: AES-GCM IV */
	iv: string;
	/** base64: AES-GCM ciphertext of the master password */
	wrapped: string;
}

/**
 * Reads the biometric unlock record.
 * @returns The record, or null when biometric unlock is not enrolled
 */
export async function loadBiometricRecord(): Promise<BiometricRecord | null> {
	const db = await getDb();
	const record: unknown = await db.get(META_STORE, 'biometric');
	if (record && typeof record === 'object' && 'credentialId' in record && 'wrapped' in record) {
		return record as BiometricRecord;
	}
	return null;
}

/**
 * Persists the biometric unlock record.
 * @param record - Record produced at enrollment
 */
export async function saveBiometricRecord(record: BiometricRecord): Promise<void> {
	const db = await getDb();
	await db.put(META_STORE, record, 'biometric');
}

/** Removes the biometric unlock record (disables biometric unlock). */
export async function clearBiometricRecord(): Promise<void> {
	const db = await getDb();
	await db.delete(META_STORE, 'biometric');
}

/**
 * Dropbox connection: an OAuth 2 PKCE refresh token (App-folder scope only)
 * plus the cached access token. Losing this only exposes the encrypted
 * .kdbx blob inside the app's dedicated Dropbox folder — never plaintext,
 * never the rest of the account.
 */
export interface DropboxAuth {
	refreshToken: string;
	accessToken: string;
	/** epoch ms */
	accessTokenExpiresAt: number;
}

/** Reads the Dropbox connection, or null when not connected. */
export async function loadDropboxAuth(): Promise<DropboxAuth | null> {
	const db = await getDb();
	const auth: unknown = await db.get(META_STORE, 'dropbox');
	if (auth && typeof auth === 'object' && 'refreshToken' in auth) {
		return auth as DropboxAuth;
	}
	return null;
}

/** Persists the Dropbox connection. */
export async function saveDropboxAuth(auth: DropboxAuth): Promise<void> {
	const db = await getDb();
	await db.put(META_STORE, auth, 'dropbox');
}

/** Removes the Dropbox connection (disconnects sync). */
export async function clearDropboxAuth(): Promise<void> {
	const db = await getDb();
	await db.delete(META_STORE, 'dropbox');
}

/** Sync bookkeeping shown in the UI ("last synced ..."). */
export interface DropboxSyncMeta {
	lastSyncedAt: number | null;
}

/** Reads Dropbox sync bookkeeping. */
export async function loadDropboxSyncMeta(): Promise<DropboxSyncMeta> {
	const db = await getDb();
	const meta: unknown = await db.get(META_STORE, 'dropbox-sync');
	if (meta && typeof meta === 'object' && 'lastSyncedAt' in meta) {
		return meta as DropboxSyncMeta;
	}
	return { lastSyncedAt: null };
}

/** Writes Dropbox sync bookkeeping. */
export async function saveDropboxSyncMeta(meta: DropboxSyncMeta): Promise<void> {
	const db = await getDb();
	await db.put(META_STORE, meta, 'dropbox-sync');
}

/**
 * Asks the browser to protect this origin's storage from eviction.
 * On iOS this reduces (but does not eliminate) the risk of data loss,
 * which is why manual .kdbx exports remain the authoritative backup.
 * @returns Whether persistence was granted
 */
export async function requestPersistentStorage(): Promise<boolean> {
	if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
		return false;
	}
	try {
		return await navigator.storage.persist();
	} catch {
		return false;
	}
}
