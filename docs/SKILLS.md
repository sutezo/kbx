# kbx 開発者向けスキル要件

最終更新: 2026-07-04 / 対象: このリポジトリにコントリビュートする開発者

このドキュメントは kbx の開発に必要な技術知識を分野別に整理したものです。
各分野の設計判断・詳細な理由は [ARCHITECTURE.md](ARCHITECTURE.md) を参照してください。
ここでは「何を知っておく必要があるか」「どのファイルに関わるか」を一覧化します。

## 1. コアスタック（必須）

| 分野 | 知識レベル | 主な対象ファイル |
|---|---|---|
| SvelteKit 2 | ルーティング、`ssr=false` の SPA 構成、`adapter-static` | `src/routes/` |
| Svelte 5 (runes) | `$state` / `$derived` / `$effect`、クラスベースの状態管理 | `session.svelte.ts`, `pwa/update.svelte.ts`, `src/lib/components/` |
| TypeScript (strict) | `any` 禁止、`unknown` での型絞り込み | 全体 |
| Tailwind CSS 4 | `@tailwindcss/vite` プラグイン方式（v3以前の設定ファイル方式と異なる） | `src/app.css`, コンポーネント |
| Vitest | 単体テスト、暗号ラウンドトリップの検証パターン | `**/*.test.ts` |

## 2. 暗号・保管庫フォーマット（コア領域）

kbx の中心的な複雑さはここにある。変更前に必ず [ARCHITECTURE.md §4](ARCHITECTURE.md#4-暗号設計) を読むこと。

| 分野 | 知識レベル | 主な対象ファイル |
|---|---|---|
| KDBX4 フォーマット | KeePass 互換バイナリ形式の構造（ヘッダ/KDF/暗号ブロック） | `vault.ts` |
| `kdbxweb` | このライブラリの API（`Kdbx.create/load/save`, `ProtectedValue`, `merge()`） | `vault.ts` |
| Argon2id | パラメータ（メモリ/反復/並列度）の意味、KiB/バイト単位変換の罠 | `crypto-engine.ts` |
| `hash-wasm` | kdbxweb への KDF 実装注入パターン | `crypto-engine.ts` |
| AES-256-GCM / ChaCha20 | 対称暗号の基礎（kdbxweb が内部で使用、自前実装はしない） | `vault.ts` |
| CSPRNG | `crypto.getRandomValues`、rejection sampling（モジュロバイアス排除）、`Math.random` 禁止の理由 | `generator.ts` |
| WebAuthn PRF 拡張 | パスキー作成、`residentKey: required`、PRF 出力の HKDF 変換 | `biometric.ts` |
| TOTP (RFC 6238) | HMAC-SHA1/256/512、Base32、otpauth:// URI | `totp.ts` |

## 3. PWA・オフライン動作

| 分野 | 知識レベル | 主な対象ファイル |
|---|---|---|
| Service Worker | SvelteKit 標準 `$service-worker` モジュール、cache-first 戦略、precache 差分更新 | `src/service-worker.ts` |
| IndexedDB | `idb` ラッパー経由の非同期 CRUD、暗号文のみを保存する設計制約の理解 | `storage.ts` |
| Web App Manifest | アイコン/表示モード設定 | `static/manifest.webmanifest`, `scripts/gen-icons.mjs` |

## 4. 外部連携（Dropbox 同期、任意機能）

| 分野 | 知識レベル | 主な対象ファイル |
|---|---|---|
| OAuth 2.0 PKCE | クライアントシークレット不要フロー、認可コード交換、refresh token | `dropbox.ts` |
| Dropbox API | App フォルダスコープ、アップロード/ダウンロード API | `dropbox.ts` |
| 非破壊マージ | `kdbxweb` の `merge()` による UUID/タイムスタンプベースのコンフリクト解決 | `vault.ts`, `session.svelte.ts` |

## 5. セキュリティヘッダ・配信

| 分野 | 知識レベル | 主な対象ファイル |
|---|---|---|
| CSP (Content-Security-Policy) | ディレクティブの意味、インラインスクリプトの sha256 ハッシュ許可方式（`'unsafe-inline'` を使わない理由） | `static/_headers`, `scripts/inject-csp-hash.mjs` |
| Netlify 静的配信 | `_headers` / `_redirects` の役割、`netlify.toml` のビルド設定 | `netlify.toml`, `static/_redirects` |

## 6. 開発インフラ

| 分野 | 知識レベル | 主な対象ファイル |
|---|---|---|
| Docker 開発環境 | ホストに Node 不要の構成、named volume（`node_modules`）とバインドマウントの使い分け | `docker.sh`, `Dockerfile` |
| npm scripts | `dev` / `test` / `check` / `build` / `preview` の役割の違い（特に `preview` は CSP を適用しない点） | `package.json` |

## 7. 触る前に読むべきドキュメント

| これから触る領域 | 先に読むもの |
|---|---|
| 暗号・保管庫・KDF・CSP | [ARCHITECTURE.md](ARCHITECTURE.md) 全体 |
| バックアップ・復元・平文閲覧などの運用系 UI | [VAULT_GUIDE.md](VAULT_GUIDE.md) |
| 新機能・フェーズ計画 | [REQUIREMENTS.md](REQUIREMENTS.md) |
| 脆弱性報告・対応方針 | [../SECURITY.md](../SECURITY.md) |

## 8. 変更前の必須チェック

暗号関連（`vault.ts` / `crypto-engine.ts`）を変更する場合は、必ず以下を通すこと。

```sh
npm run check   # 型検査
npm test        # vault.test.ts のラウンドトリップ/KDF/マージ回帰ゲート
npm run build
node scripts/serve-with-headers.mjs   # CSP込みでブラウザ確認
```
