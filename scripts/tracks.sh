#!/bin/bash
# 渲染成片 + 分轨交付 + 审核片段。就三条交付，多一条都是错。
#   画面.mp4        画面 + 字幕，无音轨
#   BGM带音效.m4a   BGM + 点缀音效，无口播
#   口播.mp3        纯人声（apad 补静音对齐到成片时长）
# 用法：在项目根目录跑  bash scripts/tracks.sh [bgm.mp3]
set -e
cd "$(dirname "$0")/.."
BGM_FILE="${1:-bgm.mp3}"
HF="npx hyperframes@0.8.35"
mkdir -p out/交付 out/review out/logs

echo "=== [1/5] render final (voice + BGM) ==="
BGM="$BGM_FILE" BGM_VOL=0.32 node scripts/build.mjs out video > out/logs/build-final.log 2>&1
(cd video && $HF render -o renders/final.mp4 --low-memory-mode) > out/logs/render-final.log 2>&1

echo "=== [2/5] render bgm-sfx (NO_VOICE, with BGM) ==="
NO_VOICE=1 BGM="$BGM_FILE" BGM_VOL=0.32 node scripts/build.mjs out video > out/logs/build-bgm.log 2>&1
(cd video && $HF render -o renders/bgm-sfx.mp4 --low-memory-mode) > out/logs/render-bgm.log 2>&1

echo "=== [3/5] restore index.html (voice + BGM) ==="
BGM="$BGM_FILE" BGM_VOL=0.32 node scripts/build.mjs out video > out/logs/build-restore.log 2>&1

echo "=== [4/5] export 交付 (3 tracks) + review clips ==="
D=$(ffprobe -v error -show_entries format=duration -of csv=p=0 video/renders/final.mp4)
ffmpeg -v error -y -i video/renders/final.mp4   -an -c:v copy                    out/交付/画面.mp4
ffmpeg -v error -y -i video/renders/bgm-sfx.mp4 -vn -c:a copy                    out/交付/BGM带音效.m4a
ffmpeg -v error -y -i out/voice.mp3 -af apad -t "$D" -c:a libmp3lame -b:a 192k   out/交付/口播.mp3
ffmpeg -v error -y -i video/renders/final.mp4 -t 6                 -c:v libx264 -crf 20 -c:a aac -b:a 128k out/review/开场_0-6s.mp4
ffmpeg -v error -y -ss 24 -i video/renders/final.mp4 -t 12         -c:v libx264 -crf 20 -c:a aac -b:a 128k out/review/中段_24-36s.mp4
TAIL=$(( ${D%.*} - 8 ))
ffmpeg -v error -y -ss "$TAIL" -i video/renders/final.mp4 -t 8     -c:v libx264 -crf 20 -c:a aac -b:a 128k "out/review/结尾_${TAIL}-${D%.*}s.mp4"

echo "=== [5/5] verify（三条必须等长，画面轨必须无音轨）==="
for f in out/交付/*; do
  d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")
  na=$(ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$f" | wc -l | tr -d ' ')
  printf "%-28s %12s s  音轨数=%s\n" "$(basename "$f")" "$d" "$na"
done
echo "ALL DONE"
