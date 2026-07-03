<!--
	Live TOTP code for one entry: refreshes every second, shows remaining
	seconds, and copies the code (with auto-clear) on tap.
-->
<script lang="ts">
	import { copySecret } from '$lib/clipboard';
	import { parseTotp, totpCode, totpRemaining } from '$lib/totp';
	import { session } from '$lib/vault/session.svelte';

	let { entryId }: { entryId: string } = $props();

	let code = $state('------');
	let remaining = $state(0);
	let invalid = $state(false);

	async function tick(): Promise<void> {
		try {
			const config = parseTotp(session.otp(entryId));
			remaining = totpRemaining(config);
			code = await totpCode(config);
			invalid = false;
		} catch {
			// Malformed secret, or the vault locked mid-tick — show as invalid.
			invalid = true;
		}
	}

	$effect(() => {
		void tick();
		const timer = setInterval(() => void tick(), 1000);
		return () => clearInterval(timer);
	});

	async function copy(): Promise<void> {
		if (!invalid) {
			await copySecret(code);
		}
	}
</script>

{#if invalid}
	<span class="rounded bg-slate-800 px-2 py-2 text-xs text-red-400" title="TOTPシークレットが不正です">
		OTP?
	</span>
{:else}
	<button
		onclick={copy}
		class="rounded bg-slate-800 px-2 py-1 text-right font-mono text-sm tabular-nums"
		title="ワンタイムコードをコピー"
	>
		{code}
		<span class="block text-[10px] text-slate-500">{remaining}s</span>
	</button>
{/if}
