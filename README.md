# Mid-Air Flick Input System

A system for entering **emoji / Japanese / English** via mid-air flick gestures.
Each modality is developed independently as a separate subsystem, then bundled into a single integrated app (`midair`).

> ⚠️ **This branch `tmp-demo-app` is an integration staging (demo) branch.**
> Built on top of `main`, it adds emoji-search improvements — **switching / comparing 3 vision encoders (CLIP ViT-B/32 / B/16 / L/14)**, a **Top-K / search-time accuracy-evaluation page**, and a **reduced emoji DB (783 items, dropping rarely used emoji)**.
> It also lets you hands-on test the mid-air flick input mechanics (fold-based Japanese/English input, language switching via hand rotation, an input test page, Japanese/English UI toggle). Fingering configurations and thresholds are **adjustable from the UI** — this is not a stable release.

**Character recognition (hand detection → gesture/flick interpretation → character commit) runs entirely in the browser frontend (`index.html` / `static/js`).** The backend (CLIP embedding + FAISS nearest-neighbor search in `emoji-search`) is only needed for modalities that **recognize and search trajectories or text to find candidates** — like emoji. Flick-based kana input and language-switch motions that deterministically map gestures to characters are frontend-only, with no backend required.

## Subsystems

| Modality | Package | Status | Overview |
|---|---|---|---|
| Emoji input | `emoji-search` | **Implemented (v0) / 3-model comparison** | Embeds OpenMoji with CLIP; search by text / handwriting / camera. **Switchable across ViT-B/32 · B/16 · L/14, with an accuracy-evaluation page** |
| Japanese input | Prototype in Web UI | **Fold-input demo** | Select a row by folding fingers (binary fingering) + flick for the vowel → confirm with open palm. Frontend-only. |
| English input | Prototype in Web UI | **Fold-input demo** | Select a row (1–11) with the same fold engine + flick for the letter. Frontend-only. |

> The Japanese/English "prototypes" refer to the Web UI implementation (no backend packages yet). See [`docs/fold_input_demo.md`](docs/fold_input_demo.md) and [`docs/japanese_input.md`](docs/japanese_input.md).

The shared foundation `midair-shared` provides the **encoder contract / FAISS utilities / integration contract (`Searcher`)**.
The integrated app `midair-app` lazily loads and dispatches to each subsystem based on `mode`.
The browser UI is served by `midair-web` (FastAPI) — text / handwritten / camera mid-air input, results displayed as images, async search.

### 3-model comparison / accuracy evaluation (focus of this branch)

- Emoji search can be switched across **CLIP ViT-B/32 (default) / B/16 / L/14** and compared. All three are **baked into the image at build time**; the web app registers them via the `MIDAIR_MODELS` env var (and returns the list from `/api/models`).
- Indexes are stored per model in **`data/` (B/32) / `data-vitb16/` / `data-vitl14/`** — the index-build and the search must use the same model (a shared embedding space is assumed).
- **Accuracy-evaluation page**: draw a prompt emoji by hand → search → record Top-1/5/10 hit and search time, then aggregate. Enter it via the "**Emoji Input Evaluation**" button on the right panel; choose the backbone from the **model selector** inside the panel.
- The emoji DB is a **reduced version (783 items)**, dropping rarely used emoji.

## Repository Structure (uv workspace monorepo)

```
mi-midair-input/
├── pyproject.toml              # uv workspace root (package=false, members=packages/*)
├── README.md / CLAUDE.md
├── Dockerfile / docker-compose.yml / .dockerignore
├── scripts/run-web.sh          # Docker launcher (auto-selects an available port)
├── docs/                        # Documentation
│   └── emoji_search/            #   DOCKER.md / experiment plans
├── packages/
│   ├── shared/                 # midair-shared: shared foundation (encoder.py / index.py / search.py)
│   ├── emoji-search/           # Emoji input (download_openmoji.py / build_index.py / searcher.py)
│   ├── app/                    # midair-app: integrated CLI (`midair`)
│   └── web/                    # midair-web: Web app (FastAPI, async search)
│       └── src/midair_web/     #   app.py (/api/models, etc.) / static/{index.html, js/, game.html}
├── data/                        # Not tracked by git. ViT-B/32 index + display openmoji
│   └── emoji_search/           #   openmoji/ + openmoji.json + index.faiss + metadata.jsonl + index_meta.json
├── data-vitb16/                 # Not tracked. ViT-B/16 index (separate mount)
│   └── emoji_search/           #   index.faiss + metadata.jsonl + index_meta.json
└── data-vitl14/                 # Not tracked. ViT-L/14 index (separate mount)
    └── emoji_search/           #   index.faiss + metadata.jsonl + index_meta.json
```

Display images are served only from the base `data/emoji_search/openmoji/`; only the indexes are split into per-model directories.

---

# How to Run

**3-model comparison requires Docker** (the models are baked into the image). The uv method is for local development and defaults to a single model (B/32).

| Method | Best for | Notes |
|---|---|---|
| **[A. Docker](#a-run-with-docker-recommended)** | Distribution, reproducibility, 3-model comparison | CPU-only torch; 3 CLIP models / MediaPipe baked in → nearly offline at runtime. Intel Mac runs natively; Apple Silicon via amd64 emulation |
| **[B. uv](#b-run-with-uv-for-contributors)** | Modifying Python code | Hot reload, etc. Single model by default; CLIP fetched on first run |

Emoji search needs:

- **OpenMoji images** — for displaying results (from official Releases)
- **Drive FAISS indexes (all 3 models)** — for search. Pre-built indexes are shared via Drive to avoid running heavy CLIP inference on every machine.
- **MediaPipe (Hand Landmarker)** — only for camera mid-air input (baked in at A-1 for Docker)

> If `data*/emoji_search/` already has the indexes (e.g., copied from another machine), skip data prep and go straight to startup.

---

## A. Run with Docker (Recommended)

### A-1. Build the image

```bash
docker compose build
```

- Installs CPU-only torch / transformers / faiss and bakes **3 CLIP models (ViT-B/32 / B/16 / L/14)** into the image. Because the 3 models total ~3 GB downloaded from HuggingFace, the first build takes **tens of minutes**.
- **MediaPipe JS / wasm / model files are also bundled at build time** (`Dockerfile` runs `fetch_mediapipe.py`) → camera mid-air input works **offline with no extra setup**.
- ⚠️ **Large HF downloads often stall while on a VPN** (compounded by unauthenticated HF rate limits — it can hang at 0 bytes). **Disconnect the VPN before building.** Setting `HF_TOKEN` makes it faster. The CLIP `RUN` step cannot resume a partial download, so if it stalls, stop it, drop the VPN, and rebuild.

### A-1b. Ship the built image to other environments (optional, faster)

To avoid re-downloading the 3 models (tens of minutes) on every environment, transfer the built image instead:

```bash
# On the machine that already built it
docker save midair-input:latest | gzip > midair-img.tar.gz
# On the other machine (no build needed)
gunzip -c midair-img.tar.gz | docker load
```

→ That machine can skip A-1 and only run A-2 (fetch) + A-3 (start).

### A-2. Prepare data (OpenMoji images + Drive indexes for all 3 models)

```bash
docker compose --profile setup run --rm fetch
#   -> data/emoji_search/{openmoji/, openmoji.json, index.faiss, metadata.jsonl, index_meta.json}  # ViT-B/32
#   -> data-vitb16/emoji_search/{index.faiss, metadata.jsonl, index_meta.json}                      # ViT-B/16
#   -> data-vitl14/emoji_search/{index.faiss, metadata.jsonl, index_meta.json}                      # ViT-L/14
```

- The `fetch` service runs `download_openmoji.py` (display images) + **`gdown` on 3 Drive folders** (all 3 models in one command):
  - `data`        ← `1GPY8HoBWiTls_NgCLLpe7ej4-Ue1DYGp`
  - `data-vitb16` ← `17EnB_MTdp6TOCfloyOaYDPmyHbhDhO2d`
  - `data-vitl14` ← `1OL2IqQBFC8QwN07M6lPmkWrOr8KufBCh`
  - Parent shared folder: <https://drive.google.com/drive/folders/12fiVE0QkZdJ3L72cWHAkiU8WorMGdLbu>
- `gdown` **overwrites** existing files, so a re-fetch replaces any stale index with the current reduced DB (783 items).
- **MediaPipe was baked in at A-1 — nothing to do here.**

To build the 3-model indexes locally via in-container CLIP inference (heavy):

```bash
docker compose --profile setup run --rm prepare
```

> ⚠️ `prepare` (`build_index.py`) builds the **full DB (all emoji)**. The distributed **reduced version (783 items: 3 groups + skin-tone exclusion) has no committed reproduction procedure** and is currently **distributed only as a Drive artifact** — so use the A-2 `fetch` if you need the reduced DB. A filter in `build_index.py` is planned for reproducibility.

### A-3. Start (auto port assignment)

**Recommended: `scripts/run-web.sh`** — a wrapper that **picks an available port first, then calls `docker compose up`**, and prints the URL:

```bash
scripts/run-web.sh               # Pick a free port (from 8762), start, print URL
scripts/run-web.sh -d            # Background (extra args passed to compose)
```

To fix the port, use `docker compose` directly (**fails if 8762 is taken**, and does not print the URL):

```bash
docker compose up web            # Default http://localhost:8762 (container port 8000)
docker compose up -d web         # Background
MIDAIR_WEB_PORT=9000 docker compose up web   # Manual port override
docker compose down              # Stop
```

### A-4. Using the app

- Open the URL shown (default http://localhost:8762) **in a browser**. Search via text input, handwritten canvas, or camera mid-air input; results appear as a grid of emoji images (search is an async job).
- **Switch backbone (model)**: click "**Emoji Input Evaluation**" on the right panel → pick **ViT-B/32 / B/16 / L/14** from the "Model" selector inside the panel. Subsequent searches use the selected model, and you can record accuracy (Top-K / search time).
- The frontend (`index.html` / `static/js`) is **bind-mounted from the host**, so edits reflect with **no rebuild — just hard-reload the browser** (only changes to the Python `app.py` require a rebuild).
- **One-shot CLI**:
  ```bash
  docker compose run --rm web midair --mode emoji --query "cat" --top-k 5
  ```

See [`docs/emoji_search/DOCKER.md`](docs/emoji_search/DOCKER.md) for details.

---

## B. Run with uv (for contributors)

For modifying Python code. Defaults to a **single model (B/32)** (3-model comparison assumes Docker's `MIDAIR_MODELS`). Requires [uv](https://docs.astral.sh/uv/).

### B-0. Setup

```bash
uv sync          # Install all workspace packages into a single shared venv
uv run python -c "import torch, transformers, faiss; print('ok')"
```

### B-1. Download OpenMoji images (for display)

```bash
uv run python packages/emoji-search/scripts/download_openmoji.py
#   -> data/emoji_search/{openmoji/, openmoji.json}   (idempotent: skips existing, --force to re-fetch)
```

### B-2. Download the FAISS index from Drive (for search, B/32)

```bash
uvx gdown --folder "https://drive.google.com/drive/folders/1GPY8HoBWiTls_NgCLLpe7ej4-Ue1DYGp" -O data
#   -> data/emoji_search/{index.faiss, metadata.jsonl, index_meta.json}   (reduced DB, 783 items, ViT-B/32)
```

- To compare all three, also fetch `-O data-vitb16` (`17EnB_MTdp6TOCfloyOaYDPmyHbhDhO2d`) and `-O data-vitl14` (`1OL2IqQBFC8QwN07M6lPmkWrOr8KufBCh`), then set `MIDAIR_MODELS` at startup (Docker's A-2 does all of this in one command).
- Search assumes the **same CLIP model** as `index_meta.json`'s `model_id` (indexes are device-independent and portable).

To build the index locally from scratch (from line-art source, heavy CLIP inference):

```bash
uv run python packages/emoji-search/scripts/download_openmoji.py --variant both
uv run python packages/emoji-search/scripts/build_index.py --source-variant black
```

### B-3. Download MediaPipe (only for camera mid-air input)

```bash
uv run python packages/web/scripts/fetch_mediapipe.py
#   -> packages/web/src/midair_web/static/vendor/mediapipe/ (idempotent, --force to re-fetch)
```

### B-4. Using the app

```bash
uv run midair-doctor   # Check deps / OpenMoji / index / MediaPipe / web prerequisites at once

uv run midair-web      # Web app (default http://127.0.0.1:8762, shifts to the next free port if taken)
#   --port <start> / --strict-port / --reload / --host

uv run midair --mode emoji --query "cat" --top-k 5   # Integrated CLI
#   0.250  🐈‍⬛  1F408-200D-2B1B  black cat
#   0.246  🐈️  1F408            cat
uv run midair --mode japanese --query "..."   # Not implemented (skeleton, exits 2)
uv run midair --mode english  --query "..."   # Not implemented (skeleton, exits 2)
```

See [`packages/emoji-search/README.md`](packages/emoji-search/README.md) and [`packages/web/README.md`](packages/web/README.md).

---

## Troubleshooting

### `docker compose build` never finishes

Almost always a **stalled ~3 GB download caused by a VPN + unauthenticated HF**. If the stuck BuildKit line is `[N/M] RUN python -c "from transformers import CLIPModel…"` (the 3-model bake), that's it. **Disconnect the VPN** and rerun (the CLIP `RUN` can't resume, so stop it, drop the VPN, and retry). Setting `HF_TOKEN` lifts the rate limit and speeds it up.

### All web buttons become unresponsive after an edit (Docker Desktop for Mac)

Editing `index.html` can make the container serve a truncated `index.html` whose trailing `<script src="core.js">` tag is cut off (bind-mount sync issue) → `core.js` never loads, no handlers register, and all buttons die.

```bash
docker compose restart web    # Re-establish the mount. For JS-only edits, a browser hard-reload is enough.
```

### Hugging Face warnings appear

```text
Warning: You are sending unauthenticated requests to the HF Hub.
```

Unauthenticated access can be slower or rate-limited — it does not mean failure. If a local build is just slow, fetch from Drive instead (A-2 / B-2).

### Camera error for `vision_bundle.mjs`

MediaPipe static files are missing, or the server wasn't restarted after fetching them. Run `uv run python packages/web/scripts/fetch_mediapipe.py`, restart the server, then hard-reload the browser.

### Just want to check if all artifacts are present

```bash
uv run midair-doctor
```

---

## Documentation

- [`docs/fold_input_demo.md`](docs/fold_input_demo.md) — Fold-based Japanese/English input, language switching, input test, UI language toggle, tunable parameters
- [`docs/japanese_input.md`](docs/japanese_input.md) — Japanese fold-input: fingering, parameters, internal spec
- [`docs/architecture.md`](docs/architecture.md) — Overall architecture / package scopes and boundaries / integration seam
- [`docs/emoji_search/DOCKER.md`](docs/emoji_search/DOCKER.md) — Local Docker execution (Mac / CPU)
- [`docs/emoji_search/experiment-domain-matched-index.md`](docs/emoji_search/experiment-domain-matched-index.md) — Experiment plan for a handwriting-domain-matched index
- [`CLAUDE.md`](CLAUDE.md) — System architecture / development flow (git-flow) / agent guidelines
- `packages/*/README.md` — Per-subsystem details

## License

OpenMoji emoji data is licensed under **CC BY-SA 4.0** (attribution required when redistributing).
