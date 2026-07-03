// Biometric (Face ID / Touch ID) unlock via the WebAuthn PRF extension.
// The PRF output — only obtainable after user verification — feeds HKDF to
// derive an AES-GCM key that wraps the master password. The wrapped blob is
// stored locally; without a successful assertion it cannot be decrypted.
import {
	clearBiometricRecord,
	loadBiometricRecord,
	saveBiometricRecord,
	type BiometricRecord
} from './storage';

/** Domain-separation info for HKDF. Changing this invalidates enrollments. */
const HKDF_INFO = new TextEncoder().encode('kbx-biometric-unlock-v1');

/** Thrown when the platform lacks WebAuthn PRF support. */
export class PrfUnsupportedError extends Error {
	constructor() {
		super('WebAuthn PRF extension is not supported on this device/browser');
		this.name = 'PrfUnsupportedError';
	}
}

/** Shape of the PRF extension results (not yet in TS DOM lib). */
interface PrfExtensionResults {
	prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
}

/**
 * Whether this device offers a user-verifying platform authenticator
 * (Face ID / Touch ID / Windows Hello). PRF support itself can only be
 * probed by attempting enrollment.
 * @returns True when biometric enrollment can be offered
 */
export async function biometricSupported(): Promise<boolean> {
	if (typeof window === 'undefined' || !window.PublicKeyCredential) {
		return false;
	}
	try {
		return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
	} catch {
		return false;
	}
}

/**
 * Creates a passkey, derives the PRF wrapping key, encrypts the master
 * password, and stores the enrollment record. Must be called from a user
 * gesture (click) while the master password is known to be correct.
 * @param masterPassword - The verified master password to wrap
 * @throws {PrfUnsupportedError} When the authenticator lacks PRF support
 */
export async function enrollBiometric(masterPassword: string): Promise<void> {
	const prfSalt = crypto.getRandomValues(new Uint8Array(32));
	const credential = (await navigator.credentials.create({
		publicKey: {
			rp: { name: 'kbx' },
			user: {
				id: crypto.getRandomValues(new Uint8Array(16)),
				name: 'kbx',
				displayName: 'kbx vault'
			},
			challenge: crypto.getRandomValues(new Uint8Array(32)),
			pubKeyCredParams: [
				{ type: 'public-key', alg: -7 }, // ES256
				{ type: 'public-key', alg: -257 } // RS256
			],
			authenticatorSelection: {
				authenticatorAttachment: 'platform',
				residentKey: 'required',
				userVerification: 'required'
			},
			extensions: { prf: {} } as AuthenticationExtensionsClientInputs
		}
	})) as PublicKeyCredential | null;
	if (!credential) {
		throw new Error('Passkey creation was cancelled');
	}
	const createResults = credential.getClientExtensionResults() as PrfExtensionResults;
	if (createResults.prf?.enabled === false) {
		throw new PrfUnsupportedError();
	}

	// PRF results are only returned on assertions, so run one immediately.
	const prfOutput = await assertPrf(credential.rawId, prfSalt);
	const key = await deriveWrapKey(prfOutput, prfSalt);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const wrapped = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv },
		key,
		new TextEncoder().encode(masterPassword)
	);

	await saveBiometricRecord({
		credentialId: toBase64(credential.rawId),
		prfSalt: toBase64(prfSalt),
		iv: toBase64(iv),
		wrapped: toBase64(wrapped)
	});
}

/**
 * Runs a biometric assertion and unwraps the master password.
 * @returns The master password
 * @throws {Error} When not enrolled, cancelled, or the record is stale
 */
export async function unwrapMasterPassword(): Promise<string> {
	const record = await loadBiometricRecord();
	if (!record) {
		throw new Error('Biometric unlock is not enrolled');
	}
	const prfOutput = await assertPrf(fromBase64(record.credentialId), fromBase64(record.prfSalt));
	const key = await deriveWrapKey(prfOutput, fromBase64(record.prfSalt));
	try {
		const plain = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: fromBase64(record.iv) },
			key,
			fromBase64(record.wrapped)
		);
		return new TextDecoder().decode(plain);
	} catch {
		// Wrong key material (e.g. passkey was re-created) — enrollment is dead.
		await clearBiometricRecord();
		throw new Error('Biometric record is stale; re-enroll after unlocking with the password');
	}
}

/** Gets the PRF output for the given credential; throws if unsupported. */
async function assertPrf(credentialId: BufferSource, salt: Uint8Array): Promise<ArrayBuffer> {
	const assertion = (await navigator.credentials.get({
		publicKey: {
			challenge: crypto.getRandomValues(new Uint8Array(32)),
			allowCredentials: [{ type: 'public-key', id: credentialId }],
			userVerification: 'required',
			extensions: {
				prf: { eval: { first: salt } }
			} as AuthenticationExtensionsClientInputs
		}
	})) as PublicKeyCredential | null;
	if (!assertion) {
		throw new Error('Biometric verification was cancelled');
	}
	const results = assertion.getClientExtensionResults() as PrfExtensionResults;
	const output = results.prf?.results?.first;
	if (!output) {
		throw new PrfUnsupportedError();
	}
	return output;
}

/** HKDF-SHA256(PRF output) → non-extractable AES-GCM-256 wrapping key. */
async function deriveWrapKey(prfOutput: ArrayBuffer, salt: Uint8Array): Promise<CryptoKey> {
	const ikm = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey']);
	return crypto.subtle.deriveKey(
		{ name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: HKDF_INFO },
		ikm,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}

function toBase64(data: ArrayBuffer | Uint8Array): string {
	const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

function fromBase64(encoded: string): Uint8Array<ArrayBuffer> {
	const binary = atob(encoded);
	const bytes = new Uint8Array(new ArrayBuffer(binary.length));
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}
