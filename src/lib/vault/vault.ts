// Vault domain layer: creating, opening, and serializing KDBX4 vaults and
// CRUD helpers for entries. Wraps kdbxweb so the UI never touches it directly.
import * as kdbxweb from 'kdbxweb';
import { registerArgon2 } from './crypto-engine';

/**
 * Fallback tag assigned to entries imported without any tags, so every
 * imported entry stays reachable through the vault's tag filter.
 */
export const NO_TAG = 'タグ無';

/** Editable fields of a vault entry. */
export interface EntryDraft {
	title: string;
	username: string;
	password: string;
	url: string;
	notes: string;
	/** TOTP secret: otpauth:// URI or bare Base32 (KeePassXC "otp" convention). */
	otp: string;
	/** Free-form labels (KDBX4 native `<Tags>`; shown as chips, not encrypted). */
	tags: string[];
}

/** Listing projection of an entry (secrets are intentionally absent). */
export interface EntrySummary {
	id: string;
	title: string;
	username: string;
	url: string;
	hasOtp: boolean;
	tags: string[];
	/** Set once by kdbxweb when the entry is created. */
	createdAt: Date;
	/** Bumped by kdbxweb (`times.update()`) on every edit. */
	modifiedAt: Date;
}

/** Listing projection of a past revision of an entry (no secrets). */
export interface EntryHistoryItem {
	/** Position in kdbxweb's history array; pass to {@link getEntryHistoryDraft}. */
	index: number;
	modifiedAt: Date;
	title: string;
	username: string;
	url: string;
	hasOtp: boolean;
	tags: string[];
}

/** Thrown when a vault cannot be decrypted with the given master password. */
export class InvalidPasswordError extends Error {
	constructor() {
		super('Invalid master password');
		this.name = 'InvalidPasswordError';
	}
}

/**
 * Creates a new empty KDBX4 vault using Argon2id as KDF.
 * @param name - Database name shown by KeePass-compatible apps
 * @param masterPassword - Master password protecting the vault
 * @returns The in-memory vault
 */
export function createVault(name: string, masterPassword: string): kdbxweb.Kdbx {
	registerArgon2();
	const credentials = new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString(masterPassword));
	const db = kdbxweb.Kdbx.create(credentials, name);
	db.setKdf(kdbxweb.Consts.KdfId.Argon2id);
	return db;
}

/**
 * Opens an encrypted vault.
 * @param data - Encrypted .kdbx bytes
 * @param masterPassword - Master password
 * @returns The decrypted vault
 * @throws {InvalidPasswordError} When the password does not match
 */
export async function openVault(data: ArrayBuffer, masterPassword: string): Promise<kdbxweb.Kdbx> {
	registerArgon2();
	const credentials = new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString(masterPassword));
	try {
		return await kdbxweb.Kdbx.load(data, credentials);
	} catch (err) {
		if (err instanceof kdbxweb.KdbxError && err.code === kdbxweb.Consts.ErrorCodes.InvalidKey) {
			throw new InvalidPasswordError();
		}
		throw err;
	}
}

/**
 * Serializes the vault to encrypted .kdbx bytes.
 * @param db - The vault to serialize
 * @returns Encrypted bytes suitable for storage or export
 */
export async function saveVault(db: kdbxweb.Kdbx): Promise<ArrayBuffer> {
	return db.save();
}

/**
 * Merges a remote copy of this same vault (e.g. downloaded from Dropbox)
 * into the local, already-unlocked vault. Uses kdbxweb's UUID/timestamp
 * based reconciliation, so concurrent edits from two devices are combined
 * rather than one silently overwriting the other.
 *
 * The remote bytes must be encrypted with the same master password as
 * `db` — {@link db}.credentials is reused, so the password is never
 * needed (or asked for) again here.
 * @param db - The local vault to merge into (mutated in place)
 * @param remoteBytes - Encrypted .kdbx content downloaded from the remote
 * @throws {InvalidPasswordError} When the remote file uses a different password
 */
export async function mergeVault(db: kdbxweb.Kdbx, remoteBytes: ArrayBuffer): Promise<void> {
	let remote: kdbxweb.Kdbx;
	try {
		remote = await kdbxweb.Kdbx.load(remoteBytes, db.credentials);
	} catch (err) {
		if (err instanceof kdbxweb.KdbxError && err.code === kdbxweb.Consts.ErrorCodes.InvalidKey) {
			throw new InvalidPasswordError();
		}
		throw err;
	}
	db.merge(remote);
}

/**
 * Lists entries of the default group (recycle bin is a separate subgroup and
 * therefore excluded), sorted by title.
 * @param db - The vault
 * @returns Entry summaries without secrets
 */
export function listEntries(db: kdbxweb.Kdbx): EntrySummary[] {
	const group = db.getDefaultGroup();
	return group.entries
		.map((entry) => ({
			id: entry.uuid.id,
			title: fieldText(entry, 'Title'),
			username: fieldText(entry, 'UserName'),
			url: fieldText(entry, 'URL'),
			hasOtp: fieldText(entry, 'otp') !== '',
			tags: entry.tags,
			createdAt: entry.times.creationTime ?? new Date(0),
			modifiedAt: entry.times.lastModTime ?? new Date(0)
		}))
		.sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Adds a new entry to the default group.
 * @param db - The vault
 * @param draft - Field values for the new entry
 * @returns The id of the created entry
 */
export function addEntry(db: kdbxweb.Kdbx, draft: EntryDraft): string {
	const entry = db.createEntry(db.getDefaultGroup());
	applyDraft(entry, draft);
	return entry.uuid.id;
}

/**
 * Updates an existing entry. The previous state is kept as a history
 * revision inside the KDBX file (viewable in KeePassXC etc.).
 * @param db - The vault
 * @param id - Entry uuid
 * @param draft - New field values
 */
export function updateEntry(db: kdbxweb.Kdbx, id: string, draft: EntryDraft): void {
	const entry = requireEntry(db, id);
	entry.pushHistory();
	applyDraft(entry, draft);
}

/**
 * Moves an entry to the recycle bin.
 * @param db - The vault
 * @param id - Entry uuid
 */
export function deleteEntry(db: kdbxweb.Kdbx, id: string): void {
	db.remove(requireEntry(db, id));
}

/**
 * Reads the full draft of an entry, including the decrypted password.
 * @param db - The vault
 * @param id - Entry uuid
 * @returns All editable fields
 */
export function getEntryDraft(db: kdbxweb.Kdbx, id: string): EntryDraft {
	return entryToDraft(requireEntry(db, id));
}

/**
 * Lists every distinct tag used across all entries, sorted.
 * @param db - The vault
 * @returns Sorted unique tag names
 */
export function listTags(db: kdbxweb.Kdbx): string[] {
	const tags = new Set<string>();
	for (const entry of db.getDefaultGroup().entries) {
		for (const tag of entry.tags) {
			tags.add(tag);
		}
	}
	return [...tags].sort((a, b) => a.localeCompare(b));
}

/**
 * Lists every distinct tag ever used in the vault, sorted. Unlike
 * {@link listTags} this also scans history revisions and the recycle bin, so
 * a tag stays offered as a choice even after it was removed from (or its last
 * entry was deleted from) the live list.
 * @param db - The vault
 * @returns Sorted unique tag names, including past-only ones
 */
export function listKnownTags(db: kdbxweb.Kdbx): string[] {
	const tags = new Set<string>();
	const visit = (group: kdbxweb.KdbxGroup): void => {
		for (const entry of group.entries) {
			for (const tag of entry.tags) {
				tags.add(tag);
			}
			for (const revision of entry.history) {
				for (const tag of revision.tags) {
					tags.add(tag);
				}
			}
		}
		for (const sub of group.groups) {
			visit(sub);
		}
	};
	visit(db.getDefaultGroup());
	return [...tags].sort((a, b) => a.localeCompare(b));
}

/**
 * Lists past revisions of an entry (newest first), without secrets.
 * Revisions are created automatically by {@link updateEntry}.
 * @param db - The vault
 * @param id - Entry uuid
 * @returns History summaries, newest first
 */
export function getEntryHistory(db: kdbxweb.Kdbx, id: string): EntryHistoryItem[] {
	const entry = requireEntry(db, id);
	return entry.history
		.map((revision, index) => ({
			index,
			modifiedAt: revision.times.lastModTime ?? new Date(0),
			title: fieldText(revision, 'Title'),
			username: fieldText(revision, 'UserName'),
			url: fieldText(revision, 'URL'),
			hasOtp: fieldText(revision, 'otp') !== '',
			tags: revision.tags
		}))
		.reverse();
}

/**
 * Reads the full field set of a past revision, including its password.
 * @param db - The vault
 * @param id - Entry uuid
 * @param index - Revision index from {@link EntryHistoryItem.index}
 * @returns The revision's fields
 */
export function getEntryHistoryDraft(db: kdbxweb.Kdbx, id: string, index: number): EntryDraft {
	return entryToDraft(requireHistoryRevision(db, id, index));
}

/**
 * Restores a past revision as the entry's current state. The state being
 * replaced is itself kept as a new history revision, so restoring is
 * non-destructive and can be undone the same way.
 * @param db - The vault
 * @param id - Entry uuid
 * @param index - Revision index from {@link EntryHistoryItem.index}
 */
export function restoreEntryRevision(db: kdbxweb.Kdbx, id: string, index: number): void {
	const entry = requireEntry(db, id);
	const revision = requireHistoryRevision(db, id, index);
	const draft = entryToDraft(revision);
	entry.pushHistory();
	applyDraft(entry, draft);
}

/** Extracts editable fields from any KdbxEntry (current or a history revision). */
function entryToDraft(entry: kdbxweb.KdbxEntry): EntryDraft {
	return {
		title: fieldText(entry, 'Title'),
		username: fieldText(entry, 'UserName'),
		password: fieldText(entry, 'Password'),
		url: fieldText(entry, 'URL'),
		notes: fieldText(entry, 'Notes'),
		otp: fieldText(entry, 'otp'),
		tags: entry.tags
	};
}

/** Finds a history revision by index or throws. */
function requireHistoryRevision(db: kdbxweb.Kdbx, id: string, index: number): kdbxweb.KdbxEntry {
	const entry = requireEntry(db, id);
	const revision = entry.history[index];
	if (!revision) {
		throw new Error(`History revision not found: ${id}[${index}]`);
	}
	return revision;
}

/**
 * Reads the TOTP secret of an entry (otpauth URI or Base32).
 * @param db - The vault
 * @param id - Entry uuid
 * @returns The secret, or '' when the entry has none
 */
export function getEntryOtp(db: kdbxweb.Kdbx, id: string): string {
	return fieldText(requireEntry(db, id), 'otp');
}

/**
 * Reads the decrypted password of an entry (for clipboard copy).
 * @param db - The vault
 * @param id - Entry uuid
 * @returns The plaintext password
 */
export function getEntryPassword(db: kdbxweb.Kdbx, id: string): string {
	return fieldText(requireEntry(db, id), 'Password');
}

/** Writes draft fields into an entry; secrets are stored protected. */
function applyDraft(entry: kdbxweb.KdbxEntry, draft: EntryDraft): void {
	entry.fields.set('Title', draft.title);
	entry.fields.set('UserName', draft.username);
	entry.fields.set('Password', kdbxweb.ProtectedValue.fromString(draft.password));
	entry.fields.set('URL', draft.url);
	entry.fields.set('Notes', draft.notes);
	if (draft.otp === '') {
		entry.fields.delete('otp');
	} else {
		entry.fields.set('otp', kdbxweb.ProtectedValue.fromString(draft.otp));
	}
	entry.tags = draft.tags;
	entry.times.update();
}

/** Finds an entry in the default group or throws. */
function requireEntry(db: kdbxweb.Kdbx, id: string): kdbxweb.KdbxEntry {
	const entry = db.getDefaultGroup().entries.find((e) => e.uuid.id === id);
	if (!entry) {
		throw new Error(`Entry not found: ${id}`);
	}
	return entry;
}

/** Reads a field as plain text, decrypting protected values. */
function fieldText(entry: kdbxweb.KdbxEntry, name: string): string {
	const value = entry.fields.get(name);
	if (value === undefined) {
		return '';
	}
	return typeof value === 'string' ? value : value.getText();
}
