---
name: kbx-verify
description: Use before declaring any change done in this repo, and ALWAYS when vault.ts, crypto-engine.ts, storage.ts, service-worker.ts, _headers, or CSP-related scripts were touched. Runs the regression gate and explains how to verify CSP correctly.
---

# kbx 変更後の検証手順

コマンドはすべて Docker コンテナ内で実行する（kbx-dev 参照）。

## 1. 全変更共通（最低ライン）

```sh
npm run check    # svelte-check 型検査
npx vitest run   # 全テスト
```

## 2. 暗号・保管庫系（vault.ts / crypto-engine.ts / storage.ts）

`vault.test.ts` がラウンドトリップ / 誤パスワード / KDF / マージの回帰ゲート。
**失敗したままにしない・テストを弱めて通さない。**
エントリ一覧の射影（`EntrySummary`）を変えたときはテストの期待値更新が必要になるが、
既存アサーションの削除はユーザー確認を取る。

## 3. CSP・ヘッダ・Service Worker 系

`npm run preview` は `_headers` を適用しないため CSP 検証には**使えない**。

```sh
npm run build                        # inject-csp-hash.mjs がハッシュ注入
node scripts/serve-with-headers.mjs  # _headers 適用でローカル配信
```

ブラウザで開き、DevTools コンソールに CSP violation が出ないこと、
オフライン（DevTools → Network → Offline）でリロードできることを確認する。

## 4. リリース前フルシーケンス

```sh
npm run check && npx vitest run && npm run build
node scripts/serve-with-headers.mjs   # ブラウザで動作確認
```
