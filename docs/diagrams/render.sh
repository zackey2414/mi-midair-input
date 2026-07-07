#!/usr/bin/env bash
# docs/diagrams の Mermaid ソース (*.mmd) を 白背景 PNG (figs/) に一括レンダリングする。
#
# 使い方:
#   cd docs/diagrams && ./render.sh
#
# 必要環境:
#   - Docker (Chromium 同梱の minlag/mermaid-cli イメージを使用。ローカルに mmdc は不要)
#   - 16:9 パディングは macOS の sips を使用 (無ければパディングはスキップ)
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p figs

IMG="minlag/mermaid-cli:latest"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Chromium の実行パス + サンドボックス無効 (コンテナ内 root 実行のため)
cat > "$TMP/pptr.json" <<'JSON'
{ "executablePath": "/usr/bin/chromium-browser", "args": ["--no-sandbox", "--disable-setuid-sandbox"] }
JSON

# Mermaid 設定: フォントサイズ (見やすさ) と余白/間隔
cat > "$TMP/mmconf.json" <<'JSON'
{ "theme": "default", "themeVariables": { "fontSize": "26px" },
  "flowchart": { "padding": 14, "nodeSpacing": 55, "rankSpacing": 65, "htmlLabels": true } }
JSON

# 全 .mmd を白背景・2倍解像度で PNG 化
for mmd in *.mmd; do
  base="${mmd%.mmd}"
  echo "render: $mmd -> figs/$base.png"
  docker run --rm -u 0 -v "$PWD":/data -v "$TMP":/cfg "$IMG" \
    -p /cfg/pptr.json -c /cfg/mmconf.json \
    -i "/data/$mmd" -o "/data/figs/$base.png" -b white -s 2
done

# アプリ概要図だけ スライド用に 16:9 へ白パディング (実装フロー図は横長のまま)
if command -v sips >/dev/null 2>&1; then
  for f in figs/application.png figs/application.en.png; do
    [ -f "$f" ] || continue
    w=$(sips -g pixelWidth  "$f" | awk '/pixelWidth/{print $2}')
    h=$(sips -g pixelHeight "$f" | awk '/pixelHeight/{print $2}')
    need_h=$(awk -v a="$w" 'BEGIN{printf "%d", (a/16*9)+0.5}')
    if [ "$need_h" -ge "$h" ]; then
      sips -p "$need_h" "$w" --padColor FFFFFF "$f" --out "$f" >/dev/null
      echo "pad 16:9: $f (${w}x${need_h})"
    fi
  done
else
  echo "note: sips が無いため 16:9 パディングはスキップしました" >&2
fi

echo "done -> figs/*.png"
