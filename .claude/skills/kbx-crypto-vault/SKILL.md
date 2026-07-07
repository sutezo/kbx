---
name: kbx-crypto-vault
description: Use before editing vault.ts, crypto-engine.ts, biometric.ts, generator.ts, totp.ts, or storage.ts. Covers KDBX4/Argon2/WebAuthn PRF/TOTP implementation invariants and known pitfalls (e.g. Argon2 KiB/byte unit conversion) so changes don't silently weaken the crypto.
---

# 暗号・保管庫コアの実装不変条件

kbx の中心的な複雑さはこの領域にある（`docs/SKILLS.md` 分野2）。
詳細な設計根拠は `docs/ARCHITECTURE.md` §4 を参照。ここでは実装時に
踏みやすい罠と、崩してはいけない不変条件だけをまとめる。

## 1. 保管庫フォーマット（vault.ts）

- 保管庫形式は **KDBX4 固定**。`createVault()` で `kdbx.setKdf(KdfId.Argon2id)`
  を明示指定する。KeePassXC 等の他実装で開けることが「アプリが使えなく
  なってもデータへアクセスできる非常口」なので、独自拡張で互換性を
  崩さない。

## 2. Argon2 注入の罠（crypto-engine.ts）

kdbxweb は Argon2 実装を同梱しないため `hash-wasm` を注入する。

- kdbxweb は KDF パラメータ `M`（バイト）を **KiB に変換してから**
  実装を呼ぶ。hash-wasm の `memorySize` も KiB 単位なのでそのまま渡せる。
  **ここでもう一度 KiB 変換をかけると二重適用になり、意図した
  メモリコストの 1/1024 でハッシュ計算してしまう**（気付きにくい弱体化）。
- Argon2 バージョンは **0x13 のみ**対応。0x10 が来たら例外を投げる
  （黙って別バージョンとして扱わない）。
- type は Argon2d(0) / Argon2id(2) を kdbxweb の定数で分岐する。

## 3. 秘密情報の扱い

- パスワード等の秘密は **ProtectedValue**（kdbxweb）で扱い、平文 string
  として長期保持しない。
- マスターパスワードはどこにも永続化しない。導出後は破棄する。
- IndexedDB（storage.ts）に書いてよいのは**暗号文と非秘密メタのみ**。
  平文・導出鍵・復号済み Kdbx は `session.svelte.ts` のメモリ上にしか
  存在してはいけない（ロックで null 化）。

## 4. CSPRNG（generator.ts）

- `crypto.getRandomValues` + rejection sampling（モジュロバイアス排除）+
  Fisher-Yates シャッフル。**`Math.random` は禁止**。
- 有効化した文字種それぞれ最低1文字を保証する既存ロジックを壊さない。

## 5. WebAuthn PRF 生体認証（biometric.ts）

「見た目のスキップ」ではなく暗号学的に成立させる設計。フローを変える
場合は以下の順序と性質を保つこと:

1. 有効化時はマスターパスワードを再入力させ、実際に保管庫を開いて検証する
   （検証を省略しない）
2. パスキー（`residentKey: required`）を作成し、PRF 拡張付きアサーションで
   32 バイトの PRF 出力を取得
3. PRF 出力 → HKDF-SHA256（info: `kbx-biometric-unlock-v1`）→ AES-GCM-256 鍵
4. マスターパスワードをこの鍵でラップして保存（生体情報自体は保存しない）
5. 復号に失敗したら**自動破棄してパスワード解錠にフォールバック**する
   （エラーを握りつぶして解錠成功に見せない）
6. インポート・保管庫削除時は必ずこのレコードを破棄する（古いパスワードを
   ラップしたブロブが残ると不整合になる）

対応環境（iOS/macOS Safari 18+、Chrome の Touch ID/Windows Hello）に
限定し、非対応環境では設定 UI ごと出さない。

## 6. TOTP（totp.ts）

- RFC 6238。HMAC は WebCrypto（SHA-1/256/512）、6-8 桁、周期 5-300 秒。
- エントリの `otp` フィールドは **ProtectedValue** かつ KeePassXC 互換
  （`otpauth://` URI または素の Base32）。
- 空文字で保存したときはフィールド自体を削除する（KeePassXC 慣例。
  空文字を値として残さない）。
- 変更時は RFC 6238 Appendix B のテストベクタ（`totp.test.ts`）を壊さない。

## 変更後に必ずやること

このスキル対象のファイルを1つでも変更したら **`kbx-verify` スキル**の
回帰ゲート（`npm run check` → `npx vitest run` → 必要なら
`npm run build` + `serve-with-headers.mjs`）を実行する。
`vault.test.ts` はラウンドトリップ/誤パスワード/KDF/マージの回帰ゲート
であり、失敗したまま・アサーションを弱めて通さない。
