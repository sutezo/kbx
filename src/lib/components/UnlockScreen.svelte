<!--
	Lock screen: unlock the stored vault with the master password.
	Also allows restoring from a .kdbx backup (replaces the stored vault).
-->
<script lang="ts">
	import ImportVaultForm from './ImportVaultForm.svelte';
	import { session } from '$lib/vault/session.svelte';
	import { InvalidPasswordError } from '$lib/vault/vault';

	const ERASE_PHRASE = '削除';

	let password = $state('');
	let error = $state('');
	let busy = $state(false);

	let eraseConfirmText = $state('');
	let erasing = $state(false);

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

	async function eraseAndStartOver(): Promise<void> {
		erasing = true;
		try {
			await session.eraseAndStartOver();
		} finally {
			erasing = false;
			eraseConfirmText = '';
		}
	}

	async function unlockWithBiometric(): Promise<void> {
		busy = true;
		error = '';
		try {
			await session.unlockWithBiometric();
		} catch (err) {
			error = `生体認証で解錠できませんでした。マスターパスワードをお使いください（${err instanceof Error ? err.message : String(err)}）`;
		} finally {
			busy = false;
		}
	}
</script>

<main class="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
	<header class="text-center">
		<h1 class="text-3xl font-bold">kbx</h1>
		<p class="mt-2 text-slate-400">保管庫はロックされています</p>
	</header>

	{#if session.biometric === 'enabled'}
		<button
			type="button"
			onclick={unlockWithBiometric}
			disabled={busy}
			class="rounded bg-emerald-700 px-4 py-3 font-medium disabled:opacity-40"
		>
			Face ID / Touch ID で解錠
		</button>
	{/if}

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

	<details class="rounded border border-red-900/50 p-4">
		<summary class="cursor-pointer text-red-400">マスターパスワードを忘れた場合</summary>
		<div class="mt-4 flex flex-col gap-3 text-sm">
			<p class="text-slate-300">
				マスターパスワードはこのアプリのどこにも保存されておらず、忘れた場合に復元する方法はありません。
				バックアップ (.kdbx) のパスワードも分からない場合、この端末に保存されている保管庫のデータは
				事実上失われています。
			</p>
			<p class="text-slate-400">
				下のボタンでこの端末上の保管庫を削除し、最初から保管庫を作り直せます
				（ブラウザの「サイトデータを削除」と同じ効果ですが、他のサイトのデータには影響しません）。
				<span class="font-medium text-red-400">この操作は取り消せません。</span>
			</p>
			<label class="flex flex-col gap-1">
				確認のため「{ERASE_PHRASE}」と入力してください
				<input
					bind:value={eraseConfirmText}
					autocomplete="off"
					class="rounded bg-slate-800 px-3 py-2"
				/>
			</label>
			<button
				type="button"
				onclick={eraseAndStartOver}
				disabled={erasing || eraseConfirmText !== ERASE_PHRASE}
				class="rounded bg-red-700 px-4 py-2 font-medium disabled:opacity-40"
			>
				{erasing ? '削除中…' : '保管庫を削除して最初からやり直す'}
			</button>
		</div>
	</details>
</main>
