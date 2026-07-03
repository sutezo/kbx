// In-memory session for the unlocked vault: owns the decrypted Kdbx object,
// enforces auto-lock, and persists every mutation back to IndexedDB.
import type { Kdbx } from 'kdbxweb';
import {
	addEntry,
	createVault,
	deleteEntry,
	getEntryDraft,
	getEntryPassword,
	listEntries,
	openVault,
	saveVault,
	updateEntry,
	type EntryDraft,
	type EntrySummary
} from './vault';
import {
	clearVault,
	loadBackupMeta,
	loadVaultBytes,
	requestPersistentStorage,
	saveBackupMeta,
	saveVaultBytes,
	type BackupMeta
} from './storage';

export type SessionStatus = 'loading' | 'empty' | 'locked' | 'unlocked';

/** Lock the vault after this much inactivity. */
const AUTO_LOCK_MS = 5 * 60 * 1000;

/** Nag for a backup once this many changes are unexported. */
export const BACKUP_NAG_CHANGES = 5;

/**
 * Reactive vault session. The decrypted database is kept in a private,
 * non-reactive field so secrets never leak into reactive snapshots;
 * the UI only sees `EntrySummary` projections.
 */
class VaultSession {
	status = $state<SessionStatus>('loading');
	entries = $state<EntrySummary[]>([]);
	backupMeta = $state<BackupMeta>({ lastExportedAt: null, changesSinceExport: 0 });

	#db: Kdbx | null = null;
	#lockTimer: ReturnType<typeof setTimeout> | null = null;

	/** Loads persisted state and decides the initial screen. */
	async init(): Promise<void> {
		await requestPersistentStorage();
		this.backupMeta = await loadBackupMeta();
		const bytes = await loadVaultBytes();
		this.status = bytes ? 'locked' : 'empty';
	}

	/** Creates a brand-new vault and unlocks it. */
	async create(masterPassword: string): Promise<void> {
		const db = createVault('kbx', masterPassword);
		await saveVaultBytes(await saveVault(db));
		this.#becomeUnlocked(db);
	}

	/**
	 * Unlocks the stored vault.
	 * @throws {InvalidPasswordError} When the password does not match
	 */
	async unlock(masterPassword: string): Promise<void> {
		const bytes = await loadVaultBytes();
		if (!bytes) {
			throw new Error('No vault stored on this device');
		}
		this.#becomeUnlocked(await openVault(bytes, masterPassword));
	}

	/**
	 * Imports an existing .kdbx file, replacing any stored vault.
	 * The password is validated by actually opening the file first.
	 */
	async importVault(bytes: ArrayBuffer, masterPassword: string): Promise<void> {
		const db = await openVault(bytes, masterPassword);
		await saveVaultBytes(bytes);
		await this.#setBackupMeta({ lastExportedAt: Date.now(), changesSinceExport: 0 });
		this.#becomeUnlocked(db);
	}

	/**
	 * Permanently deletes the stored vault (no password reset exists).
	 * Only call after explicit user confirmation — this is irreversible.
	 */
	async eraseAndStartOver(): Promise<void> {
		this.#clearLockTimer();
		this.#db = null;
		this.entries = [];
		await clearVault();
		this.backupMeta = { lastExportedAt: null, changesSinceExport: 0 };
		this.status = 'empty';
	}

	/** Drops all decrypted state from memory. */
	lock(): void {
		this.#clearLockTimer();
		this.#db = null;
		this.entries = [];
		if (this.status === 'unlocked') {
			this.status = 'locked';
		}
	}

	/** Resets the inactivity timer; call on any user interaction. */
	touch(): void {
		if (this.status === 'unlocked') {
			this.#armLockTimer();
		}
	}

	/** Adds an entry and persists the vault. */
	async add(draft: EntryDraft): Promise<void> {
		addEntry(this.#require(), draft);
		await this.#persistChange();
	}

	/** Updates an entry and persists the vault. */
	async update(id: string, draft: EntryDraft): Promise<void> {
		updateEntry(this.#require(), id, draft);
		await this.#persistChange();
	}

	/** Moves an entry to the recycle bin and persists the vault. */
	async remove(id: string): Promise<void> {
		deleteEntry(this.#require(), id);
		await this.#persistChange();
	}

	/** Reads all fields of an entry for editing. */
	draft(id: string): EntryDraft {
		return getEntryDraft(this.#require(), id);
	}

	/** Reads the plaintext password of an entry (for clipboard copy). */
	password(id: string): string {
		return getEntryPassword(this.#require(), id);
	}

	/** Serializes the vault for export. Call {@link markExported} on success. */
	async exportBytes(): Promise<ArrayBuffer> {
		return saveVault(this.#require());
	}

	/** Records a successful backup export and clears the nag counter. */
	async markExported(): Promise<void> {
		await this.#setBackupMeta({ lastExportedAt: Date.now(), changesSinceExport: 0 });
	}

	/** Whether the UI should show the "please export a backup" warning. */
	get needsBackup(): boolean {
		return this.backupMeta.changesSinceExport >= BACKUP_NAG_CHANGES;
	}

	#becomeUnlocked(db: Kdbx): void {
		this.#db = db;
		this.entries = listEntries(db);
		this.status = 'unlocked';
		this.#armLockTimer();
	}

	async #persistChange(): Promise<void> {
		const db = this.#require();
		await saveVaultBytes(await saveVault(db));
		this.entries = listEntries(db);
		await this.#setBackupMeta({
			...this.backupMeta,
			changesSinceExport: this.backupMeta.changesSinceExport + 1
		});
		this.touch();
	}

	async #setBackupMeta(meta: BackupMeta): Promise<void> {
		this.backupMeta = meta;
		await saveBackupMeta(meta);
	}

	#require(): Kdbx {
		if (!this.#db) {
			throw new Error('Vault is locked');
		}
		return this.#db;
	}

	#armLockTimer(): void {
		this.#clearLockTimer();
		this.#lockTimer = setTimeout(() => this.lock(), AUTO_LOCK_MS);
	}

	#clearLockTimer(): void {
		if (this.#lockTimer !== null) {
			clearTimeout(this.#lockTimer);
			this.#lockTimer = null;
		}
	}
}

/** App-wide singleton session. */
export const session = new VaultSession();
