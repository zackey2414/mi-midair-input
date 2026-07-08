// 精度評価モード:
//   お題の絵文字を順に手書き -> 画像検索(top-10) -> お題が top-1/5/10 に入ったかを記録し、
//   ヒット率と MRR を集計する。お題は /api/eval/targets (index に在る絵文字のみ) から取得。
//   ログは localStorage に貯め、右カラム下 (#evalLog) に描画する (ファイルは作らない)。
//   ✌️ 検索ジェスチャからも確定できるよう window.__evalActive / __evalSubmit を公開する。
import { $, clearPad, getPadCtx, searchImageRaw, setStatus, setLangSwitchEnabled } from "./core.js";

const EVAL_LOG_KEY = "emojiEvalLog";
const EVAL_TOPK = 10;
let state = { active: false, targets: [], idx: 0 };
let evalMode = false;   // 絵文字モード内で「評価サブモード」に入っているか

const loadLog = () => { try { return JSON.parse(localStorage.getItem(EVAL_LOG_KEY)) || []; } catch { return []; } };
const saveLog = (log) => localStorage.setItem(EVAL_LOG_KEY, JSON.stringify(log.slice(-200)));  // 肥大防止

function setActive(on) {
  state.active = on;
  window.__evalActive = on;                     // modes/emoji.js の ✌️ 分岐が参照
  const start = $("evalStartBtn"), stop = $("evalStopBtn"), box = $("evalTargetBox");
  if (start) start.style.display = on ? "none" : "";
  if (stop) stop.style.display = on ? "" : "none";
  if (box) box.style.display = on ? "" : "none";
}

// 絵文字モード内の左カラム表示を一括制御 (core.js の setInputMode から呼ばれる):
//   非絵文字        -> 評価UIは全部隠す (評価サブモードも解除)
//   絵文字/通常      -> 検索結果+テキスト検索+「この絵で検索」を表示、評価パネル隠す、ボタン「絵文字入力評価」
//   絵文字/評価サブ  -> 上記の検索UIを隠す、評価パネル表示、ボタン「通常入力に戻る」
export function applyEmojiLayout(isEmoji) {
  if (!isEmoji && evalMode) { evalMode = false; setLangSwitchEnabled(true); setActive(false); }
  const showSearch = isEmoji && !evalMode;
  const set = (id, show) => { const e = $(id); if (e) e.style.display = show ? "" : "none"; };
  set("resultSettingPanel", showSearch);
  set("textSearchPanel", showSearch);
  set("drawActions", showSearch);              // カメラ窓の「この絵で検索/クリア」も通常時だけ
  set("evalPanel", isEmoji && evalMode);
  const btn = $("evalModeBtn");
  if (btn) {
    btn.style.display = isEmoji ? "" : "none";
    btn.textContent = evalMode ? "通常入力に戻る" : "絵文字入力評価";
  }
}

// 「絵文字入力評価」ボタン: 評価サブモードのオン/オフ。入るときは即お題を出す
// (検索UIを隠すのでスクロール無しでお題が見える)。抜けるときは評価セッションも止める。
export function toggleEvalMode() {
  evalMode = !evalMode;
  setLangSwitchEnabled(!evalMode);              // 評価中は手首フリックの言語切替を無効化、抜けたら復帰
  applyEmojiLayout(true);                       // このボタンは絵文字モード中のみ表示
  if (evalMode) startEval();
  else setActive(false);
}

export async function startEval() {
  const n = Math.max(1, parseInt($("evalN").value, 10) || 10);
  const group = $("evalGroup").value;
  setStatus("お題を取得中…");
  let data;
  try { data = await (await fetch(`/api/eval/targets?n=${n}&group=${encodeURIComponent(group)}`)).json(); }
  catch (e) { setStatus("お題取得エラー: " + e); return; }
  if (!data.targets || !data.targets.length) { setStatus("お題が取得できませんでした"); return; }
  state = { active: true, targets: data.targets, idx: 0 };
  setActive(true);
  clearPad();
  showTarget();
}

export function stopEval() {
  setActive(false);
  setStatus("評価を中止しました");
  renderEvalLog();
}

function showTarget() {
  const tg = state.targets[state.idx];
  const p = $("evalProgress"); if (p) p.textContent = `お題 ${state.idx + 1} / ${state.targets.length}`;
  const img = $("evalTargetImg"); if (img) img.src = tg.image_url;
  const lab = $("evalTargetLabel"); if (lab) lab.textContent = `${tg.emoji} ${tg.label}`;
  setStatus(`お題「${tg.label}」を描いてください`);
}

function padBlank() {
  const c = getPadCtx(); if (!c) return true;
  const cv = c.canvas, d = c.getImageData(0, 0, cv.width, cv.height).data;
  for (let i = 0; i < d.length; i += 4) if (d[i] < 250 || d[i + 1] < 250 || d[i + 2] < 250) return false;
  return true;
}

function padThumb(w = 160) {
  const src = getPadCtx().canvas;
  const h = Math.round(w * src.height / src.width);
  const t = document.createElement("canvas"); t.width = w; t.height = h;
  const g = t.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, w, h);
  g.drawImage(src, 0, 0, w, h);
  return t.toDataURL("image/png");
}

// ✌️ / ボタンからの確定: 検索して順位を記録し、次のお題へ進む。
export async function evalSubmit() {
  if (!state.active) return;
  if (padBlank()) { setStatus("先にお題を描いてください"); return; }
  setStatus("検索中…");
  let results;
  try { results = await searchImageRaw(EVAL_TOPK); }
  catch (e) { setStatus("検索エラー: " + e); return; }
  const tg = state.targets[state.idx];
  let rank = null;
  for (let i = 0; i < results.length; i++) if (results[i].id === tg.hexcode) { rank = i + 1; break; }
  const log = loadLog();
  log.push({
    ts: Date.now(), target: tg, drawing: padThumb(), rank,
    results: results.slice(0, EVAL_TOPK).map((r) => ({
      id: r.id, emoji: r.emoji, label: r.label, score: r.score, image_url: r.image_url,
    })),
  });
  saveLog(log);
  state.idx++;
  if (state.idx >= state.targets.length) { setActive(false); setStatus("評価セッション完了。下に集計を表示しました。"); }
  else { clearPad(); showTarget(); }
  renderEvalLog();
}

export function evalClearLog() {
  if (!confirm("評価ログを全消去します。よろしいですか？")) return;
  localStorage.removeItem(EVAL_LOG_KEY);
  renderEvalLog();
}

function rankBadge(rank) {
  if (rank === 1) return `<span class="badge b1">Top-1</span>`;
  if (rank && rank <= 5) return `<span class="badge b5">Top-5 (#${rank})</span>`;
  if (rank && rank <= 10) return `<span class="badge b10">Top-10 (#${rank})</span>`;
  return `<span class="badge bmiss">圏外</span>`;
}

export function renderEvalLog() {
  const box = $("evalLog"); if (!box) return;
  const log = loadLog();
  if (!log.length) { box.innerHTML = ""; return; }
  const n = log.length;
  const c1 = log.filter((t) => t.rank === 1).length;
  const c5 = log.filter((t) => t.rank && t.rank <= 5).length;
  const c10 = log.filter((t) => t.rank && t.rank <= 10).length;
  const mrr = log.reduce((s, t) => s + (t.rank ? 1 / t.rank : 0), 0) / n;
  const pct = (x) => `${(100 * x / n).toFixed(1)}%`;
  let html = `
    <div class="eval-summary">
      <h2>評価ログ集計 <button onclick="evalClearLog()" style="float:right">ログ消去</button></h2>
      <div class="stats">
        <div class="stat"><div class="v">${n}</div><div class="k">試行数</div></div>
        <div class="stat"><div class="v">${pct(c1)}</div><div class="k">Top-1 (${c1}/${n})</div></div>
        <div class="stat"><div class="v">${pct(c5)}</div><div class="k">Top-5 (${c5}/${n})</div></div>
        <div class="stat"><div class="v">${pct(c10)}</div><div class="k">Top-10 (${c10}/${n})</div></div>
        <div class="stat"><div class="v">${mrr.toFixed(3)}</div><div class="k">MRR</div></div>
      </div>
    </div>
    <table class="eval-table">
      <thead><tr><th>お題</th><th>描画</th><th>結果</th><th>top-10 (左=1位 / 緑枠=お題)</th></tr></thead>
      <tbody>`;
  for (const t of log.slice().reverse()) {
    const resImgs = t.results.map((r) => {
      const hit = r.id === t.target.hexcode ? " hit" : "";
      return `<img class="res${hit}" src="${r.image_url}" title="${r.label} (${r.score})" loading="lazy" />`;
    }).join("");
    html += `<tr>
      <td class="tgt"><img src="${t.target.image_url}" loading="lazy" /><div>${t.target.emoji} ${t.target.label}</div></td>
      <td><img class="draw" src="${t.drawing}" /></td>
      <td>${rankBadge(t.rank)}</td>
      <td class="resrow">${resImgs}</td>
    </tr>`;
  }
  html += `</tbody></table>`;
  box.innerHTML = html;
}

// 起動時: 既存ログ描画 + ✌️ 用サブミットを公開
export function initEval() {
  window.__evalActive = false;
  window.__evalSubmit = evalSubmit;
  renderEvalLog();
}
