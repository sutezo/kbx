<!--
	First-run screen: create a new vault with a master password,
	or import an existing .kdbx file instead.
-->
<script lang="ts">
	import ImportVaultForm from './ImportVaultForm.svelte';
	import { session } from '$lib/vault/session.svelte';

	const MIN_LENGTH = 12;

	let password = $state('');
	let confirmPassword = $state('');
	let error = $state('');
	let busy = $state(false);

	async function submit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (password.length < MIN_LENGTH) {
			error = `マスターパスワードは${MIN_LENGTH}文字以上にしてください`;
			return;
		}
		if (password !== confirmPassword) {
			error = '確認用パスワードが一致しません';
			return;
		}
		busy = true;
		error = '';
		try {
			await session.create(password);
		} catch (err) {
			error = `保管庫を作成できませんでした: ${err instanceof Error ? err.message : String(err)}`;
			busy = false;
		}
	}
</script>

<main class="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
	<header class="text-center">
		<h1 class="text-3xl font-bold">kbx</h1>
		<p class="mt-2 text-slate-400">新しい保管庫を作成します</p>
	</header>

	<form onsubmit={submit} class="flex flex-col gap-3">
		<input
			type="password"
			bind:value={password}
			placeholder="マスターパスワード（{MIN_LENGTH}文字以上）"
			autocomplete="new-password"
			class="rounded bg-slate-800 px-3 py-3"
			required
		/>
		<input
			type="password"
			bind:value={confirmPassword}
			placeholder="マスターパスワード（確認）"
			autocomplete="new-password"
			class="rounded bg-slate-800 px-3 py-3"
			required
		/>
		<p class="text-xs text-slate-500">
			このパスワードはどこにも保存されません。忘れると保管庫は誰にも開けません。
		</p>
		{#if error}
			<p class="text-sm text-red-400">{error}</p>
		{/if}
		<button
			type="submit"
			disabled={busy}
			class="rounded bg-indigo-600 px-4 py-3 font-medium disabled:opacity-40"
		>
			{busy ? '作成中…' : '保管庫を作成'}
		</button>
	</form>

	<details class="rounded border border-slate-800 p-4">
		<summary class="cursor-pointer text-slate-300">既存の .kdbx をインポート</summary>
		<div class="mt-4">
			<ImportVaultForm />
		</div>
	</details>
</main>
