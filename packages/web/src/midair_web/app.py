"""FastAPI アプリ: テキスト / 手書き画像で絵文字を検索し、画像で結果を返す。

検索は **非同期ジョブ** で処理する:
  POST /api/search/{text,image}  -> job_id を即返す (status=pending)
  GET  /api/jobs/{job_id}        -> status と結果 (done になったら results)
重い CLIP 推論は ``asyncio.to_thread`` でワーカースレッドに逃がし、
イベントループ (= 他リクエスト) を塞がない。

絵文字の検索は複数モデル (ViT-B/32 / B/16 / L/14) を環境変数 ``MIDAIR_MODELS`` で
登録して比較でき、精度評価用の ``/api/eval/targets`` / ``/api/models`` を持つ。
(日本語入力は「かな入力」まで。かな漢字変換は行わない。)
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import mimetypes
import os
import random
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image
from pydantic import BaseModel

from emoji_search.searcher import EmojiSearcher

# データルートは MIDAIR_DATA_DIR 優先 (Docker 等)、無ければ repo root/data。
# .../packages/web/src/midair_web/app.py -> parents[4] = repo root
REPO_ROOT = Path(__file__).resolve().parents[4]
_DATA_ROOT = Path(os.environ.get("MIDAIR_DATA_DIR") or (REPO_ROOT / "data"))
DATA_DIR = _DATA_ROOT / "emoji_search"   # 既定モデルのデータ (表示用 openmoji もここから配信)
STATIC_DIR = Path(__file__).parent / "static"


def _parse_models() -> list[dict]:
    """比較用の複数モデルを環境変数 MIDAIR_MODELS から読む。

    形式: "key|label|dataroot;key|label|dataroot;..."
      dataroot は MIDAIR_DATA_DIR と同じ「data ルート」(直下に emoji_search/ がある)。
    未指定なら既定の DATA_DIR を単一モデル "default" として扱う (従来挙動)。
    """
    raw = os.environ.get("MIDAIR_MODELS", "").strip()
    if not raw:
        return [{"key": "default", "label": "default", "data_dir": DATA_DIR}]
    models = []
    for part in raw.split(";"):
        part = part.strip()
        if not part:
            continue
        key, label, root = part.split("|", 2)
        models.append({"key": key, "label": label, "data_dir": Path(root) / "emoji_search"})
    return models


MODELS = _parse_models()
MODELS_BY_KEY = {m["key"]: m for m in MODELS}
DEFAULT_MODEL_KEY = MODELS[0]["key"]

app = FastAPI(title="Mid-Air Emoji Search")

# ES モジュール (.mjs) / wasm を正しい MIME で配信する (ブラウザの module / wasm 読込に必須)。
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("application/wasm", ".wasm")
# static/ 配下 (vendor の MediaPipe 等) を /assets で配信する。
app.mount("/assets", StaticFiles(directory=STATIC_DIR), name="assets")

# --- モデル別 searcher の遅延ロード (CLIP モデル + index は初回検索時に 1 度だけ) ---
_searchers: dict[str, EmojiSearcher] = {}
_searcher_lock = asyncio.Lock()


async def get_searcher(model_key: str | None = None) -> EmojiSearcher:
    key = model_key if model_key in MODELS_BY_KEY else DEFAULT_MODEL_KEY
    if key not in _searchers:
        async with _searcher_lock:
            if key not in _searchers:
                m = MODELS_BY_KEY[key]
                _searchers[key] = await asyncio.to_thread(
                    EmojiSearcher,
                    m["data_dir"] / "index.faiss",
                    m["data_dir"] / "metadata.jsonl",
                )
    return _searchers[key]


# --- 非同期ジョブ管理 (プロセス内メモリ) ---
@dataclass
class Job:
    id: str
    status: str = "pending"  # pending | running | done | error
    results: list = field(default_factory=list)
    error: str | None = None
    elapsed_ms: float | None = None  # 検索(エンコード+近傍探索)の実時間


JOBS: dict[str, Job] = {}


class TextQuery(BaseModel):
    query: str
    top_k: int = 12
    model: str | None = None  # 検索に使うモデル key (未指定なら既定)


class ImageQuery(BaseModel):
    image: str  # data URL ("data:image/png;base64,....") もしくは生 base64
    top_k: int = 12
    model: str | None = None


def _serialize(result) -> dict:
    return {
        "id": result.id,
        "score": round(result.score, 4),
        "label": result.label,
        "emoji": result.payload.get("emoji", ""),
        "image_url": f"/emoji-img/{result.id}.png",
    }


def _decode_image(data_url: str) -> Image.Image:
    """canvas の data URL / base64 PNG を白背景合成して RGB の PIL 画像にする。"""
    payload = data_url.split(",", 1)[1] if "," in data_url else data_url
    raw = base64.b64decode(payload)
    img = Image.open(io.BytesIO(raw)).convert("RGBA")
    background = Image.new("RGBA", img.size, (255, 255, 255, 255))
    background.alpha_composite(img)
    return background.convert("RGB")


async def _process(job_id: str, model_key: str | None, run) -> None:
    """``run`` (同期・ブロッキング) をスレッドで実行し、結果を job に格納する。

    検索の実時間 (エンコード+近傍探索) を計測して ``elapsed_ms`` に記録する
    (モデル別の速度比較に使う)。
    """
    job = JOBS[job_id]
    job.status = "running"
    try:
        searcher = await get_searcher(model_key)
        t0 = time.perf_counter()
        results = await asyncio.to_thread(run, searcher)
        job.elapsed_ms = (time.perf_counter() - t0) * 1000.0
        job.results = [_serialize(r) for r in results]
        job.status = "done"
    except Exception as exc:  # noqa: BLE001 - 失敗内容を job に載せて返す
        job.error = str(exc)
        job.status = "error"


def _new_job() -> str:
    job_id = uuid.uuid4().hex
    JOBS[job_id] = Job(id=job_id)
    return job_id


@app.get("/api/models")
def list_models() -> dict:
    """比較に使えるモデル一覧を返す (key / label / model_id / dim)。"""
    out = []
    for m in MODELS:
        meta_path = m["data_dir"] / "index_meta.json"
        meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
        out.append({
            "key": m["key"], "label": m["label"],
            "model_id": meta.get("model_id", ""), "dim": meta.get("dim"),
        })
    return {"models": out, "default": DEFAULT_MODEL_KEY}


@app.post("/api/search/text")
async def search_text(query: TextQuery) -> dict:
    job_id = _new_job()
    asyncio.create_task(_process(job_id, query.model, lambda s: s.search_text(query.query, query.top_k)))
    return {"job_id": job_id, "status": "pending"}


@app.post("/api/search/image")
async def search_image(query: ImageQuery) -> dict:
    image = _decode_image(query.image)
    job_id = _new_job()
    asyncio.create_task(_process(job_id, query.model, lambda s: s.search_image(image, query.top_k)))
    return {"job_id": job_id, "status": "pending"}


@app.get("/api/eval/targets")
async def eval_targets(n: int = 10, group: str = "smileys-emotion") -> dict:
    """精度評価用の「お題」絵文字をランダムに返す。

    index に入っている絵文字だけから選ぶので、お題は必ず検索対象に存在する
    (存在しない絵文字をお題にすると原理的に当たらず、評価が無意味になるため)。
    group="all" (または空文字) で全ジャンル、group="faces" で人の顔だけ、
    それ以外は該当 group から抽出する。お題は全モデルで同一 (index の内容が同じ) なので
    既定モデルの metadata から選ぶ。
    """
    searcher = await get_searcher(DEFAULT_MODEL_KEY)
    if group in ("", "all"):
        pool = searcher.metadata
    elif group == "faces":
        # 人の顔だけ: smileys-emotion の face* サブグループから、
        # costume (💩🤡👹👺👻👽👾🤖) と 悪魔/どくろ (😈👿💀☠️) を除く。
        # cat-face/monkey-face は "face" 始まりでないので自動的に除外される。
        pool = [
            m for m in searcher.metadata
            if m.get("group") == "smileys-emotion"
            and m.get("subgroups", "").startswith("face")
            and m.get("subgroups") != "face-costume"
            and m.get("hexcode") not in ("1F608", "1F47F", "1F480", "2620")
        ]
    else:
        pool = [m for m in searcher.metadata if m.get("group") == group]
    if not pool:
        raise HTTPException(status_code=404, detail=f"no targets for group={group!r}")
    chosen = random.sample(pool, min(n, len(pool)))
    return {
        "group": group,
        "targets": [
            {
                "hexcode": m["hexcode"],
                "emoji": m.get("emoji", ""),
                "label": m.get("annotation", ""),
                "group": m.get("group", ""),
                "image_url": f"/emoji-img/{m['hexcode']}.png",
            }
            for m in chosen
        ],
    }


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    job = JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="unknown job")
    return {"job_id": job.id, "status": job.status, "results": job.results,
            "error": job.error, "elapsed_ms": job.elapsed_ms}


@app.get("/emoji-img/{name}")
def emoji_image(name: str) -> FileResponse:
    path = DATA_DIR / "openmoji" / Path(name).name  # .name でパストラバーサル防止
    if not path.is_file():
        raise HTTPException(status_code=404, detail="not found")
    return FileResponse(path, media_type="image/png")


@app.get("/", response_class=HTMLResponse)
def index() -> str:
    return (STATIC_DIR / "index.html").read_text(encoding="utf-8")
