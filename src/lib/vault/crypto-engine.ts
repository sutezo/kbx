// Registers a WASM-based Argon2 implementation (hash-wasm) into kdbxweb's
// crypto engine. kdbxweb ships no Argon2 of its own, so this must run first.
import { argon2d, argon2id } from 'hash-wasm';
import * as kdbxweb from 'kdbxweb';

let registered = false;

/**
 * Injects the Argon2 KDF implementation into kdbxweb. Idempotent.
 *
 * kdbxweb passes `memory` already converted to KiB, which matches
 * hash-wasm's `memorySize` unit directly.
 */
export function registerArgon2(): void {
	if (registered) {
		return;
	}
	kdbxweb.CryptoEngine.setArgon2Impl(
		async (password, salt, memory, iterations, length, parallelism, type, version) => {
			if (version !== 0x13) {
				throw new Error(`Unsupported Argon2 version: 0x${version.toString(16)}`);
			}
			const argon2 = type === kdbxweb.CryptoEngine.Argon2TypeArgon2id ? argon2id : argon2d;
			const hash = await argon2({
				password: new Uint8Array(password),
				salt: new Uint8Array(salt),
				parallelism,
				iterations,
				memorySize: memory,
				hashLength: length,
				outputType: 'binary'
			});
			// Copy into a standalone ArrayBuffer (hash-wasm may reuse its buffer).
			return hash.slice().buffer;
		}
	);
	registered = true;
}
