# 环境

| 组件 | 用途 | 安装/检查 |
|---|---|---|
| Python 3.9+ · playwright | 截图/录像 | `pip3 install playwright && python3 -m playwright install chromium` |
| edge-tts | 口播 | `pip3 install edge-tts`（需要联网，走微软服务） |
| ffmpeg / ffprobe | 音视频处理、音效变调 | `brew install ffmpeg` |
| Node ≥ 22 · npx | build.mjs、HyperFrames | 已有 |
| hyperframes@0.8.35 | 渲染 | 项目内 pin；首次 `npx hyperframes@0.8.35 browser ensure` |
| GSAP + SplitText/CustomEase/ScrambleText | 动效 | `assets/gsap/*.min.js` 已随 skill 附带（GSAP 3.15，已全部免费） |
| whisper-cli + ggml-small.bin | 仅克隆音色路线需要（对齐字级时间戳） | `brew install whisper-cpp`；模型从 HF ggerganov/whisper.cpp 下载，确认完整 487MB |
| media-use skill 的 sfx 库 | 点缀音效源 | `~/.claude/skills/media-use/audio/assets/sfx/`，build.mjs 通过 `SFX_DIR` 找 |
| BGM | `~/.claude/skills/design-to-promo/assets/audio/bgm/tonight-hiphop.mp3` | 裁剪：`ffmpeg -i in.mp3 -t 62 -af "afade=t=in:st=0:d=1,loudnorm=I=-18:TP=-2" bgm.mp3` |

克隆音色路线（**用户明确说不用，默认不要走；只有他主动提才启用**）：
- IndexTTS-2.5 装在 `~/projects/自动化视频研究/pipeline/tts/index-tts`（uv 环境 + checkpoints 9GB），测试脚本 `_test_infer.py`。
- F5-TTS 在 `~/projects/火柴人视频探索/open-source-tts/f5tts`，`scripts/tts_f5.py` 可直接用（参考音频路径写死在脚本顶部）。
- 用户克隆样本：`~/projects/火柴人视频探索/assets/voice/user-video/clone-sample-18s.wav`（12s 版本同目录）。

参考项目（完整可跑的实例）：`~/projects/自动化视频研究/pipeline/`，最终成片 `out/v10_青色_点缀音效.mp4`。
