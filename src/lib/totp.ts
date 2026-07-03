// RFC 6238 TOTP implementation on WebCrypto, plus otpauth:// URI / Base32
// secret parsing. Compatible with the KeePassXC "otp" entry field convention.

/** Parsed TOTP parameters. */
export interface TotpConfig {
	secret: Uint8Array;
	algorithm: 'SHA-1' | 'SHA-256' | 'SHA-512';
	digits: number;
	period: number;
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const ALGORITHM_MAP: Record<string, TotpConfig['algorithm']> = {
	SHA1: 'SHA-1',
	SHA256: 'SHA-256',
	SHA512: 'SHA-512'
};

/**
 * Decodes an RFC 4648 Base32 string (case-insensitive, padding and
 * whitespace tolerated).
 * @param encoded - Base32 text
 * @returns Decoded bytes
 * @throws {Error} On characters outside the Base32 alphabet
 */
export function base32Decode(encoded: string): Uint8Array {
	const clean = encoded.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
	let bits = 0;
	let value = 0;
	const out: number[] = [];
	for (const ch of clean) {
		const index = BASE32_ALPHABET.indexOf(ch);
		if (index === -1) {
			throw new Error(`Invalid Base32 character: ${ch}`);
		}
		value = (value << 5) | index;
		bits += 5;
		if (bits >= 8) {
			out.push((value >>> (bits - 8)) & 0xff);
			bits -= 8;
		}
	}
	if (out.length === 0) {
		throw new Error('Empty Base32 secret');
	}
	return new Uint8Array(out);
}

/**
 * Parses either an otpauth://totp/ URI or a bare Base32 secret
 * (bare secrets get the standard defaults: SHA-1, 6 digits, 30 s).
 * @param input - URI or Base32 text as stored in the entry's "otp" field
 * @returns Normalized TOTP parameters
 * @throws {Error} On malformed input or unsupported options
 */
export function parseTotp(input: string): TotpConfig {
	const trimmed = input.trim();
	if (trimmed === '') {
		throw new Error('Empty TOTP secret');
	}
	if (!trimmed.toLowerCase().startsWith('otpauth://')) {
		return { secret: base32Decode(trimmed), algorithm: 'SHA-1', digits: 6, period: 30 };
	}

	const url = new URL(trimmed);
	if (url.host.toLowerCase() !== 'totp') {
		throw new Error(`Unsupported otpauth type: ${url.host} (only totp)`);
	}
	const secret = url.searchParams.get('secret');
	if (!secret) {
		throw new Error('otpauth URI has no secret parameter');
	}
	const algorithm = ALGORITHM_MAP[(url.searchParams.get('algorithm') ?? 'SHA1').toUpperCase()];
	if (!algorithm) {
		throw new Error(`Unsupported TOTP algorithm: ${url.searchParams.get('algorithm')}`);
	}
	const digits = Number(url.searchParams.get('digits') ?? 6);
	const period = Number(url.searchParams.get('period') ?? 30);
	if (!Number.isInteger(digits) || digits < 6 || digits > 8) {
		throw new Error(`TOTP digits must be 6-8, got ${digits}`);
	}
	if (!Number.isInteger(period) || period < 5 || period > 300) {
		throw new Error(`TOTP period must be 5-300 s, got ${period}`);
	}
	return { secret: base32Decode(secret), algorithm, digits, period };
}

/**
 * Computes the current TOTP code.
 * @param config - TOTP parameters
 * @param nowMs - Clock in milliseconds (defaults to Date.now())
 * @returns Zero-padded code string
 */
export async function totpCode(config: TotpConfig, nowMs: number = Date.now()): Promise<string> {
	const counter = Math.floor(nowMs / 1000 / config.period);
	const message = new ArrayBuffer(8);
	const view = new DataView(message);
	view.setUint32(0, Math.floor(counter / 0x100000000));
	view.setUint32(4, counter % 0x100000000);

	const key = await crypto.subtle.importKey(
		'raw',
		config.secret as BufferSource,
		{ name: 'HMAC', hash: config.algorithm },
		false,
		['sign']
	);
	const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, message));

	// RFC 4226 dynamic truncation.
	const offset = mac[mac.length - 1] & 0x0f;
	const binary =
		((mac[offset] & 0x7f) << 24) |
		(mac[offset + 1] << 16) |
		(mac[offset + 2] << 8) |
		mac[offset + 3];
	return String(binary % 10 ** config.digits).padStart(config.digits, '0');
}

/**
 * Seconds until the current code expires.
 * @param config - TOTP parameters
 * @param nowMs - Clock in milliseconds (defaults to Date.now())
 * @returns Remaining whole seconds (1..period)
 */
export function totpRemaining(config: TotpConfig, nowMs: number = Date.now()): number {
	const elapsed = Math.floor(nowMs / 1000) % config.period;
	return config.period - elapsed;
}
