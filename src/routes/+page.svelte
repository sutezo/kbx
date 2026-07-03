<!--
	Single-page dispatcher: shows the create / unlock / vault screen
	depending on the current session status.
-->
<script lang="ts">
	import CreateVaultScreen from '$lib/components/CreateVaultScreen.svelte';
	import UnlockScreen from '$lib/components/UnlockScreen.svelte';
	import VaultScreen from '$lib/components/VaultScreen.svelte';
	import { session } from '$lib/vault/session.svelte';
</script>

{#if session.status === 'loading'}
	<main class="flex min-h-dvh items-center justify-center">
		<p class="text-slate-400">読み込み中…</p>
	</main>
{:else if session.status === 'empty'}
	<CreateVaultScreen />
{:else if session.status === 'locked'}
	<UnlockScreen />
{:else}
	<VaultScreen />
{/if}
