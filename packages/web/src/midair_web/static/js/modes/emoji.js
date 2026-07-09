// 絵文字入力:
//   描く   = 人差し指のみ伸展 (中指/薬指/小指は折れている)
//   検索   = グーパーグー (共通ジェスチャー: confirm)
//   クリア = グーフリップ (共通ジェスチャー: delete)
import { setGesture, setCameraState, drawPadCursor, setFlash,
  getPadCtx, clearPad, searchImage, applyLangCamState,
} from "../core.js";
import { t } from "../i18n.js";

let penDown = false;

// 人差し指のみ伸展 (中指/薬指/小指は折れている) = 描画。グーは除外。
function classifyDraw(hand) {
  if (hand.isFist) return "neutral";
  if (hand.fingers.index && !hand.fingers.middle && !hand.fingers.ring && !hand.fingers.pinky) {
    return "draw";
  }
  return "neutral";
}

export default {
  id: "emoji",
  label: "絵文字",
  reset() { penDown = false; },
  onFrame(ctx) {
    const { now, langInfo, hand, gesture } = ctx;
    const drawMode = classifyDraw(hand);

    const tip = hand.indexTip;
    drawPadCursor(tip.x, tip.y, drawMode);
    const pctx = getPadCtx();

    // 描画 (連続): 人差し指のみ伸展中
    if (drawMode === "draw" && pctx) {
      if (!penDown) { penDown = true; pctx.beginPath(); pctx.moveTo(tip.x, tip.y); }
      else { pctx.lineTo(tip.x, tip.y); pctx.stroke(); pctx.beginPath(); pctx.moveTo(tip.x, tip.y); }
    } else {
      penDown = false;
    }

    // 共通ジェスチャー: 決定=検索, 削除=クリア
    // 評価モード中は検索でなく「この絵で確定」(お題の記録) にフォークする。
    if (gesture.fired === "confirm") {
      if (window.__evalActive) window.__evalSubmit(); else searchImage("camera");
      setFlash(t("emoji.fSubmit"), now + 500);
    } else if (gesture.fired === "delete") {
      clearPad();
      setFlash(t("emoji.fClear"), now + 500);
    }

    // ジェスチャー表示
    if (langInfo.fired) {
      setGesture(`-> ${langInfo.label}`);
    } else {
      setGesture(drawMode === "draw" ? t("emoji.gDraw") : t("emoji.gIdle"));
    }

    if (applyLangCamState(langInfo)) {
      // 言語切替優先
    } else if (gesture.fired === "confirm") {
      setCameraState("searching", t("emoji.cSearchRun"), t("emoji.cSearchWait"));
    } else if (gesture.fired === "delete") {
      setCameraState("detecting", t("emoji.cCleared"), t("cam.waitNext"));
    } else if (drawMode === "draw") {
      setCameraState("drawing", t("emoji.cDrawing"), t("emoji.cDrawDetail"));
    } else {
      setCameraState("detecting", t("cam.detecting"), t("cam.emojiModeDetail"));
    }
  },
};
