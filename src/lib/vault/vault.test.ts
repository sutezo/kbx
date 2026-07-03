// Round-trip tests for the vault domain layer: these MUST pass before any
// release, as they prove the encrypt → persist → decrypt cycle is lossless.
import { describe, expect, it } from 'vitest';
import * as kdbxweb from 'kdbxweb';
import {
	addEntry,
	createVault,
	deleteEntry,
	getEntryDraft,
	getEntryHistory,
	getEntryHistoryDraft,
	getEntryOtp,
	getEntryPassword,
	InvalidPasswordError,
	listEntries,
	listTags,
	mergeVault,
	openVault,
	restoreEntryRevision,
	saveVault,
	updateEntry
} from './vault';

const MASTER = 'correct horse battery staple';

const SAMPLE = {
	title: 'Example Bank',
	username: 'taro',
	password: 'S3cret!パスワード',
	url: 'https://bank.example.com',
	notes: '支店番号 123 / 口座番号 4567890',
	otp: 'otpauth://totp/Example:taro?secret=JBSWY3DPEHPK3PXP&digits=6&period=30',
	tags: ['銀行', '重要']
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
			url: SAMPLE.url,
			hasOtp: true,
			tags: SAMPLE.tags
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

	it('stores the OTP secret protected and round-trips it', async () => {
		const db = createVault('kbx', MASTER);
		const id = addEntry(db, SAMPLE);
		const entry = db.getDefaultGroup().entries.find((e) => e.uuid.id === id);
		expect(entry?.fields.get('otp')).toBeInstanceOf(kdbxweb.ProtectedValue);

		const reopened = await openVault(await saveVault(db), MASTER);
		expect(getEntryOtp(reopened, id)).toBe(SAMPLE.otp);

		// Clearing the otp removes the field entirely (KeePassXC convention).
		updateEntry(db, id, { ...SAMPLE, otp: '' });
		expect(db.getDefaultGroup().entries[0].fields.has('otp')).toBe(false);
		expect(listEntries(db)[0].hasOtp).toBe(false);
	});

	it('round-trips tags natively (KDBX4 <Tags>) and lists distinct tags', async () => {
		const db = createVault('kbx', MASTER);
		const id1 = addEntry(db, SAMPLE);
		const id2 = addEntry(db, { ...SAMPLE, title: 'Other', tags: ['重要', 'その他'] });

		expect(listTags(db)).toEqual(['その他', '重要', '銀行']);

		const reopened = await openVault(await saveVault(db), MASTER);
		expect(getEntryDraft(reopened, id1).tags).toEqual(['銀行', '重要']);
		expect(getEntryDraft(reopened, id2).tags).toEqual(['重要', 'その他']);
		expect(listTags(reopened)).toEqual(['その他', '重要', '銀行']);
	});

	it('keeps a history revision on update', async () => {
		const db = createVault('kbx', MASTER);
		const id = addEntry(db, SAMPLE);
		updateEntry(db, id, { ...SAMPLE, password: 'changed' });

		const reopened = await openVault(await saveVault(db), MASTER);
		const entry = reopened.getDefaultGroup().entries.find((e) => e.uuid.id === id);
		expect(entry?.history).toHaveLength(1);
		const old = entry?.history[0].fields.get('Password');
		expect(old && typeof old !== 'string' ? old.getText() : old).toBe(SAMPLE.password);
	});

	it('lists history newest-first and exposes full past field values', async () => {
		const db = createVault('kbx', MASTER);
		const id = addEntry(db, SAMPLE);
		updateEntry(db, id, { ...SAMPLE, title: 'Renamed once', password: 'pw1' });
		updateEntry(db, id, { ...SAMPLE, title: 'Renamed twice', password: 'pw2' });

		const history = getEntryHistory(db, id);
		expect(history.map((h) => h.title)).toEqual(['Renamed once', SAMPLE.title]);

		const newest = getEntryHistoryDraft(db, id, history[0].index);
		expect(newest.title).toBe('Renamed once');
		expect(newest.password).toBe('pw1');

		const oldest = getEntryHistoryDraft(db, id, history[1].index);
		expect(oldest.title).toBe(SAMPLE.title);
		expect(oldest.password).toBe(SAMPLE.password);
	});

	it('restores a past revision without losing the replaced state', async () => {
		const db = createVault('kbx', MASTER);
		const id = addEntry(db, SAMPLE);
		updateEntry(db, id, { ...SAMPLE, title: 'Renamed', password: 'new-pass' });

		const [original] = getEntryHistory(db, id);
		restoreEntryRevision(db, id, original.index);

		expect(getEntryDraft(db, id).title).toBe(SAMPLE.title);
		expect(getEntryDraft(db, id).password).toBe(SAMPLE.password);

		// The pre-restore state ("Renamed") must itself now be in history.
		const historyAfterRestore = getEntryHistory(db, id);
		expect(historyAfterRestore.map((h) => h.title)).toContain('Renamed');

		const reopened = await openVault(await saveVault(db), MASTER);
		expect(getEntryDraft(reopened, id).title).toBe(SAMPLE.title);
	});

	it('merges divergent copies without losing either side (Dropbox sync scenario)', async () => {
		const ancestorDb = createVault('kbx', MASTER);
		addEntry(ancestorDb, SAMPLE);
		const ancestorBytes = await saveVault(ancestorDb);

		// Two independent copies of the same starting point, each edited
		// without knowledge of the other — simulates two devices.
		const localDb = await openVault(ancestorBytes, MASTER);
		const remoteDb = await openVault(ancestorBytes, MASTER);
		addEntry(localDb, { ...SAMPLE, title: 'Added locally', tags: [] });
		addEntry(remoteDb, { ...SAMPLE, title: 'Added remotely', tags: [] });
		const remoteBytes = await saveVault(remoteDb);

		await mergeVault(localDb, remoteBytes);

		const titles = listEntries(localDb)
			.map((e) => e.title)
			.sort();
		expect(titles).toEqual(['Added locally', 'Added remotely', SAMPLE.title].sort());

		// The merge result itself must also survive a save/reopen cycle.
		const reopened = await openVault(await saveVault(localDb), MASTER);
		expect(listEntries(reopened).map((e) => e.title).sort()).toEqual(
			['Added locally', 'Added remotely', SAMPLE.title].sort()
		);
	});

	it('rejects merging a remote file with a different master password', async () => {
		const localDb = createVault('kbx', MASTER);
		addEntry(localDb, SAMPLE);
		const otherDb = createVault('kbx', 'a totally different password');
		const otherBytes = await saveVault(otherDb);

		await expect(mergeVault(localDb, otherBytes)).rejects.toBeInstanceOf(InvalidPasswordError);
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
