<!--
	Main screen for an unlocked vault: entry list with search, clipboard copy
	with auto-clear, backup export, and access to the entry editor.
-->
<script lang="ts">
	import EntryEditor from './EntryEditor.svelte';
	import TotpCell from './TotpCell.svelte';
	import { copySecret, CLIPBOARD_CLEAR_MS } from '$lib/clipboard';
	import { session } from '$lib/vault/session.svelte';
	import { InvalidPasswordError } from '$lib/vault/vault';
	import { PrfUnsupportedError } from '$lib/vault/biometric';

	let query = $state('');
	/** null = closed, 'new' = creating, otherwise the id being edited. */
	let editing = $state<string | null>(null);
	let toast = $state('');
	let toastTimer: ReturnType<typeof setTimeout> | null = null;

	let bioPassword = $state('');
	let bioError = $state('');
	let bioBusy = $state(false);

	async function enableBiometric(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		bioBusy = true;
		bioError = '';
		try {
			await session.enableBiometric(bioPassword);
			showToast('生体認証での解錠を有効にしました');
		} catch (err) {
			if (err instanceof InvalidPasswordError) {
				bioError = 'マスターパスワードが違います';
			} else if (err instanceof PrfUnsupportedError) {
				bioError = 'この端末/ブラウザは対応していません（iOS 18+ / macOS Safari 18+ 等が必要）';
			} else {
				bioError = `有効化できませんでした: ${err instanceof Error ? err.message : String(err)}`;
			}
		} finally {
			bioBusy = false;
			bioPassword = '';
		}
	}

	async function disableBiometric(): Promise<void> {
		await session.disableBiometric();
		showToast('生体認証での解錠を無効にしました');
	}

	const filtered = $derived(
		session.entries.filter((entry) => {
			const q = query.trim().toLowerCase();
			return (
				q === '' ||
				entry.title.toLowerCase().includes(q) ||
				entry.username.toLowerCase().includes(q) ||
				entry.url.toLowerCase().includes(q)
			);
		})
	);

	function showToast(message: string): void {
		toast = message;
		if (toastTimer !== null) {
			clearTimeout(toastTimer);
		}
		toastTimer = setTimeout(() => (toast = ''), 3000);
	}

	async function copyPassword(id: string): Promise<void> {
		const ok = await copySecret(session.password(id));
		showToast(
			ok
				? `パスワードをコピーしました（${CLIPBOARD_CLEAR_MS / 1000}秒後に消去）`
				: 'コピーできませんでした'
		);
	}

	async function copyUsername(username: string): Promise<void> {
		const ok = await copySecret(username);
		showToast(ok ? 'ユーザー名をコピーしました' : 'コピーできませんでした');
	}

	async function exportVault(): Promise<void> {
		const bytes = await session.exportBytes();
		const stamp = new Date().toISOString().slice(0, 10);
		const file = new File([bytes], `kbx-${stamp}.kdbx`, { type: 'application/octet-stream' });
		try {
			if (navigator.canShare?.({ files: [file] })) {
				// iOS: share sheet lets the user save into Files (iCloud Drive).
				await navigator.share({ files: [file], title: file.name });
			} else {
				const url = URL.createObjectURL(file);
				const anchor = document.createElement('a');
				anchor.href = url;
				anchor.download = file.name;
				anchor.click();
				URL.revokeObjectURL(url);
			}
			await session.markExported();
			showToast('バックアップを書き出しました');
		} catch {
			// User cancelled the share sheet — keep the nag counter as-is.
		}
	}
</script>

<main class="mx-auto flex min-h-dvh max-w-2xl flex-col gap-4 p-4">
	<header class="flex items-center justify-between gap-2">
		<h1 class="text-xl font-bold">kbx</h1>
		<div class="flex gap-2">
			<button
				onclick={exportVault}
				class="rounded bg-slate-800 px-3 py-2 text-sm"
			>
				エクスポート
			</button>
			<button
				onclick={() => session.lock()}
				class="rounded bg-slate-800 px-3 py-2 text-sm"
			>
				ロック
			</button>
		</div>
	</header>

	{#if session.needsBackup}
		<div class="rounded border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-300">
			未バックアップの変更が {session.backupMeta.changesSinceExport} 件あります。
			「エクスポート」から .kdbx を iCloud Drive などへ保存してください。
		</div>
	{/if}

	<div class="flex gap-2">
		<input
			type="search"
			bind:value={query}
			placeholder="検索"
			class="min-w-0 flex-1 rounded bg-slate-800 px-3 py-2"
		/>
		<button
			onclick={() => (editing = 'new')}
			class="rounded bg-indigo-600 px-4 py-2 font-medium"
		>
			追加
		</button>
	</div>

	{#if filtered.length === 0}
		<p class="py-12 text-center text-slate-500">
			{session.entries.length === 0 ? 'エントリがありません。「追加」から登録できます。' : '該当なし'}
		</p>
	{:else}
		<ul class="flex flex-col divide-y divide-slate-800 rounded border border-slate-800">
			{#each filtered as entry (entry.id)}
				<li class="flex items-center gap-2 p-3">
					<button
						onclick={() => (editing = entry.id)}
						class="min-w-0 flex-1 text-left"
					>
						<p class="truncate font-medium">{entry.title || '(無題)'}</p>
						{#if entry.username}
							<p class="truncate text-sm text-slate-400">{entry.username}</p>
						{/if}
					</button>
					{#if entry.hasOtp}
						<TotpCell entryId={entry.id} />
					{/if}
					{#if entry.username}
						<button
							onclick={() => copyUsername(entry.username)}
							class="rounded bg-slate-800 px-3 py-2 text-xs"
							title="ユーザー名をコピー"
						>
							ID
						</button>
					{/if}
					<button
						onclick={() => copyPassword(entry.id)}
						class="rounded bg-slate-700 px-3 py-2 text-xs"
						title="パスワードをコピー"
					>
						PW
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	<details class="rounded border border-slate-800 p-4">
		<summary class="cursor-pointer text-sm text-slate-300">設定</summary>
		<div class="mt-4 flex flex-col gap-3 text-sm">
			{#if session.biometric === 'enabled'}
				<p class="text-slate-300">Face ID / Touch ID での解錠: <span class="text-green-400">有効</span></p>
				<button
					type="button"
					onclick={disableBiometric}
					class="self-start rounded bg-slate-700 px-4 py-2"
				>
					生体認証での解錠を無効にする
				</button>
			{:else if session.biometric === 'available'}
				<p class="text-slate-300">
					Face ID / Touch ID での解錠を有効にできます。確認のためマスターパスワードを入力してください。
				</p>
				<form onsubmit={enableBiometric} class="flex flex-col gap-2">
					<input
						type="password"
						bind:value={bioPassword}
						placeholder="マスターパスワード"
						autocomplete="current-password"
						class="rounded bg-slate-800 px-3 py-2"
						required
					/>
					{#if bioError}
						<p class="text-red-400">{bioError}</p>
					{/if}
					<button
						type="submit"
						disabled={bioBusy}
						class="self-start rounded bg-indigo-600 px-4 py-2 font-medium disabled:opacity-40"
					>
						{bioBusy ? '設定中…' : '生体認証での解錠を有効にする'}
					</button>
				</form>
				<p class="text-xs text-slate-500">
					マスターパスワードは生体認証を通らないと復号できない形で端末内に暗号化保存されます。
					パスワード入力での解錠は引き続き利用できます。
				</p>
			{:else}
				<p class="text-slate-500">この端末/ブラウザでは生体認証解錠を利用できません。</p>
			{/if}
		</div>
	</details>

	{#if toast}
		<div
			class="fixed inset-x-4 bottom-6 mx-auto max-w-md rounded bg-slate-800 p-3 text-center text-sm shadow-lg"
		>
			{toast}
		</div>
	{/if}

	{#if editing !== null}
		<EntryEditor entryId={editing === 'new' ? null : editing} onclose={() => (editing = null)} />
	{/if}
</main>
