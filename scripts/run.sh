#!/bin/zsh
# 一键：shots.json + script.json -> out/final.mp4 + out/剪映导入/
# 用法: ./scripts/run.sh shots.json script.json [bgm.mp3]
set -e
SHOTS=${1:-shots.json}; SCRIPT=${2:-script.json}; BGM_FILE=${3:-}
Q=${QUALITY:-standard}
python3 scripts/capture.py "$SHOTS" out
python3 scripts/tts.py "$SCRIPT" out
BGM="$BGM_FILE" BGM_VOL=${BGM_VOL:-0.32} SFX_VOL=${SFX_VOL:-0.5} node scripts/build.mjs out video
(cd video && npx --yes hyperframes@0.8.35 check --no-contrast | tail -3)
(cd video && npx --yes hyperframes@0.8.35 render --quality "$Q" --output ../out/final.mp4 --workers 3 > ../out/render.log 2>&1)
node scripts/export_srt.mjs out out/final.mp4
echo "done -> out/final.mp4  out/剪映导入/"
