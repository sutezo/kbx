<!--
	Root layout: global styles, session bootstrap, and lock policies
	(lock on background, reset the auto-lock timer on user activity).
-->
<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { session } from '$lib/vault/session.svelte';

	let { children } = $props();

	$effect(() => {
		void session.init();

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

<div class="min-h-dvh bg-slate-950 text-slate-100">
	{@render children()}
</div>
