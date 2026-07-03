<!--
	Past-revision viewer for one entry: list of history snapshots (kept
	automatically on every edit), full field view per revision, and
	non-destructive restore (the replaced state becomes a new revision).
-->
<script lang="ts">
	import { session } from '$lib/vault/session.svelte';
	import type { EntryDraft } from '$lib/vault/vault';

	let {
		entryId,
		onclose,
		onrestored
	}: { entryId: string; onclose: () => void; onrestored: () => void } = $props();

	// The panel is mounted fresh each time it opens, so a one-time snapshot is fine.
	// svelte-ignore state_referenced_locally
	const items = session.history(entryId);

	let selectedIndex = $state<number | null>(null);
	let selectedDraft = $state<EntryDraft | null>(null);
	let showPassword = $state(false);
	let confirmRestore = $state(false);
	let busy = $state(false);
	let error = $state('');

	function view(index: number): void {
		selectedIndex = index;
		selectedDraft = session.historyDraft(entryId, index);
		showPassword = false;
		confirmRestore = false;
	}

	function back(): void {
		selectedIndex = null;
		selectedDraft = null;
	}

	function formatDate(date: Date): string {
		return date.toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' });
	}

	async function restore(): Promise<void> {
		if (selectedIndex === null) {
			return;
		}
		if (!confirmRestore) {
			confirmRestore = true;
			return;
		}
		busy = true;
		error = '';
		try {
			await session.restoreRevision(entryId, selectedIndex);
			onrestored();
		} catch (err) {
			error = `復元できませんでした: ${err instanceof Error ? err.message : String(err)}`;
			busy = false;
		}
	}
</script>

<div class="fixed inset-0 z-20 flex items-end justify-center bg-black/60 sm:items-center">
	<div
		class="flex max-h-[90dvh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-t-xl bg-slate-900 p-5 sm:rounded-xl"
	>
		{#if selectedDraft === null}
			<h2 class="text-lg font-bold">履歴</h2>
			{#if items.length === 0}
				<p class="py-8 text-center text-sm text-slate-500">
					このエントリはまだ編集されていません。履歴は編集のたびに記録されます。
				</p>
			{:else}
				<ul class="flex flex-col divide-y divide-slate-800 rounded border border-slate-800">
					{#each items as item (item.index)}
						<li>
							<button
								onclick={() => view(item.index)}
								class="flex w-full flex-col gap-0.5 p-3 text-left"
							>
								<span class="text-sm text-slate-300">{formatDate(item.modifiedAt)}</span>
								<span class="truncate font-medium">{item.title || '(無題)'}</span>
								{#if item.username}
									<span class="truncate text-sm text-slate-400">{item.username}</span>
								{/if}
							</button>
						</li>
					{/each}
				</ul>
			{/if}
			<button type="button" onclick={onclose} class="rounded bg-slate-800 px-4 py-3">
				閉じる
			</button>
		{:else}
			<div class="flex items-center gap-2">
				<button type="button" onclick={back} class="rounded bg-slate-800 px-3 py-2 text-sm">
					← 一覧に戻る
				</button>
			</div>
			<h2 class="text-lg font-bold">{selectedDraft.title || '(無題)'}</h2>

			<dl class="flex flex-col gap-3 text-sm">
				<div>
					<dt class="text-slate-400">ユーザー名 / 口座番号など</dt>
					<dd class="break-all">{selectedDraft.username || '—'}</dd>
				</div>
				<div>
					<dt class="text-slate-400">パスワード</dt>
					<dd class="flex items-center gap-2">
						<span class="break-all font-mono">
							{showPassword ? selectedDraft.password : '••••••••'}
						</span>
						<button
							type="button"
							onclick={() => (showPassword = !showPassword)}
							class="rounded bg-slate-800 px-2 py-1 text-xs"
						>
							{showPassword ? '隠す' : '表示'}
						</button>
					</dd>
				</div>
				<div>
					<dt class="text-slate-400">URL</dt>
					<dd class="break-all">{selectedDraft.url || '—'}</dd>
				</div>
				<div>
					<dt class="text-slate-400">メモ</dt>
					<dd class="whitespace-pre-wrap break-all">{selectedDraft.notes || '—'}</dd>
				</div>
				{#if selectedDraft.tags.length > 0}
					<div>
						<dt class="text-slate-400">タグ</dt>
						<dd class="flex flex-wrap gap-1">
							{#each selectedDraft.tags as tag (tag)}
								<span class="rounded-full bg-slate-800 px-2 py-0.5 text-xs">{tag}</span>
							{/each}
						</dd>
					</div>
				{/if}
			</dl>

			{#if error}
				<p class="text-sm text-red-400">{error}</p>
			{/if}

			<button
				type="button"
				onclick={restore}
				disabled={busy}
				class="rounded px-4 py-3 font-medium disabled:opacity-40 {confirmRestore
					? 'bg-amber-600'
					: 'bg-indigo-600'}"
			>
				{confirmRestore ? 'もう一度タップで復元を確定' : 'この版を復元する'}
			</button>
			<p class="text-xs text-slate-500">
				復元しても現在の内容は失われません。新しい履歴として保存されます。
			</p>
		{/if}
	</div>
</div>
