# 構成図について（作成・レンダリング方法）

このフォルダの構成図は **[Mermaid](https://mermaid.js.org/)**（テキストでグラフを記述する記法）で作成し、**PNG 画像**に書き出している。テキストソースなので git で差分管理・レビューでき、修正も速い。

## ファイル構成

| 種類 | 位置 | 説明 |
|---|---|---|
| ソース | `*.mmd` | Mermaid のテキスト（**これが図の実体**。編集対象） |
| 画像 | `figs/*.png` | `.mmd` をレンダリングした白背景 PNG（スライド用） |
| 解説 | `*.md` | 各図の説明ページ（`figs/` の PNG を埋め込む） |
| 生成 | `render.sh` | `*.mmd` → `figs/*.png` を一括生成するスクリプト |

図の一覧:
- 実装（モード別）: `implementation-japanese.mmd` / `-english.mmd` / `-emoji.mmd`（＋ `.en` = 英語版）
- アプリ操作フロー: `application.mmd`（＋ `application.en.mmd`）

解説ページ: [`implementation.md`](implementation.md) / [`application.md`](application.md)（English: [`implementation.en.md`](implementation.en.md) / [`application.en.md`](application.en.md)）

## 図を直す・作り直す

1. `*.mmd` を編集（例: `implementation-japanese.mmd`）。GitHub 上ではこの Mermaid がそのまま図として表示される。
2. 画像を再生成する:
   ```bash
   cd docs/diagrams
   ./render.sh          # Docker が必要（下記）
   ```
   `figs/*.png` が更新される。新しい図を足したら `.mmd` を置くだけで `render.sh` が拾う。

## レンダリングの仕組み（`render.sh`）

- **[mermaid-cli (`mmdc`)](https://github.com/mermaid-js/mermaid-cli)** を **Docker イメージ `minlag/mermaid-cli`**（ヘッドレス Chromium 同梱）で実行して PNG 化する。ローカルに Node や Chromium を入れなくてよい。
- 主なオプション:
  - `-b white` … 背景を白（スライド前提）
  - `-s 2` … 2 倍解像度
  - `-c mmconf.json` … フォントサイズ `26px` 等（見やすさ調整）
  - `-p pptr.json` … コンテナ内 Chromium の実行パス + `--no-sandbox`
- **16:9 パディング**: アプリ概要図だけ、スライドにそのまま載るよう macOS の `sips` で白余白を足して 16:9 にする（実装フロー図はパイプライン形状のため横長のまま）。

### 前提

- Docker が動くこと（初回は `minlag/mermaid-cli` イメージを pull、約 2.2GB）。
- 16:9 パディングは `sips`（macOS 標準）に依存。Linux 等では自動でスキップされ、PNG は自然な縦横比で出力される。

> drawio 等で作り直したい場合も、`.mmd` の内容を元に移植できる。
