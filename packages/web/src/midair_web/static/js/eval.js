// 精度評価モード:
//   お題の絵文字を順に手書き -> 画像検索(top-10) -> お題が top-1/5/10 に入ったかを記録し、
//   ヒット率と MRR を集計する。お題は /api/eval/targets (index に在る絵文字のみ) から取得。
//   ログは localStorage に貯め、右カラム下 (#evalLog) に描画する (ファイルは作らない)。
//   ✌️ 検索ジェスチャからも確定できるよう window.__evalActive / __evalSubmit を公開する。
import { $, clearPad, getPadCtx, searchImageRaw, setStatus, setLangSwitchEnabled, setSearchModel } from "./core.js";

const EVAL_LOG_KEY = "emojiEvalLog";
const EVAL_TOPK = 10;
let state = { active: false, targets: [], idx: 0 };
let evalMode = false;   // 絵文字モード内で「評価サブモード」に入っているか
let shownAt = 0;                            // お題表示時刻 (入力完了までの時間の計測用)
let models = [];                            // /api/models の一覧
let modelInfo = { key: null, label: "?" };  // 現在選択中の検索モデル
let limitSec = 0;                           // 描画制限時間(秒)。0=無制限
let deadline = 0;                           // 制限モードの締切時刻 (performance.now 基準)
let tickTimer = null, limitTimer = null;    // カウントダウン表示 / 強制検索タイマ
let busy = false;                           // 二重サブミット防止 (タイマ発火とボタンの競合対策)

const loadLog = () => { try { return JSON.parse(localStorage.getItem(EVAL_LOG_KEY)) || []; } catch { return []; } };
const saveLog = (log) => localStorage.setItem(EVAL_LOG_KEY, JSON.stringify(log.slice(-200)));  // 肥大防止

function setActive(on) {
  state.active = on;
  window.__evalActive = on;                     // modes/emoji.js の ✌️ 分岐が参照
  if (!on) clearCountdown();                     // セッション終了/中止でタイマを止める
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

// 「絵文字入力評価」ボタン: 評価サブモードのオン/オフ。入るときは設定パネル(試行数/ジャンル/
// モデル/制限)を開いた状態で待機し、お題取得・計測は「評価開始」ボタン(startEval)で始める。
// 抜けるときは評価セッションも止める。
export function toggleEvalMode() {
  evalMode = !evalMode;
  setLangSwitchEnabled(!evalMode);              // 評価中は手首フリックの言語切替を無効化、抜けたら復帰
  applyEmojiLayout(true);                       // このボタンは絵文字モード中のみ表示
  setActive(false);                             // 設定を表示して待機(入る)/セッション停止(抜ける)。開始は startEval()
  if (evalMode) setStatus("設定を選び「評価開始」を押してください");
}

export async function startEval() {
  const n = Math.max(1, parseInt($("evalN").value, 10) || 10);
  const group = $("evalGroup").value;
  const limSel = $("evalLimit");
  limitSec = limSel ? Math.max(0, parseInt(limSel.value, 10) || 0) : 0;   // セッションの制限時間を固定
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
  shownAt = performance.now();   // ここから確定までを「入力にかかった時間」とする
  startCountdown();              // 制限モードなら 5s 等のカウントダウン開始 (0=無制限は何もしない)
}

// 制限モードのカウントダウン: 表示を更新し、締切で強制的に検索(evalSubmit(true))する。
function clearCountdown() {
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  if (limitTimer) { clearTimeout(limitTimer); limitTimer = null; }
  const el = $("evalCountdown"); if (el) { el.textContent = ""; el.classList.remove("urgent"); }
}
function startCountdown() {
  clearCountdown();
  const el = $("evalCountdown");
  if (!limitSec) return;                         // 無制限
  deadline = performance.now() + limitSec * 1000;
  const render = () => {
    if (!el) return;
    const r = Math.max(0, (deadline - performance.now()) / 1000);
    el.textContent = `⏱ 残り ${r.toFixed(1)}s`;
    el.classList.toggle("urgent", r <= 1.5);
  };
  render();
  tickTimer = setInterval(render, 100);
  limitTimer = setTimeout(() => evalSubmit(true), limitSec * 1000);
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

// 確定: 検索して順位を記録し、次のお題へ進む。
//   forced=false … ✌️ / ボタンからの通常確定 (空描画は弾く)。
//   forced=true  … 制限時間切れの強制確定 (空でも記録: 未描画なら検索せず圏外扱い)。
export async function evalSubmit(forced = false) {
  if (!state.active || busy) return;
  const blank = padBlank();
  if (blank && !forced) { setStatus("先にお題を描いてください"); return; }  // 空クリックはカウントダウン継続
  clearCountdown();                                   // 確定するのでタイマ停止 (時間切れとの二重発火も防ぐ)
  busy = true;
  const drawMs = performance.now() - shownAt;         // お題表示→確定 = 入力にかかった時間
  const tg = state.targets[state.idx];
  let results = [], searchMs = null, rank = null;
  if (!blank) {                                       // 未描画(時間切れ)は検索せず圏外(rank=null)で記録
    setStatus("検索中…");
    try { ({ results, searchMs } = await searchImageRaw(EVAL_TOPK)); }
    catch (e) { setStatus("検索エラー: " + e); busy = false; startCountdown(); return; }
    for (let i = 0; i < results.length; i++) if (results[i].id === tg.hexcode) { rank = i + 1; break; }
  }
  const log = loadLog();
  log.push({
    ts: Date.now(), target: tg, drawing: padThumb(), rank,
    model: modelInfo, drawMs, searchMs, limitSec, timedOut: forced, blank,
    results: results.slice(0, EVAL_TOPK).map((r) => ({
      id: r.id, emoji: r.emoji, label: r.label, score: r.score, image_url: r.image_url,
    })),
  });
  saveLog(log);
  state.idx++;
  busy = false;
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
  if (rank && rank <= 3) return `<span class="badge b3">Top-3 (#${rank})</span>`;
  if (rank && rank <= 5) return `<span class="badge b5">Top-5 (#${rank})</span>`;
  if (rank && rank <= 10) return `<span class="badge b10">Top-10 (#${rank})</span>`;
  return `<span class="badge bmiss">圏外</span>`;
}

function aggregate(ts) {
  const n = ts.length;
  const le = (k) => ts.filter((t) => t.rank && t.rank <= k).length;   // rank<=k の件数
  const c1 = ts.filter((t) => t.rank === 1).length;
  const mrr = ts.reduce((s, t) => s + (t.rank ? 1 / t.rank : 0), 0) / n;
  const avgDraw = ts.reduce((s, t) => s + (t.drawMs || 0), 0) / n;
  // 検索時間は「実際に検索した試行」だけで平均 (未描画=検索なしは除外)
  const searched = ts.filter((t) => t.searchMs != null);
  const avgSearch = searched.length ? searched.reduce((s, t) => s + t.searchMs, 0) / searched.length : 0;
  return { n, c1, c3: le(3), c5: le(5), c10: le(10), mrr, avgDraw, avgSearch };
}

const limitLabel = (lim) => (lim ? `${lim}s` : "無制限");

export function renderEvalLog() {
  const box = $("evalLog"); if (!box) return;
  const log = loadLog();
  if (!log.length) { box.innerHTML = ""; return; }

  // --- モデル × 制限時間 別の集計 (実験の 6 パターン比較) ---
  const byGroup = new Map();
  for (const t of log) {
    const ml = (t.model && t.model.label) || "?";
    const lim = t.limitSec || 0;
    const key = ml + "||" + lim;
    if (!byGroup.has(key)) byGroup.set(key, { ml, lim, ts: [] });
    byGroup.get(key).ts.push(t);
  }
  const groups = [...byGroup.values()].sort((a, b) => a.ml.localeCompare(b.ml) || a.lim - b.lim);
  const p = (x, n) => `${(100 * x / n).toFixed(0)}%`;
  let cmp = `<table class="eval-table"><thead><tr>
      <th>モデル</th><th>制限</th><th>試行</th><th>Top-1</th><th>Top-3</th><th>Top-5</th><th>Top-10</th><th>MRR</th>
      <th>平均入力</th><th>平均検索</th></tr></thead><tbody>`;
  for (const g of groups) {
    const s = aggregate(g.ts);
    cmp += `<tr><td><b>${g.ml}</b></td><td>${limitLabel(g.lim)}</td><td>${s.n}</td>
      <td>${p(s.c1, s.n)}</td><td>${p(s.c3, s.n)}</td><td>${p(s.c5, s.n)}</td><td>${p(s.c10, s.n)}</td>
      <td>${s.mrr.toFixed(3)}</td>
      <td>${(s.avgDraw / 1000).toFixed(1)}s</td><td>${Math.round(s.avgSearch)}ms</td></tr>`;
  }
  cmp += `</tbody></table>`;

  // --- 各試行の詳細 ---
  let rows = "";
  for (const t of log.slice().reverse()) {
    const resImgs = t.results.map((r) => {
      const hit = r.id === t.target.hexcode ? " hit" : "";
      return `<img class="res${hit}" src="${r.image_url}" title="${r.label} (${r.score})" loading="lazy" />`;
    }).join("");
    const ml = (t.model && t.model.label) || "?";
    const cond = limitLabel(t.limitSec || 0)
      + (t.timedOut ? " ⏱時間切れ" : "") + (t.blank ? " ·未描画" : "");
    const dsec = t.drawMs != null ? `${(t.drawMs / 1000).toFixed(1)}s` : "-";
    const sms = t.searchMs != null ? `${Math.round(t.searchMs)}ms` : "-";
    rows += `<tr>
      <td class="tgt"><img src="${t.target.image_url}" loading="lazy" /><div>${t.target.emoji} ${t.target.label}</div></td>
      <td><img class="draw" src="${t.drawing}" /></td>
      <td>${rankBadge(t.rank)}<div class="trial-meta">${ml} · ${cond}<br>入力 ${dsec} / 検索 ${sms}</div></td>
      <td class="resrow">${resImgs}</td>
    </tr>`;
  }

  box.innerHTML = `
    <div class="eval-summary">
      <h2>モデル別 集計 <button onclick="evalClearLog()" style="float:right">ログ消去</button></h2>
      ${cmp}
    </div>
    <table class="eval-table" style="margin-top:20px">
      <thead><tr><th>お題</th><th>描画</th><th>結果 / モデル・時間</th><th>top-10 (左=1位 / 緑枠=お題)</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// /api/models からモデル一覧を取ってセレクトに反映し、選択を検索モデルに反映する。
async function initModelSelect() {
  const sel = $("evalModel");
  if (!sel) return;
  try {
    const data = await (await fetch("/api/models")).json();
    models = data.models || [];
    sel.innerHTML = "";
    for (const m of models) {
      const o = document.createElement("option");
      o.value = m.key;
      o.textContent = `${m.label} (${m.dim}d)`;
      sel.appendChild(o);
    }
    sel.value = data.default;
    applyModel(sel.value);
    sel.onchange = () => applyModel(sel.value);
  } catch (e) { /* モデル一覧が取れなければ既定モデルのまま検索 */ }
}
function applyModel(key) {
  const m = models.find((x) => x.key === key) || { key, label: key };
  modelInfo = { key: m.key, label: m.label };
  setSearchModel(m.key);
}

// 起動時: モデル一覧の反映 + 既存ログ描画 + ✌️ 用サブミットを公開
export function initEval() {
  window.__evalActive = false;
  window.__evalSubmit = evalSubmit;
  initModelSelect();
  renderEvalLog();
}
