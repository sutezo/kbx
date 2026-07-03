// Clipboard helper that copies a secret and clears it again after a delay.
// Clearing is best-effort: iOS may deny writes while the app is backgrounded.

/** How long a copied secret stays on the clipboard. */
export const CLIPBOARD_CLEAR_MS = 30_000;

let clearTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Copies a secret to the clipboard and schedules an automatic clear.
 * @param text - The secret to copy
 * @returns Whether the copy succeeded
 */
export async function copySecret(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
	} catch {
		return false;
	}
	if (clearTimer !== null) {
		clearTimeout(clearTimer);
	}
	clearTimer = setTimeout(() => {
		clearTimer = null;
		// Overwrite rather than read-back: reading the clipboard needs a
		// permission prompt, and we only ever want to destroy our own value.
		navigator.clipboard.writeText('').catch(() => undefined);
	}, CLIPBOARD_CLEAR_MS);
	return true;
}
