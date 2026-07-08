<!--
	Root layout: global styles, session bootstrap, and lock policies
	(lock on background, reset the auto-lock timer on user activity).
-->
<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { session } from '$lib/vault/session.svelte';
	import { pwaUpdate } from '$lib/pwa/update.svelte';

	let { children } = $props();

	$effect(() => {
		void session.init();
		void pwaUpdate.init();

		const onVisibility = (): void => {
			// Going to background must lock immediately (requirement #3).
			if (document.hidden) {
				session.lock();
			}
		};
		const onActivity = (): void => session.touch();

		document.addEventListener('visibilitychange', onVisibility);
		window.addEventListener('pointerdown', onActivity);
		window.addEventListener('keydown', onActivity);
		return () => {
			document.removeEventListener('visibilitychange', onVisibility);
			window.removeEventListener('pointerdown', onActivity);
			window.removeEventListener('keydown', onActivity);
		};
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>kbx</title>
</svelte:head>

<div
	class="min-h-dvh bg-slate-950 text-slate-100"
	style="padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom);"
>
	{@render children()}

	<!-- z-0: rendered after the page content so it stays on top of normal
	     flow, but below overlays like the entry editor (z-10). -->
	<a
		href="/manual.html"
		target="_blank"
		rel="noopener noreferrer"
		aria-label="ユーザーズマニュアルを開く"
		class="fixed right-4 z-0 flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-slate-300 shadow hover:bg-slate-700"
		style="top: calc(env(safe-area-inset-top) + 1rem);"
	>
		?
	</a>

	{#if pwaUpdate.available}
		<div class="fixed inset-x-0 bottom-0 z-50 flex justify-center p-4">
			<div
				class="flex items-center gap-3 rounded-lg border border-indigo-400/30 bg-slate-900 px-4 py-3 text-sm shadow-lg"
			>
				<span>新しいバージョンがあります</span>
				<button
					type="button"
					class="rounded bg-indigo-500 px-3 py-1 font-medium text-white hover:bg-indigo-400"
					onclick={() => pwaUpdate.apply()}
				>
					更新する
				</button>
			</div>
		</div>
	{/if}
</div>
