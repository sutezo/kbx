# kbx — パスワード保管庫 PWA 要件定義

最終更新: 2026-07-03 / ステータス: 承認済み（Phase 1 着手）

## 1. 概要

銀行口座情報を含む機密情報を安全に保管する、個人用パスワードマネージャ。
iPhone のホーム画面に追加して使うオフライン動作可能な PWA として実装する。
ストアアプリは費用面で採用しない。

## 2. 基本方針

**「静的サイト + 全処理クライアント内 + 外部通信ゼロ」**

- ホスティング（Netlify）は暗号化前のデータに一切触れない
- ネットワーク経由の漏洩経路が構造上存在しないことを CSP で強制する
- 保管庫は標準フォーマット KDBX4 とし、他アプリで開ける「非常口」を確保する

## 3. アーキテクチャ

```
[iPhone PWA (ホーム画面追加)]
  UI (SvelteKit SPA / ssr=false / adapter-static)
  kdbxweb — KDBX4 (Argon2id + AES-256/ChaCha20)
  IndexedDB — 暗号化済み .kdbx バイナリのみ保存
  バックアップ — 共有シート/Blob ダウンロードで「ファイル」(iCloud Drive) へ
                インポートは <input type="file">
```

## 4. 技術スタック

| 領域 | 選定 | 理由 |
|---|---|---|
| フレームワーク | SvelteKit 2 + Svelte 5 (runes), TypeScript strict | SSR 不要のため純 SPA |
| ビルド/配信 | `adapter-static` + Netlify（fallback: `index.html`） | バックエンドゼロ |
| PWA | SvelteKit 標準サービスワーカー（`$service-worker`） | 依存追加なしで全アセット precache・完全オフライン |
| 保管庫形式 | KDBX4 (`kdbxweb`) | KeePassXC / Strongbox / KeePassium と互換 |
| KDF | Argon2id（WASM 実装 `hash-wasm` を kdbxweb に注入） | GPU 総当たり耐性 |
| ローカル保存 | IndexedDB (`idb`) + `navigator.storage.persist()` | 平文は絶対に保存しない |
| パスワード生成 | `crypto.getRandomValues` | CSPRNG |
| スタイル | Tailwind CSS 4 | 軽量・依存最小 |
| テスト | Vitest（暗号化ラウンドトリップ必須） + Playwright | |
| CI/CD | GitHub → Netlify 自動デプロイ | |

## 5. セキュリティ要件

1. **外部通信ゼロの強制**: `_headers` で厳格 CSP を配信する
   - `default-src 'self'`, `connect-src 'self'`（外部ホストへの通信を全面禁止。
     `'none'` にしないのはサービスワーカーの precache フェッチが同一オリジンで必要なため）
   - `script-src 'self' 'wasm-unsafe-eval'`（Argon2 WASM 用）
   - HSTS, `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`
2. **マスターパスワード非保存**: 導出鍵はメモリのみに保持する
3. **自動ロック**: 無操作タイマー + `visibilitychange`（バックグラウンド移行時に即ロック）
4. **クリップボード自動クリア**: コピー後 30 秒（iOS 制約内でベストエフォート）
5. **バックアップ督促**: 変更 N 回ごと / 最終エクスポートから N 日経過で警告表示
6. **乱数**: すべて CSPRNG。`Math.random` の使用禁止

## 6. iOS PWA の既知の制約（設計に織り込み済み）

- ホーム画面追加した PWA は Safari の「7 日間未使用でストレージ削除」の対象外。
  ただしストレージ逼迫時の退避リスクは残るため `persist()` + バックアップ督促で対処
- File System Access API 非対応 → エクスポートは Blob ダウンロード / Web Share API、
  インポートは `<input type="file">`

## 7. 開発環境

macOS + Docker。ホストに Node は不要で、すべて `./docker.sh` 経由で操作する
（`build` / `shell` / `rebuild` / `clean`。詳細は README 参照）。
`node_modules` は Docker volume に置き、ソースはバインドマウントする。

## 8. フェーズ計画

### Phase 1 (MVP)

- 保管庫の新規作成 / 解錠（マスターパスワード）
- エントリ CRUD（タイトル・ユーザー名・パスワード・URL・メモ）と検索
- パスワード生成（長さ・文字種指定）
- 自動ロック / クリップボード自動クリア
- .kdbx エクスポート・インポート
- PWA オフライン化（ホーム画面追加対応）
- バックアップ督促

### Phase 2（完了）

- [x] Face ID / Touch ID 解錠（WebAuthn PRF 拡張、iOS 18+ / macOS Safari 18+。
      マスターパスワードは常にフォールバック）
- [x] TOTP (2FA) コード表示（RFC 6238。KeePassXC 互換の `otp` フィールド）
- [x] エントリ履歴の記録・閲覧 UI（編集のたびに記録。一覧・詳細表示・非破壊的な復元）
- [x] タグ付加機能（Gmail ライクなラベル。kdbxweb 標準 `tags` フィールド、単一選択フィルタ）

### Phase 3（実装済み: Dropbox 同期）

- [x] Dropbox 同期（OAuth 2 PKCE、App フォルダ限定スコープ）
  - 完全手動・単発方式: 「今すぐ同期」ボタン1回でダウンロード→マージ→アップロードが完結
  - 自動・定期的な通信は一切行わない（操作頻度を減らし攻撃対象を最小化する方針）
  - kdbxweb の `merge()` で UUID/タイムスタンプベースの非破壊マージ（2台での同時編集も両方残る）
  - `PUBLIC_DROPBOX_CLIENT_ID` 未設定時は機能自体を非表示

## 9. リスクと対応

| リスク | 対応 |
|---|---|
| 端末紛失 = 全喪失（ローカルのみ運用） | バックアップ督促を MVP に含める。KDBX4 なので他アプリで復元可 |
| kdbxweb のメンテ鈍化 | 標準 KDBX4 形式のため代替実装へ差し替え可能 |
| iOS のストレージ退避 | `persist()` 要求 + 督促。真のマスターはエクスポートした .kdbx |
