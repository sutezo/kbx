<!--
	Form to import an existing .kdbx file, replacing the stored vault.
	Validates the master password by actually decrypting the file.
-->
<script lang="ts">
	import { session } from '$lib/vault/session.svelte';
	import { InvalidPasswordError } from '$lib/vault/vault';

	/** When true, an explicit confirmation checkbox is required (a vault already exists). */
	let { requireConfirm = false }: { requireConfirm?: boolean } = $props();

	let file = $state<File | null>(null);
	let password = $state('');
	let confirmed = $state(false);
	let error = $state('');
	let busy = $state(false);

	async function submit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (!file) {
			error = 'ファイルを選択してください';
			return;
		}
		busy = true;
		error = '';
		try {
			await session.importVault(await file.arrayBuffer(), password);
		} catch (err) {
			error =
				err instanceof InvalidPasswordError
					? 'マスターパスワードが違います'
					: 'ファイルを読み込めませんでした（.kdbx 形式か確認してください）';
		} finally {
			busy = false;
			password = '';
		}
	}
</script>

<form onsubmit={submit} class="flex flex-col gap-3">
	{#if requireConfirm}
		<p class="text-sm text-amber-400">
			インポートすると、この端末に保存されている保管庫は置き換えられます。
		</p>
	{/if}
	<input
		type="file"
		accept=".kdbx"
		class="text-sm file:mr-3 file:rounded file:border-0 file:bg-slate-700 file:px-3 file:py-2 file:text-slate-100"
		onchange={(e) => (file = e.currentTarget.files?.[0] ?? null)}
	/>
	<input
		type="password"
		bind:value={password}
		placeholder="この .kdbx のマスターパスワード"
		autocomplete="off"
		class="rounded bg-slate-800 px-3 py-2"
		required
	/>
	{#if requireConfirm}
		<label class="flex items-center gap-2 text-sm text-slate-300">
			<input type="checkbox" bind:checked={confirmed} />
			既存の保管庫を置き換えることを理解しました
		</label>
	{/if}
	{#if error}
		<p class="text-sm text-red-400">{error}</p>
	{/if}
	<button
		type="submit"
		disabled={busy || (requireConfirm && !confirmed)}
		class="rounded bg-slate-700 px-4 py-2 font-medium disabled:opacity-40"
	>
		{busy ? '読み込み中…' : 'インポート'}
	</button>
</form>
