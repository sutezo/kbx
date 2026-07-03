# kbx

Offline-first password vault PWA (KDBX4). All crypto runs client-side;
the site is 100% static and never talks to any external host.

要件・設計は [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) を参照。

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

## Architecture (short)

- SvelteKit 2 (Svelte 5, TypeScript strict) / pure SPA (`ssr=false`, adapter-static)
- Vault: KDBX4 via `kdbxweb`, KDF: Argon2id (`hash-wasm`)
- Persistence: IndexedDB (ciphertext only) / backup: manual `.kdbx` export
- Offline: SvelteKit built-in service worker (full precache)
