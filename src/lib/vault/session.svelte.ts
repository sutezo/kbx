// In-memory session for the unlocked vault: owns the decrypted Kdbx object,
// enforces auto-lock, and persists every mutation back to IndexedDB.
import type { Kdbx } from 'kdbxweb';
import { env } from '$env/dynamic/public';
import {
	addEntry,
	changeVaultPassword,
	createVault,
	deleteEntry,
	getEntryDraft,
	getEntryHistory,
	getEntryHistoryDraft,
	getEntryOtp,
	getEntryPassword,
	listEntries,
	listKnownTags,
	mergeVault,
	openVault,
	restoreEntryRevision,
	saveVault,
	tagUntaggedEntries,
	updateEntry,
	IMPORT_TAG,
	NO_TAG,
	type EntryDraft,
	type EntryHistoryItem,
	type EntrySummary
} from './vault';
import {
	clearBiometricRecord,
	clearVault,
	loadBackupMeta,
	loadBiometricRecord,
	loadDropboxSyncMeta,
	loadVaultBytes,
	requestPersistentStorage,
	saveBackupMeta,
	saveDropboxSyncMeta,
	saveVaultBytes,
	type BackupMeta,
	type DropboxSyncMeta
} from './storage';
import { biometricSupported, enrollBiometric, unwrapMasterPassword } from './biometric';
import * as dropbox from './dropbox';

export type SessionStatus = 'loading' | 'empty' | 'locked' | 'unlocked';

/** Biometric unlock availability on this device. */
export type BiometricStatus = 'unsupported' | 'available' | 'enabled';

/**
 * Dropbox sync availability. 'unavailable' means no app key is configured
 * (DROPBOX_CLIENT_ID unset) — the feature is hidden entirely.
 */
export type DropboxStatus = 'unavailable' | 'disconnected' | 'connected';

// $env/dynamic/public (not static) so a missing env var never breaks the
// build — the feature just stays hidden until PUBLIC_DROPBOX_CLIENT_ID is
// configured (e.g. in Netlify's site settings).
const DROPBOX_CLIENT_ID = env.PUBLIC_DROPBOX_CLIENT_ID ?? '';

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
	biometric = $state<BiometricStatus>('unsupported');
	dropboxStatus = $state<DropboxStatus>('unavailable');
	dropboxSyncMeta = $state<DropboxSyncMeta>({ lastSyncedAt: null });
	dropboxSyncing = $state(false);

	/**
	 * Every tag ever used (incl. history/recycle bin), sorted — the pick-from
	 * choices in the entry editor. Refreshed together with {@link entries}.
	 */
	knownTags = $state<string[]>([]);

	/** Every distinct tag currently in use, sorted (for the filter row). */
	allTags = $derived.by(() => {
		const tags = new Set<string>();
		for (const entry of this.entries) {
			for (const tag of entry.tags) {
				tags.add(tag);
			}
		}
		return [...tags].sort((a, b) => a.localeCompare(b));
	});

	#db: Kdbx | null = null;
	#lockTimer: ReturnType<typeof setTimeout> | null = null;

	/** Loads persisted state and decides the initial screen. */
	async init(): Promise<void> {
		await requestPersistentStorage();
		this.backupMeta = await loadBackupMeta();
		await this.#refreshBiometricStatus();
		await this.#initDropbox();
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
	 * Any biometric enrollment is dropped (it wraps the old password).
	 */
	async importVault(bytes: ArrayBuffer, masterPassword: string): Promise<void> {
		const db = await openVault(bytes, masterPassword);
		// Tagless entries get a fallback tag so they stay filterable; this
		// changes the vault, so persist the re-serialized bytes, not the input.
		const tagged = tagUntaggedEntries(db, NO_TAG);
		await saveVaultBytes(tagged > 0 ? await saveVault(db) : bytes);
		await this.#setBackupMeta({ lastExportedAt: Date.now(), changesSinceExport: 0 });
		await clearBiometricRecord();
		await this.#refreshBiometricStatus();
		this.#becomeUnlocked(db);
	}

	/**
	 * Enables Face ID / Touch ID unlock. The password is verified against
	 * the stored vault before enrolling, so a typo cannot get wrapped.
	 * @param masterPassword - Re-entered master password
	 */
	async enableBiometric(masterPassword: string): Promise<void> {
		const bytes = await loadVaultBytes();
		if (!bytes) {
			throw new Error('No vault stored on this device');
		}
		await openVault(bytes, masterPassword); // throws InvalidPasswordError on typo
		await enrollBiometric(masterPassword);
		this.biometric = 'enabled';
	}

	/**
	 * Changes the master password. The current password is re-verified
	 * against the stored vault first, so an unattended unlocked session
	 * cannot have its password changed by someone who doesn't know the
	 * original. Biometric enrollment is dropped afterward since it wraps
	 * the old password.
	 * @param currentPassword - Must match the vault's existing password
	 * @param newPassword - The new master password
	 * @throws {InvalidPasswordError} When currentPassword does not match
	 */
	async changeMasterPassword(currentPassword: string, newPassword: string): Promise<void> {
		const bytes = await loadVaultBytes();
		if (!bytes) {
			throw new Error('No vault stored on this device');
		}
		await openVault(bytes, currentPassword); // throws InvalidPasswordError on mismatch
		const db = this.#require();
		await changeVaultPassword(db, newPassword);
		await saveVaultBytes(await saveVault(db));
		await clearBiometricRecord();
		await this.#refreshBiometricStatus();
		this.touch();
	}

	/** Disables biometric unlock and removes the wrapped password. */
	async disableBiometric(): Promise<void> {
		await clearBiometricRecord();
		await this.#refreshBiometricStatus();
	}

	/** Unlocks via Face ID / Touch ID (WebAuthn PRF assertion). */
	async unlockWithBiometric(): Promise<void> {
		const masterPassword = await unwrapMasterPassword();
		await this.unlock(masterPassword);
	}

	/**
	 * Permanently deletes the stored vault (no password reset exists).
	 * Only call after explicit user confirmation — this is irreversible.
	 */
	async eraseAndStartOver(): Promise<void> {
		this.#clearLockTimer();
		this.#db = null;
		this.entries = [];
		this.knownTags = [];
		await clearVault();
		this.backupMeta = { lastExportedAt: null, changesSinceExport: 0 };
		await this.#refreshBiometricStatus();
		await this.#refreshDropboxStatus();
		this.dropboxSyncMeta = { lastSyncedAt: null };
		this.status = 'empty';
	}

	/** Drops all decrypted state from memory. */
	lock(): void {
		this.#clearLockTimer();
		this.#db = null;
		this.entries = [];
		this.knownTags = [];
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

	/**
	 * Adds multiple entries at once (e.g. from a CSV import) and persists
	 * the vault a single time afterwards.
	 * @param drafts - Entries to add to the default group
	 */
	async importEntries(drafts: EntryDraft[]): Promise<void> {
		const db = this.#require();
		for (const draft of drafts) {
			// Mark every CSV-imported entry with the "import" tag (deduped)
			// so the batch stays identifiable and filterable.
			const tags = draft.tags.includes(IMPORT_TAG) ? draft.tags : [...draft.tags, IMPORT_TAG];
			addEntry(db, { ...draft, tags });
		}
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

	/** Reads the TOTP secret of an entry ('' when none). */
	otp(id: string): string {
		return getEntryOtp(this.#require(), id);
	}

	/** Lists past revisions of an entry, newest first. */
	history(id: string): EntryHistoryItem[] {
		return getEntryHistory(this.#require(), id);
	}

	/** Reads the full fields of a past revision (including its password). */
	historyDraft(id: string, index: number): EntryDraft {
		return getEntryHistoryDraft(this.#require(), id, index);
	}

	/** Restores a past revision as the entry's current state. */
	async restoreRevision(id: string, index: number): Promise<void> {
		restoreEntryRevision(this.#require(), id, index);
		await this.#persistChange();
	}

	/** Starts the Dropbox connection flow (redirects away from the page). */
	async connectDropbox(): Promise<void> {
		await dropbox.startAuthorization(DROPBOX_CLIENT_ID);
	}

	/** Disconnects Dropbox (revokes the token) and forgets it locally. */
	async disconnectDropbox(): Promise<void> {
		await dropbox.disconnect(DROPBOX_CLIENT_ID);
		await this.#refreshDropboxStatus();
	}

	/**
	 * One-button sync: downloads the remote copy (if any), merges it into
	 * the unlocked vault, saves the merge locally, then uploads the merged
	 * result back. A single call does the entire round trip — there is no
	 * background/automatic sync, by design (fewer network operations,
	 * smaller attack surface).
	 * @throws {InvalidPasswordError} When the remote file uses a different password
	 */
	async syncWithDropbox(): Promise<void> {
		const db = this.#require();
		this.dropboxSyncing = true;
		try {
			const remote = await dropbox.downloadVault(DROPBOX_CLIENT_ID);
			if (remote) {
				await mergeVault(db, remote);
			}
			const bytes = await saveVault(db);
			await saveVaultBytes(bytes);
			this.entries = listEntries(db);
			this.knownTags = listKnownTags(db);
			await dropbox.uploadVault(DROPBOX_CLIENT_ID, bytes);
			const meta = { lastSyncedAt: Date.now() };
			this.dropboxSyncMeta = meta;
			await saveDropboxSyncMeta(meta);
			this.touch();
		} finally {
			this.dropboxSyncing = false;
		}
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
		this.knownTags = listKnownTags(db);
		this.status = 'unlocked';
		this.#armLockTimer();
	}

	async #persistChange(): Promise<void> {
		const db = this.#require();
		await saveVaultBytes(await saveVault(db));
		this.entries = listEntries(db);
		this.knownTags = listKnownTags(db);
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

	async #refreshBiometricStatus(): Promise<void> {
		if (await loadBiometricRecord()) {
			this.biometric = 'enabled';
		} else {
			this.biometric = (await biometricSupported()) ? 'available' : 'unsupported';
		}
	}

	async #initDropbox(): Promise<void> {
		if (!DROPBOX_CLIENT_ID) {
			this.dropboxStatus = 'unavailable';
			return;
		}
		// Resumes the OAuth redirect if this load is the callback; a no-op otherwise.
		await dropbox.completeAuthorization(DROPBOX_CLIENT_ID);
		this.dropboxSyncMeta = await loadDropboxSyncMeta();
		await this.#refreshDropboxStatus();
	}

	async #refreshDropboxStatus(): Promise<void> {
		if (!DROPBOX_CLIENT_ID) {
			this.dropboxStatus = 'unavailable';
			return;
		}
		this.dropboxStatus = (await dropbox.isConnected()) ? 'connected' : 'disconnected';
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
