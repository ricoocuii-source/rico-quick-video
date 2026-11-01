---
name: rico-quick-video
description: 给一个 GitHub 仓库链接，产出 40～70 秒抖音风"开源项目速览"横版视频：Playwright 截图/录屏仓库页与官网（可整页机翻中文）→ 口播稿 → edge-tts 配音+字级时间戳 → HyperFrames/GSAP 合成（黑格背景呼吸辉光窗口、开场库四选一：故障风/爆闪/纸片汇聚/emoji火焰、推镜+卡片推移转场、3D 倾斜、手绘画重点/划词高亮+搜一搜浮条、任务清单卡、场景角标、数字滚动、关键词轻震、点击波纹、打字机字幕、双样式花字、点缀音效）→ mp4 + 三条分轨（画面 / 音效 / 口播）。Use when 用户说 "做个 GitHub 项目视频 / 开源项目速览 / rico-quick-video / 按上次那个流水线做视频"。规则是通用的（任何仓库都适用），GSAP 那期只是 examples 里的一个取值样例。
---

# rico-quick-video

输入一个 GitHub 仓库 URL，输出成片 + 三条分轨。规则通用，取值按项目定。

## 硬规则（开工前先看这两条）

1. **触发任务后，第一件事是出口播稿，不是采镜头。** 读完 README / 官网就写 `script.json`，把口播稿**贴到对话里**，然后停下等他说「可以 / 继续」再往下。稿子他会亲自改好几轮，**改完的版本就是新规则**。不要在他确认前跑生产 `capture.py` / `tts.py` / 渲染。**例外：** 他说「先出口播稿和静帧」时，可以出内容确认静帧（给人看卖点对不对），仍禁止正式采集、配音、渲染。他说「用我的口播稿，其他按你推荐」= 闸口过了，直接采，不要再为镜头方案追问。
2. **最终交付三条（2026-11-01 起）**：`画面.mp4`（画面+字幕，无音轨）、`口播.m4a`（纯人声）、`音效.m4a`（纯点缀音效）。**BGM 彻底不做**（他自己配乐），**不给** SRT、剪映导入包。**默认整体 1.2 倍速**：TTS 保持 +18% 渲染，成片 `setpts=PTS/1.2`+`atempo=1.2` 整体变速后再拆轨（不是只调语速，画面/动效/素材要一起快）。**开场也上字幕**：钩子/承接句不再写 `nocap`。审核片段（变速后的 开场 0-6s / 中段 / 结尾）照发到 `out/review/`。详见 preferences.md「交付」。

## 先读

| 文件 | 内容 |
|---|---|
| [references/preferences.md](references/preferences.md) | Rico 的硬规则：协作节奏、文案习惯、画面、声音。**每条都是否决项。** |
| [references/script-guide.md](references/script-guide.md) | 口播稿怎么写：骨架、钩子三选一、每段句式、关键词/cues 设计、痛点取证 |
| [references/shot-guide.md](references/shot-guide.md) | 镜头怎么挑：开场底图优先级、有/无官网的录制策略、每个卖点的画面判定 |
| [references/pitfalls.md](references/pitfalls.md) | 实现层的坑（选择器、录屏、TTS、HyperFrames、样式定位、改稿回灌）**开工前扫一遍** |
| [references/setup.md](references/setup.md) | 环境、素材库位置 |
| [examples/hyperframes-fastcut/](examples/hyperframes-fastcut/) | **2026-09-19 定稿的新玩法标杆，下期先看这份**：最强素材前置、画面产出物优先+口播画面解绑、快节奏（~3s/视觉变化）、短 CTA（CTA_MINIMAL）、宣传片多段裁切、counter/任务卡/划词全家桶 |
| [examples/gsap-skills/](examples/gsap-skills/) · [examples/jev-ultrafast/](examples/jev-ultrafast/) | 旧两期取值（慢节奏时代产物，只参考定位技巧：GIF 当镜头、intro 套层取景、推文镜头）。**是样例不是规则**，换项目全部重写 |

## 流程

```
① 研究   读 README、外链、官网；列候选卖点，每条标出处 URL + 页面上可定位的元素
② 取舍   按 script-guide 骨架挑 3～6 个卖点，定钩子类型，定开场底图（shot-guide）
③ 写稿   script.json（口播 + kw + cues）→ **贴到对话里等他确认，这是硬闸口**
④ 镜头   shots.json；capture.py 跑一遍，看 out/shots/*.png|mp4 里每个 bbox 是否框对
⑤ 配音   tts.py（edge-tts，固定）；然后跑 verify_frames.py（依赖 voice.json）看实际取景和画重点框，标 CUT 就是出画，先修再往下
⑥ 合成   build.mjs → check → PREVIEW_SEC=5 渲开场给用户 → 中段 10 秒试听 → 整片
⑦ 交付   分轨导出 画面.mp4 / 音效.m4a / 口播.m4a + 发 ≤30MB 的审核片段
```

**③ 是硬闸口：稿子没被确认，不许进 ④。** ⑥ 也有一次用户确认，不要跳。

## 命令

```bash
# 初始化
mkdir -p proj && cd proj && cp -r ~/.claude/skills/rico-quick-video/scripts ./
HYPERFRAMES_SKIP_SKILLS=1 npx -y hyperframes@0.8.35 init video --non-interactive --example blank --resolution landscape
mkdir -p video/assets/gsap && cp ~/.claude/skills/rico-quick-video/assets/gsap/*.js video/assets/gsap/
npx hyperframes@0.8.35 browser ensure          # 首次必做
# 跑
python3 scripts/capture.py shots.json out
python3 scripts/tts.py script.json out
python3 scripts/verify_frames.py out          # 需要 out/voice.json，所以放 tts 之后；有 CUT 就先修 shots.json 重采
CTA_MINIMAL=1 BGM=bgm.mp3 BGM_VOL=0.32 node scripts/build.mjs out video && (cd video && npx hyperframes@0.8.35 check --no-contrast)   # CTA_MINIMAL 是 2026-09-19 起的默认
PREVIEW_SEC=5 CTA_MINIMAL=1 BGM=bgm.mp3 BGM_VOL=0.32 node scripts/build.mjs out video_preview   # 先复制 video/ 的 package.json hyperframes.json meta.json
mkdir -p video_preview/assets && cp -R video/assets/gsap video_preview/assets/gsap   # 必须！build.mjs 只搬截图和配音，不搬 GSAP 库，缺了会报 sub_timeline_script_failure
(cd video_preview && HF_VIDEO_COVERAGE_THRESHOLD=0 npx hyperframes@0.8.35 render -o renders/intro.mp4 --low-memory-mode)
(cd video && npx hyperframes@0.8.35 render -o renders/final.mp4 --low-memory-mode)
node scripts/export_srt.mjs out video/renders/final.mp4

# 分轨交付：先整体 1.2 变速，再拆三条。音效轨要重渲（NO_VOICE=1 关掉口播），口播轨用 TTS 产物（apad 对齐）。
ffmpeg -y -i video/renders/final.mp4 -filter_complex "[0:v]setpts=PTS/1.2[v];[0:a]atempo=1.2[a]" -map "[v]" -map "[a]" -c:v libx264 -crf 20 -preset fast -c:a aac -b:a 192k /tmp/final_12x.mp4
NO_VOICE=1 CTA_MINIMAL=1 node scripts/build.mjs out video && (cd video && npx hyperframes@0.8.35 render -o renders/sfx.mp4 --low-memory-mode)
ffmpeg -y -i video/renders/sfx.mp4 -filter_complex "[0:v]setpts=PTS/1.2[v];[0:a]atempo=1.2[a]" -map "[v]" -map "[a]" -c:v libx264 -crf 20 -preset fast -c:a aac -b:a 192k /tmp/sfx_12x.mp4
CTA_MINIMAL=1 node scripts/build.mjs out video   # 还原 index.html（带口播版）
mkdir -p out/交付
D=$(ffprobe -v error -show_entries format=duration -of csv=p=0 /tmp/final_12x.mp4)
ffmpeg -y -i /tmp/final_12x.mp4 -an -c:v copy out/交付/画面.mp4
ffmpeg -y -i /tmp/sfx_12x.mp4   -vn -c:a copy out/交付/音效.m4a
ffmpeg -y -i out/voice.mp3 -af "atempo=1.2,apad" -t "$D" -c:a aac -b:a 192k out/交付/口播.m4a
```

**交付就这三条，多一条都是错**（`画面.mp4` / `音效.m4a` / `口播.m4a`，无 A_/B_/C_ 前缀）。不要给 SRT、剪映导入包。口播和音效都要 1.2 变速 + 与画面等长对齐（口播用 `apad -t <成片时长>` 补静音，通常比成片短 1～2 秒）。审核片段（开场 0-6s / 中段 / 结尾）照发到 `out/review/`。

`scripts/tracks.sh` 把「渲染三条 + 导出交付」合成一条命令（含还原 index.html）。
`scripts/run.sh shots.json script.json bgm.mp3` 一键跑完整链（不含预览）。

## 数据格式

**shots.json**：`viewport` 1600×1000。
- 静态：`{id, url?, target|text, up?, action: hover|point|select|click, extend?, hide?, css?, clicks?, frame?, translate?, tilt?, mark_style?}`
  - `translate: true`：走 translate.goog 整页机翻中文（英文站零门槛）；采完必查，被拦就去掉。口播点名英文名的镜头别开。
  - `tilt: true | [rx, ry]`：3D 倾斜漂浮（默认 [2.5, -4]），只给读文档的静态镜头，一期 2~4 个。
  - `mark_style: "select"`：该镜头的画重点用划词蓝色高亮（浅色页文本用）；默认手绘框（图形/按钮/数字/深色页）。
  - `tall: 1.6`：长图滚动镜头——截 1.6 倍视口高的长图，播放时页面缓慢上滚（浏览感）。整幅轻推、不推 bbox、不配 mark、无光标；给要念好几句的长段落当背景。节奏规则见 shot-guide「节奏红线」（4 秒无变化即违规）。
  - `hide` 是选择器数组，注入 `{display:none!important}`；`css` 是任意样式串（用来把 `file://` 独立资源居中之类）
  - `clicks` 是要点的文案数组（如 `["EN","中文"]`）。locale=zh-CN 不等于中文站。点不到就 skip，不能卡死。
  - `frame` 是 iframe 选择器，目标在 iframe 里时用（推文 embed：`"frame":"#twitter-widget-0"`）。x.com 屏蔽无头浏览器，推文镜头走 shot-guide 的「推文镜头」写法。
- 录像：`{id, url, record, settle, scroll: [[at, y]], hover_text?, hover_up?, zoom?, focus?}` → 输出带 `bbox`、`bbox_t`
- 本地动图/视频直接当镜头：`{id, video_src: "assets/demo.gif", record, bg?, zoom?, focus?}` → ffmpeg 缩放居中到视口、末尾定格补足 `record` 秒，不经过浏览器（README 的 demo GIF 用这个，比录 GitHub 页稳）
- 开场底图镜头加 `"role": "intro"`；可加 `intro_style: "glitch"|"flash"|"shatter"|"emoji"`（开场库，默认 glitch，env `INTRO_STYLE` 可覆盖）和 `intro_emoji`（emoji 开场用，默认 😮）。选型见 shot-guide「开场库」。

**script.json**：`voice`、`rate`、`lines[]`；每行 `{id, shot, text, kw[], cues[{at, shot?, trans?, mark?, style?, sticker?, task?, corner?, counter?}], badges[]?, nocap?, title?}`。
`cues[].style: "select"` 让这个画重点用划词高亮（优先级高于镜头的 `mark_style`）；`cues[].task: "步骤名"` 追加一张任务清单进度卡（白卡+绿勾，agent 分步演示题材用，所属句子结束自动收走）；`cues[].trans: "push"` 让这次切镜用卡片推移转场（默认模糊拉镜）；`cues[].corner: "PPT"` 左上场景角标（本句结束收走）；`cues[].counter: "51.5k"` 在当前镜头 bbox 右上滚出数字 chip（带 coin 音效）。
第 1 行钩子（`title` 是开场大字，`text` 是口播，两者可以不等长），第 2 行承接句（悬念/报名型钩子可省），末行短 CTA「感兴趣的兄弟快去冲吧」压在最后一个产出物镜头上（配 `CTA_MINIMAL=1`，旧长 CTA 已作废）。**开场也上字幕**：钩子/承接句不要写 `nocap`（`nocap: true` 只留给确实不想上字幕的行，2026-11-01 起）。开场标注是圈住整段 `title`，不是底部一条线。

**3:4 竖版**：`FORMAT=portrait`（1080×1440）。素材**不裁切**：横版网页/宣传片等比完整放中部辉光窗口，上下留白给大字/贴纸/字幕；推镜系统按 SF=W/1920 等比自适应，bbox 特写另乘 1.35 补偿（不然竖版特写太小）；字幕/花字/贴纸字号有竖版档，页面内 UI（浮条/counter/光标/波纹）放大 1.7 倍补偿窗口缩小。同一份 out/ 数据横竖两渲：竖版复制一个工程目录（如 `video_p34`，拷 package.json/hyperframes.json/meta.json + assets/gsap），`FORMAT=portrait CTA_MINIMAL=1 BGM=... node scripts/build.mjs out video_p34` 再渲。竖版钩子 `title` ≤10 字（86px 大字单行上限）。verify_frames 同样认 `FORMAT=portrait`。

**build.mjs 环境变量**：`FORMAT`(portrait=3:4 竖版) `BRAND`(#00C3D0) `BGM` `BGM_VOL`(0.32) `ACCENT_VOL`(1) `PREVIEW_SEC` `SFX_DIR` `NO_VOICE`(省略口播轨，出 B 分轨用) `CTA_MINIMAL`(1=无胶囊结尾，末句压在最后镜头上直接收，2026-09-19 起默认用) `BG_STYLE`(grid=黑色透视网格默认 / wall=旧模糊壁纸) `WM_TEXT`(合规角标文案，默认「*纯干货分享，不存在站外引流」)

## 已实现的画面/声音元素

黑色网格背景+辉光圆角窗口（呼吸辉光；BG_STYLE=wall 切回模糊壁纸）· 跟随 bbox 推镜 · 转场两种：模糊拉镜 / 卡片推移（trans:push）· 3D 倾斜漂浮镜头（tilt）· 放大光标+点击波纹 · 画重点两形态：手绘框 / 划词蓝色高亮（select，划完弹「搜一搜|问问AI」浮条）· 任务清单进度卡（task）· 场景角标（corner）· 数字滚动 chip（counter）· 关键词轻震 punch · 打字机字幕+关键词高亮+随内容包裹的黑底 · 花字两样式轮换（乱码扫出/斜体重影）· 序号徽章 · 开场库四选一：故障风/爆闪进场/纸片汇聚/emoji火焰（均无音效）· 左上角合规角标 · 描边胶囊 CTA · BGM duck · 点缀音效层（按事件类型自动挂，变调轮换）。
样式改 CSS，动效逻辑都在 `build.mjs` 时间线段落里，按注释找。

## 未自动化

①②③ 研究/取舍/写稿目前由对话中的 Claude 按 guide 手工完成。做研究 Agent 时以 script-guide 的"卖点三条件"为验收标准。
