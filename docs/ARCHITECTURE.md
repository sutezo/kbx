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
      vault.ts            # KDBX4 ドメイン層（作成/開錠/保存/エントリCRUD/マージ）
      crypto-engine.ts    # hash-wasm の Argon2 を kdbxweb に注入
      biometric.ts        # WebAuthn PRF による生体認証解錠
      dropbox.ts          # Dropbox OAuth2 PKCE + アップロード/ダウンロード
      storage.ts          # IndexedDB 永続化（暗号文・各種メタのみ）
      session.svelte.ts   # 復号済み保管庫のメモリ管理・自動ロック（$state）
      vault.test.ts       # ラウンドトリップ/誤パスワード/KDF/マージ検証テスト
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
| Dropbox トークン | IndexedDB `kbx/meta` (key: `dropbox`) | refresh/access トークン（平文。App フォルダのみに影響範囲を限定） |
| Dropbox上のファイル | Dropboxアプリ専用フォルダ `/vault.kdbx` | **常に暗号文** |

### 4.4 ロックポリシー

- 無操作 5 分で自動ロック（`AUTO_LOCK_MS`、操作イベントでリセット）
- `visibilitychange` でバックグラウンド移行時に**即ロック**
- クリップボードへのコピーは 30 秒後に上書きクリア（ベストエフォート）

### 4.5 生体認証解錠（WebAuthn PRF）

`biometric.ts` が実装。「見た目のスキップ」ではなく暗号学的に成立させる:

1. 有効化時: マスターパスワードを再入力させ、保管庫を実際に開いて検証
2. パスキー（platform authenticator, `residentKey: required`）を作成し、
   PRF 拡張付きアサーションで 32 バイトの PRF 出力を取得
3. PRF 出力 → HKDF-SHA256（info: `kbx-biometric-unlock-v1`）→ AES-GCM-256 鍵
4. マスターパスワードをこの鍵でラップし、IndexedDB `meta/biometric` に保存
5. 解錠時: アサーション（Face ID / Touch ID）→ PRF 出力 → 鍵導出 → アンラップ →
   通常の `openVault()` に合流

PRF 出力は生体認証を通過したアサーションでしか得られないため、ラップ済み
ブロブが漏れても復号できない。インポート・保管庫削除時はレコードを破棄
（古いパスワードをラップしているため）。復号に失敗した場合も自動破棄して
パスワード解錠へフォールバックする。対応環境: iOS/macOS Safari 18+、
Chrome（Touch ID / Windows Hello）。非対応なら設定 UI に出さない。

### 4.6 TOTP（RFC 6238）

`totp.ts` が実装。エントリの `otp` フィールド（KeePassXC 互換、ProtectedValue）
に otpauth:// URI または素の Base32 を保存し、一覧でライブ表示する。

- HMAC は WebCrypto（SHA-1/256/512、6-8 桁、周期 5-300 秒）
- RFC 6238 Appendix B のテストベクタで検証（`totp.test.ts`）
- 空文字で保存するとフィールド自体を削除（KeePassXC 慣例）

### 4.7 Dropbox 同期（Phase 3、任意）

`dropbox.ts` + `session.ts` の `syncWithDropbox()` が実装。設計方針は
「**操作頻度を最小化して攻撃対象を減らす**」— 自動・定期同期は一切行わず、
「今すぐ同期」ボタン1回で以下を完結させる:

1. OAuth 2.0 **PKCE**（クライアントシークレット不要、静的SPAでも安全）で接続。
   Dropbox App は **「App フォルダ」スコープ**必須（Full Dropbox は不可）。
   これにより、万一トークンが漏れても影響範囲はこのアプリ専用フォルダの
   暗号化ファイル1つに限定される（アカウント全体には及ばない）
2. 接続時に `token_access_type=offline` を要求し refresh token を取得。
   以降のアクセストークン更新（4時間で失効）はボタン押下時に必要な場合のみ
   サイレントに行う。バックグラウンドでの自動更新はしない
3. 同期ボタン押下時: リモートをダウンロード →
   `db.credentials`（既に解錠済みの認証情報を再利用、パスワード再入力不要）で
   復号 → `kdbx.merge()` で UUID/タイムスタンプベースに現在の保管庫へ
   非破壊マージ → ローカル保存 → マージ結果をアップロード、を1回で実行
4. マージにより、2台で同時に編集しても「後勝ちで消える」ことがない
   （`vault.test.ts` に分岐マージのテストあり）

CSP は `connect-src` に `api.dropboxapi.com` / `content.dropboxapi.com` を
追加（唯一の外部通信の例外。やりとりされるのは常に .kdbx 暗号文のみ）。
`PUBLIC_DROPBOX_CLIENT_ID`（Dropbox App の公開キー。secretではない）を
`$env/dynamic/public` 経由で読み込み、未設定なら機能全体を非表示にする
（未設定でもビルドは壊れない設計）。

**この値は kbx というアプリ自体の身分証であり、特定の Dropbox アカウントを
指すものではない**。全利用者が同じ値を共有し、実際にどの Dropbox アカウント
に保存するかは各利用者が「Dropboxと連携する」ボタンで自分のアカウントに
OAuth ログインした時点で決まる（= 利用者ごとに別々の Dropbox、kbx 側は
どの保管庫が誰のものかを一切管理しない）。

取得手順（詳細は `.env.example`）:

1. https://www.dropbox.com/developers/apps → Create app
2. **Scoped access** → **App folder**（Full Dropbox は選択不可 — 4.7-1 の
   不変条件）
3. Permissions タブで `files.content.write` / `files.content.read` を有効化
4. Settings タブの Redirect URIs に開発用（`http://localhost:5173/` など）と
   本番 URL（例: `https://<site>.netlify.app/`）を追加
5. Settings タブの **App key**（App secret ではない）を控え、
   `PUBLIC_DROPBOX_CLIENT_ID` としてローカルの `.env` と Netlify の
   Environment variables の両方に設定する

OAuth のリダイレクト往復はページの再読み込みを伴うため、接続直後は
保管庫がロック状態に戻る（解錠してから同期する必要がある）。これは
アプリを離れて Dropbox の認可画面へ遷移する OAuth の性質上避けられない、
初回接続時のみの制約。

#### なぜ Google Drive ではなく Dropbox か

同期先の選定時に Google Drive も検討したが、**バックエンドを持たない
静的 SPA** という本アプリの前提と相性が悪く、Dropbox を採用した。

1. **refresh token がシークレット無しで取れない**（決定打）。
   Google はブラウザのみの公開クライアントに refresh token を発行しない。
   SPA 向けの GIS token model で得られるのは約1時間で失効する
   アクセストークンだけで、失効のたびに再認可ポップアップが必要になる。
   refresh token を得るには client secret を持つ認可コードフロー
   （= サーバー）が要る。kbx は「サーバーを一切持たない」設計であり、
   静的 SPA に secret は埋め込めない。Dropbox は PKCE + 公開クライアント
   のまま `token_access_type=offline` で refresh token を発行するため、
   一度の連携で以降サイレントに更新できる（4.7-2）
2. **CSP を破らずに実装できない**。Google の公式フロー（GIS / Picker）は
   Google のホストから JS を読み込む前提で、`script-src 'self'` の
   厳格 CSP（5章）と衝突する。Dropbox は REST 2 ホスト
   （`api.dropboxapi.com` / `content.dropboxapi.com`）への `connect-src`
   追加だけで済み、外部スクリプトを一切読み込まない
3. **スコープと審査の負担**。Drive の広いスコープは Google の
   restricted 扱いで、OAuth アプリ審査に加えて年次のセキュリティ評価
   （CASA）が求められる。未審査のままだと警告画面と 100 ユーザー上限が
   付く。Dropbox の App folder スコープは「アプリ専用フォルダ 1 つ」に
   影響範囲を限定でき（4.7-1 の不変条件そのもの）、審査も軽い
4. **利用者がファイルを直接確認できる**。Google の `appDataFolder` は
   利用者から不可視で、暗号文を自分で取り出して検査・バックアップする
   ことができない。Dropbox の App フォルダは通常のフォルダとして見える
   ため、「保存されるのは常に暗号文のみ」を利用者自身が検証できる

`drive.file` スコープを使えば 3 は軽減できるが、1・2 は解決しないため
結論は変わらない。将来同期先を追加・変更する場合も、この 4 条件
（secret 不要の refresh token / 外部 JS 不要 / 最小スコープ /
利用者による検証可能性）を満たすことを要件とする。

### 4.8 パスワード生成

`crypto.getRandomValues` + rejection sampling（モジュロバイアス排除）+
Fisher-Yates シャッフル。有効化した文字種それぞれ最低 1 文字を保証。
`Math.random` は禁止。

### 4.9 マスターパスワードの変更

`vault.ts` の `changeVaultPassword()` が `kdbxweb` の
`db.credentials.setPassword()` を呼ぶだけで実装されている（新しい
`Credentials` オブジェクトに差し替えるのではなく既存オブジェクトの
パスワードだけ更新する。今は使っていないキーファイル/チャレンジレスポンス
を保持する余地を残すため）。

- `session.svelte.ts` の `changeMasterPassword()` が呼び出し元。まず
  `openVault()` で**現在の**パスワードを再検証してから変更する
  （解錠済み端末を離席した隙に他人が変更できないようにするため。
  `enableBiometric()` と同じ検証パターン）
- 生体認証の登録は**旧**パスワードをラップしているため、変更後は
  `clearBiometricRecord()` で必ず失効させる（`importVault()` と同じ理由）。
  再度有効化するには新しいパスワードで登録し直す必要がある
- Dropbox 同期との相互作用: リモートに旧パスワードで暗号化された
  ファイルが残っている状態で次に「今すぐ同期」すると、`mergeVault()` が
  `db.credentials`（＝新パスワード）でリモートを復号しようとして
  `InvalidPasswordError` になる。これを自動アップロードやマージ側の
  特別分岐で"解決"しようとすると、非破壊マージ（4.7-4）の安全保証を
  壊しかねないため、**意図的に自動処理はしない**。UI 側は
  `InvalidPasswordError` を検知して「Dropbox アプリでこのアプリ専用
  フォルダ内の `vault.kdbx` を削除してから再同期する」よう案内する
  （削除後はダウンロードが `null` になりマージがスキップされ、新パスワードの
  内容がそのままアップロードされる）。利用者が App フォルダの中身を
  直接確認・操作できることは、そもそも Dropbox を選んだ理由の一つでもある
  （4.7 節「なぜ Google Drive ではなく Dropbox か」参照）

## 5. CSP と配信

`static/_headers` で全パスに厳格 CSP を配信する。要点:

- `connect-src 'self' https://api.dropboxapi.com https://content.dropboxapi.com` —
  外部ホストへの通信は原則全面禁止。依存ライブラリが悪意を持ってもデータを
  外部送信できない。Dropbox の2ホストのみが唯一の opt-in 例外（Phase 3
  同期機能が未設定なら実質使われない）。`'none'` にしないのはサービスワーカーの
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
- fetch は cache-first。ナビゲーションは、まずリクエストURLと完全一致する
  プリキャッシュ実ファイルを探し、なければキャッシュ済み app shell を返す
  （実ファイル優先はNetlifyの `_redirects`（`/* /index.html 200`、`!`なし）と
  同じ考え方。`static/manual.html` のような単体HTMLページを `target="_blank"`
  で開いたときに、SPA shellに差し替わってしまわないようにするため）
- キャッシュ名に `version` を含み、activate 時に旧キャッシュを削除 → デプロイで自動更新
- GET・同一オリジンのみ処理（外部はそもそも CSP で遮断）

`static/manual.html` は `+layout.svelte` に常時表示される「?」ボタンから
新しいタブで開く、依存ゼロ（インラインCSSのみ、JSなし）のオフライン対応
ヘルプページ。内容は `docs/VAULT_GUIDE.md` を元にした手書きHTMLで、
自動生成パイプラインは持たない（更新時は両方を手で合わせる。
`ARCHITECTURE.md`/`VAULT_GUIDE.md`/`REQUIREMENTS.md` の3文書運用と同じ扱い）。

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
- Dropbox 同期を使うなら Netlify の Site settings → Environment variables に
  `PUBLIC_DROPBOX_CLIENT_ID` を設定する（`$env/dynamic/public` 経由のため、
  未設定でもビルド自体は失敗せず、機能が非表示になるだけ）。手順は
  `.env.example` 参照

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
