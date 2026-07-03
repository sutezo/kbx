// Vault domain layer: creating, opening, and serializing KDBX4 vaults and
// CRUD helpers for entries. Wraps kdbxweb so the UI never touches it directly.
import * as kdbxweb from 'kdbxweb';
import { registerArgon2 } from './crypto-engine';

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
			tags: entry.tags
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
	const entry = requireEntry(db, id);
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
