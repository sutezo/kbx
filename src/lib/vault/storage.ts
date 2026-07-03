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
 * Permanently deletes the stored vault and its backup bookkeeping.
 * Used when the master password is lost beyond recovery — there is no
 * password reset, so starting over is the only way forward.
 */
export async function clearVault(): Promise<void> {
	const db = await getDb();
	await db.delete(VAULT_STORE, VAULT_KEY);
	await db.delete(META_STORE, 'backup');
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
