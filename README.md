# rico-quick-video

一个 Agent 技能（Claude Code、Codex 等支持 skill 的 Agent 均可用）：给它一个 GitHub 仓库链接，它做出一条 **40～70 秒的「开源项目速览」横版视频**，抖音/视频号那套节奏。

采集仓库页和官网 → 写口播稿 → 配音 → 出成片，最后给你三条可直接进剪辑软件的分轨。

## 为什么值得用

- **不用手搓素材**。Playwright 自动截仓库页、官网、README 里的 demo GIF；英文站可以整页机翻中文再截。
- **画面跟着口播走**。每个卖点自动推镜到页面上对应的元素，配手绘重点框或划词高亮，不是干念截图。
- **一套可复用的动效系统**。黑格背景 + 呼吸辉光窗口、四种开场（故障风 / 爆闪 / 纸片汇聚 / emoji 火焰）、卡片推移转场、3D 倾斜、任务清单卡、数字滚动、打字机字幕、关键词轻震、点缀音效。
- **交付就是三条轨**。画面、纯人声、纯音效分开给，你自己配乐剪辑，不用再从成片里剥。

## 流程

```
① 研究   读 README、外链、官网，列候选卖点（每条标出处）
② 取舍   挑 3～6 个卖点，定钩子类型，定开场底图
③ 写稿   script.json → 贴到对话里等你确认（硬闸口，不确认不动生产）
④ 镜头   shots.json → capture.py，逐个核对截图框得对不对
⑤ 配音   tts.py（edge-tts）→ verify_frames.py 查取景是否出画
⑥ 合成   build.mjs → check → 先渲开场 5 秒给你看 → 整片
⑦ 交付   画面.mp4 / 音效.m4a / 口播.m4a
```

## 安装与使用

```bash
git clone https://github.com/ricoocuii-source/rico-quick-video.git ~/.claude/skills/rico-quick-video
```

然后对你的 Agent 说一句，例如：

> 做个 rico-quick-video，仓库是 https://github.com/xxx/yyy

它会先出研究和口播稿，等你确认后才开始采集和渲染。

## 依赖

- **Node**：`hyperframes@0.8.35`（npx 自动拉取）+ Playwright 浏览器
- **Python 3**：`edge-tts`、`playwright`、`pillow`
- **ffmpeg**：变速与分轨导出
- GSAP 已随技能附带（`assets/gsap/`），无需另装

首次运行必做一次 `npx hyperframes@0.8.35 browser ensure`。

## 仓库结构

| 路径 | 内容 |
|---|---|
| `SKILL.md` | 技能入口：硬规则、流程、命令、数据格式 |
| `references/` | 口播稿写法、镜头挑选、实现层坑位、环境要求 |
| `scripts/` | 采集、配音、合成、校验、分轨 |
| `assets/gsap/` | GSAP 与插件 |
| `examples/` | 真实项目的 `script.json` / `shots.json` 样例，当参考不当规则 |

## 注意

- 口播稿是硬闸口：没确认稿子不会进入采集和渲染。
- 采集依赖页面 DOM，目标站点改版后 `shots.json` 里的选择器可能要跟着改。
- 视频产出在你的项目目录下，不在技能目录里。
- 仅用于公开可见的页面；需要登录或反爬的站点不适用。

## 隐私与安全

全程本地运行，采集、配音、渲染都不上传素材，唯一的外部请求是它要截的那些公开网页。

## English

An agent skill (Claude Code, Codex, and other skill-enabled agents) that turns a GitHub repo URL into a 40–70s vertical-format intro video: Playwright captures the repo page and site, a spoken script is written and confirmed by you, edge-tts voices it, and HyperFrames/GSAP composes the cut with push-in camera moves, hand-drawn highlights, and sticker-style captions. Ships as three separate tracks (picture, voice, SFX) so you can score and edit it yourself. MIT licensed.

## License

MIT
