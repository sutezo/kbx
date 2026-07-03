// Cryptographically secure password generator.
// All randomness comes from crypto.getRandomValues (CSPRNG); Math.random is banned.

/** Character classes to include in a generated password. */
export interface PasswordOptions {
	length: number;
	lowercase: boolean;
	uppercase: boolean;
	digits: boolean;
	symbols: boolean;
}

const POOLS: Record<Exclude<keyof PasswordOptions, 'length'>, string> = {
	lowercase: 'abcdefghijklmnopqrstuvwxyz',
	uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
	digits: '0123456789',
	symbols: '!"#$%&\'()*+,-./:;<=>?@[]^_{|}~'
};

/** Sensible default: 20 chars, all classes enabled. */
export const DEFAULT_PASSWORD_OPTIONS: PasswordOptions = {
	length: 20,
	lowercase: true,
	uppercase: true,
	digits: true,
	symbols: true
};

/**
 * Generates a random password guaranteed to contain at least one character
 * from every enabled class.
 * @param options - Length and character classes
 * @returns The generated password
 * @throws {Error} When no class is enabled or length is too short
 */
export function generatePassword(options: PasswordOptions): string {
	const pools = (Object.keys(POOLS) as (keyof typeof POOLS)[])
		.filter((key) => options[key])
		.map((key) => POOLS[key]);
	if (pools.length === 0) {
		throw new Error('At least one character class must be enabled');
	}
	if (!Number.isInteger(options.length) || options.length < pools.length || options.length > 256) {
		throw new Error(`Password length must be between ${pools.length} and 256`);
	}

	// One guaranteed char per enabled class, the rest from the combined pool.
	const combined = pools.join('');
	const chars = pools.map((pool) => pool[randomInt(pool.length)]);
	while (chars.length < options.length) {
		chars.push(combined[randomInt(combined.length)]);
	}
	shuffle(chars);
	return chars.join('');
}

/** Unbiased random integer in [0, max) via rejection sampling. */
function randomInt(max: number): number {
	const limit = Math.floor(0x100000000 / max) * max;
	const buf = new Uint32Array(1);
	let value: number;
	do {
		crypto.getRandomValues(buf);
		value = buf[0];
	} while (value >= limit);
	return value % max;
}

/** In-place Fisher-Yates shuffle backed by the CSPRNG. */
function shuffle(items: string[]): void {
	for (let i = items.length - 1; i > 0; i--) {
		const j = randomInt(i + 1);
		[items[i], items[j]] = [items[j], items[i]];
	}
}
