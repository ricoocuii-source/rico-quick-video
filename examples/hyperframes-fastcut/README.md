# hyperframes-fastcut（2026-09-19 定稿的「新玩法」标杆样例）

HyperFrames 仓库速览，55s，Rico 逐轮打磨后拍板的版本。**下期开工先看这份取值**（旧的 gsap-skills/jev-ultrafast 是慢节奏时代的，只参考定位技巧）。

这期定下来的玩法（全部已写进 guides，这里是完整取值示范）：

1. **最强素材前置**：钩子 1.7s → 官方宣传片效果快闪（hero_clip，video_src）→ 才报名。宣传片从 docs 的 `<video>` 标签 curl 下来，裁成 5 段分配全片。
2. **画面产出物优先 + 口播画面解绑**：口播讲技术（HTML/GSAP/确定性），画面放宣传片效果段。GitHub 文字画面只剩报名（repo 1.7s → About 划词 1.5s → star+counter 2s）和背书（community 划词，名字同帧），合计 ~8s。
3. **快节奏**：22 行短句（6~16 字），18+ 视觉事件，平均 ~3s/变化，4 秒红线全过。
4. **短 CTA**：`CTA_MINIMAL=1`，末句「感兴趣的兄弟快去冲吧」压在宣传片收尾画面上直接收，无胶囊。
5. 用到的元素：flash 爆闪开场、push 推移转场（star、agent 段、design）、counter 数字滚动（51.5k）、划词+浮条（about/community）、大贴纸任务卡（写页面→接动画→跑检查→出成片，贴在宣传片画面上，video_src 镜头手写 bbox 供避让）、序号徽章（catalog 录屏上）、双样式花字（代码出片/即开即用）。

跑法：`CTA_MINIMAL=1 BGM=bgm.mp3 BGM_VOL=0.32 node scripts/build.mjs out video`（B 轨同样带 CTA_MINIMAL）。
