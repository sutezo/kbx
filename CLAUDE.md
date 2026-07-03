# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

kbx is an offline-first password vault PWA using the KDBX4 format (KeePass-compatible). It is a pure static SPA — SvelteKit 2 + Svelte 5 (runes), `ssr=false`, `adapter-static`. All crypto (Argon2id KDF, AES-256/ChaCha20) runs client-side; the deployed site never talks to any external host except an opt-in Dropbox sync feature. Netlify only serves static files.

Read `docs/ARCHITECTURE.md` before touching anything crypto-, storage-, CSP-, or sync-related — it documents the full design rationale (key locations, lock policy, WebAuthn PRF biometric unlock, Dropbox OAuth2 PKCE merge flow, CSP hash injection) in more depth than belongs here. `docs/VAULT_GUIDE.md` covers end-user vault operations (backup/restore/plaintext viewing). `docs/REQUIREMENTS.md` has the phased requirements/roadmap.

## Development environment

Node is **not required on the host** — everything runs in Docker on macOS.

```sh
./docker.sh build     # build the dev image
./docker.sh shell      # open a shell in the dev container (ports 5173/4173 published)
./docker.sh rebuild    # rebuild image from scratch (--no-cache)
./docker.sh clean      # remove containers, image, and the node_modules volume
```

Source is bind-mounted; `node_modules` is a named Docker volume (not visible from the host, for macOS I/O performance). Run all commands below inside `./docker.sh shell`.

## Common commands

```sh
npm install      # install deps (into the node_modules volume)
npm run dev       # dev server -> http://localhost:5173
npm test          # vitest run (single run)
npm run test:watch  # vitest watch mode
npm run check     # svelte-kit sync + svelte-check (type checking)
npm run build     # production build -> build/ (also injects CSP script hash)
npm run preview   # serve production build -> http://localhost:4173 (does NOT apply _headers/CSP)
npm run icons     # regenerate PWA icons -> static/
node scripts/serve-with-headers.mjs  # serve build/ with _headers CSP applied — use this, not `npm run preview`, when verifying anything CSP-related
```

To run a single test file: `npx vitest run src/lib/vault/vault.test.ts`. Vitest picks up `src/**/*.test.ts`.

Pre-release check sequence: `npm run check` → `npm test` → `npm run build` → verify in browser via `serve-with-headers.mjs`.

## Architecture

```
src/
  routes/
    +layout.ts          # ssr=false / prerender=false (SPA declaration)
    +layout.svelte       # loads app.css, initializes session, enforces lock policy
    +page.svelte          # dispatches screen based on session status
  lib/
    vault/
      vault.ts            # KDBX4 domain layer: create/open/save/entry CRUD/merge
      crypto-engine.ts     # injects hash-wasm's Argon2 into kdbxweb
      biometric.ts          # WebAuthn PRF-based biometric unlock
      dropbox.ts             # Dropbox OAuth2 PKCE + upload/download
      storage.ts               # IndexedDB persistence (ciphertext + metadata only)
      session.svelte.ts         # in-memory session state for the decrypted vault, auto-lock ($state)
      vault.test.ts               # roundtrip / wrong-password / KDF / merge tests
    components/            # screen components (Create/Unlock/Vault/Editor/Import/History)
    generator.ts            # CSPRNG password generation (rejection sampling, no Math.random)
    totp.ts                   # RFC 6238 TOTP, otpauth:// URIs in KeePassXC-compatible `otp` field
    clipboard.ts               # copy + auto-clear after 30s
    pwa/update.svelte.ts        # service worker update prompt state
  service-worker.ts          # offline precache (cache-first, SvelteKit's $service-worker)
scripts/
  gen-icons.mjs               # PWA icon generation (no image-lib dependency)
  inject-csp-hash.mjs           # post-build: injects inline-script sha256 into build/_headers
  serve-with-headers.mjs          # local server that applies static/_headers (CSP) for testing
static/
  _headers                       # strict CSP and other security headers (served by Netlify)
  _redirects                      # SPA fallback: /* -> /index.html 200
```

Data flow: UI components → `session.svelte.ts` (holds the decrypted `Kdbx` object in memory, `$state`) → `vault.ts` (KDBX4 read/write/CRUD/merge via `kdbxweb`) → `storage.ts` (IndexedDB, ciphertext only). `crypto-engine.ts` wires `hash-wasm`'s Argon2 implementation into `kdbxweb` since kdbxweb ships no KDF implementation itself.

### Security invariants (do not weaken without explicit instruction)

- The master password is never persisted anywhere; it exists only transiently during key derivation.
- Only ciphertext (KDBX4 binary) is ever written to IndexedDB or Dropbox. Plaintext/derived keys live only in `session.svelte.ts` memory and are nulled on lock.
- Auto-lock after 5 minutes idle (`AUTO_LOCK_MS`) and immediately on `visibilitychange` to background.
- CSP in `static/_headers` blocks all outbound connections except same-origin and (opt-in) `api.dropboxapi.com` / `content.dropboxapi.com`. Never add `'unsafe-inline'` — the inline-script hash is injected automatically by `scripts/inject-csp-hash.mjs` after build.
- Dropbox integration must stay App-folder-scoped PKCE OAuth (never Full Dropbox, never a client secret in the SPA). `PUBLIC_DROPBOX_CLIENT_ID` is a public key, not a secret; missing it must not break the build, only hide the feature.
- Any change touching `vault.ts` or `crypto-engine.ts` must keep `vault.test.ts` passing — it's the roundtrip/KDF/merge regression gate for the encrypted format.

## Deployment

GitHub `main` → Netlify auto-deploy (`netlify.toml` runs `npm ci && npm run build`). `build/_headers` (with the injected CSP hash) and `build/_redirects` ship as part of the static output. Dropbox sync requires setting `PUBLIC_DROPBOX_CLIENT_ID` in Netlify's environment variables (see `.env.example` for full setup steps).
