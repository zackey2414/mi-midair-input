# Mid-Air Flick Input — プロジェクト指針

このリポジトリで作業する際の、システム全体構成・開発フロー・禁止事項。
(オーケストレーション全般の方針は `~/CLAUDE.md` / `~/.claude/rules` を参照)

## システム全体構成

- **目的**: 空中フリック入力で 絵文字 / 日本語 / 英語 を入力する。
- **このブランチ (`demo-app-with-eval`)**: デモ版 (`demo-app`) に **絵文字入力の精度評価・モデル比較** を加えたもの。
  - 日本語・英語入力は **Web フロント (`static/index.html` + `static/js/modes/*.js`) で完結**（折り曲げ式フリック・手の回転で言語切替）。backend が要るのは「軌跡/テキストから絵文字を検索して当てる」絵文字だけ。
  - 絵文字モードに **精度評価モード**（手描き→検索の top-1/5/10・MRR・速度を計測）と **モデル比較**（ViT-B/32 / B/16 / L/14 をページ内切替）を持つ。
- **設計思想**: 各モダリティを独立サブシステムとして分割開発する。ただし本ブランチの backend パッケージは `emoji-search` のみ（日英はフロント完結）。
- **共通構造 (絵文字)**: 入力 → CLIP 埋め込み → FAISS 近傍検索 → 候補表示。
- **レイアウト**: uv workspace monorepo (`packages/*`)。1 つの venv を共有し、依存はパッケージ単位で分離。

### パッケージ

| パッケージ | import 名 | 役割 |
|---|---|---|
| `midair-shared` | `midair_shared` | 共通基盤: encoder 契約 (`encoder.py`)、FAISS utils (`index.py`)、統合契約 (`search.py`) |
| `emoji-search` | `emoji_search` | 絵文字入力 (実装済み)。OpenAI CLIP (既定 ViT-B/32、比較用に B/16 / L/14) + OpenMoji |
| `midair-app` | `midair_app` | 統合 CLI (`midair`)。`mode` で各 Searcher を遅延ロードして振り分け |
| `midair-web` | `midair_web` | 検索 Web アプリ (FastAPI)。テキスト/手書き/カメラ入力、日英フリック(フロント)、精度評価・モデル比較。ホスト port 8762 (コンテナ内 8000) |

> 日本語・英語入力は Web UI 内のフロント実装 (`static/js/modes/{japanese,english}.js`)。
> backend パッケージ (japanese-search / english-search) は本ブランチには存在しない。

### 統合の継ぎ目 (重要)

- 絵文字サブシステムは `midair_shared.search.Searcher` を実装する (`mode` / `search_text` / `search_image`)。日本語・英語はフロント完結で backend Searcher を持たない。
- 統合側 (`midair_app.registry`) は実装詳細を知らず `mode` で振り分けるだけ。重い依存 (torch 等) は選択モードのみ遅延 import。
- **データ隔離**: サブシステム別に `data/<name>_search/` に置き、相互干渉させない。中身は git 管理外 (`.gitkeep` のみ追跡)。
- **モデル整合**: index 構築時と検索時で同一 CLIP モデル (共通空間が前提)。`index_meta.json` に `model_id`/`dim`/`normalize` を記録し、searcher はそれを読んで query 側エンコーダをそのモデルに合わせる。
- **モデル比較 (精度評価)**: モデルごとに index を分けて `data/`・`data-vitb16/`・`data-vitl14/` に置き、web を `MIDAIR_MODELS="key|label|dataルート;..."` (先頭が既定) で起動して 3 モデルを登録する。手順は `packages/web/README.md` の「精度評価 & モデル比較」。

## 実行環境 (ローカル / Docker)

- **配布ターゲットは Intel Mac (linux/amd64, GPU 無し)**。環境依存を抑えるため Docker ベースで動かす (`docs/emoji_search/DOCKER.md`)。
- torch は **CPU 版が既定**: `pyproject.toml` の `[[tool.uv.index]] pytorch-cpu` + emoji-search の `torch = { index = "pytorch-cpu" }`。`uv.lock` も CPU 解決済み (nvidia-* を含まない)。
- GPU で index 構築を高速化したいときだけ `UV_TORCH_BACKEND=cu124 uv sync` 等で上書きする (Docker 運用は CPU のまま)。
- Docker: `data*` はボリュームマウントで永続化、CLIP **3 モデル (B/32 / B/16 / L/14)** をイメージに焼き込み (実行時オフライン)。web は `MIDAIR_MODELS` で 3 モデルを登録済み。`MIDAIR_DATA_DIR` でデータルートを上書きできる。

### データ配布ルール

- **FAISS index 関連 (`index.faiss` / `metadata.jsonl` / `index_meta.json`) のみ共有ストレージ (Drive 等) に配置**し、各環境はそれを取得して使う (重い CLIP エンコードを各環境で再実行しなくても良いように設計)。共有 Drive `midair-flick-input-ViT` にモデル別 (b32 / b16 / l14) フォルダで置いている。
- **OpenMoji 画像 (`openmoji/`) は Drive に再配布しない** (CC BY-SA 4.0 の再配布手続き回避)。`download_openmoji.py` で公式 Releases から取得する。
- index はデバイス非依存。検索は `index_meta.json` の `model_id` と同一の CLIP モデルで行う前提。

## 開発フロー (git-flow)

- **git-flow を採用する。**
- `main` は安定版。デモ／実験は `demo-app` 系ブランチ (本ブランチは `demo-app-with-eval`) で行う。機能は feature ブランチで開発し、完了後にマージする。
- **commit / push はユーザの明示指示があるときのみ**行う。

## アクセス禁止領域

- **`.git/` は直接読み書き・改変しない** (手動編集 / 削除をしない)。git 操作は通常の git コマンド経由で、かつユーザ指示時のみ。
