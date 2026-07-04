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
./docker.sh build   # 初回のみ: イメージ作成
./docker.sh shell   # コンテナ起動（ports 5173/4173 公開、対話シェル）
```

対話シェルはユーザーに起動してもらう（`! ./docker.sh shell` を案内）か、
`docker compose run --rm dev <command>` で単発実行する。

## 注意

- `node_modules` は named volume。ホストからは見えないので、ホスト側で
  `ls node_modules` 等を実行しても存在しない — 異常ではない。
- 単一テストファイル: `npx vitest run src/lib/vault/vault.test.ts`
- `npm run preview` は CSP を適用しない。CSP 検証には使わない（kbx-verify 参照）。
