// Tests for the credential CSV importer: format detection
// (Chrome/Apple/KeePassXC), RFC 4180 quoting edge cases, and rejection of
// unrecognized files.
import { describe, expect, it } from 'vitest';
import { CsvFormatError, parseCredentialCsv } from './csv-import';

describe('parseCredentialCsv', () => {
	it('parses a Chrome / Google Password Manager export', () => {
		const csv = [
			'name,url,username,password,note',
			'Example Bank,https://bank.example.com,taro,S3cret!,支店番号 123',
			'No Note Site,https://nonote.example.com,hana,pw123,'
		].join('\n');

		const result = parseCredentialCsv(csv);

		expect(result.source).toBe('chrome');
		expect(result.drafts).toHaveLength(2);
		expect(result.drafts[0]).toEqual({
			title: 'Example Bank',
			url: 'https://bank.example.com',
			username: 'taro',
			password: 'S3cret!',
			notes: '支店番号 123',
			otp: '',
			tags: []
		});
	});

	it('parses an older Chrome export without the note column', () => {
		const csv = ['name,url,username,password', 'Site,https://a.example.com,taro,pw'].join('\n');

		const result = parseCredentialCsv(csv);

		expect(result.source).toBe('chrome');
		expect(result.drafts[0].notes).toBe('');
	});

	it('parses an Apple Passwords export including OTPAuth', () => {
		const otp = 'otpauth://totp/Example:taro?secret=JBSWY3DPEHPK3PXP&digits=6&period=30';
		const csv = [
			'Title,URL,Username,Password,Notes,OTPAuth',
			`Example,https://example.com,taro,pw!,memo,${otp.replace(/,/g, '')}`
		].join('\r\n');

		const result = parseCredentialCsv(csv);

		expect(result.source).toBe('apple');
		expect(result.drafts).toHaveLength(1);
		expect(result.drafts[0].otp).toContain('otpauth://totp/');
		expect(result.drafts[0].notes).toBe('memo');
	});

	it('parses a KeePassXC export with TOTP and group-path tags', () => {
		const csv = [
			'"Group","Title","Username","Password","URL","Notes","TOTP","Icon","Last Modified","Created"',
			'"Passwords","Root Entry","taro","pw1","https://a.example.com","","","0","2026-01-01T00:00:00Z","2026-01-01T00:00:00Z"',
			'"Passwords/銀行/メイン","Bank","hana","pw2","https://b.example.com","memo","otpauth://totp/Bank:hana?secret=JBSWY3DPEHPK3PXP&period=30&digits=6","0","2026-01-01T00:00:00Z","2026-01-01T00:00:00Z"'
		].join('\n');

		const result = parseCredentialCsv(csv);

		expect(result.source).toBe('keepassxc');
		expect(result.drafts).toHaveLength(2);
		// The root group is shared by every row and must not become a tag.
		expect(result.drafts[0].tags).toEqual([]);
		expect(result.drafts[0].otp).toBe('');
		expect(result.drafts[1].tags).toEqual(['銀行', 'メイン']);
		expect(result.drafts[1].otp).toContain('otpauth://totp/');
		expect(result.drafts[1].notes).toBe('memo');
	});

	it('handles quoted fields with commas, newlines, and escaped quotes', () => {
		const csv = [
			'name,url,username,password,note',
			'"Quoted, Site",https://q.example.com,taro,"p,w""x"',
			'"Multi',
			'Line",https://m.example.com,hana,pw2,"note',
			'with newline"'
		].join('\n');

		const result = parseCredentialCsv(csv);

		expect(result.drafts).toHaveLength(2);
		expect(result.drafts[0].title).toBe('Quoted, Site');
		expect(result.drafts[0].password).toBe('p,w"x');
		expect(result.drafts[1].title).toBe('Multi\nLine');
		expect(result.drafts[1].notes).toBe('note\nwith newline');
	});

	it('skips empty rows and tolerates a leading BOM and trailing newline', () => {
		const csv = '\uFEFFname,url,username,password,note\nSite,https://s.example.com,taro,pw,\n,,,,\n';

		const result = parseCredentialCsv(csv);

		expect(result.drafts).toHaveLength(1);
	});

	it('rejects a CSV with an unrecognized header', () => {
		const csv = 'email,secret\na@example.com,pw';

		expect(() => parseCredentialCsv(csv)).toThrow(CsvFormatError);
	});

	it('rejects an empty file', () => {
		expect(() => parseCredentialCsv('')).toThrow(CsvFormatError);
	});
});
