# Mid-Air Flick Input — プロジェクト指針

このリポジトリで作業する際の、システム全体構成・開発フロー・禁止事項。
(オーケストレーション全般の方針は `~/CLAUDE.md` / `~/.claude/rules` を参照)

## システム全体構成

- **目的**: 空中フリック入力で 絵文字 / 日本語 / 英語 を入力する。
- **このブランチ (`tmp-demo-app`)**: `main` を土台に、`demo-app-with-eval` の絵文字改善 (精度評価ページ・複数 vision encoder 比較・削減 DB) を**加算移植**した統合用の踏み台ブランチ。
  - 全体 UI / 日本語・英語入力 / 絵文字の入力方法 (人差し指描画＋グーパーグー検索) は **main を採用**。ただし日本語は「かな入力」までとし、main にあった**かな漢字変換は外す**(demo / docs と整合。わ行フリップは全角スペースに割当)。
  - 絵文字検索は **ViT-B/32 (既定) / B/16 / L/14 を `MIDAIR_MODELS` で登録して比較**でき、**Top-K・検索時間の精度評価ページ**を持つ。DB は使用頻度の低い絵文字を除いた削減版 (783件)。
  - **main / demo-app-with-eval は変更しない**。統合はこの `tmp-demo-app` 上でのみ行う。
- **方針**: 各モダリティを独立サブシステムとして**分割開発**し、最終的に 1 つの統合アプリ (`midair`) に**束ねる**。
- **共通構造**: 入力 → 埋め込みベクトル化 → FAISS 近傍検索 → 候補表示。
- **レイアウト**: uv workspace monorepo (`packages/*`)。1 つの venv を共有し、依存はパッケージ単位で分離。

### パッケージ

| パッケージ | import 名 | 役割 |
|---|---|---|
| `midair-shared` | `midair_shared` | 共通基盤: encoder 契約 (`encoder.py`)、FAISS utils (`index.py`)、統合契約 (`search.py`) |
| `emoji-search` | `emoji_search` | 絵文字入力 (実装済み)。OpenAI CLIP (既定 ViT-B/32、比較用に B/16 / L/14) + OpenMoji。searcher は index の `index_meta.json` の `model_id` を読んで query 側 encoder を合わせる |
| `japanese-search` | `japanese_search` | かな漢字変換の実装 (`converter.convert`)。**本ブランチでは未使用**: JP は「かな入力」までとし、変換は行わないため web は依存しない (パッケージは残置) |
| `midair-app` | `midair_app` | 統合アプリ。`mode` で各 Searcher を遅延ロードして振り分け。`midair` CLI |
| `midair-web` | `midair_web` | 検索 Web アプリ (FastAPI)。テキスト/手書き入力、非同期ジョブ、画像で結果表示、**3 モデル比較・精度評価**。ホスト port 8762 (コンテナ内 8000) |

> 日本語入力は「かな入力」まで (かな漢字変換は行わない)。日本語・英語とも入力ロジックは Web フロント側で完結し、backend Searcher は持たない (かな漢字変換 backend も本ブランチでは無効化)。

### 統合の継ぎ目 (重要)

- 各サブシステムは `midair_shared.search.Searcher` を実装する (`mode`, `search_text`)。
- 統合側 (`midair_app.registry`) は実装詳細を知らず、`mode` で振り分けるだけ。重い依存 (torch 等) は選択モードのみ遅延 import。
- **新サブシステム追加手順**: (1) `packages/` に追加 → (2) `Searcher` を実装 → (3) `registry.build_searcher` に登録。
- **データ隔離**: サブシステム別に `data/<name>_search/` に置き、相互干渉させない。中身は git 管理外 (`.gitkeep` のみ追跡)。
- **モデル整合**: encoder の差し替え・モデル変更時は index を再構築する (index 構築時と検索時で同一モデル = 共通空間が前提)。`data/<name>_search/index_meta.json` に `model_id`/`dim`/`normalize` を記録している。

## 実行環境 (ローカル / Docker)

- **配布ターゲットは Intel Mac (linux/amd64, GPU 無し)**。環境依存を抑えるため Docker ベースで動かす (`docs/emoji_search/DOCKER.md`)。
- torch は **CPU 版が既定**: `pyproject.toml` の `[[tool.uv.index]] pytorch-cpu` + emoji-search の `torch = { index = "pytorch-cpu" }`。`uv.lock` も CPU 解決済み (nvidia-* を含まない)。
- GPU で index 構築を高速化したいときだけ `UV_TORCH_BACKEND=cu124 uv sync` 等で上書きする (Docker 運用は CPU のまま)。
- Docker: `data*` はボリュームマウントで永続化、CLIP **3 モデル (B/32 / B/16 / L/14)** をイメージに焼き込み (実行時オフライン)。web は `MIDAIR_MODELS` で 3 モデルを登録済み。フロント (`static/js`・`index.html`) はホストから bind-mount するので再ビルド無しで反映できる。`MIDAIR_DATA_DIR` でデータルートを上書き可。

### データ配布ルール

- **FAISS index 関連 (`index.faiss` / `metadata.jsonl` / `index_meta.json`) のみ共有ストレージ (Drive 等) に配置**し、各環境はそれを取得して使う (重い CLIP エンコードを各環境で再実行しなくても良いように設計)。モデル別に `data/` (B/32)・`data-vitb16/`・`data-vitl14/` へ分けて置く。
- **OpenMoji 画像 (`openmoji/`) は Drive に再配布しない** (CC BY-SA 4.0 の再配布手続き回避)。`download_openmoji.py` で公式 Releases から取得する (表示画像は base `data/emoji_search/` のみでよい)。
- index はデバイス非依存。検索は `index_meta.json` の `model_id` と同一の CLIP モデルで行う前提。
- **削減 DB (783件: 3グループ＋肌色除外) の再現ビルド手順は未コミット**で、現状は Drive 成果物として配布 (`docker compose --profile setup run --rm fetch`)。将来 main へ取り込む際に `build_index.py` へフィルタを実装して再現性を確保する。

## 開発フロー (git-flow)

- **git-flow を採用する。**
- `main` は安定版。**`main` と `demo-app-with-eval` は本統合作業では変更しない** (2ブランチの状態を維持)。統合は踏み台の **`tmp-demo-app`** 上でのみ行う。
- demo 側の取り込みは `git merge` せず、`git show demo-app-with-eval:<path>` で必要ファイル/ハンクだけ選択的に加算する (demo の削除＝japanese-search/kanji や折り曲げフロントを巻き込まないため)。
- **commit / push はユーザの明示指示があるときのみ**行う。

## アクセス禁止領域

- **`.git/` は直接読み書き・改変しない** (手動編集 / 削除をしない)。git 操作は通常の git コマンド経由で、かつユーザ指示時のみ。
