<!--
	Modal editor for a single entry: create/edit fields, generate passwords,
	and delete (two-tap confirmation, no browser dialogs).
-->
<script lang="ts">
	import { session } from '$lib/vault/session.svelte';
	import { DEFAULT_PASSWORD_OPTIONS, generatePassword } from '$lib/generator';
	import type { EntryDraft } from '$lib/vault/vault';

	let { entryId, onclose }: { entryId: string | null; onclose: () => void } = $props();

	// The editor is mounted fresh for every open, so capturing the initial
	// entryId/draft once is intentional.
	// svelte-ignore state_referenced_locally
	const initial: EntryDraft =
		entryId === null
			? { title: '', username: '', password: '', url: '', notes: '' }
			: session.draft(entryId);

	let draft = $state({ ...initial });
	let showPassword = $state(false);
	let confirmDelete = $state(false);
	let error = $state('');
	let busy = $state(false);
	let genOptions = $state({ ...DEFAULT_PASSWORD_OPTIONS });

	function generate(): void {
		try {
			draft.password = generatePassword(genOptions);
			showPassword = true;
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		}
	}

	async function save(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		busy = true;
		error = '';
		try {
			if (entryId === null) {
				await session.add(draft);
			} else {
				await session.update(entryId, draft);
			}
			onclose();
		} catch (err) {
			error = `保存できませんでした: ${err instanceof Error ? err.message : String(err)}`;
			busy = false;
		}
	}

	async function remove(): Promise<void> {
		if (!confirmDelete) {
			confirmDelete = true;
			return;
		}
		if (entryId === null) {
			return;
		}
		busy = true;
		try {
			await session.remove(entryId);
			onclose();
		} catch (err) {
			error = `削除できませんでした: ${err instanceof Error ? err.message : String(err)}`;
			busy = false;
		}
	}
</script>

<div class="fixed inset-0 z-10 flex items-end justify-center bg-black/60 sm:items-center">
	<form
		onsubmit={save}
		class="flex max-h-[90dvh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-t-xl bg-slate-900 p-5 sm:rounded-xl"
	>
		<h2 class="text-lg font-bold">{entryId === null ? 'エントリを追加' : 'エントリを編集'}</h2>

		<label class="flex flex-col gap-1 text-sm text-slate-300">
			タイトル
			<input bind:value={draft.title} required class="rounded bg-slate-800 px-3 py-2 text-base" />
		</label>
		<label class="flex flex-col gap-1 text-sm text-slate-300">
			ユーザー名 / 口座番号など
			<input bind:value={draft.username} autocomplete="off" class="rounded bg-slate-800 px-3 py-2 text-base" />
		</label>
		<label class="flex flex-col gap-1 text-sm text-slate-300">
			パスワード
			<div class="flex gap-2">
				{#if showPassword}
					<input
						bind:value={draft.password}
						autocomplete="off"
						class="min-w-0 flex-1 rounded bg-slate-800 px-3 py-2 font-mono text-base"
					/>
				{:else}
					<input
						type="password"
						bind:value={draft.password}
						autocomplete="off"
						class="min-w-0 flex-1 rounded bg-slate-800 px-3 py-2 text-base"
					/>
				{/if}
				<button
					type="button"
					onclick={() => (showPassword = !showPassword)}
					class="rounded bg-slate-800 px-3 text-xs"
				>
					{showPassword ? '隠す' : '表示'}
				</button>
			</div>
		</label>

		<fieldset class="rounded border border-slate-800 p-3">
			<legend class="px-1 text-xs text-slate-400">パスワード生成</legend>
			<div class="flex flex-wrap items-center gap-3 text-sm">
				<label class="flex items-center gap-1">
					長さ
					<input
						type="number"
						bind:value={genOptions.length}
						min="4"
						max="128"
						class="w-16 rounded bg-slate-800 px-2 py-1"
					/>
				</label>
				<label class="flex items-center gap-1">
					<input type="checkbox" bind:checked={genOptions.uppercase} /> A-Z
				</label>
				<label class="flex items-center gap-1">
					<input type="checkbox" bind:checked={genOptions.lowercase} /> a-z
				</label>
				<label class="flex items-center gap-1">
					<input type="checkbox" bind:checked={genOptions.digits} /> 0-9
				</label>
				<label class="flex items-center gap-1">
					<input type="checkbox" bind:checked={genOptions.symbols} /> 記号
				</label>
				<button type="button" onclick={generate} class="rounded bg-slate-700 px-3 py-1">
					生成
				</button>
			</div>
		</fieldset>

		<label class="flex flex-col gap-1 text-sm text-slate-300">
			URL
			<input bind:value={draft.url} type="url" placeholder="https://" class="rounded bg-slate-800 px-3 py-2 text-base" />
		</label>
		<label class="flex flex-col gap-1 text-sm text-slate-300">
			メモ
			<textarea bind:value={draft.notes} rows="3" class="rounded bg-slate-800 px-3 py-2 text-base"></textarea>
		</label>

		{#if error}
			<p class="text-sm text-red-400">{error}</p>
		{/if}

		<div class="flex gap-2 pt-1">
			<button
				type="submit"
				disabled={busy}
				class="flex-1 rounded bg-indigo-600 px-4 py-3 font-medium disabled:opacity-40"
			>
				保存
			</button>
			<button type="button" onclick={onclose} class="rounded bg-slate-800 px-4 py-3">
				キャンセル
			</button>
		</div>
		{#if entryId !== null}
			<button
				type="button"
				onclick={remove}
				disabled={busy}
				class="rounded px-4 py-2 text-sm {confirmDelete
					? 'bg-red-600 font-medium'
					: 'text-red-400'} disabled:opacity-40"
			>
				{confirmDelete ? 'もう一度タップで削除を確定' : 'このエントリを削除'}
			</button>
		{/if}
	</form>
</div>
