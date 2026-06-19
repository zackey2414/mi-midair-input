# Docker で動かす (Intel Mac / GPU 無し環境)

環境依存を抑えるため、このシステムは Docker 上で動かせる。
torch は **CPU 版** を `uv.lock` で固定し、CLIP モデルはイメージに焼き込むので、
ビルド後はほぼオフラインで動く。対象は **Intel Mac (linux/amd64)**。

```
構成: Docker image "midair-input"
  - web      : FastAPI + uvicorn の検索 Web アプリ (port 8000)
  - prepare  : OpenMoji 取得 + FAISS index 構築 (初回のみ、profile=setup)
  data/      : ホストの ./data を /app/data にマウント (画像・index を永続化)
```

## 0. 前提

- Docker Desktop (Mac)。Compose v2 同梱。
- Apple Silicon Mac で動かす場合も `platform: linux/amd64` でエミュレーション動作する（Intel Mac ならネイティブ）。

## 1. イメージをビルドする

```bash
docker compose build
```

- CPU 版 torch / transformers / faiss を入れ、CLIP ViT-B/32 を焼き込む。
- 初回は数分（モデル約 600MB のダウンロード込み）。以降はキャッシュされる。

## 2. データを用意する（初回のみ・既存 data があればスキップ可）

> **すでに `./data/emoji_search/` に画像 + index がある場合（別マシンからコピーした場合も含む）は、この手順は不要。** そのまま手順 3 へ。
> faiss index は**デバイス非依存・移植可能**で、GPU で構築した index も CPU でそのまま使える
> （CLIP の重みが同じなら GPU/CPU で同じ埋め込み空間。差は無視できる浮動小数誤差のみ）。
> ただし Web 表示には絵文字画像（`openmoji/`、約18MB）も要るので、`./data/emoji_search/` を**まるごと**持ち込むこと。

データが無い新規環境では、OpenMoji 画像の取得と FAISS index 構築をコンテナ内で実行し、結果を `./data` に書き出す。

```bash
docker compose --profile setup run --rm prepare
```

- 生成物: `./data/emoji_search/{openmoji/, openmoji.json, index.faiss, metadata.jsonl, index_meta.json}`
- index 構築は CPU で 1〜数分（絵文字 約4500枚）。
- 一度実行すればホストの `./data` に残るので、次回以降は不要。

### Drive 等にアップした成果物を使う（各環境でビルドしない）

CLIP エンコード（重い工程）を各環境でやらせたくない場合、構築済み成果物を共有ストレージ
（Google Drive 等）に置いてダウンロードさせるのが手軽。`index.faiss` / `metadata.jsonl` /
`index_meta.json` は**デバイス非依存で移植可能**。**同じ CLIP モデル（`index_meta.json` の `model_id`）で
検索する前提**。Web 表示には絵文字画像（`openmoji/`）も必要な点に注意。

- **(推奨) `data/emoji_search/` をまるごと zip（画像 + index、約28MB）**
  ```bash
  # アップ側 (一度だけ)
  (cd data && zip -r emoji_search.zip emoji_search)
  # 取得側  (pip install gdown)
  gdown "<SHARE_URL or FILE_ID>" -O emoji_search.zip
  mkdir -p data && unzip -o emoji_search.zip -d data
  ```
  → 画像も含むので `prepare` も `download_openmoji.py` も不要。

- **(分割) index 3ファイルだけ Drive、画像はスクリプトで取得**
  ```bash
  gdown "<index.faiss URL>"     -O data/emoji_search/index.faiss
  gdown "<metadata.jsonl URL>"  -O data/emoji_search/metadata.jsonl
  gdown "<index_meta.json URL>" -O data/emoji_search/index_meta.json
  python packages/emoji-search/scripts/download_openmoji.py   # 画像のみ取得 (GPU 不要)
  ```

いずれも `./data/emoji_search/` が揃えば、あとは手順 3 の `docker compose up web` だけ。

## 3. ローカルホストで起動する

```bash
docker compose up web          # フォアグラウンド
docker compose up -d web       # バックグラウンド
```

ブラウザで **http://localhost:8000** を開く。テキスト入力 / 手書きキャンバスで検索できる。

停止:
```bash
docker compose down
```

## 4. コンテナに入る / 中身を見る

```bash
docker compose exec web bash          # 起動中コンテナにシェルで入る
docker compose logs -f web            # ログ追尾
docker compose run --rm web bash      # 使い捨てコンテナで入る
```

コンテナ内では venv が有効済み（`/app/.venv/bin` に PATH）。例:
```bash
python -c "import torch; print(torch.__version__)"     # 2.12.1+cpu
midair --mode emoji --query "cat" --top-k 5            # CLI 検索 (画像は出ないがスコア確認)
```

CLI をワンショットで使う:
```bash
docker compose run --rm web midair --mode emoji --query "fire" --top-k 5
```

## 5. 実装・開発の仕方

ワークスペース各パッケージ (`packages/*`) は editable install されている。
ソースをマウントすれば、イメージを再ビルドせずに変更を反映できる（`--reload` でホットリロード）:

```bash
docker compose run --rm -p 8000:8000 \
  -v "$(pwd)/packages:/app/packages" \
  web uvicorn midair_web.app:app --host 0.0.0.0 --port 8000 --reload
```

- Python コードの編集 → 自動リロード。
- **依存を変えたとき**（`pyproject.toml` のパッケージ追加など）は lock 更新 + 再ビルドが必要:
  ```bash
  uv lock                 # ホスト側で lock 更新
  docker compose build    # イメージ再ビルド
  ```
- `data/` 配下はマウント共有なので、ホストで作った index をそのままコンテナが読む（逆も同様）。

## 6. よくあるハマり

| 症状 | 対処 |
|------|------|
| `address already in use` (8000) | 他プロセスが 8000 を使用。`ports: "8080:8000"` に変更 |
| 検索が `index が見つかりません` | 手順 2 (prepare) を未実行。`docker compose --profile setup run --rm prepare` |
| Apple Silicon で遅い | amd64 エミュレーションのため。Intel Mac ならネイティブで高速 |
| イメージを作り直したい | `docker compose build --no-cache` |

## 7. CPU / GPU について

- 既定は CPU 版 torch（`pyproject.toml` の `[[tool.uv.index]] pytorch-cpu` + `torch = { index = "pytorch-cpu" }`）。
- GPU マシンで高速に index 構築したいときだけ、ホストで `UV_TORCH_BACKEND=cu124 uv sync` のように上書きする（Docker 運用は CPU のまま）。
