<!--
	Lock screen: unlock the stored vault with the master password.
	Also allows restoring from a .kdbx backup (replaces the stored vault).
-->
<script lang="ts">
	import ImportVaultForm from './ImportVaultForm.svelte';
	import { session } from '$lib/vault/session.svelte';
	import { InvalidPasswordError } from '$lib/vault/vault';

	let password = $state('');
	let error = $state('');
	let busy = $state(false);

	async function submit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		busy = true;
		error = '';
		try {
			await session.unlock(password);
		} catch (err) {
			error =
				err instanceof InvalidPasswordError
					? 'マスターパスワードが違います'
					: `解錠できませんでした: ${err instanceof Error ? err.message : String(err)}`;
		} finally {
			busy = false;
			password = '';
		}
	}
</script>

<main class="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
	<header class="text-center">
		<h1 class="text-3xl font-bold">kbx</h1>
		<p class="mt-2 text-slate-400">保管庫はロックされています</p>
	</header>

	<form onsubmit={submit} class="flex flex-col gap-3">
		<input
			type="password"
			bind:value={password}
			placeholder="マスターパスワード"
			autocomplete="current-password"
			class="rounded bg-slate-800 px-3 py-3"
			required
		/>
		{#if error}
			<p class="text-sm text-red-400">{error}</p>
		{/if}
		<button
			type="submit"
			disabled={busy}
			class="rounded bg-indigo-600 px-4 py-3 font-medium disabled:opacity-40"
		>
			{busy ? '解錠中…' : '解錠'}
		</button>
	</form>

	<details class="rounded border border-slate-800 p-4">
		<summary class="cursor-pointer text-slate-300">バックアップ (.kdbx) から復元</summary>
		<div class="mt-4">
			<ImportVaultForm requireConfirm />
		</div>
	</details>
</main>
