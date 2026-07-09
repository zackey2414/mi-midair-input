// 多言語辞書 (日本語/英語)。UI ラベルも実行中メッセージもここに集約する。
//   t(key, vars) で現在の言語の文言を取得 ({var} を vars で置換)。
//   applyStaticI18n() で data-i18n / data-i18n-ph / data-i18n-html を持つ DOM を一括更新。
// このモジュールは他モジュールに依存しない葉モジュール (循環回避)。
const STORE_KEY = "midairLang";
let lang = "ja";
try { if (typeof localStorage !== "undefined") lang = localStorage.getItem(STORE_KEY) || "ja"; } catch (_) {}

export const getLang = () => lang;
export function setLang(l) {
  lang = (l === "en") ? "en" : "ja";
  try { if (typeof localStorage !== "undefined") localStorage.setItem(STORE_KEY, lang); } catch (_) {}
}

const DICT = {
  // --- ヘッダー / 言語トグル ---
  "header.sub": { ja: "テキスト or 手書きで絵文字を検索（非同期バックグラウンド処理）", en: "Search emoji by text or handwriting (async background jobs)" },
  "lang.toggle": { ja: "EN", en: "日本語" },   // ボタン表示 = 切り替え先の言語

  // --- パネル見出し ---
  "panel.camera": { ja: "Mid-Air 入力 (カメラ)", en: "Mid-Air Input (Camera)" },
  "panel.results": { ja: "検索結果", en: "Search Results" },
  "panel.textsearch": { ja: "テキスト検索", en: "Text Search" },
  "panel.test": { ja: "入力テスト", en: "Input Test" },

  // --- ボタン ---
  "btn.camStart": { ja: "カメラ開始", en: "Start Camera" },
  "btn.camStop": { ja: "カメラ停止", en: "Stop Camera" },
  "btn.searchDrawing": { ja: "この絵で検索", en: "Search this drawing" },
  "btn.clear": { ja: "クリア", en: "Clear" },
  "btn.search": { ja: "検索", en: "Search" },
  "btn.delete": { ja: "削除", en: "Delete" },
  "btn.next": { ja: "次のお題", en: "Next prompt" },
  "btn.testStart": { ja: "入力開始", en: "Start" },
  "btn.testStop": { ja: "終了", en: "Stop" },
  "btn.toTest": { ja: "テストページ →", en: "Test page →" },
  "btn.toNormal": { ja: "← 通常ページ", en: "← Main page" },
  "btn.editFold": { ja: "運指変更", en: "Edit" },
  "btn.save": { ja: "保存", en: "Save" },

  // --- ヒント (HTML) ---
  "hint.main": {
    ja: "・🔁 <b>言語切替</b> = <b>手を開いたまま</b>手のひら→手の甲へ裏返す（日本語 → 英語 → 絵文字）<br>・<b>指を折って入力している間</b>は言語切替しない（手を開いた時だけ切替）<br>・モード切替や方式変更は右「入力結果」下のパネルから",
    en: "・🔁 <b>Language switch</b> = flip palm → back <b>with your hand open</b> (Japanese → English → Emoji)<br>・No switching <b>while folding fingers to type</b> (only when the hand is open)<br>・Change mode/method from the panel below “Input” on the right",
  },
  "hint.test": {
    ja: "「入力開始」で計測開始 → モードを切り替えながらお題を入力 → 「終了」。空白数は無視して正誤判定します。",
    en: "Press “Start” to begin → type the prompt while switching modes → “Stop”. Whitespace is ignored when judging.",
  },

  // --- セレクト / 選択肢 ---
  "opt.topk": { ja: "候補を top-k 表示（クリックで入力）", en: "Show top-k candidates (click to enter)" },
  "opt.top1": { ja: "最高スコアの1件を自動入力", en: "Auto-enter the top-1 match" },
  "opt.langoff": { ja: "なし（未割り当て）", en: "None (unassigned)" },
  "opt.holdback": { ja: "手の甲を0.5秒", en: "Back of hand for 0.5s" },
  "opt.flip": { ja: "手のひら→甲にひっくり返す", en: "Flip palm → back" },

  // --- ラベル ---
  "label.currentMode": { ja: "現在の入力モード", en: "Current input mode" },
  "label.langMotion": { ja: "言語切替モーション", en: "Language-switch motion" },
  "label.orient": { ja: "いま検出中の手の向き", en: "Detected hand orientation" },
  "label.orientInvert": { ja: "検出が逆のとき", en: "If detection is reversed" },
  "label.invertCheck": { ja: "手のひら/甲を反転", en: "Invert palm/back" },
  "label.noiseFilter": { ja: "ノイズフィルタ (OneEuro)", en: "Noise filter (OneEuro)" },
  "label.inputResult": { ja: "入力結果", en: "Input" },
  "label.prompt": { ja: "お題:", en: "Prompt:" },

  // --- プレースホルダ ---
  "ph.query": { ja: "例: smiling cat / red heart / fire", en: "e.g. smiling cat / red heart / fire" },
  "ph.output": { ja: "ここに入力結果が入ります（絵文字は下の候補をクリックで追加）", en: "Your input appears here (for emoji, click a candidate below)" },

  // --- 入力モード名 ---
  "mode.japanese": { ja: "日本語", en: "Japanese" },
  "mode.english": { ja: "英語", en: "English" },
  "mode.emoji": { ja: "絵文字", en: "Emoji" },

  // --- モード別ガイド (#jpFlickStatus) ---
  "guide.japanese": {
    ja: "日本語(折り曲げ式): 指を折って行を選び(2進数運指: あ=親,か=人,さ=親人,た=中…)→手をフリック→パーで確定(無フリック=あ段)。中+薬=濁点/半濁点/小。設定パネルで運指/しきい値を調整可。",
    en: "Japanese (fold style): fold fingers to pick a row (binary fingering: あ=Thumb, か=Index, さ=Thumb+Index, た=Middle…) → flick → open hand to commit (no flick = -a vowel). Middle+Ring = dakuten/handakuten/small. Adjust fingering/thresholds in the settings panel.",
  },
  "guide.english": {
    ja: "英語: 指を伸ばして行(1-11)を選び→フリックで文字 / グーで中央を小文字確定 / フリップで中央を大文字確定。確定後さらにフリップで大小トグル。グー+ひねりで削除。",
    en: "English: extend fingers to pick a row (1-11) → flick for a letter / fist to commit the center letter lowercase / flip to commit it uppercase. Flip again after committing to toggle case. Fist + twist to delete.",
  },
  "guide.emoji": {
    ja: "絵文字: テキスト / 手書きで検索し、下の候補をクリックで入力。カメラは 人差し指のみ=描画 / グーパーグー=検索 / グーフリップ=クリア。",
    en: "Emoji: search by text/handwriting and click a candidate to enter. On camera: index-only to draw / fist-open-fist to search / fist-flip to clear.",
  },

  // --- 手の向き ---
  "orient.palm": { ja: "手のひら", en: "Palm" },
  "orient.back": { ja: "手の甲", en: "Back" },
  "orient.unknown": { ja: "—", en: "—" },

  // --- 検索結果カード ---
  "card.clickToAdd": { ja: "クリックで入力結果に追加", en: "Click to add to input" },

  // --- トースト ---
  "toast.entered": { ja: "{c} を入力", en: "Entered {c}" },
  "toast.switched": { ja: "{label} に変更しました", en: "Switched to {label}" },

  // --- ステータス (#status) ---
  "status.searching": { ja: "検索中…", en: "Searching…" },
  "status.noresult": { ja: "該当なし", en: "No match" },
  "status.count": { ja: "{n} 件", en: "{n} results" },
  "status.error": { ja: "エラー: {e}", en: "Error: {e}" },
  "status.commErr": { ja: "通信エラー: {e}", en: "Network error: {e}" },
  "status.needText": { ja: "テキストを入力してください", en: "Please enter text" },

  // --- カメラ状態 ---
  "cam.idleLabel": { ja: "待機中", en: "Idle" },
  "cam.idleDetail": { ja: "カメラは停止しています", en: "Camera is stopped" },
  "cam.modeLabel": { ja: "{label}入力モード", en: "{label} input mode" },
  "cam.afterSwitch": { ja: "切替直後: 少し待ってから入力してください", en: "Just switched: wait a moment before typing" },
  "cam.searchRun": { ja: "検索実行中", en: "Searching" },
  "cam.sendingImg": { ja: "手書き画像を送信しています", en: "Sending handwriting image" },
  "cam.detecting": { ja: "検出中", en: "Detecting" },
  "cam.waitNext": { ja: "次のジェスチャを待っています", en: "Waiting for the next gesture" },
  "cam.searchErrLabel": { ja: "検索エラー", en: "Search error" },
  "cam.searchFail": { ja: "検索に失敗しました", en: "Search failed" },
  "cam.commErrLabel": { ja: "通信エラー", en: "Network error" },
  "cam.modelLoad": { ja: "モデル読み込み中", en: "Loading model" },
  "cam.modelLoadDetail": { ja: "MediaPipe Hand Landmarker を読み込んでいます", en: "Loading MediaPipe Hand Landmarker" },
  "cam.permWait": { ja: "カメラ権限待ち", en: "Waiting for camera permission" },
  "cam.permDetail": { ja: "ブラウザの許可ダイアログを確認してください", en: "Check the browser permission dialog" },
  "cam.handIn": { ja: "手をカメラ内に入れてください", en: "Put your hand in the camera view" },
  "cam.denyLabel": { ja: "カメラ権限拒否", en: "Camera permission denied" },
  "cam.denyDetail": { ja: "ブラウザ設定でカメラ権限を許可してから再実行してください", en: "Allow camera permission in browser settings, then retry" },
  "cam.errLabel": { ja: "カメラエラー", en: "Camera error" },
  "cam.noHandLabel": { ja: "手が見つかりません", en: "No hand found" },
  "cam.noHandDetail": { ja: "手全体が白い検出エリアに入るようにしてください", en: "Keep your whole hand inside the white detection area" },
  "cam.clippedLabel": { ja: "手が見切れています", en: "Hand is cut off" },
  "cam.clippedDetail": { ja: "手のひら〜指先まで枠内に収めてください", en: "Fit palm to fingertips within the frame" },
  "cam.langSwitched": { ja: "言語入力モードを切り替えました", en: "Switched input language mode" },
  "cam.langHold": { ja: "言語切替 保持中", en: "Holding to switch language" },
  "cam.langHoldDetail": { ja: "手の甲を保持 {pct}%", en: "Holding back of hand {pct}%" },
  "cam.jpModeDetail": { ja: "同じピンチを50音フリックとして解釈します", en: "Interprets fold + flick as kana input" },
  "cam.foldDetail": { ja: "指を折って行→フリック→パーで確定", en: "Fold to pick a row → flick → open hand to commit" },
  "cam.emojiModeDetail": { ja: "人差し指のみ=描画 / グーパーグー=検索 / グーフリップ=クリア", en: "Index-only draw / fist-open-fist search / fist-flip clear" },
  "cam.enNotImpl": { ja: "指を伸ばして行を選び、フリックで文字を入力します", en: "Extend fingers to pick a row, then flick to enter a letter" },

  // --- ジェスチャ表示 (#gesture) ---
  "gesture.dash": { ja: "—", en: "—" },
  "gesture.modelLoad": { ja: "モデル読み込み中…", en: "Loading model…" },
  "gesture.permWait": { ja: "カメラ権限待ち…", en: "Waiting for permission…" },
  "gesture.detecting": { ja: "検出中…", en: "Detecting…" },
  "gesture.noHand": { ja: "手が見えません", en: "No hand visible" },
  "gesture.handClipped": { ja: "手全体を写してください", en: "Show your whole hand" },
  "gesture.afterSwitch": { ja: "切替直後…", en: "Just switched…" },
  "gesture.jpFlick": { ja: "日本語フリック", en: "Japanese flick" },
  "gesture.emoji": { ja: "絵文字入力", en: "Emoji input" },
  "gesture.english": { ja: "英語入力", en: "English input" },
  "gesture.jpFold": { ja: "日本語(折り曲げ)", en: "Japanese (fold)" },
  "gesture.enFold": { ja: "英語(折り曲げ)", en: "English (fold)" },
  "gesture.permErrPrefix": { ja: "権限エラー: ", en: "Permission error: " },
  "gesture.camErrPrefix": { ja: "カメラエラー: ", en: "Camera error: " },

  // --- 絵文字モード ---
  "emoji.gDraw": { ja: "✏️ 描画中", en: "✏️ Drawing" },
  "emoji.gClear": { ja: "☝️ クリア構え (キープ)", en: "☝️ Clear pose (hold)" },
  "emoji.gSubmit": { ja: "✌️ 検索構え (キープ)", en: "✌️ Search pose (hold)" },
  "emoji.gDelete": { ja: "⌫ 削除構え (キープ)", en: "⌫ Delete pose (hold)" },
  "emoji.gIdle": { ja: "🖐 待機", en: "🖐 Idle" },
  "emoji.gLangHold": { ja: "🔁 手の甲キープ {pct}%", en: "🔁 Holding back {pct}%" },
  "emoji.fClear": { ja: "🧹 クリア", en: "🧹 Clear" },
  "emoji.fDelete": { ja: "⌫ 削除", en: "⌫ Delete" },
  "emoji.fSubmit": { ja: "🔍 検索", en: "🔍 Search" },
  "emoji.cCleared": { ja: "クリアしました", en: "Cleared" },
  "emoji.cDeleted": { ja: "1文字削除しました", en: "Deleted one character" },
  "emoji.cDrawing": { ja: "描画中", en: "Drawing" },
  "emoji.cDrawDetail": { ja: "人差し指を折ると描画を止めます", en: "Fold the index finger to stop drawing" },
  "emoji.cClearHold": { ja: "クリア保持中", en: "Holding to clear" },
  "emoji.cDeleteHold": { ja: "削除保持中", en: "Holding to delete" },
  "emoji.cSubmitHold": { ja: "検索保持中", en: "Holding to search" },
  "emoji.cSearchRun": { ja: "検索実行中", en: "Searching" },
  "emoji.cSearchWait": { ja: "検索結果を待っています", en: "Waiting for results" },

  // --- フリック方向 ---
  "dir.center": { ja: "中央", en: "Center" },
  "dir.left": { ja: "左", en: "Left" },
  "dir.up": { ja: "上", en: "Up" },
  "dir.right": { ja: "右", en: "Right" },
  "dir.down": { ja: "下", en: "Down" },

  // --- 日本語モード (状態表示: 行名/かな/方向は変数で日本語のまま、説明文のみ翻訳) ---
  "jp.noPrev": { ja: "濁点化: 直前の文字がありません", en: "Dakuten: no preceding character" },
  "jp.noVariant": { ja: "「{last}」に対応形なし", en: "No variant for “{last}”" },
  "jp.cleared": { ja: "クリアしました", en: "Cleared" },
  "jp.cancel": { ja: "キャンセル", en: "Canceled" },
  "jp.commit": { ja: "{row}行 {dir} → {kana}", en: "Row {row} {dir} → {kana}" },
  "jp.rowEnd": { ja: "{row}行 終了", en: "Row {row} done" },
  "jp.rowUnassigned": { ja: "{row}行 (未割り当て)", en: "Row {row} (unassigned)" },
  "jp.rowReturn": { ja: "{row}行: マージンに戻ってからフリック / グー or フリップであ段", en: "Row {row}: return to center, then flick / fist or flip for the -a vowel" },
  "jp.rowPending": { ja: "{row}行…", en: "Row {row}…" },
  "jp.reflick": { ja: "{row}行: 基準に戻して次フリック{mod} / フリップで濁点", en: "Row {row}: back to center for the next flick{mod} / flip for dakuten" },
  "jp.modSmall": { ja: " [小]", en: " [small]" },
  "jp.modDaku": { ja: " [濁]", en: " [dakuten]" },
  "jp.modHandaku": { ja: " [半濁]", en: " [handakuten]" },
  "jp.fullSpace": { ja: "全角スペース", en: "Full-width space" },
  "jp.waHint": { ja: "わ行: フリックで母音 / グー→わ / フリップ=全角スペース", en: "Wa row: flick for a vowel / fist→わ / flip = full-width space" },
  "jp.rowHint": { ja: "{row}行: フリックで母音 / グー or フリップであ段", en: "Row {row}: flick for a vowel / fist or flip for the -a vowel" },
  "jp.restPinky": { ja: "P: は/ま/や/ら/わ/句行", en: "P: は/ま/や/ら/わ / punctuation rows" },
  "jp.restBase": { ja: "あ/か/さ/た/な行", en: "あ/か/さ/た/な rows" },
  "jp.unassigned": { ja: "未割り当て", en: "Unassigned" },
  "jp.delOne": { ja: "1文字削除", en: "Deleted 1 char" },
  "jp.delFlip": { ja: "roll:{roll}° フリップ検出 / 戻す→1文字({ms}ms) / 保持→全削除({pct}%)", en: "roll:{roll}° flip detected / release→delete 1 ({ms}ms) / hold→delete all ({pct}%)" },
  "jp.delArmed": { ja: "roll:{roll}° グー検出 / 傾けて削除", en: "roll:{roll}° fist detected / tilt to delete" },
  "jp.delFist": { ja: "roll:{roll}° グー", en: "roll:{roll}° fist" },
  "jp.camDetail": { ja: "指を伸ばして行選択 / フリックで方向 or グー or フリップであ段", en: "Extend fingers to pick a row / flick for direction, or fist/flip for the -a vowel" },
  // --- 日本語モード (設定パネル) ---
  "jp.cfgThresholds": { ja: "検出しきい値", en: "Detection thresholds" },
  "jp.cfgHold": { ja: "行ロック(ms)", en: "Row lock (ms)" },
  "jp.cfgFlick": { ja: "フリック距離", en: "Flick distance" },
  "jp.cfgMap": { ja: "運指表", en: "Fingering table" },
  "jp.cfgFinger": { ja: "指", en: "Finger" },
  "jp.cfgLegend": { ja: "<b>T</b>=親指 <b>I</b>=人差 <b>M</b>=中 <b>P</b>=小指 &nbsp;／&nbsp; 列: ・(中央) ← ↑ → ↓", en: "<b>T</b>=Thumb <b>I</b>=Index <b>M</b>=Middle <b>P</b>=Pinky &nbsp;/&nbsp; cols: ·(center) ← ↑ → ↓" },

  // --- 英語モード ---
  "en.special.case": { ja: "大小", en: "Case" },
  "en.special.delete": { ja: "消す", en: "Delete" },
  "en.caseToggled": { ja: "直前の英字の大小を切替", en: "Toggled case of the last letter" },
  "en.caseNoAlpha": { ja: "大小: 直前が英字ではありません", en: "Case: the last char isn’t a letter" },
  "en.deleted": { ja: "1文字削除しました", en: "Deleted one character" },
  "en.delEmpty": { ja: "削除: 文字がありません", en: "Delete: nothing to delete" },
  "en.dirUnassigned": { ja: "その方向は未割り当て", en: "That direction is unassigned" },
  "en.committed": { ja: "行{entry} {dir} = {ch}", en: "Row {entry} {dir} = {ch}" },
  "en.previewCase": { ja: "直前英字の大小トグル (パーで確定)", en: "Toggle case of last letter (open hand to commit)" },
  "en.previewDelete": { ja: "1文字削除 (パーで確定)", en: "Delete 1 char (open hand to commit)" },
  "en.previewRow": { ja: "行{entry} → {dir}「{ch}」 (パーで確定)", en: "Row {entry} → {dir} “{ch}” (open hand to commit)" },
  "en.pending": { ja: "行{entry} …", en: "Row {entry} …" },
  "en.idle": { ja: "パー基準: 指を折って行を選択", en: "Open-hand base: fold to pick a row" },
  "en.unknown": { ja: "その運指は未割り当て", en: "That fingering is unassigned" },
  "en.mapTitle": { ja: "英語 運指 (行:文字 → 折る指) — 変更可", en: "English fingering (row:letters → folded fingers) — editable" },

  // --- 運指エディタ ---
  "fe.thTitle": { ja: "検出しきい値 (デモ調整・日本語/英語 共通)", en: "Detection thresholds (demo, shared JA/EN)" },
  "fe.thHold": { ja: "行ロック(ms)", en: "Row lock (ms)" },
  "fe.thFlick": { ja: "フリック距離", en: "Flick distance" },
  "fe.thThumb": { ja: "親指折りしきい", en: "Thumb-fold threshold" },
  "fe.needOne": { ja: "1本以上選択してください", en: "Select at least one finger" },
  "fe.dup": { ja: "他の運指と重複", en: "Conflicts with another fingering" },
  "fe.saved": { ja: "保存しました", en: "Saved" },
  "fe.mapTitle": { ja: "運指 (行/操作 → 折り曲げる指)", en: "Fingering (row/action → folded fingers)" },

  // --- 指ラベル ---
  "finger.T": { ja: "親", en: "Thumb" },
  "finger.I": { ja: "人", en: "Index" },
  "finger.M": { ja: "中", en: "Middle" },
  "finger.R": { ja: "薬", en: "Ring" },
  "finger.P": { ja: "小", en: "Pinky" },

  // --- テストページ統計 ---
  "test.time": { ja: "時間", en: "Time" },
  "test.inputs": { ja: "入力", en: "Inputs" },
  "test.miss": { ja: "ミス", en: "Miss" },
  "test.avg": { ja: "平均入力", en: "Avg inputs" },
  "test.perchar": { ja: "回/字", en: "/char" },
  "test.acc": { ja: "正解率", en: "Accuracy" },
  "test.times": { ja: "回", en: "" },
  "test.measuring": { ja: "計測中… お題を入力してください", en: "Measuring… type the prompt" },
  "test.correct": { ja: "✅ 正解！ 「次のお題」へ", en: "✅ Correct! Go to “Next prompt”" },
  "test.wrong": { ja: "終了。お題と一致しません", en: "Stopped. Does not match the prompt" },

  // --- 精度評価モード (パネル / ボタン / 選択肢) ---
  "eval.panelTitle": { ja: "精度評価", en: "Accuracy Evaluation" },
  "eval.modeBtn": { ja: "絵文字入力評価", en: "Emoji Input Evaluation" },
  "eval.modeBtnBack": { ja: "通常入力に戻る", en: "Back to normal input" },
  "eval.submit": { ja: "この絵で確定", en: "Submit this drawing" },
  "eval.targetHint": {
    ja: "お題をカメラ窓に描いて「この絵で確定」または ✌️ で記録。マウス描きでも可。自動で次のお題へ進みます。",
    en: "Draw the prompt in the camera view and record it with “Submit this drawing” or ✌️. Mouse drawing works too. It advances to the next prompt automatically.",
  },
  "eval.n": { ja: "試行数", en: "Trials" },
  "eval.group": { ja: "ジャンル", en: "Category" },
  "eval.model": { ja: "モデル", en: "Model" },
  "eval.limit": { ja: "制限", en: "Time limit" },
  "eval.optFaces": { ja: "顔だけ", en: "Faces only" },
  "eval.optSmileys": { ja: "顔・感情", en: "Smileys & emotion" },
  "eval.optPeople": { ja: "人物・身体", en: "People & body" },
  "eval.optSymbols": { ja: "記号", en: "Symbols" },
  "eval.optAll": { ja: "全ジャンル", en: "All categories" },
  "eval.loading": { ja: "読込中…", en: "Loading…" },
  "eval.unlimited": { ja: "無制限", en: "Unlimited" },
  "eval.sec5": { ja: "5秒", en: "5s" },
  "eval.sec10": { ja: "10秒", en: "10s" },
  "eval.sec20": { ja: "20秒", en: "20s" },
  "eval.start": { ja: "評価開始", en: "Start evaluation" },
  "eval.stop": { ja: "中止", en: "Stop" },

  // --- 精度評価モード (実行中メッセージ) ---
  "eval.selectSettings": { ja: "設定を選び「評価開始」を押してください", en: "Choose settings and press “Start evaluation”" },
  "eval.fetching": { ja: "お題を取得中…", en: "Fetching prompts…" },
  "eval.fetchErr": { ja: "お題取得エラー: {e}", en: "Failed to fetch prompts: {e}" },
  "eval.noTargets": { ja: "お題が取得できませんでした", en: "Could not fetch prompts" },
  "eval.stopped": { ja: "評価を中止しました", en: "Evaluation stopped" },
  "eval.progress": { ja: "お題 {i} / {n}", en: "Prompt {i} / {n}" },
  "eval.drawPrompt": { ja: "お題「{label}」を描いてください", en: "Draw “{label}”" },
  "eval.remaining": { ja: "⏱ 残り {s}s", en: "⏱ {s}s left" },
  "eval.drawFirst": { ja: "先にお題を描いてください", en: "Draw the prompt first" },
  "eval.searchErr": { ja: "検索エラー: {e}", en: "Search error: {e}" },
  "eval.done": { ja: "評価セッション完了。下に集計を表示しました。", en: "Evaluation session complete. Summary shown below." },
  "eval.clearConfirm": { ja: "評価ログを全消去します。よろしいですか？", en: "Clear all evaluation logs. Are you sure?" },

  // --- 精度評価モード (集計テーブル) ---
  "eval.miss": { ja: "圏外", en: "Out" },
  "eval.summaryTitle": { ja: "モデル別 集計", en: "Summary by model" },
  "eval.clearLog": { ja: "ログ消去", en: "Clear log" },
  "eval.thModel": { ja: "モデル", en: "Model" },
  "eval.thLimit": { ja: "制限", en: "Limit" },
  "eval.thTrials": { ja: "試行", en: "Trials" },
  "eval.thAvgInput": { ja: "平均入力", en: "Avg input" },
  "eval.thAvgSearch": { ja: "平均検索", en: "Avg search" },
  "eval.thPrompt": { ja: "お題", en: "Prompt" },
  "eval.thDrawing": { ja: "描画", en: "Drawing" },
  "eval.thResult": { ja: "結果 / モデル・時間", en: "Result / model & time" },
  "eval.thTop10": { ja: "top-10 (左=1位 / 緑枠=お題)", en: "top-10 (left = #1 / green = prompt)" },
  "eval.timedOut": { ja: " ⏱時間切れ", en: " ⏱ timed out" },
  "eval.blankTrial": { ja: " ·未描画", en: " ·no drawing" },
  "eval.inputSearch": { ja: "入力 {d} / 検索 {s}", en: "input {d} / search {s}" },
};

// key の現在言語の文言を返す。vars={k:v} があれば {k} を置換。未定義キーは key をそのまま返す。
export function t(key, vars) {
  const entry = DICT[key];
  let s = entry ? (entry[lang] ?? entry.ja ?? key) : key;
  if (vars) for (const k in vars) s = s.replaceAll(`{${k}}`, vars[k]);
  return s;
}

// フリック方向ラベル配列 [中央,左,上,右,下] を現在言語で返す
export const dirLabels = () => [t("dir.center"), t("dir.left"), t("dir.up"), t("dir.right"), t("dir.down")];

// data-i18n(textContent) / data-i18n-ph(placeholder) / data-i18n-html(innerHTML) を一括適用
export function applyStaticI18n(root) {
  if (typeof document === "undefined" || !document.querySelectorAll) return;
  const r = root || document;
  r.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  r.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.setAttribute("placeholder", t(el.dataset.i18nPh)); });
  r.querySelectorAll("[data-i18n-html]").forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
}
