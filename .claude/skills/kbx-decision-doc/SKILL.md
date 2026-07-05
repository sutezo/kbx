---
name: kbx-decision-doc
description: Use when the user asks why kbx chose a particular technology/design over an alternative (e.g. "why Dropbox not Google Drive", "なぜ〜にしたんだっけ"), or asks to record/document that rationale retroactively. Investigates existing sources first, then writes a "why X, not Y" subsection into docs/ARCHITECTURE.md.
---

# 技術判断の調査・文書化

「なぜ A ではなく B を選んだか」を後から文書化する手順。過去の判断の記録は
`docs/ARCHITECTURE.md` に集約し、ADR ファイルなどは別途作らない。

## 1. 既存の記録を先に探す

新しく調べる前に、すでに書かれていないか確認する（二重記載を防ぐ）。

```sh
grep -rn -i "<キーワード>" docs/ CLAUDE.md
git log --all --oneline -i --grep="<キーワード>"
```

見つかった場合はそれを提示するだけでよい。加筆が必要なら該当箇所を更新する。

## 2. 見つからない場合は判断根拠を調査する

会話や issue にヒントがなければ、次の観点で kbx の制約に照らして推論する
（CLAUDE.md の設計方針が判断の軸になっていることが多い）:

- **バックエンドを持たない静的 SPA** という前提と両立するか
  （client secret が必要な方式は不可）
- **CSP**（`static/_headers`）と衝突しないか
  （外部スクリプト読み込み前提の SDK は `script-src 'self'` と衝突する）
- **最小権限・影響範囲の限定**（フルアクセス系スコープより、
  アプリ専用領域に限定できる方を優先する設計哲学に合うか）
- **利用者がデータを自分で検証できるか**（暗号文のみが保存されている
  ことを利用者自身が確認できる透明性）
- 実装が複雑になりすぎないか（YAGNI）

これらは仮説であり、断定せず「〜と考えられる」「〜という制約による」と
根拠付きで書く。不確かな場合は文書化の前にユーザーに確認する。

## 3. ARCHITECTURE.md に追記する

該当機能の既存セクション（例: 4.7 Dropbox 同期）の末尾に、
`#### なぜ A ではなく B か` という小見出しで追記する。

構成の型（Dropbox vs Google Drive の節を参考にする）:

1. 冒頭1文で結論と検討した代替案を明示
2. 番号付きで理由を列挙。各理由は「事実 → kbx のどの制約と衝突するか」
   の順で書く。決定打になった理由を先頭に置く
3. 末尾に「将来同様の判断をする際の基準」として一般化しておくと、
   次に同じ選定が発生したときに再利用できる

日本語で書く（このファイル自体が日本語ドキュメントのため）。
ソースコードのコメントとは異なり、ARCHITECTURE.md は日本語一貫方針。

## 4. 完了後

CLAUDE.md の Git 規約に従い、コミットはユーザー確認後。
コミットメッセージ案は英語で提示する（Conventional Commits, `docs:` prefix）。
