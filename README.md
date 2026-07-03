# kbx

Offline-first password vault PWA (KDBX4). All crypto runs client-side;
the site is 100% static and never talks to any external host.

[![Netlify](https://img.shields.io/netlify/e7fc25a7-d641-4d9d-ab7e-83302c9af396?logo=netlify&label=deploy)](https://app.netlify.com/projects/luminous-capybara-5275d4/deploys)
![SvelteKit](https://img.shields.io/badge/SvelteKit-2-ff3e00?logo=svelte&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-offline--first-5a0fc8?logo=pwa&logoColor=white)
![KDBX4](https://img.shields.io/badge/KDBX-4-2e7d32)

ドキュメント:

- [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) — 要件定義・フェーズ計画
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 技術ドキュメント（設計・暗号・CSP・開発/デプロイ）
- [docs/VAULT_GUIDE.md](docs/VAULT_GUIDE.md) — 保管庫 (.kdbx) の運用ガイド（バックアップ・復元・平文閲覧）
- [docs/SKILLS.md](docs/SKILLS.md) — 開発者向けスキル要件一覧

## Development (macOS + Docker)

Node はホストに不要。すべてコンテナ内で実行する。

```sh
./docker.sh build     # dev イメージをビルド
./docker.sh shell     # コンテナのシェルに入る（ポート 5173/4173 公開）
./docker.sh rebuild   # イメージを作り直す（--no-cache）
./docker.sh clean     # コンテナ・イメージ・node_modules volume を削除
```

コンテナ内での主なコマンド:

```sh
npm install     # 依存関係の取得（node_modules は Docker volume 内）
npm run dev     # 開発サーバ → http://localhost:5173
npm test        # 単体テスト（暗号化ラウンドトリップ含む）
npm run check   # svelte-check（型検査）
npm run build   # 本番ビルド → build/
npm run preview # 本番ビルドの確認 → http://localhost:4173
npm run icons   # PWA アイコンの再生成 → static/
```

## Deploy

GitHub リポジトリを Netlify に接続すれば `netlify.toml` の設定で自動デプロイされる。
セキュリティヘッダは `static/_headers`、SPA フォールバックは `static/_redirects` で配信される。

Dropbox 同期（任意）を使う場合は、Netlify の Site settings → Environment
variables に `PUBLIC_DROPBOX_CLIENT_ID` を設定する。手順は `.env.example` 参照。
未設定でもビルドは失敗せず、機能が非表示になるだけ。

## Architecture (short)

- SvelteKit 2 (Svelte 5, TypeScript strict) / pure SPA (`ssr=false`, adapter-static)
- Vault: KDBX4 via `kdbxweb`, KDF: Argon2id (`hash-wasm`)
- Persistence: IndexedDB (ciphertext only) / backup: manual `.kdbx` export
- Sync: Dropbox (OAuth2 PKCE, App-folder scope), manual one-button only
- Offline: SvelteKit built-in service worker (full precache)
