// 日本語入力 (新方式):
//   行未ロック時: グー / パー = レスト (入力待ち)
//   中間状態 (T/I/M のいずれかを伸展) + orientation(0°/90°) → 行選択
//   フリック(手を動かす) → 方向を即自動確定
//   グー(握る) → あ段を即確定 (濁点サイクルへは繋がらないシンプルな確定)
//   フリップ(指を伸ばしたまま中央で手首をひねる) → あ段を確定 (濁点があれば素の文字を経由せず濁点形から開始)
//   確定直後、同じポーズのままもう一度フリップ → 濁点/半濁点/元 をさらにサイクル
//   フリップ中(ロール角がニュートラルから外れている間)は姿勢判定(グー/パー/行)を凍結し、
//   指の見え方が乱れても誤爆しないようにする
//   CommonGestures delete (グーを握ってひねる) → 1文字削除 / 全削除
import { LM } from "../config.js";
import {
  dist, fingerUp, $, clearPadCursor, drawPadCursor, setGesture, setCameraState, applyLangCamState,
} from "../core.js";
import { t, dirLabels } from "../i18n.js";

// --- 調整用しきい値 ---
let HOLD_MS    = 150;   // 行選択ポーズをこの ms 保持でロック
let FLICK_DIST = 0.07;  // 基準点からこの距離を超えたらフリック検知 / 戻り判定も同じ距離

// --- かな表 (行の基準字 → [中央, 左, 上, 右, 下]) ---
const ROWS = {
  "あ": ["あ", "い", "う", "え", "お"],
  "か": ["か", "き", "く", "け", "こ"],
  "さ": ["さ", "し", "す", "せ", "そ"],
  "た": ["た", "ち", "つ", "て", "と"],
  "な": ["な", "に", "ぬ", "ね", "の"],
  "は": ["は", "ひ", "ふ", "へ", "ほ"],
  "ま": ["ま", "み", "む", "め", "も"],
  "や": ["や", "（", "ゆ", "）", "よ"],
  "ら": ["ら", "り", "る", "れ", "ろ"],
  "わ": ["わ", "を", "ん", "ー", "〜"],
  "、": ["　", "、", "。", "？", "！"],
};
// フリック方向ラベルは i18n の dirLabels() から取得 (中央/左… ⇄ Center/Left…)

// --- 濁音/半濁音/小 のループ ---
const DAKUTEN_CYCLES = [
  "あぁ", "いぃ", "うゔぅ", "えぇ", "おぉ",
  "かが", "きぎ", "くぐ", "けげ", "こご",
  "さざ", "しじ", "すず", "せぜ", "そぞ",
  "ただ", "ちぢ", "つづっ", "てで", "とど",
  "はばぱ", "ひびぴ", "ふぶぷ", "へべぺ", "ほぼぽ",
  "やゃ", "ゆゅ", "よょ", "わゎ",
];
const DAKUTEN_NEXT = {};
for (const cyc of DAKUTEN_CYCLES) {
  const arr = [...cyc];
  for (let i = 0; i < arr.length; i++) DAKUTEN_NEXT[arr[i]] = arr[(i + 1) % arr.length];
}

// フリップ修飾用マップ (サイクル順: 小文字 → 濁点 → 半濁点 → なし)
const KOGAKI_MAP = Object.fromEntries([
  ["あ","ぁ"],["い","ぃ"],["う","ぅ"],["え","ぇ"],["お","ぉ"],
  ["つ","っ"],
  ["や","ゃ"],["ゆ","ゅ"],["よ","ょ"],
  ["わ","ゎ"],
]);
const DAKUTEN_MAP = Object.fromEntries([
  ["か","が"],["き","ぎ"],["く","ぐ"],["け","げ"],["こ","ご"],
  ["さ","ざ"],["し","じ"],["す","ず"],["せ","ぜ"],["そ","ぞ"],
  ["た","だ"],["ち","ぢ"],["つ","づ"],["て","で"],["と","ど"],
  ["は","ば"],["ひ","び"],["ふ","ぶ"],["へ","べ"],["ほ","ぼ"],
]);
const HANDAKUTEN_MAP = Object.fromEntries([
  ["は","ぱ"],["ひ","ぴ"],["ふ","ぷ"],["へ","ぺ"],["ほ","ぽ"],
]);

// --- 運指テーブル: extend(T/I/M/P の組み合わせ) → 行 ---
export const DEFAULT_ROW_MAP = [
  { row: "あ", extend: ["T"]                },
  { row: "か", extend: ["I"]                },
  { row: "さ", extend: ["T", "I"]           },
  { row: "た", extend: ["I", "M"]           },
  { row: "な", extend: ["T", "I", "M"]      },
  { row: "は", extend: ["T", "P"]           },
  { row: "ま", extend: ["I", "P"]           },
  { row: "や", extend: ["T", "I", "P"]      },
  { row: "ら", extend: ["I", "M", "P"]      },
  { row: "わ", extend: ["T", "I", "M", "P"] },
  { row: "、", extend: ["P"]               },
];
export let rowMap = JSON.parse(JSON.stringify(DEFAULT_ROW_MAP));

const EXTEND_ORDER = ["T", "I", "M", "R", "P"];
export function canonExtend(arr) { return EXTEND_ORDER.filter((f) => arr.includes(f)).join(""); }

function extendedKey(hand) {
  const s = [];
  if (hand.fingers.thumb)  s.push("T");
  if (hand.fingers.index)  s.push("I");
  if (hand.fingers.middle) s.push("M");
  if (hand.fingers.ring)   s.push("R");
  if (hand.fingers.pinky)  s.push("P");
  return s.join("");
}

// extend → 行名 (マッチなければ null)
function extendToRow(hand) {
  const key = extendedKey(hand);
  for (const r of rowMap) {
    if (canonExtend(r.extend) === key) return r.row;
  }
  return null;
}

function flickDir(dx, dy) {
  if (Math.hypot(dx, dy) < FLICK_DIST) return 0;
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 1 : 3;
  return dy < 0 ? 2 : 4;
}

// ヒステリシス付き方向判定: 隣接セクター間の切り替えに HYST_RATIO の余裕を要求する
const HYST_RATIO = 1.5;
function flickDirHyst(dx, dy, prevDir) {
  if (Math.hypot(dx, dy) < FLICK_DIST) return 0;
  const rawHoriz = Math.abs(dx) >= Math.abs(dy);
  const rawDir   = rawHoriz ? (dx < 0 ? 1 : 3) : (dy < 0 ? 2 : 4);
  if (prevDir === 0) return rawDir;
  const prevHoriz = prevDir === 1 || prevDir === 3;
  if (prevHoriz !== rawHoriz) {
    // 水平↔垂直の切り替え: 優勢比が HYST_RATIO を超えるまで前の方向を維持
    const ratio = rawHoriz
      ? Math.abs(dx) / (Math.abs(dy) || 1e-9)
      : Math.abs(dy) / (Math.abs(dx) || 1e-9);
    if (ratio < HYST_RATIO) return prevDir;
  }
  return rawDir;
}

// --- 出力ヘルパ ---
function jpAppend(kana) { const o = $("jpFlickOutput"); if (o) o.value += kana; }
function jpStatus(text) { const s = $("jpFlickStatus"); if (s) s.textContent = text; }

function applyDakuten() {
  const o = $("jpFlickOutput");
  if (!o || !o.value) { jpStatus(t("jp.noPrev")); return; }
  const last = o.value.slice(-1);
  const next = DAKUTEN_NEXT[last];
  if (next) { o.value = o.value.slice(0, -1) + next; jpStatus(`${last} → ${next}`); }
  else jpStatus(t("jp.noVariant", { last }));
}

export function jpFlickBackspace() { const o = $("jpFlickOutput"); if (o) o.value = o.value.slice(0, -1); }
export function jpFlickClear() {
  const o = $("jpFlickOutput"); if (o) o.value = "";
  resetFull();
  jpStatus(t("jp.cleared"));
}

// --- 状態機械 ---
let lockedRow   = null;   // ロック中の行名 (null = 未ロック)
let rowPending  = null;   // { row, since } 行選択のデバウンス候補
let flickStart  = null;   // フリック基準座標 (最後のパー位置 or ロック時位置)
let flickArmed  = true;   // true=フリック受付中, false=検知済み・基準に戻るまで待機
let lastOpenPos = null;   // 最後に isOpen だったときの palmPoint
let leftMargin  = false;  // 現在の確定サイクル中に一度でも FLICK_DIST 外に出たか (中央フリップ確定は移動しないため、これが true にならない限り再アームしない)
let centerBaseRoll = 0;   // あ段確定用フリップのロール基準 (中央保持中に追従)
let centerFlipping = false; // あ段確定用フリップの検出中フラグ
let _lastDir    = 0;      // 直前に確定したフリック方向 (マージン外連続入力のヒステリシス用)
let _guuFrozenPos = null; // グー開始時に凍結したカーソル位置 (resetRowState をまたいで保持)

// --- JP専用削除ステートマシン ---
const DEL_QUICK_MS     = 1000;  // これ以内に戻したら1文字削除
const DEL_HOLD_MS      = 1000;  // これ以上保持したら全削除
const DEL_ROLL_FLIP    = 90;    // roll がこれ以上変化したらフリップ (deg)
const DEL_ROLL_NEUTRAL = 30;    // この範囲内に戻ったら中立 (deg)
let _delCanFire   = false;
let _delFlipAt    = -1;

  _guuFrozenPos = null;
  _convMode = false; _convSegs = []; _convSegIdx = 0; _convOrigText = "";
}

function updateJapanese(hand, now) {
  const isRest = hand.isFist || hand.isOpen;
  const row    = isRest ? null : extendToRow(hand);

  // ---- ロック中 ----
  if (lockedRow) {
    // フリップ中(手首を大きくひねっている間)は指の見え方が乱れて別の姿勢(グー/パー/別行)に
    // 誤検出されやすいため、その間は姿勢による判定を全て凍結し、ロック中の行のまま扱う
    // (は行などフリップの回転量が大きい行で特に指が隠れやすいための安定化)
    const rollBase = flickArmed ? centerBaseRoll : _modBaseRoll;
    const midFlip  = Math.abs(angleDelta(hand.orientation.roll, rollBase)) > MOD_ROLL_NEUTRAL;

    if (!midFlip) {
      // パー → リセット (行ロック解除)
      if (hand.isOpen) { resetFull(); jpStatus(t("jp.cancel")); return; }

      // グー → あ段を確定してロック解除 (即確定。削除ジェスチャーとの衝突を避けるため
      // 濁点サイクルへは繋げない。濁点まで続けたい場合はフリップ方式を使う)
      // ただし、このロック中に既にフリック/フリップで何か確定済み(flickArmed=false)の場合は
      // 「あ段」を二重に追加せず、単に終了(ロック解除)だけ行う
      if (hand.isFist) {
  root.appendChild(makeSlider("フリック距離", 0.02, 1.00, 0.01, FLICK_DIST, (v) => { FLICK_DIST = v; }));

  const mapTitle = document.createElement("div");
  mapTitle.className = "jp-cfg-title"; mapTitle.textContent = t("jp.cfgMap");
  root.appendChild(mapTitle);

  const legend = document.createElement("div");
  legend.className = "jp-cfg-legend";
  legend.innerHTML = t("jp.cfgLegend");
  root.appendChild(legend);

  // グリッド表: 指の組み合わせ | グー | ← | ↑ | → | ↓
  const sk = (k) => (!k ? "—" : (k === " " || k === "　") ? "⎵" : k);
  const table = document.createElement("div");
  table.className = "jp-flick-table";

  // ヘッダ行
  const hdr = document.createElement("div");
  hdr.className = "jp-flick-row jp-flick-hdr";
  hdr.innerHTML = `<span>${t("jp.cfgFinger")}</span><span>・</span><span>←</span><span>↑</span><span>→</span><span>↓</span>`;
  table.appendChild(hdr);

  for (const r of rowMap) {
    const kana = ROWS[r.row];
    const row = document.createElement("div");
    row.className = "jp-flick-row";
    row.innerHTML =
      `<span class="jp-flick-key">${r.extend.join("+")}</span>` +
      kana.map(k => `<span>${sk(k)}</span>`).join("");
    table.appendChild(row);
  }
  root.appendChild(table);
}

function makeSlider(label, min, max, step, value, onInput) {
  const row = document.createElement("div");
  row.className = "jp-cfg-th";
  const lab = document.createElement("span"); lab.className = "jp-cfg-thlab"; lab.textContent = label;
  const inp = document.createElement("input");
  inp.type = "range"; inp.min = min; inp.max = max; inp.step = step; inp.value = value;
  const val = document.createElement("span"); val.className = "jp-cfg-thval"; val.textContent = value;
  inp.addEventListener("input", () => { val.textContent = inp.value; onInput(parseFloat(inp.value)); });
  row.appendChild(lab); row.appendChild(inp); row.appendChild(val);
  return row;
}
