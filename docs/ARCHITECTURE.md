# kbx 技術ドキュメント

最終更新: 2026-07-03 / 対象: 開発者向け（運用は [VAULT_GUIDE.md](VAULT_GUIDE.md) を参照）

## 1. 全体像

kbx は「静的サイト + 全処理クライアント内 + 外部通信ゼロ」のパスワード保管庫 PWA。
Netlify は暗号化済みファイルの CDN 配信のみを行い、秘密情報は一切サーバに渡らない。

```
┌─ iPhone / PC ブラウザ ──────────────────────────────┐
│  UI (SvelteKit SPA)                                  │
│    └─ session.svelte.ts   … 復号済み Kdbx をメモリ保持│
│         └─ vault.ts       … KDBX4 の読み書き・CRUD    │
│              ├─ kdbxweb   … KDBX4 実装               │
│              └─ crypto-engine.ts … Argon2id (WASM)   │
│    └─ storage.ts          … IndexedDB（暗号文のみ）   │
│  service-worker.ts        … 全アセット precache       │
└──────────────────────────────────────────────────────┘
          ▲ 静的配信のみ（HTML/JS/CSS/WASM）
┌─ Netlify ────────────────────────────────────────────┐
│  build/ + _headers(CSP) + _redirects(SPA fallback)   │
└──────────────────────────────────────────────────────┘
```

## 2. 技術スタック

| 領域 | 採用 | 補足 |
|---|---|---|
| フレームワーク | SvelteKit 2 + Svelte 5 (runes) | `ssr=false` の純 SPA。`adapter-static` + `fallback: index.html` |
| 言語 | TypeScript (strict) | `any` 禁止、`unknown` を使用 |
| スタイル | Tailwind CSS 4 | `@tailwindcss/vite` プラグイン |
| 保管庫形式 | KDBX4 (`kdbxweb` v2) | KeePass 互換。KDF: Argon2id、暗号: AES-256/ChaCha20 |
| KDF 実装 | `hash-wasm` の Argon2 | kdbxweb に WASM 実装を注入（後述） |
| ローカル保存 | IndexedDB (`idb`) | 暗号文 ArrayBuffer のみ。平文・鍵・パスワードは保存しない |
| PWA | SvelteKit 標準 `$service-worker` | Workbox 等の追加依存なし |
| テスト | Vitest | 暗号化ラウンドトリップテストが必須ゲート |
| 配信 | Netlify（静的のみ） | `netlify.toml` / `static/_headers` / `static/_redirects` |

## 3. ディレクトリ構成

```
src/
  routes/
    +layout.ts            # ssr=false / prerender=false（SPA宣言）
    +layout.svelte        # app.css 読込、session 初期化、ロックポリシー
    +page.svelte          # status による画面ディスパッチ
  lib/
    vault/
      vault.ts            # KDBX4 ドメイン層（作成/開錠/保存/エントリCRUD）
      crypto-engine.ts    # hash-wasm の Argon2 を kdbxweb に注入
      storage.ts          # IndexedDB 永続化（暗号文とバックアップメタのみ）
      session.svelte.ts   # 復号済み保管庫のメモリ管理・自動ロック（$state）
      vault.test.ts       # ラウンドトリップ/誤パスワード/KDF検証テスト
    components/           # 画面コンポーネント（Create/Unlock/Vault/Editor/Import）
    generator.ts          # CSPRNG パスワード生成（rejection sampling）
    clipboard.ts          # コピー + 30秒後自動クリア
  service-worker.ts       # オフライン precache（cache-first）
scripts/
  gen-icons.mjs           # PWA アイコン生成（依存なしPNGエンコーダ）
  inject-csp-hash.mjs     # ビルド後: インラインscriptのsha256をCSPへ注入
  serve-with-headers.mjs  # _headers のCSPを適用するローカル検証サーバ
static/
  _headers                # CSP 等セキュリティヘッダ（Netlifyが配信）
  _redirects              # /* → /index.html 200（SPA fallback）
  manifest.webmanifest    # PWA マニフェスト
docs/                     # 要件・本ドキュメント・運用ガイド
```

## 4. 暗号設計

### 4.1 保管庫フォーマット

標準 **KDBX4**。`vault.ts` の `createVault()` が `kdbx.setKdf(KdfId.Argon2id)` を
明示指定する。KeePassXC / Strongbox / KeePassium 等でそのまま開ける互換性が
「アプリが使えなくなってもデータへアクセスできる非常口」として機能する。

### 4.2 Argon2 の注入（crypto-engine.ts）

kdbxweb は Argon2 実装を同梱しないため、`hash-wasm` を注入する。

- kdbxweb は KDF パラメータ `M`（バイト）を **KiB に変換してから** 実装を呼ぶ。
  hash-wasm の `memorySize` も KiB なのでそのまま渡せる（単位変換の二重適用に注意）
- Argon2 バージョンは 0x13 のみ対応（0x10 が来たら例外）
- type は Argon2d(0) / Argon2id(2) を kdbxweb の定数で分岐

### 4.3 何がどこに存在するか

| データ | 場所 | 状態 |
|---|---|---|
| マスターパスワード | どこにも保存されない | 入力時のみ・導出後に破棄 |
| 導出鍵・復号済みDB | `session.svelte.ts` の private field | メモリのみ。ロックで null 化 |
| 保管庫 | IndexedDB `kbx/vault` (key: `current`) | **常に暗号文** (ArrayBuffer) |
| バックアップメタ | IndexedDB `kbx/meta` (key: `backup`) | 平文（秘密情報を含まない） |
| エクスポートファイル | ユーザーが選んだ保存先 | 暗号文（.kdbx そのもの） |

### 4.4 ロックポリシー

- 無操作 5 分で自動ロック（`AUTO_LOCK_MS`、操作イベントでリセット）
- `visibilitychange` でバックグラウンド移行時に**即ロック**
- クリップボードへのコピーは 30 秒後に上書きクリア（ベストエフォート）

### 4.5 パスワード生成

`crypto.getRandomValues` + rejection sampling（モジュロバイアス排除）+
Fisher-Yates シャッフル。有効化した文字種それぞれ最低 1 文字を保証。
`Math.random` は禁止。

## 5. CSP と配信

`static/_headers` で全パスに厳格 CSP を配信する。要点:

- `connect-src 'self'` — **外部ホストへの通信を全面禁止**。依存ライブラリが悪意を
  持ってもデータを外部送信できない。`'none'` にしないのはサービスワーカーの
  precache フェッチ（同一オリジン）に必要なため
- `script-src 'self' 'wasm-unsafe-eval' 'sha256-…'` — WASM 用許可と、
  SvelteKit が SPA 起動用に埋め込む**インラインスクリプトの sha256 ハッシュ**
- ハッシュはビルドごとに変わるため、`npm run build` の後段で
  `scripts/inject-csp-hash.mjs` が `build/index.html` から実物を読み取り
  `build/_headers` に自動注入する（`'unsafe-inline'` は使わない）

> **教訓**: `vite preview` は `_headers` を解釈しないため、CSP 起因の問題は
> ローカルで見えない。CSP を検証するときは
> `node scripts/serve-with-headers.mjs`（ポート4173、CSP付き配信）を使うこと。
> 実際に本番だけ白画面になる障害がこれで発生した。

## 6. サービスワーカー（オフライン動作）

SvelteKit 標準の `$service-worker` モジュールを使用。

- `build`（ビルド成果物）+ `files`（static/）+ `/index.html` を install 時に precache
- fetch は cache-first。ナビゲーションは常にキャッシュ済み app shell を返す
- キャッシュ名に `version` を含み、activate 時に旧キャッシュを削除 → デプロイで自動更新
- GET・同一オリジンのみ処理（外部はそもそも CSP で遮断）

## 7. 開発ワークフロー（macOS + Docker）

ホストに Node 不要。すべて `./docker.sh` 経由:

| コマンド | 動作 |
|---|---|
| `./docker.sh build` | dev イメージ（node:24-bookworm-slim）をビルド |
| `./docker.sh shell` | コンテナ shell（ポート 5173/4173 公開） |
| `./docker.sh rebuild` | `--no-cache` で作り直し |
| `./docker.sh clean` | コンテナ・イメージ・node_modules volume 削除 |

- ソースはバインドマウント、`node_modules` は named volume（macOS の I/O 対策）。
  そのため **ホスト側から `node_modules` は見えない**
- コンテナ内の主要コマンド: `npm run dev` / `npm test` / `npm run check` /
  `npm run build` / `npm run preview` / `npm run icons`

## 8. デプロイ

GitHub `main` への push → Netlify が自動ビルド・デプロイ。

- ビルドコマンドは `npm ci && npm run build`（`netlify.toml`）。
  `npm ci` で package-lock.json 通りの完全再現ビルドを強制
- `build/` を公開。`_headers`（CSP注入済み）と `_redirects` も成果物に含まれる

## 9. テスト方針

- `vault.test.ts`: 作成→保存→再オープンのラウンドトリップ、誤パスワードの
  型付きエラー、KDBX4 + Argon2id であることのヘッダ検証、ProtectedValue 保存、
  更新・削除の永続性。**暗号まわりを触ったら必ずパスさせること**
- `generator.test.ts`: 長さ・文字種保証・無効設定の拒否
- リリース前チェック: `npm run check`（型）→ `npm test` →
  `npm run build` → `serve-with-headers.mjs` でブラウザ確認（CSP込み）

## 10. 既知の制約・注意点

- **iOS のストレージ**: ホーム画面追加した PWA は Safari の 7 日削除の対象外だが、
  ストレージ逼迫時の退避リスクは残る。`navigator.storage.persist()` を要求しつつ、
  真のマスターデータは手動エクスポートした .kdbx とする運用（督促バナーあり）
- **kdbxweb のメンテ状況**: 更新は緩やか。形式が標準 KDBX4 なので、
  最悪別実装へ差し替え可能。Node 用依存 `@xmldom/xmldom` は脆弱版を
  `overrides` で ^0.8.11 に固定している（ブラウザでは native DOMParser を使用）
- **クリップボード**: iOS ではバックグラウンド時のクリアが失敗し得る
  （OS 制約）。UI 上も「30秒後に消去」はベストエフォートである旨を表示
- **マスターパスワード**: 復元手段なし。忘れた場合はロック画面の
  「マスターパスワードを忘れた場合」から端末内保管庫を削除して再作成する
