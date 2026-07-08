<!--
	Main screen for an unlocked vault: entry list with search, clipboard copy
	with auto-clear, backup export, and access to the entry editor.
-->
<script lang="ts">
	import EntryEditor from './EntryEditor.svelte';
	import TotpCell from './TotpCell.svelte';
	import { copySecret, CLIPBOARD_CLEAR_MS } from '$lib/clipboard';
	import { session } from '$lib/vault/session.svelte';
	import { InvalidPasswordError, MIN_MASTER_PASSWORD_LENGTH } from '$lib/vault/vault';
	import { PrfUnsupportedError } from '$lib/vault/biometric';
	import { CsvFormatError, parseCredentialCsv, type CsvImportResult } from '$lib/vault/csv-import';

	let query = $state('');
	/** Active tag filter (Gmail-label style, single-select); null = all. */
	let activeTag = $state<string | null>(null);
	/** List order: alphabetical (vault.ts default) or most recently modified first. */
	let sortBy = $state<'title' | 'modified'>('title');
	/** null = closed, 'new' = creating, otherwise the id being edited. */
	let editing = $state<string | null>(null);
	let toast = $state('');
	let toastTimer: ReturnType<typeof setTimeout> | null = null;

	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmNewPassword = $state('');
	let passwordChangeError = $state('');
	let passwordChangeBusy = $state(false);

	async function changeMasterPassword(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (newPassword.length < MIN_MASTER_PASSWORD_LENGTH) {
			passwordChangeError = `新しいマスターパスワードは${MIN_MASTER_PASSWORD_LENGTH}文字以上にしてください`;
			return;
		}
		if (newPassword !== confirmNewPassword) {
			passwordChangeError = '確認用パスワードが一致しません';
			return;
		}
		const hadBiometric = session.biometric === 'enabled';
		passwordChangeBusy = true;
		passwordChangeError = '';
		try {
			await session.changeMasterPassword(currentPassword, newPassword);
			showToast(
				hadBiometric
					? 'マスターパスワードを変更しました。生体認証での解錠は無効になったため、必要であれば再度有効にしてください。'
					: 'マスターパスワードを変更しました'
			);
			currentPassword = '';
			newPassword = '';
			confirmNewPassword = '';
		} catch (err) {
			passwordChangeError =
				err instanceof InvalidPasswordError
					? '現在のマスターパスワードが違います'
					: `変更できませんでした: ${err instanceof Error ? err.message : String(err)}`;
		} finally {
			passwordChangeBusy = false;
		}
	}

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

	let dropboxError = $state('');

	/** Parsed CSV awaiting user confirmation; null = no file picked yet. */
	let csvResult = $state<CsvImportResult | null>(null);
	let csvFileName = $state('');
	let csvError = $state('');
	let csvBusy = $state(false);

	/** Human-readable label of the detected CSV source. */
	function csvSourceLabel(source: CsvImportResult['source']): string {
		return source === 'chrome' ? 'Google パスワードマネージャー（Chrome）' : 'Apple パスワード';
	}

	async function pickCsv(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		csvResult = null;
		csvError = '';
		if (!file) {
			return;
		}
		csvFileName = file.name;
		try {
			const parsed = parseCredentialCsv(await file.text());
			if (parsed.drafts.length === 0) {
				csvError = 'インポートできるエントリがありません';
			} else {
				csvResult = parsed;
			}
		} catch (err) {
			csvError =
				err instanceof CsvFormatError
					? '対応していないCSV形式です（Chrome / Apple パスワードのエクスポートに対応しています）'
					: `読み込めませんでした: ${err instanceof Error ? err.message : String(err)}`;
		}
		// Allow picking the same file again after cancelling or importing.
		input.value = '';
	}

	async function confirmCsvImport(): Promise<void> {
		if (!csvResult) {
			return;
		}
		csvBusy = true;
		try {
			await session.importEntries(csvResult.drafts);
			showToast(`${csvResult.drafts.length}件のエントリを追加しました。元のCSVファイルは削除してください`);
			csvResult = null;
			csvFileName = '';
		} catch (err) {
			csvError = `インポートできませんでした: ${err instanceof Error ? err.message : String(err)}`;
		} finally {
			csvBusy = false;
		}
	}

	function cancelCsvImport(): void {
		csvResult = null;
		csvFileName = '';
		csvError = '';
	}

	async function syncDropbox(): Promise<void> {
		dropboxError = '';
		try {
			await session.syncWithDropbox();
			showToast('Dropboxと同期しました');
		} catch (err) {
			dropboxError =
				err instanceof InvalidPasswordError
					? 'Dropbox上のファイルは異なるマスターパスワードで暗号化されています。マスターパスワードを変更した場合は、Dropboxアプリでこのアプリ専用フォルダ内のvault.kdbxを削除してから、もう一度同期してください。'
					: `同期できませんでした: ${err instanceof Error ? err.message : String(err)}`;
		}
	}

	async function disconnectDropbox(): Promise<void> {
		await session.disconnectDropbox();
		showToast('Dropbox連携を解除しました');
	}

	function formatSyncTime(epochMs: number | null): string {
		return epochMs === null ? '未同期' : new Date(epochMs).toLocaleString('ja-JP', {
			dateStyle: 'medium',
			timeStyle: 'short'
		});
	}

	const filtered = $derived.by(() => {
		const matched = session.entries.filter((entry) => {
			const q = query.trim().toLowerCase();
			const matchesQuery =
				q === '' ||
				entry.title.toLowerCase().includes(q) ||
				entry.username.toLowerCase().includes(q) ||
				entry.url.toLowerCase().includes(q);
			const matchesTag = activeTag === null || entry.tags.includes(activeTag);
			return matchesQuery && matchesTag;
		});
		// session.entries is already title-sorted (vault.ts), so only the
		// modified-first order needs an explicit sort here.
		if (sortBy === 'modified') {
			matched.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
		}
		return matched;
	});

	/**
	 * Formats an entry timestamp for the list row.
	 * @param date - Timestamp from the KDBX entry
	 * @returns Localized short date, or a dash for the epoch-0 fallback
	 */
	function formatEntryDate(date: Date): string {
		return date.getTime() === 0
			? '—'
			: date.toLocaleDateString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric' });
	}

	function toggleTag(tag: string): void {
		activeTag = activeTag === tag ? null : tag;
	}

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
		let file: File;
		try {
			const bytes = await session.exportBytes();
			const stamp = new Date().toISOString().slice(0, 10);
			file = new File([bytes], `kbx-${stamp}.kdbx`, { type: 'application/octet-stream' });
		} catch (err) {
			showToast(`エクスポートできませんでした: ${err instanceof Error ? err.message : String(err)}`);
			return;
		}
		if (navigator.canShare?.({ files: [file] })) {
			try {
				// iOS: share sheet lets the user save into Files (iCloud Drive).
				await navigator.share({ files: [file], title: file.name });
				await session.markExported();
				showToast('バックアップを書き出しました');
				return;
			} catch (err) {
				if (err instanceof DOMException && err.name === 'AbortError') {
					// User dismissed the share sheet — keep the nag counter as-is.
					return;
				}
				// share() can fail with NotAllowedError because transient user
				// activation expires during the slow Argon2 re-derivation in
				// exportBytes() — fall through to the anchor download instead.
			}
		}
		const url = URL.createObjectURL(file);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = file.name;
		anchor.click();
		URL.revokeObjectURL(url);
		await session.markExported();
		showToast('バックアップを書き出しました');
	}
</script>

<main class="mx-auto flex min-h-dvh max-w-2xl flex-col gap-4 p-4">
	<!-- pr-12 below md: keeps the buttons clear of the fixed "?" help button
	     in +layout.svelte, which overlaps this corner on narrow viewports. -->
	<header class="flex items-center justify-between gap-2 pr-12 md:pr-0">
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

	<label class="flex items-center gap-2 self-end text-xs text-slate-400">
		並び順
		<select bind:value={sortBy} class="rounded bg-slate-800 px-2 py-1">
			<option value="title">タイトル順</option>
			<option value="modified">更新が新しい順</option>
		</select>
	</label>

	{#if session.allTags.length > 0}
		<div class="flex flex-wrap gap-2">
			{#each session.allTags as tag (tag)}
				<button
					onclick={() => toggleTag(tag)}
					class="rounded-full px-3 py-1 text-xs {activeTag === tag
						? 'bg-indigo-600 text-white'
						: 'bg-slate-800 text-slate-300'}"
				>
					{tag}
				</button>
			{/each}
		</div>
	{/if}

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
						<p class="text-[10px] text-slate-500">更新: {formatEntryDate(entry.modifiedAt)}</p>
						{#if entry.tags.length > 0}
							<div class="mt-1 flex flex-wrap gap-1">
								{#each entry.tags as tag (tag)}
									<span class="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">
										{tag}
									</span>
								{/each}
							</div>
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
			<p class="font-medium text-slate-200">マスターパスワードの変更</p>
			<form onsubmit={changeMasterPassword} class="flex flex-col gap-2">
				<input
					type="password"
					bind:value={currentPassword}
					placeholder="現在のマスターパスワード"
					autocomplete="current-password"
					class="rounded bg-slate-800 px-3 py-2"
					required
				/>
				<input
					type="password"
					bind:value={newPassword}
					placeholder="新しいマスターパスワード（{MIN_MASTER_PASSWORD_LENGTH}文字以上）"
					autocomplete="new-password"
					class="rounded bg-slate-800 px-3 py-2"
					required
				/>
				<input
					type="password"
					bind:value={confirmNewPassword}
					placeholder="新しいマスターパスワード（確認）"
					autocomplete="new-password"
					class="rounded bg-slate-800 px-3 py-2"
					required
				/>
				{#if passwordChangeError}
					<p class="text-red-400">{passwordChangeError}</p>
				{/if}
				<button
					type="submit"
					disabled={passwordChangeBusy}
					class="self-start rounded bg-indigo-600 px-4 py-2 font-medium disabled:opacity-40"
				>
					{passwordChangeBusy ? '変更中…' : 'マスターパスワードを変更する'}
				</button>
			</form>
			<p class="text-xs text-slate-500">
				変更すると生体認証での解錠は無効になります。Dropboxと同期している場合、
				次回の同期で「異なるパスワードで暗号化されている」エラーが出ることがあります
				（同期ボタンの案内に従ってください）。
			</p>

			<hr class="border-slate-800" />
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

			{#if session.dropboxStatus !== 'unavailable'}
				<hr class="border-slate-800" />
				<p class="font-medium text-slate-200">Dropbox 同期</p>
				{#if session.dropboxStatus === 'connected'}
					<p class="text-slate-400">
						最終同期: {formatSyncTime(session.dropboxSyncMeta.lastSyncedAt)}
					</p>
					<div class="flex gap-2">
						<button
							type="button"
							onclick={syncDropbox}
							disabled={session.dropboxSyncing}
							class="rounded bg-indigo-600 px-4 py-2 font-medium disabled:opacity-40"
						>
							{session.dropboxSyncing ? '同期中…' : '今すぐ同期'}
						</button>
						<button
							type="button"
							onclick={disconnectDropbox}
							class="rounded bg-slate-700 px-4 py-2"
						>
							連携を解除
						</button>
					</div>
					{#if dropboxError}
						<p class="text-red-400">{dropboxError}</p>
					{/if}
					<p class="text-xs text-slate-500">
						ボタンを押すたびに: ダウンロード→端末内容とマージ→アップロード、を1回で行います。
						自動・定期的な通信は一切行いません。
					</p>
				{:else}
					<button
						type="button"
						onclick={() => session.connectDropbox()}
						class="self-start rounded bg-indigo-600 px-4 py-2 font-medium"
					>
						Dropboxと連携する
					</button>
					<p class="text-xs text-slate-500">
						アプリ専用フォルダのみへのアクセスに限定されます（Dropboxアカウント全体へはアクセスしません）。
						連携後もページの再読み込みが必要です。
					</p>
				{/if}
			{/if}

			<hr class="border-slate-800" />
			<p class="font-medium text-slate-200">CSVからインポート</p>
			<p class="text-slate-400">
				Google パスワードマネージャー（Chrome）または Apple
				パスワードから書き出したCSVのエントリを、このボールトに追加します。
			</p>
			<input
				type="file"
				accept=".csv,text/csv"
				onchange={pickCsv}
				disabled={csvBusy}
				class="text-slate-300 file:mr-3 file:rounded file:border-0 file:bg-slate-700 file:px-4 file:py-2 file:text-slate-100"
			/>
			{#if csvResult}
				<p class="text-slate-300">
					{csvFileName}: {csvSourceLabel(csvResult.source)} 形式のエントリ {csvResult.drafts.length}
					件を追加します。既存のエントリは変更されません。
				</p>
				<div class="flex gap-2">
					<button
						type="button"
						onclick={confirmCsvImport}
						disabled={csvBusy}
						class="rounded bg-indigo-600 px-4 py-2 font-medium disabled:opacity-40"
					>
						{csvBusy ? 'インポート中…' : 'インポートする'}
					</button>
					<button
						type="button"
						onclick={cancelCsvImport}
						disabled={csvBusy}
						class="rounded bg-slate-700 px-4 py-2"
					>
						キャンセル
					</button>
				</div>
			{/if}
			{#if csvError}
				<p class="text-red-400">{csvError}</p>
			{/if}
			<p class="text-xs text-slate-500">
				CSVファイルはパスワードが平文のまま入っています。内容は端末内でのみ処理され保存されませんが、
				インポート後は元のCSVファイルを必ず削除してください。
			</p>
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
