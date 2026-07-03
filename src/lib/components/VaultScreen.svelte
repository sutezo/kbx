<!--
	Main screen for an unlocked vault: entry list with search, clipboard copy
	with auto-clear, backup export, and access to the entry editor.
-->
<script lang="ts">
	import EntryEditor from './EntryEditor.svelte';
	import { copySecret, CLIPBOARD_CLEAR_MS } from '$lib/clipboard';
	import { session } from '$lib/vault/session.svelte';

	let query = $state('');
	/** null = closed, 'new' = creating, otherwise the id being edited. */
	let editing = $state<string | null>(null);
	let toast = $state('');
	let toastTimer: ReturnType<typeof setTimeout> | null = null;

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
