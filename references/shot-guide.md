# 镜头指南（通用）

## 开场库四选一（intro 镜头的 `intro_style`，默认 glitch）

| 样式 | 适用 | 效果 |
|---|---|---|
| `glitch` | 默认，工具/框架类 | 故障风闪入 + 文字崩坏 |
| `flash` | 官网/文档有漂亮首屏时 | 黑格背景小窗白闪爆光 → 快速推满全屏（对标博主同款） |
| `shatter` | 底图是文档/README 页时 | 白色纸片爆炸汇聚成完整页面 |
| `emoji` | 模型资讯/大事件题材 | 大 emoji + 火焰底（`intro_emoji` 自定，默认 😮），配圈层呼告钩子 |

四种开场都保持「开场无音效」规则。一期只用一种，别混。

## 最强素材前置（2026-09-19 Rico：「最核心的 README 视频要尽早爆出来」）

研究阶段先问一句：**这个仓库最炸的一段素材是什么？**（官方宣传片、demo 录屏、效果 gallery）。有的话钩子后 2 秒内就切它（`video_src` 镜头 + 「先看效果」类短句），报名段挪到爆点之后。别按部就班「钩子→报名→定位」慢慢铺。官方 mp4 一般在 docs/官网 `<video>` 标签里，浏览器 network 一看就有，curl 下来裁精华 6~8 秒。

**画面产出物优先 + 口播画面解绑（同日追加）**：宣传片够长的话裁成多段（效果快闪/定位段/agent 段/收尾段），分配给各口播段落当画面——口播讲技术没关系，画面持续给效果。GitHub 文字画面只保留「必须同帧」的：报名 repo/star、背书名字出处，合计 ≤10s。结尾 `CTA_MINIMAL=1`：末句压在宣传片收尾画面上直接收。video_src 镜头可以手写 `bbox`（视频画面里正文/主体的大致区域），贴纸避让会用它挑空白侧。

## 开场底图（`role: intro`）优先级

挑这个仓库**最有辨识度的一屏**，按顺序找，找到就停：
1. README 顶部的视觉块：ASCII 字符画、logo banner、产品截图、GIF 首帧（GitHub 里是 `article` 下第一个 `img` / `div.snippet-clipboard-content`）
2. 官网首屏（有动效就录像，取第一帧）
3. 仓库标题栏 + About 区（兜底，所有仓库都有）

判断标准：静音看这一帧 1 秒，能不能猜到项目是干什么的。

**intro 的 bbox 决定底图取景，不是整张图。** build 把 intro bbox 的中心放到画面 (960, 370)、底图放大 1.5×。bbox 若是整张截图，顶部约 250px 会被切掉（demo GIF 的标题「Zürich → London. In 7.1 seconds.」就是这样丢的）。本地图片做 intro 时，写一个 `assets/intro.html`：`<img>` 绝对定位 + 一个透明 `#box` div 盖住想露出的区域（如左上 1280×494），镜头 `target: "#box"`，bbox 就是那块。

**README 的 demo GIF 想作为动态镜头**：别去录 GitHub 页（GIF 何时开始播不可控），直接 `curl` 到 `assets/`，镜头写 `{"id":"demo","video_src":"assets/demo.gif","record":10,"bg":"#f5f5ed"}`，capture 用 ffmpeg 转成 1600×1000 的 mp4，末尾定格补到 `record` 秒。`bg` 填 GIF 自己的底色，四周 pad 才不露黑边。

## 有官网：下钻策略

按这个顺序找值得录的页面，每个录 5～7 秒：
- **首屏 hero**：文字动效、视频背景、交互演示 → `record` + 滚一屏
- **案例/Showcase/Gallery**：说到大厂/案例名时用 → `record` + 滚到画廊 + `hover_text` 到那张卡（记录 bbox 供画重点）
- **Demo/Playground/Examples**：数量感 → `record` 滚 2～3 屏
- **Docs 里最亮的一页**：只在 README 没写清的卖点需要时

录像原则：每段最多两次滚动，滚完停 1 秒；`settle` 给足页面动画加载时间；有 loader 的站 settle ≥ 2.5s。

## 没有官网：纯工具/库/CLI/数据集

画面只剩 README 和代码，用这三种：
1. **README 里的 GIF/截图**：静态镜头 `target: "article img"`（第 N 个），extend 并入它的说明段
2. **README 的功能表/对比表/代码块**：静态镜头 + 画重点，一个表就是一个卖点
3. **仓库结构**：Structure/目录树代码块，配"一个文件夹一个功能"这类口播

终端里真跑命令的录屏目前没有采集脚本，需要时用 Playwright 打开一个 web 终端页或先手录，别硬凑。

### README 里的图太小？把它单独抓出来

README 常把 demo 动图塞进三栏 markdown 表格，渲染出来只有 **252px 宽**——推镜顶到 z=2.6 还是糊。这些大图基本都是 Git LFS 存的，所以：

- `raw.githubusercontent.com/...` 拿到的是 **LFS 指针文本**（`version https://git-lfs.github.com/spec/v1` + oid + size），不是图；
- `https://media.githubusercontent.com/media/<owner>/<repo>/main/<path>` 才是真图（`content-type: image/gif`，用 `curl -sIL` 确认）；
- 但直接 goto 这个 media URL 时响应头是 `content-security-policy: default-src 'none'`，**`add_style_tag` 会被 CSP 拦掉**（`Applying inline style violates...`），而且图是**左上角对齐**的，不是居中。

所以正确做法是：`curl -sL -o assets/xxx.gif <media url>` 下载到项目里，然后镜头这样写：

```json
{
  "id": "robot",
  "url": "file:///abs/path/to/assets/xxx.gif",
  "target": "img",
  "action": "point",
  "css": "body{display:flex;justify-content:center;align-items:center;height:100vh;margin:0;overflow:hidden} img{max-width:920px}"
}
```

`file://` 没有 CSP，`css` 字段能把图居中；`img{max-width:920px}` 是为了让画重点框（bbox+36 再 ×z）留在画面内——自然尺寸 960px 时框会顶到 6px 边距，收到 920 就有余量了。实测：三栏表格里的 252px 缩略图 → 920px 全尺寸，z 仍是 1.5（bbox 够大，不会被 clamp 到 2.6 去糊）。

## 推文镜头（X 高赞当背书时）

x.com 状态页在无头 Chromium 里是**整页空白**（非登录态 + headless 双重拦截），普通浏览器能看不代表 Playwright 能采。正确做法是官方 embed 嵌到本地 HTML：

```html
<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#000}body{display:flex;justify-content:center;align-items:center}#w{width:640px}</style></head><body><div id="w">
<blockquote class="twitter-tweet" data-theme="dark" data-cards="hidden" data-lang="zh-cn" data-width="640" data-dnt="true"><a href="https://twitter.com/<user>/status/<id>"></a></blockquote>
<script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script></div></body></html>
```

存到项目 `assets/tweet_xxx.html`，镜头这样写（`url` 用 `pathlib.Path(...).resolve().as_uri()` 生成，中文路径要转义）：

```json
{"id":"tweet_ceo","url":"file:///.../assets/tweet_ceo.html","settle":7000,"frame":"#twitter-widget-0","target":"article","action":"point"},
{"id":"tweet_ceo_likes","frame":"#twitter-widget-0","text":"6.9万","up":2,"action":"point"}
```

- widgets.js 渲染进 `iframe#twitter-widget-0`（class 是空的，别用 `iframe.twitter-tweet`），要 7s settle。
- `data-cards="hidden"`：带视频/图片的推文卡片高 720px，超过静态镜头 640px 上限；藏掉卡片后约 415px。
- 长推文会被折成「显示更多」，折叠掉的内容口播里不要提（同帧原则）。要完整正文只能截 x.com 原页，需要登录态，目前没走通。
- 点赞数：`text` 定位数字，`up: 2` 拿到整个 ❤ 链接（36×16 太小，推镜会糊）。
- **点赞镜头不要切 shot 推近**：embed 页除推文外全是黑，z=2.6 推到底部一半画面是黑的。cue 只挂 `mark`，不挂 `shot`，让框在整卡视图里画。
- 数字用 embed 里显示的值（zh-cn 显示 `6.9万`），口播照念。

## 节奏红线（2026-09-19 重写：竞对每 2~3 秒一个视觉状态，我们此前平均 7.4s/镜头被 Rico 打回）

1. **4 秒红线**：任何画面超过 4 秒没有状态变化（切镜/推镜落位/滚动/标注或贴纸出现）就算违规。写完稿按 6 字/秒排一遍时间轴自查。
2. **一句一变，长句两变**：每句至少 1 个 cue（shot 或 mark/sticker/task）；超过 5 秒的句子至少 2 个。
3. **同页 bbox 跳切是最便宜的提速手段**：README 长读段拆成同页 2~3 个小镜头（定义段→代码块→结果段），capture 同页复用不重新加载，相机 0.55s 直接跳。
4. **报名段做成快组合**：仓库名 1.5s → 推到 star 1.5s → 走，别在 repo 页停满一句话。
5. **长段落用 `tall` 滚动镜头**：`"tall": 1.6` 截 1.6 倍视口长图，播放时页面持续缓慢上滚——「停在页面上」变成「在页面里浏览」。tall 镜头整幅轻推、不推 bbox、不配 mark、无光标；适合「它是给 agent 设计的」这类念好几句的段落当背景。
6. 静态镜头 hold 期自动带「缓推+纵向漂移」（build 内置），但这只是兜底，别拿它当变化量凑 4 秒红线。

改稿后仍然不要按字数手拉每段时长——时间轴是口播驱动的，句子变长，静帧自动多停；变长后触发 4 秒红线就加 cue，不是改镜头时长。

## 每个卖点配画面的判定

| 卖点类型 | 画面 | 元素 |
|---|---|---|
| 数字（star、数量、速度） | 数字所在的页面元素 | 画重点（手绘框）+ coin 音效 |
| 一个功能/效果 | 官网对应的动态页 或 README 对应段落 | 花字 |
| 并列 3 项 | 列表/表格镜头 | 序号徽章 |
| 痛点 | README/文档里描述该痛点的原文（Why 段、FAQ、Quick reference 注释） | 划词高亮 |
| 反差/福利 | 原文那一句（blockquote、公告条） | `select` 选中 + 划词高亮 + 花字 |
| 案例/大厂 | Showcase 里那张卡，hover 住 | 画重点（bbox_t 之后） |
| agent 分步演示 | 每步对应的操作画面/录屏 | 任务清单进度卡（cue 的 `task`，逐条追加打绿勾） |
| star/大数字要强调滚动感 | 数字所在镜头 | `counter: "51.5k"`（bbox 右上滚数字 chip + coin；有划词浮条时自动挪左上） |
| 多场景演示（PPT/WORD/CAD…） | 各场景画面 | 每个场景一个 `corner` 角标 |

## 转场两种：模糊拉镜（默认）vs 卡片推移（`cues[].trans: "push"`）

- 推移 = 旧内容左推出、新内容右滑入，干脆利落，适合并列内容巡览（效果A→效果B→效果C）、快节奏连切。
- 模糊拉镜适合「换话题」的大切换（官网→GitHub、README→官网）。
- 一期 2~4 次推移穿插即可，全片都推移会晕。

自动挂的微动效（不用配置）：hover/click 镜头光标就位后有点击波纹；每句第一个关键词出现时画面轻震一下（与切镜自动错开）；窗口辉光缓慢呼吸；划词划完弹「搜一搜|问问AI」浮条。

## 贴纸避让机制（任务卡/序号徽章自动生效）

贴纸类组件不写死位置：build 在浏览器端算出该时刻镜头 bbox 推镜后的屏幕投影，把整组贴到空白更宽的一侧（左/右），组内间距和缩进带抖动（故意不规则），两侧都放不下就整组等比缩小（下限 0.72）。写稿时不用管贴纸位置，但**镜头 bbox 框准很重要**——bbox 就是「不许遮」的判定依据，框大了贴纸没地方放会被缩小。

## 画重点两种形态：手绘框 vs 划词高亮（2026-09-19 加入）

- **划词高亮**（`style: "select"`，或 shots.json 镜头级 `mark_style: "select"`）：蓝色 selection 扫过 bbox，模拟真人拖选。**用于浅色页面上的文本**：About 段、README 正文、列表、文档要点。矮框（≤2 行）从左往右扫，段落从上往下扫。
- **手绘框**（默认）：用于图形区域、按钮、数字、深色页面。划词的 multiply 混合在深色底上会发灰，深色页一律手绘框。
- 配合划词的镜头 `action` 用 `select`（capture 会真选中文字 + I 型光标），两层叠加最像真人操作。

## 3D 倾斜漂浮（`tilt`）

长文档/README/纯文字页的阅读镜头，加 `"tilt": true`（或 `[rx, ry]` 自定角度，默认 [2.5, -4]），页面像一张缓慢漂浮的纸，比平推有质感。**只给"读字"的静态镜头用**；官网动效录像、开场底图、有画重点框的关键帧不加（框跟着斜，验收时容易误判出画）。一期 2~4 个镜头，别全片都斜。

## 整页机翻中文（`translate`）

英文站点的镜头加 `"translate": true`，capture 会走 translate.goog 代理整页机翻成中文（观众零门槛，对标博主同款做法）。注意：
- 机翻会把专有名词翻怪（agent→特工），**口播里点名的英文名（仓库名、工具名）所在镜头不要开 translate**，或口播照机翻后的画面念。
- 个别站点拦代理，采完必查 `out/shots/`，白屏/报错就去掉 translate 用原文。
- 与 `clicks: ["EN","中文"]`（站点自带中文）二选一，站点自带中文优先。

## 静态镜头的定位技巧

- 优先 `text` 定位（`get_by_text`），其次 css；结构选择器（nth-of-type）在 README 里不可靠。
- 标题 + 正文一起框：`extend: N`，N = 后面并入的兄弟节点数；build 会把标题贴顶。
- 目标太小（一个词、一个按钮）时，推镜会到 3x，糊；把 `extend` 或 `up` 用上，让框大一点。
- **`up` 不能爬到 `article` / `main` / `body`。** 一爬上去 bbox 变成整页，verify 标 CUT，推镜废掉。采之前先看父节点链，停在卡片或段落。
- **Star 数字太小，框按钮不要框计数器。** `#repo-stars-counter-star` 只有几十像素，推镜会糊、数字还出画。`up: 2` 框住整个 Star 按钮，动作用 `point`。
- GitHub 上不要 hover 会弹 tooltip 的东西（Star/Watch/Fork 按钮），用 `point`。
- 一个页面连续多个镜头时省略 `url`，capture 会沿用不重新加载。
- 官网要中文时写 `clicks: ["EN","中文"]`。`locale=zh-CN` 不等于中文站。

## 数量

按节奏红线倒推：60 秒的片约 15~20 个视觉状态（硬切镜 + 同页跳切合计），平均 2.5~3.5s 一个。旧规则「镜头数=卖点数+3、超过 12 个算碎」已作废——那是 7 秒/镜头的慢节奏产物。卖点仍然 3~6 个，多出来的镜头来自同页拆分和快组合，不是加卖点。

## 跑完 capture 必查

打开 `out/shots/` 每张图/视频看一眼：bbox 是否框对、录像有没有录到 loader、页面是不是未登录布局（GitHub 登录态布局不同，选择器会失效）。
