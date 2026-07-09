---
name: kbx-dev
description: Use when running any npm command (dev/test/check/build), installing deps, or executing Node scripts in this repo. Node is NOT installed on the host — everything must run inside the Docker dev container.
---

# kbx 開発コマンドの実行方法

ホストに Node は無い。すべて Docker コンテナ内で実行する。

## 実行中コンテナがある場合（推奨）

```sh
# コンテナ名を確認（kbx-dev-run-* 形式）
docker ps --format '{{.Names}}' | grep kbx-dev

# ワークディレクトリは /app
docker exec -w /app <container> npm run check
docker exec -w /app <container> npx vitest run
docker exec -w /app <container> npm run build
```

## コンテナが無い場合

```sh
./docker.sh build          # 初回のみ: イメージ作成
./docker.sh exec <command>  # 対話シェルに入らず単発実行（ポート非公開なので dev 起動中でも使える）
./docker.sh dev              # 開発サーバのみを直接起動 → http://localhost:6606
```

例: `./docker.sh exec npm run check` / `./docker.sh exec npx vitest run`。

対話シェルが要る場合のみユーザーに起動してもらう（`! ./docker.sh shell` を案内）。

## 注意

- `node_modules` は named volume。ホストからは見えないので、ホスト側で
  `ls node_modules` 等を実行しても存在しない — 異常ではない。
- 単一テストファイル: `npx vitest run src/lib/vault/vault.test.ts`
- `npm run preview` は CSP を適用しない。CSP 検証には使わない（kbx-verify 参照）。

## 「Bind for 0.0.0.0:6506 failed: port is already allocated」が出たら

以前起動したコンテナ（`dev`/`shell`/serve-with-headers 等、ポート公開付き）が
残っている。探して止めれば解放される（`--rm` 起動なので停止＝削除）:

```sh
docker ps --format '{{.ID}} {{.Names}} {{.Ports}}' | grep 6506
docker stop <コンテナID>
```

なお `./docker.sh exec` はポート非公開なので、サーバ起動中でも衝突しない。
