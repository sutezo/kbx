// Round-trip tests for the vault domain layer: these MUST pass before any
// release, as they prove the encrypt → persist → decrypt cycle is lossless.
import { describe, expect, it } from 'vitest';
import * as kdbxweb from 'kdbxweb';
import {
	addEntry,
	createVault,
	deleteEntry,
	getEntryDraft,
	getEntryPassword,
	InvalidPasswordError,
	listEntries,
	openVault,
	saveVault,
	updateEntry
} from './vault';

const MASTER = 'correct horse battery staple';

const SAMPLE = {
	title: 'Example Bank',
	username: 'taro',
	password: 'S3cret!パスワード',
	url: 'https://bank.example.com',
	notes: '支店番号 123 / 口座番号 4567890'
};

describe('vault round-trip', () => {
	it('creates, saves, and reopens a vault with entries intact', async () => {
		const db = createVault('kbx', MASTER);
		const id = addEntry(db, SAMPLE);

		const bytes = await saveVault(db);
		const reopened = await openVault(bytes, MASTER);

		const entries = listEntries(reopened);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toEqual({
			id,
			title: SAMPLE.title,
			username: SAMPLE.username,
			url: SAMPLE.url
		});
		expect(getEntryDraft(reopened, id)).toEqual(SAMPLE);
		expect(getEntryPassword(reopened, id)).toBe(SAMPLE.password);
	});

	it('rejects a wrong master password with a typed error', async () => {
		const db = createVault('kbx', MASTER);
		const bytes = await saveVault(db);
		await expect(openVault(bytes, 'wrong password')).rejects.toBeInstanceOf(
			InvalidPasswordError
		);
	});

	it('uses KDBX4 with Argon2id as KDF', async () => {
		const db = createVault('kbx', MASTER);
		const bytes = await saveVault(db);
		const reopened = await openVault(bytes, MASTER);
		expect(reopened.header.versionMajor).toBe(4);
		const kdfUuid = reopened.header.kdfParameters?.get('$UUID');
		const kdfId = kdbxweb.ByteUtils.bytesToBase64(
			new Uint8Array(kdfUuid as ArrayBuffer)
		);
		expect(kdfId).toBe(kdbxweb.Consts.KdfId.Argon2id);
	});

	it('stores the password as a protected value inside the entry', () => {
		const db = createVault('kbx', MASTER);
		const id = addEntry(db, SAMPLE);
		const entry = db.getDefaultGroup().entries.find((e) => e.uuid.id === id);
		expect(entry?.fields.get('Password')).toBeInstanceOf(kdbxweb.ProtectedValue);
	});

	it('updates and deletes entries', async () => {
		const db = createVault('kbx', MASTER);
		const id = addEntry(db, SAMPLE);

		updateEntry(db, id, { ...SAMPLE, title: 'Renamed', password: 'new-pass' });
		expect(getEntryDraft(db, id).title).toBe('Renamed');
		expect(getEntryPassword(db, id)).toBe('new-pass');

		deleteEntry(db, id);
		expect(listEntries(db)).toHaveLength(0);

		// Deletion must survive a save/load cycle too.
		const reopened = await openVault(await saveVault(db), MASTER);
		expect(listEntries(reopened)).toHaveLength(0);
	});
});
