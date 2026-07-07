---
name: kbx-dropbox-sync-dev
description: Use when modifying the Dropbox sync implementation itself (dropbox.ts, or merge logic in session.svelte.ts/vault.ts) — not for enabling the feature (see kbx-dropbox-setup for that). Covers the PKCE/App-folder/manual-sync invariants and non-destructive merge pattern that must not be weakened.
---

# Dropbox 同期の実装不変条件

このスキルは `dropbox.ts` や `session.svelte.ts`/`vault.ts` の同期・
マージロジックを**実装変更**する場面が対象。`PUBLIC_DROPBOX_CLIENT_ID` の
設定やアプリ登録など**機能を有効化する**手順は `kbx-dropbox-setup`
スキルを使う（このスキルとは別物）。

設計根拠の全体像は `docs/ARCHITECTURE.md` §4.7 を参照。

## 設計方針: 操作頻度を最小化して攻撃対象を減らす

- **自動・定期同期は絶対に追加しない**。同期は「今すぐ同期」ボタン押下
  1回で完結させる設計。バックグラウンドタイマーや `visibilitychange` を
  トリガにした自動同期を足さない。

## 崩してはいけない不変条件

1. **OAuth 2.0 PKCE のみ**。クライアントシークレットを SPA に埋め込まない
   （静的サイトなのでシークレットは公開情報と等価になる）。
2. Dropbox App は **App フォルダスコープ限定**（Full Dropbox は不可。
   これは CLAUDE.md にも書かれているセキュリティ不変条件そのもの）。
   トークン漏洩時の影響範囲をアプリ専用フォルダ1つに限定するための制約。
3. `token_access_type=offline` で取得した refresh token によるアクセス
   トークン更新（4時間で失効）は、**同期ボタン押下時に必要な場合のみ**
   サイレントに行う。バックグラウンドでの自動更新はしない（方針と直結）。
4. CSP の `connect-src` は `api.dropboxapi.com` / `content.dropboxapi.com`
   のみ許可されている。新しい外部ホストとの通信を追加しない
   （`static/_headers` を緩めない）。

## 同期フロー（変えるときは全ステップを維持する）

1. リモートをダウンロード
2. `db.credentials`（既に解錠済みの認証情報を再利用。**パスワード再入力を
   要求しない**）で復号
3. `kdbx.merge()` で UUID/タイムスタンプベースに現在の保管庫へ
   **非破壊マージ**（「後勝ちで上書き」にしない）
4. ローカル保存
5. マージ結果をアップロード

この5ステップを1回のボタン押下で完結させる。分岐マージのテストは
`vault.test.ts` にあるので、マージ挙動を変えたら必ず確認する。

## なぜ Dropbox か（Google Drive との比較）

同期先を変更・追加検討する場合は、まず
`docs/ARCHITECTURE.md` §4.7 の「なぜ Google Drive ではなく Dropbox か」
を読む。secret 不要の refresh token / 外部 JS 不要（CSP適合）/
最小スコープ / 利用者による検証可能性、という4条件が判断基準になっている。

## 変更後に必ずやること

`vault.test.ts` の分岐マージテストを含む回帰ゲートを通す（`kbx-verify`
スキル参照）。CSP を変更した場合は `npm run preview` では検証できない点
（`kbx-verify` 参照）にも注意する。
