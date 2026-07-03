// TOTP tests against the RFC 6238 Appendix B reference vectors,
// plus parser and Base32 edge cases.
import { describe, expect, it } from 'vitest';
import { base32Decode, parseTotp, totpCode, totpRemaining, type TotpConfig } from './totp';

/** RFC 6238 test secret: ASCII "12345678901234567890". */
const RFC_SECRET = new TextEncoder().encode('12345678901234567890');

function rfcConfig(): TotpConfig {
	return { secret: RFC_SECRET, algorithm: 'SHA-1', digits: 8, period: 30 };
}

describe('totpCode (RFC 6238 vectors, SHA-1)', () => {
	const vectors: [number, string][] = [
		[59, '94287082'],
		[1111111109, '07081804'],
		[1111111111, '14050471'],
		[1234567890, '89005924'],
		[2000000000, '69279037'],
		[20000000000, '65353130']
	];

	for (const [seconds, expected] of vectors) {
		it(`T=${seconds} → ${expected}`, async () => {
			expect(await totpCode(rfcConfig(), seconds * 1000)).toBe(expected);
		});
	}

	it('pads short codes with leading zeros', async () => {
		// T=1111111109 yields 07081804 — the leading zero must survive.
		const code = await totpCode(rfcConfig(), 1111111109 * 1000);
		expect(code).toHaveLength(8);
		expect(code[0]).toBe('0');
	});
});

describe('base32Decode', () => {
	it('decodes a known vector', () => {
		expect(base32Decode('JBSWY3DPEB3W64TMMQ')).toEqual(
			new TextEncoder().encode('Hello world')
		);
	});

	it('tolerates lowercase, spaces, and padding', () => {
		expect(base32Decode('jbsw y3dp eb3w 64tm mq==')).toEqual(
			new TextEncoder().encode('Hello world')
		);
	});

	it('rejects invalid characters', () => {
		expect(() => base32Decode('ABC!DEF')).toThrow(/Invalid Base32/);
	});
});

describe('parseTotp', () => {
	it('parses a bare Base32 secret with defaults', () => {
		const config = parseTotp('JBSWY3DPEHPK3PXP');
		expect(config.algorithm).toBe('SHA-1');
		expect(config.digits).toBe(6);
		expect(config.period).toBe(30);
	});

	it('parses a full otpauth URI', () => {
		const config = parseTotp(
			'otpauth://totp/Example:user@example.com?secret=JBSWY3DPEHPK3PXP&algorithm=SHA256&digits=8&period=60'
		);
		expect(config.algorithm).toBe('SHA-256');
		expect(config.digits).toBe(8);
		expect(config.period).toBe(60);
	});

	it('rejects hotp URIs and missing secrets', () => {
		expect(() => parseTotp('otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP&counter=0')).toThrow(
			/only totp/
		);
		expect(() => parseTotp('otpauth://totp/x?digits=6')).toThrow(/no secret/);
	});

	it('rejects out-of-range digits', () => {
		expect(() =>
			parseTotp('otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=10')
		).toThrow(/digits/);
	});
});

describe('totpRemaining', () => {
	it('counts down from period to 1', () => {
		const config = rfcConfig();
		expect(totpRemaining(config, 0)).toBe(30);
		expect(totpRemaining(config, 29_000)).toBe(1);
		expect(totpRemaining(config, 30_000)).toBe(30);
	});
});
