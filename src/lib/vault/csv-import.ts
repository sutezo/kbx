// CSV import for migrating from other password managers: parses Chrome/Google
// Password Manager and Apple Passwords CSV exports into EntryDraft objects.
// Pure functions only — the plaintext CSV is never persisted anywhere.
import type { EntryDraft } from './vault';

/** Which password manager produced the CSV (detected from the header row). */
export type CsvSource = 'chrome' | 'apple';

/** Outcome of parsing a credential CSV. */
export interface CsvImportResult {
	source: CsvSource;
	drafts: EntryDraft[];
}

/** Thrown when the file is not a recognized credential CSV export. */
export class CsvFormatError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'CsvFormatError';
	}
}

/**
 * Minimal RFC 4180 CSV parser: handles quoted fields containing commas,
 * newlines (CRLF/LF), and escaped quotes (`""`). No external dependency so
 * the plaintext credentials never pass through third-party code.
 * @param text - Raw CSV text
 * @returns Rows of unescaped field values
 */
function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let inQuotes = false;
	let i = 0;

	const endField = (): void => {
		row.push(field);
		field = '';
	};
	const endRow = (): void => {
		endField();
		rows.push(row);
		row = [];
	};

	while (i < text.length) {
		const ch = text[i];
		if (inQuotes) {
			if (ch === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i += 2;
				} else {
					inQuotes = false;
					i += 1;
				}
			} else {
				field += ch;
				i += 1;
			}
		} else if (ch === '"' && field === '') {
			inQuotes = true;
			i += 1;
		} else if (ch === ',') {
			endField();
			i += 1;
		} else if (ch === '\r' && text[i + 1] === '\n') {
			endRow();
			i += 2;
		} else if (ch === '\n') {
			endRow();
			i += 1;
		} else {
			field += ch;
			i += 1;
		}
	}
	// Flush the last row unless the file ended with a newline.
	if (field !== '' || row.length > 0) {
		endRow();
	}
	return rows;
}

/** Maps a header cell to a canonical field name, or null if unknown. */
type Column = 'title' | 'url' | 'username' | 'password' | 'notes' | 'otp';

const HEADER_ALIASES: Record<string, Column> = {
	// Chrome / Google Password Manager: name,url,username,password,note
	name: 'title',
	note: 'notes',
	// Apple Passwords: Title,URL,Username,Password,Notes,OTPAuth
	title: 'title',
	notes: 'notes',
	otpauth: 'otp',
	// Shared columns
	url: 'url',
	username: 'username',
	password: 'password'
};

/**
 * Parses a CSV exported from Chrome/Google Password Manager or Apple
 * Passwords into entry drafts. The format is detected from the header row.
 * Rows with every field empty are skipped; short rows are padded.
 * @param text - Raw CSV text (a leading BOM is tolerated)
 * @returns Detected source and the drafts to add to the vault
 * @throws {CsvFormatError} When the header row matches neither format
 */
export function parseCredentialCsv(text: string): CsvImportResult {
	const rows = parseCsv(text.replace(/^\uFEFF/, ''));
	if (rows.length === 0) {
		throw new CsvFormatError('The file is empty');
	}

	const header = rows[0].map((cell) => cell.trim().toLowerCase());
	const columns = header.map((cell) => HEADER_ALIASES[cell] ?? null);
	const indexOf = (column: Column): number => columns.indexOf(column);

	const required: Column[] = ['title', 'url', 'username', 'password'];
	if (required.some((column) => indexOf(column) === -1)) {
		throw new CsvFormatError(
			'Unrecognized header row — expected a Chrome/Google Password Manager or Apple Passwords export'
		);
	}
	const source: CsvSource = header.includes('name') ? 'chrome' : 'apple';

	const pick = (row: string[], column: Column): string => {
		const index = indexOf(column);
		return index === -1 ? '' : (row[index] ?? '');
	};

	const drafts: EntryDraft[] = rows
		.slice(1)
		.filter((row) => row.some((cell) => cell !== ''))
		.map((row) => ({
			title: pick(row, 'title'),
			url: pick(row, 'url'),
			username: pick(row, 'username'),
			password: pick(row, 'password'),
			notes: pick(row, 'notes'),
			otp: pick(row, 'otp'),
			tags: []
		}));

	return { source, drafts };
}
