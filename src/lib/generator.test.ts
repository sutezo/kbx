// Tests for the CSPRNG-backed password generator.
import { describe, expect, it } from 'vitest';
import { DEFAULT_PASSWORD_OPTIONS, generatePassword } from './generator';

describe('generatePassword', () => {
	it('produces the requested length', () => {
		const password = generatePassword({ ...DEFAULT_PASSWORD_OPTIONS, length: 32 });
		expect(password).toHaveLength(32);
	});

	it('contains at least one character from every enabled class', () => {
		for (let i = 0; i < 50; i++) {
			const password = generatePassword(DEFAULT_PASSWORD_OPTIONS);
			expect(password).toMatch(/[a-z]/);
			expect(password).toMatch(/[A-Z]/);
			expect(password).toMatch(/[0-9]/);
			expect(password).toMatch(/[^a-zA-Z0-9]/);
		}
	});

	it('respects disabled classes', () => {
		const password = generatePassword({
			length: 24,
			lowercase: true,
			uppercase: false,
			digits: true,
			symbols: false
		});
		expect(password).toMatch(/^[a-z0-9]+$/);
	});

	it('rejects impossible configurations', () => {
		expect(() =>
			generatePassword({ length: 10, lowercase: false, uppercase: false, digits: false, symbols: false })
		).toThrow();
		expect(() => generatePassword({ ...DEFAULT_PASSWORD_OPTIONS, length: 2 })).toThrow();
	});

	it('does not repeat passwords (sanity check for randomness wiring)', () => {
		const a = generatePassword(DEFAULT_PASSWORD_OPTIONS);
		const b = generatePassword(DEFAULT_PASSWORD_OPTIONS);
		expect(a).not.toBe(b);
	});
});
