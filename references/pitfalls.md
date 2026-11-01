# 踩坑清单（每条都真实花过时间，按流程阶段排）

## 采集（Playwright）
1. **Playwright 自带 `record_video` 的时间轴和墙钟不一致**：页面加载/loader 动画会被录进去，且录像比真实时间"慢"，取最后 N 秒也不对。解决：用 CDP `Page.startScreencast` 逐帧抓 jpeg + 真实时间戳，ffmpeg concat（`duration` 行）拼成 mp4。`capture.py record_shot` 已实现。
2. **`window.scrollTo` 在带平滑滚动库的站点（gsap.com 用 Lenis）不生效**，画面一直黑。用 `mouse.wheel` 分步滚。
3. **GitHub 未登录布局的选择器**：仓库名 `strong[itemprop=name] a`；About `p[class*=SidebarAbout-module__description]`；Star 数 `#repo-stars-counter-star`；README 顶部字符画 `article div.snippet-clipboard-content`（不是 `.highlight`）；README 标题外面包着 `.markdown-heading`，`extend` 并入兄弟节点时要先 `closest('.markdown-heading')`。
4. **hover Star 按钮会弹 "You must be signed in" tooltip**，用 `action: point`。**框整个 Star 按钮，不要只框 `#repo-stars-counter-star`：** 计数器只有几十像素，推镜会糊、数字出画。`up: 2`。
4b. **locale=zh-CN 不等于中文站。** 很多站要点语言菜单。镜头写 `clicks: ["EN","中文"]`；点不到就 skip，不能卡死。`capture.py` 的 `do_clicks` 已实现。
4c. **`up` 不能爬到 article / main / body。** 父节点一碰到这三层，bbox 变成整页（宽 1600、高上万），verify 标 CUT。采之前看父节点链，停在卡片或段落。bbox 宽 ≥1500 或高 ≥800 时 capture 会打 WARN。
5. **README 懒加载会让 scrollBy 一次滚不到位**，`extend` 模式下 scrollBy 做 3 次、各等 250ms。
6. **`article h2:nth-of-type(2)` 这类结构选择器在 README 里不可靠**，用 `text=` 或 `h2:has-text('Skills')`。
6b. **README 短词会命中目录，不命中正文标题。** `get_by_text("Agent Skill")` 先打到目录链接。正文用 `article h2:has-text('Agent Skill')`。
7. **录像镜头里目标元素何时就位很重要**：hover 完成时记录 `bbox_t`，画重点不能早于它。忘了这点会把框画在空白上（宜家卡片那次）。
8. **gsap.com 首次 goto 偶发 `net::ERR_TIMED_OUT`**，goto 加 3 次重试。
8b. **README 里用 `img[alt*=...]` 定位会被 badge 抢中**：`![URDF](...URDF-Robots...)` 的 alt 就是 `URDF`，`article img[alt*="URDF"]` 命中的是徽章（28px 高）而不是 URDF demo 动图。要用足够长的唯一片段，例如 `alt*="robot description"`。同理 README 里每张图都有一个 `width=0` 的隐藏副本排在后面，`.first` 能拿到可见那张，但别写会先命中隐藏副本的选择器。
8c. **取景要在渲染前用 `scripts/verify_frames.py` 预检，不要靠脑补算。** 它按 camFor/clampCam 把截图裁成出片取景并画出画重点框，输出到 `out/verify/`。**`CUT` = 出画且该镜头挂了 mark，必须改 bbox 或去掉 mark**（脚本会 exit 1）。**`CROP` = 出画但没挂 mark，可以过**，确认取景里主体还在即可。踩过的坑：`extend` 把一个 GitHub 标题 + 整张 Skills 表并进 bbox（高 803px），z 被 clamp 到 1.5 后一屏只有 720 CSS px，画重点框上下全出画，只剩两条竖线——这种镜头直接别挂 mark。静态镜头 bbox 高度上限约 640px（z=1.5、FOCUS.y 比画面中心高 60px 吃掉 80px）。
8d. **GitHub 大图是 Git LFS 存的，`raw` 地址只能拿到指针。** 要拿真图走 `media.githubusercontent.com/media/<owner>/<repo>/main/<path>`（`curl -sIL` 看 `content-type` 确认）。但那个域名响应头带 `content-security-policy: default-src 'none'`，**`page.add_style_tag` 会被 CSP 拦掉**，图还是左上角对齐。解法：下载到项目 `assets/`，镜头 `url` 用 `file:///...`（无 CSP），再用 `css` 字段 `body{display:flex;justify-content:center;align-items:center;height:100vh;margin:0;overflow:hidden} img{max-width:920px}` 居中 + 限宽。`capture.py` 的 `css` 字段就是为这个加的（静态和录像两条路径都支持）。实测 README 三栏表格里 252px 的动图 → 920px 全尺寸，取景和画重点框都正常。

8e. **README 的 demo GIF 别录 GitHub 页，直接转成镜头。** GIF 从页面加载就开始播，settle/networkidle 之后录到第几帧不可控。`capture.py` 加了 `video_src` 分支：ffmpeg `scale+pad(color=bg)+tpad(clone)` 转成视口尺寸 mp4，返回 `bbox: null, bbox_t: 0.3`，build 按录像镜头（camVideo，zoom/focus）处理。先 `ffprobe` 看 GIF 时长，`record` 要 ≥ 对应口播句时长，不够的部分定格最后一帧。
8f. **intro 镜头 bbox = 整张图时，底图顶部会被切掉。** build 把 bbox 中心摆到 (960,370) 再放大 1.5×，整图中心 (800,500) 意味着顶部 ~250px 出画。解法见 shot-guide：用 `assets/intro.html` 套一层，透明 `#box` 指定要露出的区域当 target。

8e. **x.com 在无头 Chromium 里整页空白**（`article` 一个都没有，等 15s 也不出）。内置浏览器能看到不等于 Playwright 能采。走官方 embed 嵌本地 HTML + `frame` 字段，见 shot-guide「推文镜头」。
8f. **zsh 里 `for t in "a b c"; do set -- $t; ... $3` 拿不到位置参数**，heredoc 里 `$3` 是空的，文件名会变成 `tweet_.html`。批量生成文件用 python 写，别用 shell 位置参数。
8g. **中文路径转 `file://` 要 `pathlib.Path(p).resolve().as_uri()`**，手拼 `file://` + 中文路径会 `ERR_FILE_NOT_FOUND`。

## 配音（edge-tts / 克隆）
9. **edge-tts 要传 `boundary="WordBoundary"` 才有词级时间戳**，否则 chars 全是 0。
10. **ffmpeg concat 不能混 mp3 和 wav**，逐句先转 wav 再拼。
11. **whisper-cli 模型文件下载一半就用会报 "not all tensors loaded"**，等 ggml-small.bin 到 487MB。
12. **阿里云百炼克隆音色 API 返回 `AccessDenied.Unpurchased`**（旧项目里的 voice_id 还在，但模型权限没了），普通音色也一样，不是代码问题。
13. **IndexTTS-2.5 在 Mac MPS 能跑**（`use_bf16=False`，不装 deepspeed/flash-attn，`uv sync` 不加 `--all-extras`），但 RTF≈16：6 秒音频 100 秒。权重 4GB + 自动下载的 hf_cache 5GB，装之前看磁盘。首次跑会走本地代理慢慢下辅助模型，`print` 要 `-u` 否则日志全空。
14. **F5-TTS 开头容易吞字**，`tts_f5.py` 用 "嗯，" 垫头再裁掉。最终用户选 edge-tts。
15. **`/tmp` 下的脚本跨会话会丢**，测试脚本也放项目目录。

## 合成（HyperFrames）
16b. **花字（`.sticker`）会盖住画重点框里的原文。** 两个坑叠在一起：① tween 里有 `yPercent:-50`，所以 CSS 的 `top` 是**字块中心**而不是上边缘（128px 字号 → 字块 ≈154px，半高 77px）；② `capture.py` 把静态镜头的 bbox 摆在视口 42% 高度，推镜后又总是把 bbox 居中在视频 **y≈504**——所以画重点框中心恒在 504，跟具体是哪个镜头无关。结论：花字中心必须 ≤427（top≤39.5%）或 ≥581（top≥53.8%）。曾改成 `top:58%`（字块 549～703），但那只对矮框成立：README 段落/列表镜头 bbox 120～130 CSS px，z≈1.8 后框高 280～306px、框底到 620～633，58% 的花字正好压住框底两行原文（fast-jev 那期「一字不动」「挂了也不怕」都压了）。**现在是 `top:68%`**（字块 657～811）：框底最深 ≈640 也有 17px 余量，离字幕顶（≈910）还有 99px。改这个值前先拿 `verify_frames.py` 的框坐标算一遍。
16i. **画重点框 pad 原来上限 18 CSS px**，README 列表行距只有 ~8px，pad 一大上下边线就画在相邻两行字上，9 秒像打了删除线（QA 抓的）。**已改上限 12**（`roughRect` 的 pad）。
16j. **README 镜头别挂 `badges`**：徽章固定在左 110px，会盖住正文开头（`keepResult ≥ threshold` 被盖成 `01 原样保留`）。README 列表自己就写着三项，框住列表就够。
16k. **结尾 CTA 段光标会留在画面中央**：切镜逻辑只在下一镜头时挪光标，CTA 没有下一镜头。**已修**：`ctaStart` 时 `#cursor` `#ibeam` 一起 autoAlpha 0。
16c. **`#cta .dim` 原来是 `rgba(8,8,10,.42)`，压不住浅色/密集背景**（README 那种满屏文字）。`.62` 还不够，正文的白色粗体照样穿透 CTA 大字；提到 `.75` 后 QA 放大看胶囊内部还有推文文字穿透（胶囊底 `.86` 不够）。**现在 dim `.85` + 胶囊底 `.97`**。结尾背景固定是最后一个镜头（通常是密集的 README），dim 不到 .7 就会让 CTA 和正文打架。改完必须抽帧看 CTA 那段，别只看 check 通过。
16d. **check 输出分 Lint / Runtime / Layout / Motion / Contrast 五段，每段各有自己的 `0 error(s)` 行**。只 `tail` 会漏看——Lint 段正常就有 ~50 条 `duplicate_audio_track`（同 track index 上点缀音效有意叠播）和 1 条 `audio_volume_tween_overrides_gain`（#bgm，已知），这些都是预期的。
16. **`npx hyperframes render` 卡在 "Checking browser" 且无任何输出**：它在下载固定版 Chrome（~200MB），`--quiet` + 管道时完全看不到。先 `npx hyperframes browser ensure`，日志用 `> log 2>&1` 落盘看。
16e. **开场那句小字幕（`#hook-sub`）曾经在 build.mjs 里写死成「那就别错过这个开源项目」**，跟 `script.json` 的 `hook2` 无关——稿子念「那就**不要**错过」，画面却是「那就**别**错过」，字级对不上。**已修**：现在渲染 `${lines[1].text}`（去掉句尾标点），所以 hook2 写什么字幕就是什么。写稿时 hook2 保持在 ~14 字以内，太长会撑破 `.sub` 的居中黑底。
16g. **开场大字标注曾经写死成底部一条线**（`d="M540,745 Q760,730 960,748 T1380,744"`），两行标题只划到第二行。**已修**：按 `#hook-t` 每个字的 bbox 画圈，圈住整段 `title`。口播用 `text`，画面大字用 `title`，两者可以不等长。
16i. **开场大字超过 12 字会折两行，行间 inline-block 字符互相重叠，check 报 `content_overlap #hook-t` error。** 150px 字号 + line-height 1.1 时，SplitText 拆出的字符盒高于行高，两行就撞。**已修**：`build.mjs` 里 `hookText.length > 12` 时自动改 `top:500px; font-size:124px; line-height:1.28`，长标题（如「比Codex computer use还快」）缩成一行。圈住整段的标注按实际 bbox 画，不受影响。
16h. **改稿后不要按字数手拉每段时长。** 时间轴是口播驱动的，句子变长静帧自动多停。只有单句超过约 8 秒、死停一张图会空，才加一刀（同页推近或切下一证据）。
16f. **`#wm`（右上角「纯技术分享，无任何第三方站外引流」）是 build.mjs 里写死的水印**，不是 bug，别去删。
17. **`<video data-start>` 不能放在带 `data-start` 的祖先里**（lint error）→ 场景容器 `#scene` 不计时。
18. **每个 `<audio>` 必须有 id**，否则静音无报错。
19. **系统字体要 `@font-face { src: local() }` 声明**，否则 lint error `font_family_without_font_face`。
20. **多个 img 同一 data-URI 会报 `duplicate_media_discovery_risk`**，共用元素改成一个。
21. **PREVIEW_SEC 截短渲染时，后面的 video 片段覆盖率为 0 会被 gate 拦**，加 `HF_VIDEO_COVERAGE_THRESHOLD=0`。
21b. **渲染预览工程报 `sub_timeline_script_failure`（assets/gsap/*.min.js 加载失败）**：`video_preview/` 是独立工程，`build.mjs` 只会把截图和 voice.mp3 复制进它的 `assets/`，**不会复制 `assets/gsap/`**。预览前必须 `mkdir -p video_preview/assets && cp -R video/assets/gsap video_preview/assets/gsap`。只复制 package.json / hyperframes.json / meta.json 是不够的。
21c. **长片渲染报 `Brokered host copy requires an available runtime file rule for the source`**（阶段 `capture_disk`，帧已 100% 采完，卡在 encode）：短预览（~150 帧）走内存路径没事，长片（1980 帧）走磁盘路径就挂。**加 `--low-memory-mode` 即可**——它强制单 worker + screenshot 捕获，走的是 `capture_streaming` 路径，绕开这个 bug（66s 片约 2m13s 渲完，可接受）。`--workers 3` 反而会踩中。
21d. **BGM 音量默认值曾经是 0.22，与 `preferences.md` 要求的 `BGM_VOL=0.32` 不一致**（已修 `build.mjs` 默认值）。命令里传 `BGM=` 但**不传** `BGM_VOL` 时会静默用默认值，整片 BGM 偏小、听不出来但会被打回。**每次 build 都显式带上 `BGM_VOL=0.32`**，别依赖默认值。
21e. **`render` 偶发 `Attempted to use detached Frame '...'`（阶段 `browser_probe`，日志尾部只有 "✗ Render failed"）**：不是工程问题，直接原命令重渲就好（这次重渲一次就过了）。**注意 `tracks.sh` 是 `set -e`**——B 轨渲挂了整条链会停在第 2 步，`index.html` 停在 NO_VOICE 版本，第 3 步「还原 index.html」和第 4/5 步导出都没跑。所以渲挂之后**手动补跑**：重渲 B 轨 → `BGM=... BGM_VOL=0.32 node scripts/build.mjs out video`（还原）→ 再导出交付。**别直接重跑整个 tracks.sh**，那会把已经渲好的 A 轨再渲一遍（6 分钟白花）。
22. **`check` 里 `escaped_container #cam` 和 `rotation_pivot_drift` 警告是预期的**（镜头推近本来就要溢出容器）。
23. **确定性**：故障/乱码效果不能用 Math.random，用固定种子 PRNG 在构建期生成关键帧、逐帧 `tl.set`。ScrambleTextPlugin 内部随机只用于噪声，可接受。
24. **GSAP 的 CSS 变量可以 tween**（`"--rgb": 0`），用来做字符残影很省事。
25. **字幕超过 18 字会出画面**，按标点分段；切点避开拉丁词/数字/关键词中间。
26. **同一属性两个 tween 时间重叠会不确定**，缓推 tween 要在下一镜头切换前 0.15s 结束。
27. **GitHub 事实要核对**：README 里 skill 是 8 个不是 12 个；星标数取页面实时值。
27b. **官网数字和 README 不一致时，口播跟 README。** 例：官网写 541 cases，README 写 544。画面别卡在冲突数字上。
45. **kw 跨字幕切点会让上一句字幕整条钉在画面上，与新字幕并排**（#cap 是居中 flex 行），check 全过、无 warn，只有看成片才发现。原因：`segments()` 里 kw 边界循环把 `cut` 推到子句末尾 `c.to`，剩下的 k 轮产出空段，空段 `from` 越界 `l.chars`，字幕打字机的 `segEnd` 取 `l.chars[nextSeg.from] ?? 0` 回落成 `l.start`，上一段的 `autoAlpha: 0` 排在它自己的 `autoAlpha: 1` 之前，永远隐藏不掉。触发例：`记住这个名字，fast-jev-compaction`（kw 跨切点）。已修（双保险）：`segments()` 末尾 `.filter((sg) => sg.text.length)` 丢空段；`segEnd` 的兜底从 `?? 0` 改成 `?? l.dur`。改字幕分段逻辑后，可断言所有段 segEnd > segStart。

## 环境 / 脚本副本

34. **`~/.workbuddy-ai/skills/rico-quick-video/` 是 9/13 的旧副本**，`build.mjs` 里开场标注还是写死的底部一条线（16g 修之前）。真源是 `~/.claude/skills/rico-quick-video/`，SKILL.md 的 `cp` 命令已改指向它；每次改 skill 脚本后 `cp -r ~/.claude/skills/rico-quick-video/scripts/. ~/.workbuddy-ai/skills/rico-quick-video/scripts/` 同步一份，免得哪天又 cp 到旧的。
35. **`verify_frames.py` 依赖 `out/voice.json`**，要先跑 `tts.py` 再跑它，顺序和 SKILL.md 流程表（④ 镜头 → ⑤ 配音）相反。实际顺序：capture → tts → verify_frames → build。

## 改稿回灌（Rico 会直接改导出文件）

31a. **`build.mjs` 的 cue / kw 是从 `out/voice.json` 读的，不是 `script.json`。** `voice.json` 由 `tts.py` 生成、里面嵌了每行的 `cues`/`kw`。所以**只改 `script.json` 然后重跑 build 是无效的**——必须在改完 `script.json` 之后**重跑 `tts.py`**，让新 cue 进到 `voice.json`，再 build。（差点就这样交付了一次静默无效的修复。）纯改 CSS/样式不用重跑 tts；动到 `cues`/`kw`/文案就必须重跑。
31b. **花字可见时长要预检：<2s 等于白做。** 花字入场是 0.45s pop + 0.6s 乱码扫出，稳定形态只在之后。可见时长 = `min(下一行开始, cue时刻+3.2) - cue时刻`，所以 **cue 锚在句尾的词上必然被截短**（实测 `便于分享` 只剩 1.34s）。`build.mjs` 已加预检：`[warn] sticker "X" 只有 N s 可见（<2s），cue 锚点太靠后，往前挪`。**不要靠 build 去 clamp 花字起点**——花字必须落在它对应的那个词上，提前出现就破坏字级对齐。正确做法是把 cue 往前挪到同义的中段词（`便于分享` → `可保存`，1.34s → 3.20s）。
31. **Rico 常常直接改 `out/剪映导入/口播稿.txt` 然后说"按我的稿子重渲"**。那个文件是 `export_srt.mjs` 的**导出产物**，不是输入——真正的输入是 `script.json`。必须手工把新文案映射回 `script.json`，**并且重新推导 `kw` 和 `cues[].at`**：改一句话很容易让旧的关键词/cue 锚点失配。
32. **失配不会报错，只会静默降级**：`build.mjs` 的 `kwTime()` 找不到 `cues[].at` 时只打一行 `[warn] cue "X" not in line Y` 然后返回 `l.start`；`captionHtml()` 的 `kw` 找不到就不高亮。结果是**关键词不高亮、音效不挂、花字落点漂移**，画面直接废掉但渲染照样成功。所以回灌后**先跑一遍预检**（逐条断言 `kw in text` 和 `c.at in text`），再跑 tts。
33. 改稿会让总长变化，别忘了同步调整 `bgm.mp3` 的裁剪长度（要 ≥ 成片时长）和 C 轨的 `apad -t <成片时长>`。
28. **SendUserFile 手机端 30MB 上限**，整片发不出去，发 ffmpeg 截的 5～10 秒片段。
29. **渲染完整片前先渲 5 秒**，用户会逐秒挑，整片渲一次 1 分钟但改 5 轮就是 5 分钟。
30. **磁盘**：本机剩余空间紧张时（曾到 5.6GB），大模型下载会把 xet 暂存、hf_cache 塞满，先 `df -h`。

## 对标吸收的新元素（2026-09-19 加入）

36. **translate.goog 机翻是"尽力而为"**：capture.py 的 `translate: true` 把 URL 改写成 `<host 连字符化>.translate.goog` 代理。个别站点（CSP 严的、登录墙的）会白屏或拦截，采完必查 `out/shots/`；机翻会把专有名词翻怪（agent→特工、GitHub issue→仪式），口播点名英文名的镜头别开 translate。代理顶部横幅已用 CSS 藏掉（`#gt-nvframe`）。
37. **划词高亮（select 形态）只用于浅色页面**：`.selmark` 是 `mix-blend-mode: multiply` 的半透明蓝，深色页上会发灰看不清，深色页一律手绘框。矮框（bbox 高 ≤72px）从左往右扫，段落从上往下扫，阈值在 build.mjs 的 select 分支里。
38. **tilt 镜头别配画重点关键帧验收**：verify_frames 的 bbox 判定按平面算，倾斜后框的投影会偏，容易误标 CUT。tilt 只给纯阅读镜头，有 mark 的镜头不加 tilt。
39. **脱离 HyperFrames 直接开 index.html 自检**：`window.__timelines` 已做兜底，可以本地起 http.server 打开页面后 `window.__timelines.main.seek(t)` 逐时刻截图看新组件；但 `data-track` 的 hook/cta section 不受轨道控制会全部叠着显示，检查中段时先 `display:none` 掉 #hook 和 #cta。file:// 打不开（浏览器 pane 对项目外文件只给静态快照），要走 http。

## 画面/动效丰富化（2026-09-19 第二批）

40. **counter 和划词浮条都默认挂 bbox 右上**：同一镜头两个都有时 counter 自动挪到 bbox 左上（build.mjs counters map 里查 marks），别手动改位置。
41. **shatter 开场的碎片缝**：多边形抖动导致拼合后有细黑缝，1.0s 处淡入一层完整底图（#pc-full）盖住，属于设计的一部分，别删。
42. **关键词轻震 punch 用的是 #root 整体 scale**，不是 #cam（#cam 的 scale 被推镜 tween 占着，叠加会冲突）。punch 自动避开切镜 ±0.5s 和开场/CTA。
43. **浏览器 pane 里 seek 后立即 screenshot 会拿到上一帧**：GSAP seek 渲染和截图有一帧竞态，seek 后先 wait 1s 再截，或下一次调用再截。
44. **capture.py 曾经缺 video_src 实现**：SKILL.md 记着「本地动图/视频直接当镜头」，但代码一度丢失，镜头静默不产出 → build 崩在 shotById[...] undefined。已补回（ffmpeg 缩放居中 pad + tpad 定格）。新增数据格式能力时，SKILL.md 和 capture.py 要一起核对。
45. **口播别写自指废话**：「这条片就是它自己渲的」被 Rico 打回（"这不是废话吗"）——观众不关心素材来源，直接说画面里的效果（「先看效果」+ 列举）。
46. **竖版（FORMAT=portrait）三个坑**：① clampCam 在窗口视觉尺寸小于画布的轴上必须不夹，否则 min/max 反转把窗口顶到边上（已修）；② bbox 特写要乘 1.35 补偿，纯 SF 等比缩的特写在窄画布上太小；③ counter 挂在贴页面右缘的 bbox（Star 按钮）上会出画，`nearRight` 判定自动改挂左侧（横竖版通用修复）。

## 两支 jev subagent 实战回灌（2026-09-20）

47. **字幕整条钉死在画面上的静默 bug（已修进 build.mjs）**：kw 跨切点时 segments() 产出空段，空段 from 越界让上一段的隐藏时刻退回 l.start（隐藏早于显示）。check 全绿、build 无 warn，只有肉眼抽帧能发现。修复=segments 过滤空段 + `?? 0` 改 `?? l.dur`。**交付前的抽帧自检必须扫字幕带**。
48. **hookEnd 退化坑**：按 fastcut 写法把所有镜头挂在 cue 上时，没有任何行带 line 级 `shot`，`hookEnd` 退化成默认 3s——开场被提前切掉、承接句小字幕永不显示。第一个正片镜头要提到 line 级 `shot`。
49. **media.githubusercontent.com 只对 LFS 文件有效**：仓库没用 LFS 时它返回 0 字节，要用 `raw.githubusercontent.com`（与 #16 的场景相反，先 `curl -sIL` 看 content-length）。
50. **translate.goog 对 GitHub 会限流**：第一次成功、之后返回「速率限制」白页。替代：`hide: ["article > p"]` 把整页英文段落藏掉只留标题和表格，英文密度比机翻还低；要保住某段就 `article > p:not(:nth-of-type(N))`。
51. **机翻页面上 `text=` 选择器失效**（文字被翻译了）：改用 GitHub 锚点 id `#user-content-<slug>`（机翻不动 id）配 `:has()`；被 `<code>` 包住的英文机翻也不动，仍可 `text=` 定位。
52. **GitHub 表格外面包着 `<markdown-accessiblity-table>`**：`article table:nth-of-type(2)` 选不中，用 `article table:has-text('关键词')`。
53. **同页多镜头的 hide 样式会累积**（add_style_tag 不撤销），后面的镜头继承前面的 display:none——需要露出的内容排在 hide 它的镜头之前。
54. **capture.py 曾对 video_src 镜头强制 bbox:null**，手写 bbox 被覆盖不生效——已修（现在透传 s.bbox），视频镜头可手写画面主体区域供贴纸避让。
55. **仓库没有可视化产出时先翻文件树找 demo app**：fast-jev-compaction README 无图，但 `demo/` 里有作者专门写来录屏的 SwiftUI app（README 原话 "it exists to be screen recorded"），本机构建 + `screencapture -v -R <窗口区域>` 录屏就是最强素材。窗口 owner 名可能与目录名不同，`-V` 秒数不能传小数。
56. **shell 重试判断退出码**：`cmd | tail` 的退出码是 tail 的；重试循环要 `if cmd > log` 判真实退出码，否则失败被静默跳过。
