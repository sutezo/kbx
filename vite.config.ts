/// <reference types="vitest/config" />
// Vite + SvelteKit configuration: static SPA build (no SSR backend),
// Tailwind CSS 4, and Vitest for unit tests.
import adapter from '@sveltejs/adapter-static';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// Pure static SPA: everything runs client-side, Netlify serves files only.
			adapter: adapter({ fallback: 'index.html' })
		})
	],
	server: {
		// Bind to all interfaces so the dev server is reachable from the Docker host.
		host: true,
		port: 6606
	},
	preview: {
		host: true,
		port: 6506
	},
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node'
	}
});
