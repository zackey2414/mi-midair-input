# midair-web (検索 Web アプリ)

絵文字検索をブラウザから使う Web アプリ。**テキスト入力** と **手書きキャンバス** の 2 入力に対応し、
結果を絵文字画像のグリッドで表示する。検索は**非同期ジョブ**でバックグラウンド実行する。

## 構成
- `src/midair_web/app.py` — FastAPI アプリ (検索 API / 画像配信 / ジョブ管理)
- `src/midair_web/static/index.html` — フロント (テキスト + 手書き canvas + ポーリング描画)
- `src/midair_web/__main__.py` — `midair-web` 起動 (uvicorn)

## 非同期処理
```
GET  /api/models        -> {models:[{key,label,model_id,dim}], default}
POST /api/search/text   {query, top_k, model?}      -> {job_id, status:"pending"}
POST /api/search/image  {image(dataURL), top_k, model?} -> {job_id, status:"pending"}
GET  /api/jobs/{job_id}  -> {status, results[], error, elapsed_ms}
GET  /api/eval/targets?n=&group=  -> {targets[]}  (精度評価のお題; group=faces で人の顔のみ)
GET  /emoji-img/{hex}.png -> 絵文字画像
```
`model` は `/api/models` の key。未指定なら既定モデル。`elapsed_ms` は検索(埋め込み+近傍探索)の実時間。
重い CLIP 推論は `asyncio.to_thread` でワーカースレッドに逃がし、イベントループを塞がない。
フロントは `job_id` を受け取り `GET /api/jobs/{id}` を 300ms 間隔でポーリングして結果を描画する。

## 入力モード

カメラ入力は入力モードごとに同じ手の動きを別の意味として扱う。

- `絵文字`: 既存のピンチ描画、ピース検索、指差しクリア
- `日本語`: 10種類のピンチパターンで行を選び、フリック方向で母音を選ぶ50音入力の試作。1文字確定後は、パー状態を検出するまで次の文字を受け付けない。
- `英語`: 未実装

> **入力の読み取り自体 (手の検出 → ジェスチャ/フリックの解釈 → 文字の確定) は `index.html` のフロントで完結する。**
> 日本語フリックや言語切替モーションは backend 不要。**絵文字だけは「描いた軌跡やテキストから絵文字を検索して当てる」処理が要るため
> backend (`emoji-search`: CLIP 埋め込み + FAISS) を使う**。英語も、決定論的なジェスチャ→文字入力にするならフロント完結で追加できる。

言語切替モーション (実験): カメラパネルのセレクタで方式を選ぶと、手の向き (手のひら/手の甲) で
`cycleInputMode()` を呼び `日本語 → 英語 → 絵文字` を巡回する。方式は 2 つ:

- `手の甲を0.5秒`: 手の甲を見せて 0.5 秒キープ
- `手のひら→甲にひっくり返す`: 手のひらから手の甲へ裏返した瞬間

手のひら/甲は「手首→人差し指/小指付け根」の外積符号で判定 (環境で逆なら UI の反転トグル)。
手の甲が見えている間は 描く/検索/クリア(絵文字) や 日本語フリック を停止し、言語切替専用にする。
しきい値・既定方式などは `static/index.html` 冒頭の定数で調整する。

## 起動
事前に `data/emoji_search/` の index 構築が必要 (ルート README 参照)。

カメラの **Mid-Air 入力 (手ジェスチャ)** を使う場合は、MediaPipe アセットを先に取得する。
テキスト / 手書き検索だけなら不要。**Docker はビルド時に自動取得**するが、uv ローカルでは手動が要る (冪等):
```bash
uv run python packages/web/scripts/fetch_mediapipe.py   # -> src/midair_web/static/vendor/mediapipe/
```

依存 import・OpenMoji・FAISS index・MediaPipe・Web 起動前提をまとめて確認する:
```bash
uv run midair-doctor
```

```bash
uv run midair-web                      # http://127.0.0.1:8762 (既定ポート 8762)
uv run midair-web --reload             # 開発用オートリロード
uv run midair-web --port 9000          # ポートを変えたいとき
```

## 精度評価 & モデル比較

絵文字モードの **「絵文字入力評価」** ボタンで精度評価モードに入る。お題の絵文字を手描き → 検索し、
お題が **top-1/5/10** に入った割合と **MRR**、さらに **入力時間**(お題表示→確定) と **検索時間**
(確定→結果; サーバ側の推論実時間 `elapsed_ms`) を記録して集計する。ログはブラウザの localStorage に貯め、
画面下に **モデル別の比較表** として描画する (ファイルは作らない)。評価中は手首フリックの言語切替を無効化する。

評価パネルの **「モデル」** で **ViT-B/32 / B/16 / L/14** を切り替えられる。各モデルは自分の index で検索し、
結果はモデル別に集計されるので、**同一 UI でモデルサイズごとの精度・速度を比較**できる。

### データ配置
モデルごとに index を分け、**同じ 3 ファイル**を「data ルート/emoji_search/」に置く:
```
data/emoji_search/          index.faiss  metadata.jsonl  index_meta.json  openmoji/  openmoji_black/
data-vitb16/emoji_search/   index.faiss  metadata.jsonl  index_meta.json
data-vitl14/emoji_search/   index.faiss  metadata.jsonl  index_meta.json
```
- 表示用の絵文字画像 (`/emoji-img`) は **既定 (base) の `data/emoji_search/openmoji/` からのみ** 配信するので、
  変種 (data-vitb16 等) には index の 3 ファイルだけあればよい。
- FAISS index はデバイス非依存。**別マシンには data* ディレクトリをそのままコピーしてもよい** (下の構築は不要になる)。

### 別デバイスでの用意 (ローカル構築)
```bash
uv sync
# 1) OpenMoji 画像 (表示=color / 構築=black) を取得
uv run python packages/emoji-search/scripts/download_openmoji.py --variant both
# 2) 3 モデルぶんの index を構築 (線画 black から埋め込み)。モデルは初回に自動DL (B/16≈0.6GB, L/14≈1.7GB)
uv run python packages/emoji-search/scripts/build_index.py --source-variant black \
    --model openai/clip-vit-base-patch32
uv run python packages/emoji-search/scripts/build_index.py --source-variant black \
    --model openai/clip-vit-base-patch16 \
    --index-path data-vitb16/emoji_search/index.faiss --metadata-out data-vitb16/emoji_search/metadata.jsonl
uv run python packages/emoji-search/scripts/build_index.py --source-variant black \
    --model openai/clip-vit-large-patch14 \
    --index-path data-vitl14/emoji_search/index.faiss --metadata-out data-vitl14/emoji_search/metadata.jsonl
```
画像・メタデータは base の `data/emoji_search/` を共有して読むので、変種側に openmoji を置く必要はない。
(index_meta.json は `--index-path` と同じ場所に出力される。searcher は各 index の `model_id` を読んで
同じモデルで query を埋め込むため、モデル指定の取り違えは起きない。)

### 起動 (モデル比較を有効化)
`MIDAIR_MODELS` に「`key|label|dataルート`」を `;` 区切りで並べる (**先頭が既定モデル**)。
未設定なら単一モデル (従来挙動) で動く。`dataルート` は直下に `emoji_search/` を持つディレクトリ。
```bash
MIDAIR_DATA_DIR=$PWD/data \
MIDAIR_MODELS="b32|ViT-B/32|$PWD/data;b16|ViT-B/16|$PWD/data-vitb16;l14|ViT-L/14|$PWD/data-vitl14" \
uv run midair-web
```

## 今後
- mode 切替で japanese / english サブシステムも同 UI に載せる。
