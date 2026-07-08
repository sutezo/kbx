---
name: kbx-dropbox-setup
description: Use when the Dropbox sync section is missing from the app UI, when setting up PUBLIC_DROPBOX_CLIENT_ID, or when Dropbox sync fails to connect. Covers app registration, local .env, and Netlify configuration.
---

# Dropbox 同期の有効化手順

`PUBLIC_DROPBOX_CLIENT_ID` が未設定だと `dropboxStatus = 'unavailable'` になり、
ボールト画面「設定」内の Dropbox セクションごと非表示になる（バグではない仕様。
`session.svelte.ts` の `#initDropbox` 参照）。ビルドは壊れない。

## 1. Dropbox アプリ登録（初回のみ）

1. https://www.dropbox.com/developers/apps → Create app
2. **Scoped access** → **App folder**（Full Dropbox は禁止 — CLAUDE.md の不変条件）
3. Permissions タブで `files.content.write` / `files.content.read` を有効化
4. Settings タブの Redirect URIs に以下を追加:
   - `http://localhost:6606/`（開発用）
   - 本番 URL（例: `https://<site>.netlify.app/`）
5. App key を控える（これが client ID。公開値でありシークレットではない）

## 2. 環境変数の設定

- ローカル: リポジトリ直下に `.env` を作成し `PUBLIC_DROPBOX_CLIENT_ID=<App key>`、
  dev サーバーを再起動
- 本番: Netlify → Site settings → Environment variables に同名で設定し再デプロイ

詳細は `.env.example` に記載。

## 3. 動作確認

解錠 → 「設定」を展開 → 「Dropbox 同期」が表示される →
「Dropboxと連携する」→ OAuth 認可 → ページ再読み込み → 「今すぐ同期」。

## 制約（変更しないこと）

- App folder スコープ + PKCE のみ。クライアントシークレットを SPA に埋め込まない。
- 同期は手動ボタンのみ（自動・定期通信なし）。CSP の connect-src は
  `api.dropboxapi.com` / `content.dropboxapi.com` のみ許可。
