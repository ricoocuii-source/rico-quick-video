// 合成器：out/shots.json（截图/录像 + 目标框）+ out/voice.json（口播 + 字级时间戳）
// -> video/index.html（HyperFrames 合成，GSAP 时间线）。
// 关键规则：镜头切换/画重点/花字都绑定到口播里某个关键词出现的时刻（字级对齐）。
import fs from "node:fs";
import path from "node:path";

const [, , outDir = "out", projDir = "video"] = process.argv;
const shots = JSON.parse(fs.readFileSync(path.join(outDir, "shots.json"), "utf8"));
const voice = JSON.parse(fs.readFileSync(path.join(outDir, "voice.json"), "utf8"));

const BRAND = process.env.BRAND || "#00C3D0";
const GHOST = "#FF683C"; // 故障残影的对比色（与主色互补）
// FORMAT=portrait → 3:4 竖版（1080×1440）。素材不裁切：横版网页/视频等比完整放中部辉光窗口，
// 推镜系统按 SF 等比自适应，上下多出的空间给大字/贴纸/字幕。默认横版 1920×1080。
const PORTRAIT = process.env.FORMAT === "portrait";
const W = PORTRAIT ? 1080 : 1920, H = PORTRAIT ? 1440 : 1080;
const SF = W / 1920; // 相机缩放比例因子：所有 z 值等比缩，bbox 推镜在竖版同样成立

// ---------- 素材 ----------
const assets = path.join(projDir, "assets");
fs.mkdirSync(assets, { recursive: true });
for (const s of shots) { const f = s.video || s.png; fs.copyFileSync(path.join(outDir, f), path.join(assets, path.basename(f))); }
fs.copyFileSync(path.join(outDir, "voice.mp3"), path.join(assets, "voice.mp3"));
const bgm = process.env.BGM;
const BGM_VOL = +(process.env.BGM_VOL || 0.32);   // 口播期间 BGM 音量（Rico 定的值，比口播低约 9dB；改小会被打回）
const BGM_VOL_HI = Math.min(1, BGM_VOL * 1.5);     // 没有口播时（开场闪入、结尾）抬高一点
if (bgm) fs.copyFileSync(bgm, path.join(assets, "bgm.mp3"));

// ---------- 时间轴数据 ----------
const total = process.env.PREVIEW_SEC ? +process.env.PREVIEW_SEC : Math.ceil(voice.total + 0.6);
import { execSync } from "node:child_process";
// 音效（media-use 自带的免费商用 SFX）
const SFX_DIR = process.env.SFX_DIR || `${process.env.HOME}/.claude/skills/media-use/audio/assets/sfx`;
fs.mkdirSync(path.join(assets, "sfx"), { recursive: true });
// 开场（故障风进场那一段）不加音效：闪入故障音、崩坏重拍、硬切 whoosh 全部取消。
// 只留下面的点缀音效层，它从第一条有字幕的口播开始响。
const ACCENT_VOL = +(process.env.ACCENT_VOL || 1); // 点缀音效整体系数
// 点缀音效变体：用 ffmpeg 变调/裁剪预生成（asetrate 变调，短音效速度变化可接受）
const semis = (n) => Math.pow(2, n / 12);
const ACCENT = {
  pop0: ["pop", 0, 0.45], pop1: ["pop", 3, 0.45], pop2: ["pop", 6, 0.45],
  tick0: ["click", 0, 0.3], tick1: ["click", 3, 0.3], tick2: ["click", 6, 0.3],
  marker: ["whoosh-short", -4, 0.5], push: ["whoosh-short", -9, 0.6], cut: ["whoosh-short", 0, 0.5],
  coin: ["ping", 5, 0.8], hit: ["impact-bass-1", 0, 1.2], shine: ["chime", 0, 1.2],
  key: ["key-press", 0, 0.2], cta1: ["chime", 2, 1.0], cta2: ["ping", 0, 0.9], cta3: ["sparkle", 0, 1.2],
};
const accentReady = Object.keys(ACCENT).every((k) => fs.existsSync(path.join(assets, "sfx", k + ".mp3"))) ||
  (() => { try {
    for (const [k, [src, st, dur]] of Object.entries(ACCENT)) {
      const from = path.join(SFX_DIR, src + ".mp3"); if (!fs.existsSync(from)) return false;
      execSync(`ffmpeg -v error -y -i "${from}" -t ${dur} -af "asetrate=44100*${semis(st).toFixed(4)},aresample=44100,afade=t=out:st=${Math.max(0, dur - 0.08)}:d=0.08" "${path.join(assets, "sfx", k + ".mp3")}"`);
    }
    return true;
  } catch (e) { console.warn("[warn] accent sfx prep failed:", e.message); return false; } })();
const shotById = Object.fromEntries(shots.map((s) => [s.id, s]));
const VP = shots[0].viewport;

// 关键词 -> 该字在口播里出现的绝对时间
function kwTime(l, kw) {
  const i = l.text.indexOf(kw);
  if (i < 0) { console.warn(`[warn] cue "${kw}" not in line ${l.id}`); return l.start; }
  return l.start + Math.min(l.chars[i] ?? 0, l.dur);
}

// 末行的 next 推到时间轴之外：CTA_MINIMAL 下最后一句要压在最后一个镜头上收，
// next=total 会让它在成片结束前 ~0.9s 就消失，留一段没字幕的空尾。
const lines = voice.lines.map((l, i) => ({ ...l, next: voice.lines[i + 1]?.start ?? voice.total + 2 }));

// 事件流：shot（镜头，trans: blur|push）、mark（画重点，style: rough|select）、sticker（花字）、badges、
// task（任务清单卡）、corner（场景角标）、counter（数字滚动 chip）
const events = [];
for (const l of lines) {
  if (l.shot) events.push({ t: l.start, type: "shot", shot: l.shot, line: l });
  for (const c of l.cues || []) {
    const t = kwTime(l, c.at);
    if (c.shot) events.push({ t, type: "shot", shot: c.shot, trans: c.trans, line: l });
    if (c.mark) events.push({ t: t + 0.1, type: "mark", shot: c.mark, style: c.style, line: l });
    if (c.sticker) events.push({ t, type: "sticker", text: c.sticker, line: l });
    if (c.task) events.push({ t, type: "task", text: c.task, line: l });
    if (c.corner) events.push({ t, type: "corner", text: c.corner, line: l });
    if (c.counter) events.push({ t, type: "counter", text: c.counter, line: l });
  }
  if (l.badges) events.push({ t: l.start + 0.4, type: "badges", badges: l.badges, line: l });
}
events.sort((a, b) => a.t - b.t);
const shotEvents = events.filter((e) => e.type === "shot");
// 末个镜头事件的 end：CTA_MINIMAL 下末句压在最后镜头上收，要推到片尾之外；
// 否则钳在 ctaStart（旧胶囊 CTA 从那里接管）。注意切镜 cue 落在末行内部时
// t 会略大于 ctaStart，用旧兜底会得到负时长、镜头整个不显示。
shotEvents.forEach((e, i) => { e.end = shotEvents[i + 1]?.t ?? (process.env.CTA_MINIMAL ? total + 2 : lines[lines.length - 1].start); });
const markEvents = events.filter((e) => e.type === "mark");
markEvents.forEach((e) => {
  const se = shotEvents.find((s) => s.t <= e.t && e.t < s.end);
  e.end = se ? se.end : e.line.next;
  // 被框的内容必须已经出现：静态镜头等转场+推镜结束（0.75s），录像镜头等滚动/hover 就位（bbox_t）
  if (se) { const sh = shotById[se.shot]; const settle = sh.video ? ((sh.bbox_t ?? 0.8) + 0.15) : 0.75; e.t = Math.max(e.t, se.t + settle); }
  if (e.t > e.end - 0.6) e.t = Math.max(se ? se.t + 0.3 : e.t, e.end - 0.6);
});

// 视频镜头时间窗
const videoWin = {};
for (const e of shotEvents) if (shotById[e.shot]?.video) videoWin[e.shot] = { start: Math.max(0, e.t - 0.02), end: e.end };

// 字幕分段（竖版行窄，切短）
const MAXC = PORTRAIT ? 14 : 18;
// 竖版里 stage 整体缩到 ~0.61 倍，页面坐标系内的固定 UI（浮条/计数器/波纹/光标）要放大回来
const IS = PORTRAIT ? 1.7 : 1;
function segments(l) {
  // 先按标点切成子句；子句超过 MAXC 就均分成 n 段，切点避开拉丁词/数字中间
  const t = l.text, segs = [];
  const isWordChar = (c) => /[A-Za-z0-9.]/.test(c);
  const clauses = []; let start = 0;
  for (let i = 0; i < t.length; i++) if (/[，。！？；：!?]/.test(t[i]) || i === t.length - 1) { clauses.push({ from: start, to: i + 1 }); start = i + 1; }
  // 相邻短子句合并（≤ MAXC）
  const merged = [];
  for (const c of clauses) {
    const last = merged[merged.length - 1];
    if (last && c.to - last.from <= MAXC) last.to = c.to; else merged.push({ ...c });
  }
  for (const c of merged) {
    const len = c.to - c.from, n = Math.ceil(len / MAXC);
    let from = c.from;
    for (let k = 1; k <= n; k++) {
      let cut = k === n ? c.to : c.from + Math.round(len * k / n);
      // 长子句内部优先在顿号/逗号后切，避免把"每轮重述当前状态"这类短语切断
      if (k !== n) { let best = -1; for (let d = 0; d <= 6; d++) { for (const cc of [cut - d, cut + d]) { if (cc > from + 3 && cc < c.to - 3 && /[、，]/.test(t[cc - 1])) { best = cc; break; } } if (best >= 0) break; } if (best >= 0) cut = best; }
      while (cut > from + 3 && cut < c.to && isWordChar(t[cut - 1]) && isWordChar(t[cut])) cut--;
      for (const kw of l.kw || []) { const ki = t.indexOf(kw, from); if (ki >= 0 && ki < cut && ki + kw.length > cut) cut = ki > from + 3 ? ki : ki + kw.length; }
      segs.push({ text: t.slice(from, cut), from }); from = cut;
    }
  }
  // kw 跨切点时 cut 会被推到子句末尾，后面的 k 轮会产出空段；空段的 from 越界，
  // 会让上一段的 segEnd 退回 l.start（隐藏早于显示 → 字幕整条留在画面上），必须丢掉。
  return segs.map((sg) => ({ ...sg, text: sg.text.replace(/[，。；：、]$/, "") })).filter((sg) => sg.text.length);
}
for (const l of lines) l.segs = l.nocap ? [] : segments(l);

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function captionHtml(l, sg) {
  const kws = l.kw || []; let out = ""; let i = sg.from; const end = sg.from + sg.text.length;
  while (i < end) {
    const hit = kws.find((k) => l.text.startsWith(k, i) && i + k.length <= end);
    if (hit) { out += `<span class="kw">${[...hit].map((c, j) => `<i data-ci="${i + j}">${esc(c)}</i>`).join("")}</span>`; i += hit.length; }
    else { out += `<i data-ci="${i}">${esc(l.text[i])}</i>`; i++; }
  }
  return out;
}

// 手绘粗糙矩形路径（确定性抖动），围住 bbox，坐标为 stage 坐标
function roughRect(b, pad, seed) {
  let s = seed; const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296 - 0.5; };
  const x0 = b.x - pad, y0 = b.y - pad, x1 = b.x + b.width + pad, y1 = b.y + b.height + pad;
  const jit = Math.min(6, pad * 0.6);
  const pts = [];
  const edge = (ax, ay, bx, by, n) => { for (let k = 0; k <= n; k++) { const t = k / n; pts.push([ax + (bx - ax) * t + rnd() * jit, ay + (by - ay) * t + rnd() * jit]); } };
  const nx = Math.max(3, Math.round((x1 - x0) / 60)), ny = Math.max(2, Math.round((y1 - y0) / 60));
  edge(x0 + rnd() * jit * 2, y0, x1, y0, nx); edge(x1, y0, x1, y1, ny); edge(x1, y1, x0, y1, nx); edge(x0, y1, x0, y0 - 6, ny);
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) { const m = [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2]; d += ` Q${pts[i][0].toFixed(1)},${pts[i][1].toFixed(1)} ${m[0].toFixed(1)},${m[1].toFixed(1)}`; }
  d += ` L${pts[pts.length - 1][0].toFixed(1)},${pts[pts.length - 1][1].toFixed(1)}`;
  return d;
}
// 画重点两种形态：rough = 手绘框（图形区/按钮/数字）；select = 划词蓝色高亮（文本段落/About/列表，模拟真人拖选）。
// style 优先级：cue 的 style > shots.json 里该镜头的 mark_style > 默认 rough。
const marks = markEvents.map((e, i) => {
  const s = shotById[e.shot]; if (!s?.bbox) { console.warn("[warn] mark without bbox:", e.shot); return null; }
  if (s.tall) { console.warn("[warn] tall 镜头不配画重点（内容在滚，框会漂），忽略 mark:", e.shot); return null; }
  const style = e.style || s.mark_style || "rough";
  if (style === "select") {
    const b = s.bbox; // 划词浮条挂在选区右上（放不下就放右下）
    return { id: `sel-${i}`, style, bbox: b, t: e.t, end: e.end, shot: e.shot,
      barLeft: Math.round(Math.max(b.x, b.x + b.width - 300)), barTop: Math.round(b.y > 76 ? b.y - 64 : b.y + b.height + 12) };
  }
  const pad = Math.max(8, Math.min(12, s.bbox.height * 0.35));  // 上限 12：README 行距只有 ~8px，pad 再大会压到相邻行
  return { id: `mk-${i}`, style, d: roughRect(s.bbox, pad, 7 + i * 13), t: e.t, end: e.end, shot: e.shot };
}).filter(Boolean);
// 任务清单进度卡（agent 分步演示题材）：cue 的 task 逐条追加，绿勾逐个打上，所属句子结束一起收走
// （不能留到 CTA：后面句子的序号徽章也在左侧同一竖排，留着会叠字，check 会报 content_overlap）
const tasks = events.filter((e) => e.type === "task").map((e, i) => ({ id: `tk-${i}`, text: e.text, t: e.t, end: e.line.next }));
// 场景角标（cue 的 corner，如 "PPT"/"WORD"）：左上角小标签，标注当前演示场景，本句结束收走
const corners = events.filter((e) => e.type === "corner").map((e, i) => ({ id: `cn-${i}`, text: e.text, t: e.t, end: e.line.next }));
// 数字滚动 chip（cue 的 counter，如 "51.5k"）：在当前镜头 bbox 右上滚出目标数字。
// 渲染是逐帧 seek 的，gsap 回调不可靠，所以预生成 10 档中间值逐个换显，纯 set 驱动
const counters = events.filter((e) => e.type === "counter").map((e, i) => {
  const m = e.text.match(/^([\d.]+)(.*)$/); const target = m ? parseFloat(m[1]) : 0; const suffix = m ? m[2] : e.text;
  const dec = (m && m[1].includes(".")) ? m[1].split(".")[1].length : 0;
  const steps = Array.from({ length: 10 }, (_, k) => (target * (k + 1) / 10).toFixed(dec) + suffix);
  // 位置：挂在 counter 时刻所在镜头的 bbox 右上角（页面坐标，跟推镜走）；
  // 该镜头若有划词浮条（同挂右上），counter 改挂左上，避免叠字
  const se = shotEvents.find((s) => s.t <= e.t && e.t < s.end);
  const b = se && shotById[se.shot]?.bbox;
  const hasBar = se && marks.some((m) => m.style === "select" && m.shot === se.shot);
  const nearRight = b && b.x + b.width > VP.width - 300; // bbox 贴页面右缘（如 Star 按钮）时 chip 挂左边，否则推近后会出画/遮住按钮
  const left = b ? ((hasBar || nearRight) ? Math.max(8, b.x - 260) : Math.max(b.x, b.x + b.width - 220)) : VP.width / 2 - 110;
  const top = b ? (b.y > 80 ? b.y - 72 : b.y + b.height + 14) : 120;
  return { id: `ct-${i}`, steps, left: Math.round(left), top: Math.round(top), t: e.t, end: Math.min(e.line.next, e.t + 3.5) };
});

const stickers = events.filter((e) => e.type === "sticker").map((e, i) => ({ id: `st-${i}`, text: e.text, t: e.t, end: Math.min(e.line.next, e.t + 3.2) }));
// 花字可见时长预检：入场动画要 0.45s（pop）+ 0.6s（乱码扫出），少于 2s 就等于「闪一下」白做。
// 根因是 cue 锚在句子太靠后的词上（句尾的词离下一行开始只剩零点几秒）。改法是往前挪 cue，
// 不要靠 build 去 clamp——花字必须落在它对应的那个词上，提前出现就破坏字级对齐。
stickers.forEach((s) => {
  if (s.end - s.t < 2.0) console.warn(`[warn] sticker "${s.text}" 只有 ${(s.end - s.t).toFixed(2)}s 可见（<2s），cue 锚点太靠后，往前挪`);
});
const badgeSets = events.filter((e) => e.type === "badges").map((e, i) => ({ id: `bd-${i}`, badges: e.badges, t: e.t, end: e.line.next }));
// 开场结束 = 第一个非 intro 底图的镜头出现时刻。开场现在也上字幕了，不能再按「第一个有 shot 且非 nocap 的行」定位
// （会把 hook 行自己算进去、hookEnd 变成 0，开场段时长归零）；改按 shotEvents 里第一个非 intro 镜头。
const hook = lines[0];
const introShot = shots.find((x) => x.role === "intro") || shotById.banner;
if (!introShot) console.warn("[warn] no intro shot (role: intro / id: banner); hook background will be plain");
const hookEnd = shotEvents.find((e) => e.shot !== introShot?.id)?.t ?? 3;
// 底图取景：把字符画区块放到画面中心偏上
const INTRO_SCALE = 1.5;
const introBg = introShot?.bbox ? (() => { const cx = (introShot.bbox.x + introShot.bbox.width / 2) * INTRO_SCALE, cy = (introShot.bbox.y + introShot.bbox.height / 2) * INTRO_SCALE;
  return { w: VP.width * INTRO_SCALE, x: Math.round(W / 2 - cx), y: Math.round(H * 0.34 - cy) }; })() : { w: VP.width * INTRO_SCALE, x: 0, y: 0 };
function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// 开场库：glitch（故障风，默认）| flash（小窗爆闪进场推满）| shatter（纸片爆炸汇聚成底图）| emoji（大 emoji+火焰底，资讯题材）
// 在 shots.json 的 intro 镜头上写 intro_style / intro_emoji，或用环境变量 INTRO_STYLE 覆盖
const INTRO_STYLE = process.env.INTRO_STYLE || introShot?.intro_style || "glitch";
const INTRO_EMOJI = introShot?.intro_emoji || "\u{1F62E}";
// shatter 的碎片：4×3 网格抖动多边形 + 确定性散布参数
const shatterPieces = (() => { const r = prng(777); const cols = 4, rows = 3, out = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const jit = () => ((r() - 0.5) * 7).toFixed(1);
    const x0 = (i / cols * 100).toFixed(1), y0 = (j / rows * 100).toFixed(1), x1 = ((i + 1) / cols * 100).toFixed(1), y1 = ((j + 1) / rows * 100).toFixed(1);
    out.push({ poly: `polygon(calc(${x0}% + ${jit()}%) calc(${y0}% + ${jit()}%), calc(${x1}% + ${jit()}%) calc(${y0}% + ${jit()}%), calc(${x1}% + ${jit()}%) calc(${y1}% + ${jit()}%), calc(${x0}% + ${jit()}%) calc(${y1}% + ${jit()}%))`,
      dx: Math.round((r() - 0.5) * 1100), dy: Math.round((r() - 0.5) * 800), rot: Math.round((r() - 0.5) * 70), d: +(r() * 0.25).toFixed(2) });
  } return out; })();
const NSL = 9;
const rndSl = prng(2026);
const slices = (() => { const cuts = [0]; for (let i = 1; i < NSL; i++) cuts.push(cuts[i - 1] + 40 + rndSl() * 200); const tot = cuts[NSL - 1] + 40 + rndSl() * 200;
  return cuts.map((c, i) => ({ top: Math.round(c / tot * H), bottom: Math.round(H - ((i + 1 < NSL ? cuts[i + 1] : tot) / tot) * H) })); })();
// 一次故障爆发：从 t0 起每 step 秒一个关键帧，幅度按 decay 衰减
function burst(t0, n, step, amp, seed, decay = 1) {
  const r = prng(seed), frames = [];
  for (let k = 0; k < n; k++) {
    const a = amp * Math.pow(decay, k);
    frames.push({ t: +(t0 + k * step).toFixed(3),
      sl: Array.from({ length: NSL }, () => (r() < 0.55 ? { on: 1, x: Math.round((r() - 0.5) * 2 * a), sk: +((r() - 0.5) * 6).toFixed(1) } : { on: 0, x: 0, sk: 0 })),
      rgb: Math.round((r() * 0.7 + 0.3) * a * 0.22), flick: r() < 0.25 ? 0.35 : 1, y: Math.round((r() - 0.5) * a * 0.15) });
  }
  frames.push({ t: +(t0 + n * step).toFixed(3), sl: Array.from({ length: NSL }, () => ({ on: 0, x: 0, sk: 0 })), rgb: 0, flick: 1, y: 0 });
  return frames;
}
const glitch = {
  in: burst(0.0, 7, 0.042, 140, 11),
  punch: burst(lines[1].start, 11, 0.04, 150, 23, 0.86),
  cut: burst(hookEnd - 0.125, 3, 0.042, 120, 37),
};
// 钩子文字崩坏成乱码的 8 个变体
const GL = "▓▒░█#%&@$/<>[]{}=+*";
const hookText = hook.title || hook.text; // title 里可用「|」手动断行（渲染成 <br>，乱码/长度计算会剔除）
const hookTextLen = hookText.replace(/\|/g, "").length;
const scrambled = (() => { const r = prng(99); return Array.from({ length: 8 }, (_, k) => { const frac = 0.25 + k * 0.1; return [...hookText.replace(/\|/g, "")].map((c) => (r() < frac ? GL[Math.floor(r() * GL.length)] : c)).join(""); }); })();
const last = lines[lines.length - 1];

// ---------- 点缀音效事件 ----------
const accents = [];
let accentsDropped = 0;
if (accentReady) {
  let lastPop = -1, popI = 0;
  // 开场（0 ~ hookEnd）完全无音效。落在这个窗口里的点缀音效一律丢弃：那段画面被故障层盖着，
  // 切镜、画重点都看不见，配上音只会显得莫名其妙。
  const add = (kind, t, vol) => {
    if (t < hookEnd) { accentsDropped++; return; }
    accents.push({ kind, t: +t.toFixed(3), vol: +(vol * ACCENT_VOL).toFixed(2) });
  };
  for (const l of lines) {
    if (l.nocap) continue;
    // 句首打字机 3 下轻击
    l.chars.slice(0, 3).forEach((c, i) => add("key", l.start + c + i * 0.002, 0.12));
    // 关键词高亮：pop（数字/star 用 coin）
    for (const kw of l.kw || []) {
      const i = l.text.indexOf(kw); if (i < 0) continue;
      const t = l.start + Math.min(l.chars[i] ?? 0, l.dur);
      if (t - lastPop < 0.45) continue; lastPop = t;
      if (/star|万|\d/.test(kw)) add("coin", t, 0.38); else add("pop" + (popI++ % 3), t, 0.24);
    }
  }
  shotEvents.forEach((e, i) => { if (i === 0) return; const prev = shotEvents[i - 1];
    add(shotById[prev.shot].video || shotById[e.shot].video || (shotById[prev.shot].png !== shotById[e.shot].png) ? "cut" : "push", e.t - 0.05, 0.3); });
  for (const m of markEvents) if (shotById[m.shot]?.bbox) add("marker", m.t, 0.34);
  for (const st of events.filter((e) => e.type === "sticker")) { add("hit", st.t, 0.5); add("shine", st.t + 0.05, 0.3); }
  for (const b of events.filter((e) => e.type === "badges")) b.badges.forEach((_, i) => add("tick" + Math.min(i, 2), b.t + i * 0.7, 0.4));
  events.filter((e) => e.type === "task").forEach((tk, i) => add("tick" + Math.min(i, 2), tk.t + 0.25, 0.4));
  for (const c of events.filter((e) => e.type === "corner")) add("tick0", c.t + 0.1, 0.32);
  for (const c of events.filter((e) => e.type === "counter")) add("coin", c.t + 0.5, 0.4);
  if (!process.env.CTA_MINIMAL) [0, 1, 2].forEach((i) => add("cta" + (i + 1), last.start + 0.55 + i * 0.45, 0.4));
  accents.sort((a, b) => a.t - b.t);
  console.log("accents:", accents.length, `(开场内丢弃 ${accentsDropped} 条)`);
}

const config = { glitch, introBg, W, H, SF, PORTRAIT, VP, BRAND, total, lines, shotEvents: shotEvents.map((e) => ({ t: e.t, end: e.end, shot: e.shot, trans: e.trans })), marks, stickers, badgeSets, tasks, corners, counters, hookEnd, ctaStart: last.start, introStyle: INTRO_STYLE, shatter: shatterPieces.map((p) => ({ dx: p.dx, dy: p.dy, rot: p.rot, d: p.d })),
  shots: Object.fromEntries(shots.map((s) => [s.id, { bbox: s.bbox, video: !!s.video, png: s.png, zoom: s.zoom, focus: s.focus, action: s.action, tilt: s.tilt, tall: s.tall }])) };

const grain = `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.5 0'/></filter><rect width='160' height='160' filter='url(%23n)'/></svg>`;

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=${W}, height=${H}" />
<title>GitHub 项目速览</title>
<script src="assets/gsap/gsap.min.js"></script>
<script src="assets/gsap/SplitText.min.js"></script>
<script src="assets/gsap/CustomEase.min.js"></script>
<script src="assets/gsap/ScrambleTextPlugin.min.js"></script>
<style>
  @font-face { font-family:"PingFang SC"; src:local("PingFang SC"); }
  @font-face { font-family:"Hiragino Sans GB"; src:local("Hiragino Sans GB"); }
  body { margin:0; background:#000; font-family:"PingFang SC","Hiragino Sans GB",sans-serif; }
  #root { position:relative; width:${W}px; height:${H}px; overflow:hidden; background:#07080c; }
  .clip { position:absolute; inset:0; }
  /* 背景：黑色透视网格（2026-09-19 对标「今天学点啥？」后 Rico 拍板换掉模糊壁纸）。BG_STYLE=wall 可切回旧壁纸 */
  ${process.env.BG_STYLE === "wall" ? `#wall { position:absolute; inset:-80px; filter:blur(40px) saturate(1.15);
    background:
      radial-gradient(55% 60% at 12% 18%, #3b3f4a 0%, transparent 60%),
      radial-gradient(45% 55% at 88% 22%, ${BRAND}66 0%, transparent 62%),
      radial-gradient(60% 55% at 70% 92%, #1d2230 0%, transparent 55%),
      radial-gradient(40% 45% at 22% 88%, ${BRAND}33 0%, transparent 55%),
      linear-gradient(135deg,#0e1016,#171a22 55%,#0e1016); }` : `#wall { position:absolute; inset:0;
    background:
      radial-gradient(120% 90% at 50% 28%, rgba(255,255,255,.05), transparent 60%),
      radial-gradient(60% 50% at 82% 18%, ${BRAND}14, transparent 65%),
      repeating-linear-gradient(0deg, rgba(255,255,255,.05) 0 1.5px, transparent 1.5px 46px),
      repeating-linear-gradient(90deg, rgba(255,255,255,.05) 0 1.5px, transparent 1.5px 46px),
      #07080c; }
  #wall::after { content:""; position:absolute; inset:0; background:radial-gradient(ellipse at 50% 42%, transparent 32%, rgba(0,0,0,.68) 100%); }`}
  #grain { position:absolute; inset:0; opacity:.16; mix-blend-mode:overlay; pointer-events:none; background-image:url("data:image/svg+xml;utf8,${encodeURIComponent(grain)}"); }
  #cam { position:absolute; left:0; top:0; width:${W}px; height:${H}px; transform-origin:0 0; will-change:transform; perspective:1400px; }
  #stage { position:absolute; left:${(W - VP.width) / 2}px; top:${(H - VP.height) / 2}px; width:${VP.width}px; height:${VP.height}px;
    border-radius:16px; overflow:hidden; background:#0d1117;
    /* 辉光窗口：白色柔光描边 + 深投影（配黑格背景） */
    box-shadow:0 0 0 1px rgba(255,255,255,.09), 0 0 46px rgba(255,255,255,.13), 0 0 130px rgba(255,255,255,.06), 0 40px 90px rgba(0,0,0,.7); }
  #stage img, #stage video { position:absolute; left:0; top:0; width:${VP.width}px; height:${VP.height}px; display:block; object-fit:cover; }
  #stage img { opacity:0; visibility:hidden; }
  #cursor { position:absolute; left:0; top:0; width:${Math.round(34 * IS)}px; height:${Math.round(50 * IS)}px; opacity:0; visibility:hidden; transform-origin:4px 3px; filter:drop-shadow(0 3px 4px rgba(0,0,0,.6)); }
  #ibeam { position:absolute; left:0; top:0; width:${Math.round(18 * IS)}px; height:${Math.round(44 * IS)}px; opacity:0; visibility:hidden; transform-origin:7px 17px; filter:drop-shadow(0 2px 3px rgba(0,0,0,.6)); }
  #marks { position:absolute; left:0; top:0; width:${VP.width}px; height:${VP.height}px; overflow:visible; pointer-events:none; }
  #marks path { fill:none; stroke:${BRAND}; stroke-linecap:round; stroke-linejoin:round; opacity:0; visibility:hidden; filter:drop-shadow(0 0 2px rgba(0,0,0,.35)); }
  /* 划词蓝色高亮：模拟真人拖选文字（浏览器 selection 蓝），multiply 叠在浅色页面上不糊文字 */
  .selmark { position:absolute; background:rgba(38,111,255,.38); mix-blend-mode:multiply; opacity:0; visibility:hidden; pointer-events:none; border-radius:2px; }
  /* 任务清单进度卡：大贴纸（主色底+黑字+白割纸边+黑硬投影），位置由避让机制在浏览器端计算（找空白区贴，不遮重点区） */
  .task { position:absolute; left:0; top:0; display:flex; align-items:center; gap:22px; padding:16px 42px 16px 20px;
    background:${BRAND}; border:5px solid #111; border-radius:26px 38px 20px 40px;
    box-shadow:0 0 0 9px #fff, 14px 16px 0 rgba(0,0,0,.55); opacity:0; visibility:hidden; transform-origin:24% 50%; }
  .task .ck { width:${PORTRAIT ? 62 : 84}px; height:${PORTRAIT ? 62 : 84}px; border-radius:50%; background:#111; border:4px solid #fff; display:grid; place-items:center; flex:none; transform:rotate(-6deg); }
  .task .ck svg { width:${PORTRAIT ? 38 : 52}px; height:${PORTRAIT ? 38 : 52}px; }
  .task .ck path { fill:none; stroke:#fff; stroke-width:8; stroke-linecap:round; stroke-linejoin:round; }
  .task .tx { font-size:${PORTRAIT ? 52 : 72}px; font-weight:900; color:#0b0d12; letter-spacing:3px; white-space:nowrap; }
  /* 场景角标：左上角小标签（合规角标下方），标当前演示场景 */
  .corner { position:absolute; left:22px; top:54px; background:${BRAND}; color:#0b0d12; font-weight:900; font-size:28px; padding:8px 20px; border-radius:8px; letter-spacing:3px; box-shadow:0 6px 18px rgba(0,0,0,.4); opacity:0; visibility:hidden; transform-origin:0 50%; }
  /* 数字滚动 chip：镜头 bbox 右上滚出目标数字 */
  .counter { position:absolute; background:#101216; color:${BRAND}; font-weight:900; font-size:${Math.round(36 * IS)}px; padding:${Math.round(8 * IS)}px ${Math.round(20 * IS)}px; border-radius:10px; border:2px solid ${BRAND}; box-shadow:0 8px 24px rgba(0,0,0,.4); opacity:0; visibility:hidden; white-space:nowrap; }
  /* 划词浮条：select 划完后 bbox 右上弹出的「搜一搜|问问AI」小工具条（真人操作感） */
  .selbar { position:absolute; display:flex; align-items:center; background:#fff; border-radius:10px; box-shadow:0 8px 24px rgba(0,0,0,.35); overflow:hidden; opacity:0; visibility:hidden; transform-origin:20% 100%; }
  .selbar span { padding:${Math.round(8 * IS)}px ${Math.round(16 * IS)}px; font-size:${Math.round(22 * IS)}px; font-weight:600; color:#333; white-space:nowrap; }
  .selbar span + span { border-left:1px solid #e2e2e6; }
  /* 光标点击波纹 */
  #ripple { position:absolute; width:${Math.round(56 * IS)}px; height:${Math.round(56 * IS)}px; margin:-${Math.round(28 * IS)}px 0 0 -${Math.round(28 * IS)}px; border:4px solid ${BRAND}; border-radius:50%; opacity:0; visibility:hidden; pointer-events:none; }
  /* 辉光呼吸层：与 #stage 同框，只出辉光，透明度呼吸 */
  #stageGlow { position:absolute; left:${(W - VP.width) / 2}px; top:${(H - VP.height) / 2}px; width:${VP.width}px; height:${VP.height}px; border-radius:16px;
    box-shadow:0 0 70px rgba(255,255,255,.16), 0 0 180px rgba(255,255,255,.07); opacity:.5; pointer-events:none; }
  /* 花字第二样式：斜体重影 pop（与乱码扫出轮换） */
  .sticker.alt { font-style:italic; color:#fff; -webkit-text-stroke:4px #111; text-shadow:10px 10px 0 ${BRAND}, 20px 20px 0 rgba(0,0,0,.35); }
  /* 字幕 */
  #cap { position:absolute; left:0; right:0; bottom:${PORTRAIT ? 140 : 74}px; display:flex; justify-content:center; pointer-events:none; }
  .line { position:absolute; bottom:0; width:max-content; box-sizing:border-box; padding:6px 12px; background:transparent; border-radius:0; z-index:0; white-space:nowrap; font-size:58px; font-weight:800; color:#fff; letter-spacing:1px;
    -webkit-text-stroke:1.5px #1a1a1a; paint-order:stroke fill; text-shadow:0 3px 0 #1a1a1a, 0 8px 22px rgba(0,0,0,.7); opacity:0; visibility:hidden; }
  /* 字幕黑底：宽度由时间线逐字推进，只包裹已显示的字，不铺满整行 */
  .line::before { content:""; position:absolute; left:0; top:0; bottom:0; width:var(--caption-bg-width,24px); background:rgba(0,0,0,0.8); border-radius:0; z-index:-1; }
  .line i { font-style:normal; opacity:0; visibility:hidden; display:inline-block; }
  .line .kw { color:${BRAND}; font-size:68px; }
  .line .tw { position:absolute; left:0; bottom:12px; width:20px; height:64px; background:${BRAND}; opacity:0; visibility:hidden; }
  /* 花字 */
  /* 花字：注意 tween 里有 yPercent:-50，所以 top 是**字块中心**，不是上边缘。
     字块高度 = 128px 字号 × 1.2 ≈ 154px，半高 77px。
     而 capture.py 把静态镜头的 bbox 摆在视口 42% 高度，推镜后又总是居中在视频 y≈504——
     所以画重点框中心恒在 504，花字中心必须 ≤427（top≤39.5%）或 ≥581（top≥53.8%）才不压住原文。
     取 58%（字块 549～703）：躲开所有画重点框，离底部字幕（79% 起 ≈851）还有 148px。 */
  .sticker { position:absolute; left:50%; top:68%; transform-origin:50% 50%; opacity:0; visibility:hidden; white-space:nowrap;
    font-size:${PORTRAIT ? 92 : 128}px; font-weight:900; color:${BRAND}; -webkit-text-stroke:5px #111; paint-order:stroke fill; letter-spacing:2px;
    text-shadow:10px 10px 0 #111, 0 0 40px rgba(0,0,0,.5); }
  /* 序号徽章 */
  .badge { position:absolute; left:0; top:0; display:flex; align-items:center; gap:16px; opacity:0; visibility:hidden; transform-origin:0 50%; }
  .badge .num { width:${PORTRAIT ? 60 : 74}px; height:${PORTRAIT ? 60 : 74}px; border-radius:50%; background:${BRAND}; display:grid; place-items:center; color:#111; font-weight:900; font-size:32px; box-shadow:0 6px 0 #111; }
  .badge .txt { background:#111; color:#fff; font-weight:800; font-size:${PORTRAIT ? 42 : 52}px; padding:8px 26px; border-radius:10px; letter-spacing:2px; border:3px solid ${BRAND}; }
  /* 开场：故障风进场 */
  #hook { background:#06070a; overflow:hidden; }
  #hook .gl { position:absolute; left:0; top:0; width:${W}px; height:${H}px; transform-origin:50% 42%; }
  #hook .gl .ly { position:absolute; inset:0; background:url(assets/${introShot ? path.basename(introShot.png) : ""}) ${introBg.x}px ${introBg.y}px / ${introBg.w}px auto no-repeat #0d1117; }
  #hook .gl .r { filter:url(#fR); mix-blend-mode:screen; }
  #hook .gl .g { filter:url(#fG); }
  #hook .gl .b { filter:url(#fB); mix-blend-mode:screen; }
  #hook .gl .sl { opacity:0; visibility:hidden; }
  ${slices.map((c, i) => `#hook .gl .sl${i} { clip-path: inset(${c.top}px 0 ${c.bottom}px 0); }`).join("\n  ")}
  #hook .scan { position:absolute; inset:0; background:repeating-linear-gradient(0deg, rgba(0,0,0,.28) 0 2px, transparent 2px 5px); pointer-events:none; }
  #hook .noise { position:absolute; inset:0; background:url("data:image/svg+xml;utf8,${encodeURIComponent(grain)}"); opacity:.07; }
  #hook .vig { position:absolute; inset:0; background:radial-gradient(ellipse at 50% 45%, transparent 35%, rgba(0,0,0,.72) 100%); }
  #hook .dim { position:absolute; inset:0; background:#06070a; opacity:.62; }
  #hook .flash { position:absolute; inset:0; background:${BRAND}; opacity:0; }
  #hook .bar { position:absolute; left:0; width:${W}px; height:5px; top:0; background:${BRAND}; box-shadow:0 0 24px 6px ${BRAND}99; opacity:0; visibility:hidden; }
  #hook .t, #hook .tg { position:absolute; left:0; right:0; top:${Math.round(H * (hookTextLen > 14 ? 0.45 : 0.52))}px; text-align:center; font-size:${hookTextLen > 14 ? (PORTRAIT ? 64 : 104) : (PORTRAIT ? 86 : 150)}px; padding:0 60px; font-weight:900; color:#fff; letter-spacing:2px; line-height:1.1; perspective:800px;
    text-shadow:0 8px 40px rgba(0,0,0,.7); }
  #hook .t .c { display:inline-block; --rgb:0; text-shadow: calc(var(--rgb) * -1px) 0 ${BRAND}, calc(var(--rgb) * 1px) 0 ${GHOST}, 0 8px 40px rgba(0,0,0,.7); }
  #hook .t em { font-style:normal; color:${BRAND}; }
  #hook .tg { opacity:0; visibility:hidden; font-family:"Menlo","PingFang SC",monospace; color:#e8e8ec; text-shadow:-6px 0 ${BRAND}, 6px 0 ${GHOST}; }
  #hook .ul { position:absolute; left:0; top:0; width:${W}px; height:${H}px; overflow:visible; pointer-events:none; }
  #hook .ul path { fill:none; stroke:${BRAND}; stroke-width:12; stroke-linecap:round; stroke-linejoin:round; }
  /* 开场库：flash / shatter / emoji 变体 */
  #hook .gridbg { position:absolute; inset:0; background:
      radial-gradient(120% 90% at 50% 28%, rgba(255,255,255,.05), transparent 60%),
      repeating-linear-gradient(0deg, rgba(255,255,255,.05) 0 1.5px, transparent 1.5px 46px),
      repeating-linear-gradient(90deg, rgba(255,255,255,.05) 0 1.5px, transparent 1.5px 46px), #07080c; }
  #hook .win { position:absolute; left:0; top:0; width:${W}px; height:${H}px; transform-origin:50% 46%; border-radius:18px; overflow:hidden;
    box-shadow:0 0 0 1px rgba(255,255,255,.1), 0 0 60px rgba(255,255,255,.22), 0 0 180px rgba(255,255,255,.1), 0 40px 110px rgba(0,0,0,.7); opacity:0; visibility:hidden; }
  #hook .win .wimg { position:absolute; inset:0; background:url(assets/${introShot ? path.basename(introShot.png) : ""}) ${introBg.x}px ${introBg.y}px / ${introBg.w}px auto no-repeat #0d1117; }
  #hook .win .wflash { position:absolute; inset:0; background:#fff; opacity:0; }
  #hook .pc { position:absolute; inset:0; background:url(assets/${introShot ? path.basename(introShot.png) : ""}) ${introBg.x}px ${introBg.y}px / ${introBg.w}px auto no-repeat #0d1117; opacity:0; visibility:hidden; will-change:transform; }
  #hook .flame { position:absolute; inset:-120px; transform-origin:50% 80%; background:
      radial-gradient(60% 55% at 50% 88%, #ff9a3c 0%, #f0442b 34%, rgba(120,20,8,.9) 62%, #140505 88%),
      radial-gradient(38% 30% at 32% 96%, rgba(255,214,90,.85), transparent 70%),
      radial-gradient(38% 30% at 68% 96%, rgba(255,170,60,.75), transparent 70%), #140505; }
  #hook .emoji { position:absolute; left:0; right:0; top:${Math.round(H * 0.14)}px; text-align:center; font-size:${PORTRAIT ? 260 : 340}px; line-height:1; opacity:0; visibility:hidden;
    filter:drop-shadow(0 24px 60px rgba(0,0,0,.55)); }
  /* 结尾 */
  #cta .dim { position:absolute; inset:0; background:rgba(8,8,10,.85); }
  #cta .bar { position:absolute; left:50%; top:${Math.round(H * 0.4)}px; display:flex; align-items:center; gap:44px; padding:26px 54px;
    background:rgba(12,12,14,.97); border:3px solid ${BRAND}; border-radius:120px; box-shadow:0 30px 70px rgba(0,0,0,.6); opacity:0; visibility:hidden; }
  #cta .it { display:flex; align-items:center; gap:16px; font-size:56px; font-weight:800; color:#fff; letter-spacing:4px; opacity:0; visibility:hidden; }
  #cta .it svg { width:64px; height:64px; }
  #cta .it svg path { fill:none; stroke:${BRAND}; stroke-width:5; stroke-linecap:round; stroke-linejoin:round; }
  #cta .sep { width:4px; height:54px; background:${BRAND}; border-radius:2px; opacity:.6; }
  #cta .foot { position:absolute; left:0; right:0; top:${Math.round(H * 0.565)}px; text-align:center; font-size:40px; color:#e8e8ec; letter-spacing:5px; opacity:0; visibility:hidden; }
  #cta .foot b { color:${BRAND}; }
  /* 常驻合规角标：左上角（对标博主同款位置），WM_TEXT 可覆盖 */
  #wm { position:absolute; left:22px; top:10px; color:rgba(255,255,255,.62); font-size:22px; letter-spacing:1px; }
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-width="${W}" data-height="${H}" data-duration="${total}">

  <section id="scene" class="clip">
    <div id="wall"></div><div id="grain"></div>
    <div id="cam">
      <div id="stageGlow"></div>
      <div id="stage">
        ${shots.map((s) => s.video
          ? `<video id="img-${s.id}" src="assets/${path.basename(s.video)}" data-start="${(videoWin[s.id]?.start ?? 0).toFixed(2)}" data-duration="${((videoWin[s.id]?.end ?? 0.1) - (videoWin[s.id]?.start ?? 0)).toFixed(2)}" muted playsinline></video>`
          : `<img id="img-${s.id}" src="assets/${path.basename(s.png)}"${s.tall ? ` style="height:${Math.round(VP.height * s.tall)}px"` : ""} />`).join("\n        ")}
        <svg id="marks" viewBox="0 0 ${VP.width} ${VP.height}">
          ${marks.filter((m) => m.style !== "select").map((m) => `<path id="${m.id}" d="${m.d}" />`).join("\n          ")}
        </svg>
        ${marks.filter((m) => m.style === "select").map((m) => `<div class="selmark" id="${m.id}" style="left:${m.bbox.x - 2}px;top:${m.bbox.y - 2}px;width:${m.bbox.width + 4}px;height:${m.bbox.height + 4}px"></div>`).join("\n        ")}
        <svg id="cursor" viewBox="0 0 26 38"><path d="M4 3 L4 30 L10 24 L14 34 L19 32 L15 22 L23 22 Z" fill="#fff" stroke="#000" stroke-width="2" stroke-linejoin="round"/></svg>
        <svg id="ibeam" viewBox="0 0 14 34"><path d="M2 2 H12 M7 2 V32 M2 32 H12" stroke="#fff" stroke-width="3" stroke-linecap="round"/><path d="M2 2 H12 M7 2 V32 M2 32 H12" stroke="#000" stroke-width="1.2" stroke-linecap="round"/></svg>
        <div id="ripple"></div>
        ${marks.filter((m) => m.style === "select").map((m) => `<div class="selbar" id="${m.id}-bar" style="left:${m.barLeft}px;top:${m.barTop}px"><span>搜一搜</span><span>问问AI</span></div>`).join("\n        ")}
        ${counters.map((c) => `<div class="counter" id="${c.id}" style="left:${c.left}px;top:${c.top}px">${esc(c.steps[0])}</div>`).join("\n        ")}
      </div>
    </div>
    ${stickers.map((s, i) => `<div class="sticker${i % 2 ? " alt" : ""}" id="${s.id}">${esc(s.text)}</div>`).join("\n    ")}
    ${corners.map((c) => `<div class="corner" id="${c.id}">${esc(c.text)}</div>`).join("\n    ")}
    ${badgeSets.flatMap((b) => b.badges.map((t, i) => `<div class="badge" id="${b.id}-${i}"><div class="num">0${i + 1}</div><div class="txt">${esc(t)}</div></div>`)).join("\n    ")}
    ${tasks.map((tk) => `<div class="task" id="${tk.id}"><div class="ck"><svg viewBox="0 0 32 32"><path id="${tk.id}-ck" d="M7 17 L13 23 L25 9"/></svg></div><div class="tx">${esc(tk.text)}</div></div>`).join("\n    ")}
  </section>

  <svg width="0" height="0" style="position:absolute">
    <filter id="fR"><feColorMatrix values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"/></filter>
    <filter id="fG"><feColorMatrix values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"/></filter>
    <filter id="fB"><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"/></filter>
  </svg>
  <section id="hook" class="clip" data-start="0" data-duration="${hookEnd.toFixed(2)}" data-track-index="1">
    ${INTRO_STYLE === "glitch" ? `<div class="gl" id="hook-gl">
      <div class="ly g" id="gl-g"></div>
      <div class="ly r" id="gl-r"></div>
      <div class="ly b" id="gl-b"></div>
      ${slices.map((_, i) => `<div class="ly sl sl${i}" id="gl-sl${i}"></div>`).join("\n      ")}
    </div>
    <div class="dim" id="hook-dim"></div>
    <div class="scan"></div><div class="noise"></div><div class="vig"></div>
    <div class="bar" id="hook-bar"></div>` : ""}
    ${INTRO_STYLE === "flash" ? `<div class="gridbg"></div>
    <div class="win" id="hook-win"><div class="wimg"></div><div class="wflash" id="hook-wflash"></div></div>
    <div class="dim" id="hook-dim"></div>
    <div class="noise"></div><div class="vig"></div>` : ""}
    ${INTRO_STYLE === "shatter" ? `<div class="gridbg"></div>
    ${shatterPieces.map((p, i) => `<div class="pc" id="pc-${i}" style="clip-path:${p.poly}"></div>`).join("\n    ")}
    <div class="pc" id="pc-full"></div>
    <div class="dim" id="hook-dim"></div>
    <div class="noise"></div><div class="vig"></div>` : ""}
    ${INTRO_STYLE === "emoji" ? `<div class="flame" id="hook-flame"></div>
    <div class="emoji" id="hook-emoji">${INTRO_EMOJI}</div>
    <div class="dim" id="hook-dim"></div>
    <div class="noise"></div><div class="vig"></div>` : ""}
    <div class="t" id="hook-t">${esc(hookText).replace(/太丑/, "<em>太丑</em>").replace(/\|/g, "<br>")}</div>
    ${INTRO_STYLE === "glitch" ? scrambled.map((t, k) => `<div class="tg" id="hook-tg${k}">${esc(t)}</div>`).join("\n    ") : ""}
    <svg class="ul"><path id="hook-ul" d="" /></svg>
    <div class="flash" id="hook-flash"></div>
  </section>

  ${process.env.CTA_MINIMAL ? "" : `<section id="cta" class="clip" data-start="${last.start.toFixed(2)}" data-duration="${(total - last.start).toFixed(2)}" data-track-index="2">
    <div class="dim"></div>
    <div class="bar" id="cta-bar">
      <div class="it"><svg viewBox="0 0 64 64"><path id="ic-like" d="M32 54 C14 42 8 34 8 24 C8 16 14 11 20 11 C25 11 29 14 32 18 C35 14 39 11 44 11 C50 11 56 16 56 24 C56 34 50 42 32 54 Z"/></svg>点赞</div>
      <div class="sep"></div>
      <div class="it"><svg viewBox="0 0 64 64"><path id="ic-follow" d="M32 12 V52 M12 32 H52"/></svg>关注</div>
      <div class="sep"></div>
      <div class="it"><svg viewBox="0 0 64 64"><path id="ic-comment" d="M10 14 H54 V44 H28 L16 54 V44 H10 Z"/></svg>评论</div>
    </div>
    <div class="foot" id="cta-foot">持续分享<b>高质量开源项目</b> · 一起进步</div>
  </section>`}

  <div id="cap">
    ${lines.flatMap((l) => l.segs.map((sg, k) => `<div class="line" id="ln-${l.id}-${k}">${captionHtml(l, sg)}<span class="tw"></span></div>`)).join("\n    ")}
  </div>
  <div id="wm">${esc(process.env.WM_TEXT || "*纯干货分享，不存在站外引流")}</div>

  ${accents.map((a, i) => `<audio id="ac-${i}" src="assets/sfx/${a.kind}.mp3" data-start="${a.t.toFixed(2)}" data-duration="${ACCENT[a.kind][2]}" data-track-index="14" data-volume="${a.vol}"></audio>`).join("\n  ")}
  ${process.env.NO_VOICE ? "<!-- 口播音轨已省略（NO_VOICE=1），时间轴仍按 voice.json 对齐 -->" : `<audio id="voice" src="assets/voice.mp3" data-start="0" data-duration="${voice.total.toFixed(2)}" data-track-index="10" data-volume="1"></audio>`}
  ${bgm ? `<audio id="bgm" src="assets/bgm.mp3" data-start="0" data-duration="${total}" data-track-index="11" data-volume="${BGM_VOL}"></audio>` : ""}
</div>

<script>
gsap.registerPlugin(SplitText, CustomEase, ScrambleTextPlugin);
CustomEase.create("cam", "M0,0 C0.25,0 0.05,1 1,1");
CustomEase.create("pop", "M0,0 C0.2,0 0.3,1.35 0.55,1.02 0.7,0.98 0.85,1 1,1");

const CFG = ${JSON.stringify(config)};
const { W, H, SF, PORTRAIT, VP, lines, shotEvents, marks, stickers, badgeSets, tasks, corners, counters, shots } = CFG;
const stageLeft = (W - VP.width) / 2, stageTop = (H - VP.height) / 2;
const BASE = 1.09 * SF;
// 竖版焦点偏上：窗口占中带，底部留给大字幕，顶部留给贴纸/角标
const FOCUS = { x: W / 2, y: PORTRAIT ? H * 0.40 : H / 2 - 60 };

function clampCam(z, x, y) {
  const M = 40;
  // 某轴上窗口视觉尺寸小于画布（竖版常态）时不夹该轴——夹了会 min/max 反转把窗口顶到边上
  if (z * VP.width > W - 2 * M) { x = Math.min(x, M - z * stageLeft); x = Math.max(x, W - M - z * (stageLeft + VP.width)); }
  if (z * VP.height > H - 2 * M) { y = Math.min(y, M - z * stageTop); y = Math.max(y, H - M - z * (stageTop + VP.height)); }
  return { z, x, y };
}
function camFor(bbox, mul = 1) {
  if (!bbox) { const z = BASE * mul; const c = { x: stageLeft + VP.width / 2, y: stageTop + VP.height / 2 }; return { z, x: FOCUS.x - z * c.x, y: FOCUS.y - z * c.y }; }
  const z = SF * (PORTRAIT ? 1.35 : 1) * Math.min(2.6, Math.max(1.5, Math.min(1500 / bbox.width, 560 / bbox.height))) * mul; // 竖版特写补偿
  const px = stageLeft + bbox.x + bbox.width / 2, py = stageTop + bbox.y + bbox.height / 2;
  return clampCam(z, FOCUS.x - z * px, FOCUS.y - z * py);
}
function camVideo(s, mul = 1) {
  if (s.bbox) { const z = SF * (PORTRAIT ? 1.35 : 1) * Math.min(1.7, Math.max(1.3, Math.min(1500 / s.bbox.width, 560 / s.bbox.height))) * mul;
    const px = stageLeft + s.bbox.x + s.bbox.width / 2, py = stageTop + s.bbox.y + s.bbox.height / 2; return clampCam(z, FOCUS.x - z * px, FOCUS.y - z * py); }
  const z = SF * (s.zoom || 1.15) * mul, f = s.focus || [0.5, 0.42];
  return clampCam(z, FOCUS.x - z * (stageLeft + VP.width * f[0]), FOCUS.y - z * (stageTop + VP.height * f[1]));
}
const center = (b) => b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : { x: VP.width / 2, y: VP.height / 2 };

// ================= 贴纸避让机制 =================
// 贴纸类叠加组件（任务卡/序号徽章）不许遮当前镜头的重点内容：算出该时刻 bbox 推镜后的屏幕投影，
// 把整组贴到空白更宽的一侧；两侧都窄就整组等比缩小。组内间距/缩进带抖动，故意不规则。
function focusRectAt(t) {
  const se = shotEvents.find((s2) => s2.t <= t && t < s2.end);
  if (!se) return null;
  const s2 = shots[se.shot];
  if (s2.tall) return { x: W * 0.06, y: 150, w: W * 0.62, h: H - 400 }; // tall 内容在滚没有固定重点区，按「正文居中左」近似，贴纸自然靠右
  if (!s2.bbox) return null;
  const cam = s2.video ? camVideo(s2) : camFor(s2.bbox);
  return { x: cam.x + cam.z * (stageLeft + s2.bbox.x), y: cam.y + cam.z * (stageTop + s2.bbox.y),
           w: cam.z * s2.bbox.width, h: cam.z * s2.bbox.height };
}
function placeStickers(ids, t0) {
  // 原则：贴纸尺寸优先（要冲击感），位置全屏找空白——先挑空白宽的一侧，
  // 侧边放不下且会压掉重点区超过 22% 宽时，整组挪到重点区下方（不够再上方），轻微压边是允许的（抖音贴纸常态）
  const fr = focusRectAt(t0);
  const M = 44;
  const els = ids.map((id) => document.getElementById(id));
  const maxW = Math.max(...els.map((el) => el.offsetWidth));
  const h = els[0].offsetHeight, n = els.length;
  const jitX = [0, 42, 16, 54, 28], jitY = [0, -10, 10, -6, 14];
  let side = "left", top0 = 190, scale = 1;
  if (fr) {
    const leftGap = Math.max(0, fr.x), rightGap = Math.max(0, W - fr.x - fr.w);
    side = rightGap > leftGap ? "right" : "left";
    const gap = Math.max(leftGap, rightGap);
    top0 = Math.max(140, Math.min(fr.y, 300));
    const overlap = maxW + M * 1.3 - gap;
    if (overlap > fr.w * 0.22) {
      const need = n * (h + 22);
      const below = H - (fr.y + fr.h);
      top0 = below >= fr.y ? fr.y + fr.h + 28 : Math.max(80, fr.y - need - 28);
    }
  }
  // 底部给字幕带留 240px；实在放不下再整组缩（下限 0.8，尽量不触发）
  const needH = n * (h + 22);
  top0 = Math.max(80, Math.min(top0, H - 240 - needH));
  if (top0 <= 80 && needH > H - 320) scale = 0.8;
  els.forEach((el, i) => {
    const x = side === "left" ? M + jitX[i % 5] : W - M - el.offsetWidth * scale - jitX[i % 5];
    gsap.set(el, { left: x, top: top0 + i * (h * scale + 22 + jitY[i % 5]) });
  });
  return scale;
}

const tl = gsap.timeline({ paused: true });

// ================= 开场（开场库：glitch / flash / shatter / emoji） =================
// 大字圈定逻辑各分支共用；开场（0~hookEnd）依旧完全无音效
function hookCircle(chars) {
  const ul = document.getElementById("hook-ul");
  const hookBox = document.getElementById("hook").getBoundingClientRect();
  let x1 = 1e9, y1 = 1e9, x2 = 0, y2 = 0;
  chars.forEach((el) => { const r = el.getBoundingClientRect();
    x1 = Math.min(x1, r.left); y1 = Math.min(y1, r.top); x2 = Math.max(x2, r.right); y2 = Math.max(y2, r.bottom); });
  const sx = ${W} / hookBox.width, sy = ${H} / hookBox.height;
  const padX = 48, padY = 36;
  const cx = ((x1 + x2) / 2 - hookBox.left) * sx, cy = ((y1 + y2) / 2 - hookBox.top) * sy;
  const rx = (x2 - x1) * sx / 2 + padX, ry = (y2 - y1) * sy / 2 + padY;
  ul.setAttribute("d", ["M", cx - rx, ",", cy, " C ", cx - rx, ",", cy - ry * 0.92, " ", cx - rx * 0.5, ",", cy - ry * 1.04, " ", cx, ",", cy - ry, " C ", cx + rx * 0.52, ",", cy - ry * 0.96, " ", cx + rx * 1.03, ",", cy - ry * 0.88, " ", cx + rx, ",", cy, " C ", cx + rx * 0.98, ",", cy + ry * 0.94, " ", cx + rx * 0.48, ",", cy + ry * 1.05, " ", cx, ",", cy + ry, " C ", cx - rx * 0.46, ",", cy + ry * 0.98, " ", cx - rx * 1.03, ",", cy + ry * 0.84, " ", cx - rx, ",", cy].join(""));
  return ul;
}
if (CFG.introStyle !== "glitch") {
  const t1 = Math.min(lines[1].start, CFG.hookEnd);
  const style = CFG.introStyle;
  let tTitle = 0.4; // 大字进场时刻，等底图动画落定
  if (style === "flash") {
    gsap.set("#hook-win", { scale: 0.22 });
    tl.set("#hook-win", { autoAlpha: 1 }, 0.04);
    tl.fromTo("#hook-wflash", { opacity: 1 }, { opacity: 0, duration: 0.3, ease: "power2.out" }, 0.04);
    tl.to("#hook-win", { scale: 0.3, duration: 0.26, ease: "pop" }, 0.06);
    tl.to("#hook-win", { scale: 1, duration: 0.5, ease: "power3.inOut" }, 0.44);
    tl.set("#hook-wflash", { opacity: 0.45 }, 0.46); tl.to("#hook-wflash", { opacity: 0, duration: 0.2 }, 0.5);
    gsap.set("#hook-dim", { opacity: 0 });
    tl.to("#hook-dim", { opacity: 0.62, duration: 0.25 }, 0.95);
    tl.fromTo("#hook-win", { scale: 1 }, { scale: 1.06, duration: Math.max(0.1, CFG.hookEnd - 1), ease: "none" }, 1);
    tTitle = 1.0;
  } else if (style === "shatter") {
    gsap.set("#hook-dim", { opacity: 0.62 });
    CFG.shatter.forEach((p, i) => {
      tl.set("#pc-" + i, { autoAlpha: 1 }, 0.02);
      tl.fromTo("#pc-" + i, { x: p.dx, y: p.dy, rotation: p.rot, scale: 0.7 },
        { x: 0, y: 0, rotation: 0, scale: 1, duration: 0.75, ease: "power3.out" }, 0.05 + p.d);
    });
    tl.fromTo("#pc-full", { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.35 }, 1.0); // 拼合后盖住碎片缝
    tl.fromTo(".pc", { scale: 1 }, { scale: 1.05, duration: Math.max(0.1, CFG.hookEnd - 1.1), ease: "none" }, 1.1);
    tTitle = 0.9;
  } else { // emoji
    gsap.set("#hook-dim", { opacity: 0.3 });
    tl.fromTo("#hook-emoji", { autoAlpha: 0, scale: 0.3, y: 70 }, { autoAlpha: 1, scale: 1, y: 0, duration: 0.5, ease: "pop" }, 0.12);
    tl.to("#hook-emoji", { y: -16, duration: 0.8, yoyo: true, repeat: Math.max(1, Math.ceil(CFG.hookEnd / 0.8)), ease: "sine.inOut" }, 0.65);
    tl.fromTo("#hook-flame", { scale: 1 }, { scale: 1.07, duration: 0.45, yoyo: true, repeat: Math.max(1, Math.ceil(CFG.hookEnd / 0.45)), ease: "sine.inOut" }, 0);
    tTitle = 0.5;
  }
  const split = new SplitText("#hook-t", { type: "chars", charsClass: "c" });
  tl.fromTo(split.chars, { yPercent: 120, rotateX: -60, opacity: 0 }, { yPercent: 0, rotateX: 0, opacity: 1, duration: 0.55, ease: "pop", stagger: 0.035 }, tTitle);
  const ul = hookCircle(split.chars);
  const len = ul.getTotalLength();
  gsap.set(ul, { strokeDasharray: len, strokeDashoffset: len });
  tl.to(ul, { strokeDashoffset: 0, duration: 0.55, ease: "power2.inOut" }, tTitle + 0.6);
  if (CFG.hookEnd - t1 > 0.8) {
    tl.set("#hook-flash", { opacity: 0.7 }, t1);
    tl.to("#hook-flash", { opacity: 0, duration: 0.15, ease: "power2.out" }, t1 + 0.02);
  }
  tl.set("#hook-flash", { opacity: 0.85 }, CFG.hookEnd - 0.1);
  tl.to("#hook-flash", { opacity: 0, duration: 0.08 }, CFG.hookEnd - 0.08);
  tl.set("#hook", { opacity: 0 }, CFG.hookEnd);
}
if (CFG.introStyle === "glitch") {
  const G = CFG.glitch, t1 = lines[1].start;
  const sl = (i) => "#gl-sl" + i;
  // 应用一组故障关键帧（逐帧 set，确定性）
  const apply = (frames) => {
    for (const f of frames) {
      f.sl.forEach((c, i) => tl.set(sl(i), { autoAlpha: c.on, x: c.x, skewX: c.sk }, f.t));
      tl.set("#gl-r", { x: -f.rgb, y: f.y }, f.t); tl.set("#gl-b", { x: f.rgb, y: -f.y }, f.t);
      tl.set("#hook-gl", { opacity: f.flick }, f.t);
    }
  };
  // 0s：黑场 -> 故障闪入，压暗作底
  gsap.set("#hook-gl", { opacity: 0 });
  tl.set("#hook-gl", { opacity: 1 }, 0.02);
  apply(G.in);
  gsap.set("#hook-dim", { opacity: 0.62 });
  tl.fromTo("#hook-gl", { scale: 1 }, { scale: 1.06, duration: t1, ease: "none" }, 0);
  // 钩子文字：逐字砸入 + 橙/青残影合拢
  const split = new SplitText("#hook-t", { type: "chars", charsClass: "c" });
  tl.fromTo(split.chars, { yPercent: 120, rotateX: -60, opacity: 0 }, { yPercent: 0, rotateX: 0, opacity: 1, duration: 0.55, ease: "pop", stagger: 0.035 }, 0.3);
  tl.fromTo(split.chars, { "--rgb": 16 }, { "--rgb": 0, duration: 0.5, ease: "power3.out", stagger: 0.035 }, 0.42);
  const ul = document.getElementById("hook-ul");
  const hookBox = document.getElementById("hook").getBoundingClientRect();
  let x1 = 1e9, y1 = 1e9, x2 = 0, y2 = 0;
  split.chars.forEach((el) => {
    const r = el.getBoundingClientRect();
    x1 = Math.min(x1, r.left); y1 = Math.min(y1, r.top);
    x2 = Math.max(x2, r.right); y2 = Math.max(y2, r.bottom);
  });
  const sx = ${W} / hookBox.width, sy = ${H} / hookBox.height;
  const padX = 48, padY = 36;
  const cx = ((x1 + x2) / 2 - hookBox.left) * sx;
  const cy = ((y1 + y2) / 2 - hookBox.top) * sy;
  const rx = (x2 - x1) * sx / 2 + padX;
  const ry = (y2 - y1) * sy / 2 + padY;
  ul.setAttribute("d", ["M", cx - rx, ",", cy, " C ", cx - rx, ",", cy - ry * 0.92, " ", cx - rx * 0.5, ",", cy - ry * 1.04, " ", cx, ",", cy - ry, " C ", cx + rx * 0.52, ",", cy - ry * 0.96, " ", cx + rx * 1.03, ",", cy - ry * 0.88, " ", cx + rx, ",", cy, " C ", cx + rx * 0.98, ",", cy + ry * 0.94, " ", cx + rx * 0.48, ",", cy + ry * 1.05, " ", cx, ",", cy + ry, " C ", cx - rx * 0.46, ",", cy + ry * 0.98, " ", cx - rx * 1.03, ",", cy + ry * 0.84, " ", cx - rx, ",", cy].join(""));
  const len = ul.getTotalLength();
  gsap.set(ul, { strokeDasharray: len, strokeDashoffset: len });
  tl.to(ul, { strokeDashoffset: 0, duration: 0.55, ease: "power2.inOut" }, 0.95);
  // t1：文字崩坏成乱码，底图 punch 到全亮
  const N = ${scrambled.length};
  for (let k = 0; k < N; k++) {
    const t = t1 + k * 0.04;
    tl.set(k === 0 ? "#hook-t" : "#hook-tg" + (k - 1), { autoAlpha: 0 }, t);
    tl.set("#hook-ul", { autoAlpha: 0 }, t1);
    tl.set("#hook-tg" + k, { autoAlpha: 1, x: (k % 2 ? -1 : 1) * (18 + k * 6), skewX: (k % 3 - 1) * 8 }, t);
  }
  tl.set("#hook-tg" + (N - 1), { autoAlpha: 0 }, t1 + N * 0.04);
  tl.set("#hook-flash", { opacity: 0.85 }, t1);
  tl.to("#hook-flash", { opacity: 0, duration: 0.12, ease: "power2.out" }, t1 + 0.02);
  tl.to("#hook-dim", { opacity: 0, duration: 0.12, ease: "power2.out" }, t1);
  apply(G.punch);
  // 稳住后：缓推 + 扫描条 + 小字幕
  tl.fromTo("#hook-gl", { scale: 1.0 }, { scale: 1.11, duration: CFG.hookEnd - t1, ease: "power1.out" }, t1 + 0.44);
  tl.fromTo("#hook-bar", { autoAlpha: 0, y: -10 }, { autoAlpha: 0.9, y: 0, duration: 0.05 }, t1 + 0.6);
  tl.to("#hook-bar", { y: ${H} + 10, duration: 0.7, ease: "power2.inOut" }, t1 + 0.62);
  tl.to("#hook-bar", { autoAlpha: 0, duration: 0.08 }, t1 + 1.3);
  // 结尾：两帧故障硬切
  apply(G.cut);
  tl.set("#hook", { opacity: 0 }, CFG.hookEnd);
}

// ================= 镜头 / 素材切换 / 光标 =================
let prevShot = null, prevCenter = center(null);
{ const c0 = camFor(null); gsap.set("#cam", { scale: c0.z, x: c0.x, y: c0.y }); }
if (!shots[shotEvents[0].shot].video) gsap.set("#img-" + shotEvents[0].shot, { autoAlpha: 1 });

let shotIdx = 0;
for (const e of shotEvents) {
  const s = shots[e.shot], t0 = e.t;
  shotIdx++;
  // tall 长图滚动镜头：相机只轻推固定，页面内容自己缓慢上滚（浏览感），不推 bbox 不配 mark
  const cam = s.tall ? camFor(null, 1.06) : (s.video ? camVideo(s) : camFor(s.bbox));
  const changeMedia = prevShot && prevShot.id !== e.shot;
  if (changeMedia) {
    if (e.trans === "push") {
      // 卡片推移转场：旧内容左推出、新内容右滑入（对标博主同款），不加模糊
      const prevEl = "#img-" + prevShot.id, curEl = "#img-" + e.shot;
      tl.to(prevEl, { x: -120, autoAlpha: 0, duration: 0.3, ease: "power2.in" }, t0 - 0.24);
      tl.set(prevEl, { x: 0 }, t0 + 0.4);
      tl.fromTo(curEl, { x: 140, autoAlpha: s.video ? 1 : 0 }, { x: 0, autoAlpha: 1, duration: 0.42, ease: "cam" }, t0 - 0.04);
    } else {
      tl.to("#stage", { filter: "blur(14px)", duration: 0.16, ease: "power2.in" }, t0 - 0.16);
      if (!prevShot.video) tl.set("#img-" + prevShot.id, { autoAlpha: 0 }, t0);
      if (!s.video) tl.set("#img-" + e.shot, { autoAlpha: 1 }, t0);
      tl.to("#stage", { filter: "blur(0px)", duration: 0.24, ease: "power2.out" }, t0);
      tl.fromTo("#stage", { x: -44 }, { x: 0, duration: 0.45, ease: "cam" }, t0 - 0.1);
    }
  }
  // 同页 bbox 跳切（changeMedia=false）比换页更快：0.55s，配合密集 cue 实现竞对式快节奏
  tl.to("#cam", { scale: cam.z, x: cam.x, y: cam.y, duration: changeMedia ? 0.6 : 0.55, ease: "cam" }, t0 - (changeMedia ? 0.06 : 0.12));
  const hold = e.end - t0 - 0.9;
  if (s.tall) {
    // 页面内容缓慢上滚，滚完停在底部
    const scrollDist = Math.round(VP.height * (s.tall - 1));
    const dur = Math.max(0.5, e.end - t0 - 0.5);
    tl.fromTo("#img-" + e.shot, { y: 0 }, { y: -scrollDist, duration: dur, ease: "power1.inOut" }, t0 + 0.3);
  } else if (hold > 0.8) {
    // 静帧永动：缓推 + 纵向缓移漂移（方向按镜头序交替），保证没有一帧是死的
    const c2 = s.video ? camVideo(s, 1.035) : camFor(s.bbox, 1.035);
    const drift = clampCam(c2.z, c2.x, c2.y + (shotIdx % 2 ? -18 : 18));
    tl.to("#cam", { scale: drift.z, x: drift.x, y: drift.y, duration: hold, ease: "none" }, t0 + 0.65);
  }
  // 3D 倾斜漂浮（shots.json 里 tilt: true 或 [rx, ry]）：长文档/README 阅读段用，页面像一张缓慢漂浮的纸
  // 复位 tween 只在「上一镜头是 tilt」时发，否则每个镜头都 to(0,0) 会互相重叠（check 报 overlapping_gsap_tweens）
  if (s.tilt) {
    const [rx, ry] = Array.isArray(s.tilt) ? s.tilt : [2.5, -4];
    tl.to("#stage", { rotateX: rx, rotateY: ry, duration: 0.7, ease: "cam" }, t0);
    if (hold > 0.8) tl.to("#stage", { rotateX: rx * 0.45, rotateY: ry * 0.45, duration: hold, ease: "none" }, t0 + 0.72);
  } else if (prevShot && shots[prevShot.id].tilt) {
    tl.to("#stage", { rotateX: 0, rotateY: 0, duration: 0.5, ease: "cam" }, t0 - 0.06);
  }

  if (s.video || s.tall) { tl.set("#cursor", { autoAlpha: 0 }, t0); tl.set("#ibeam", { autoAlpha: 0 }, t0); }
  else {
    const c = center(s.bbox);
    const cur = s.action === "select" ? "#ibeam" : "#cursor", other = s.action === "select" ? "#cursor" : "#ibeam";
    const off = s.action === "select" ? { x: c.x + s.bbox.width / 2 - 4, y: c.y - 17 }
      : s.action === "point" ? { x: c.x - 4 - 34, y: c.y - 3 + 30 } : { x: c.x - 4, y: c.y - 3 };
    tl.set(other, { autoAlpha: 0 }, t0); tl.set(cur, { autoAlpha: 1 }, t0);
    tl.fromTo(cur, { x: prevCenter.x, y: prevCenter.y }, { x: off.x, y: off.y, duration: 0.6, ease: "cam" }, t0);
    if (s.action === "hover") tl.fromTo(cur, { scale: 1 }, { scale: 0.82, duration: 0.08, yoyo: true, repeat: 1 }, t0 + 0.65);
    // 点击波纹：hover/click 动作在光标就位后扩一圈
    if (s.action === "hover" || s.action === "click") {
      tl.set("#ripple", { left: c.x, top: c.y, autoAlpha: 0.9, scale: 0.25 }, t0 + 0.66);
      tl.to("#ripple", { scale: 1.4, autoAlpha: 0, duration: 0.5, ease: "power2.out" }, t0 + 0.7);
    }
    prevCenter = off;
  }
  prevShot = { id: e.shot, video: s.video };
}

// ================= 画重点：手绘框（笔画从头画到尾）/ 划词高亮（selection 扫过） =================
for (const m of marks) {
  const el = document.getElementById(m.id);
  if (m.style === "select") {
    // 划词：矮框（≤72px，约两行内）从左往右扫；高框（段落/列表）从上往下扫，近似真人逐行拖选
    const horizontal = m.bbox.height <= 72;
    const from = horizontal ? "inset(0 100% 0 0)" : "inset(0 0 100% 0)";
    const dur = Math.min(0.9, 0.35 + (horizontal ? m.bbox.width : m.bbox.height) / 1400);
    tl.set(el, { autoAlpha: 1, clipPath: from }, m.t);
    tl.to(el, { clipPath: "inset(0 0% 0% 0)", duration: dur, ease: "power2.inOut" }, m.t);
    tl.to(el, { autoAlpha: 0, duration: 0.15 }, m.end - 0.12);
    // 划完弹出「搜一搜|问问AI」小浮条（真人操作感），停 1.8s 收走
    const showT = m.t + dur + 0.08, hideT = Math.min(m.end - 0.15, showT + 1.8);
    if (hideT - showT > 0.5) {
      tl.fromTo("#" + m.id + "-bar", { autoAlpha: 0, y: 12, scale: 0.8 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.25, ease: "pop" }, showT);
      tl.to("#" + m.id + "-bar", { autoAlpha: 0, duration: 0.15 }, hideT);
    }
    continue;
  }
  const len = el.getTotalLength();
  const s = shots[m.shot];
  const z = s.video ? camVideo(s).z : camFor(s.bbox).z;
  gsap.set(el, { strokeDasharray: len, strokeDashoffset: len, strokeWidth: Math.max(2.2, 6.5 / z) });
  tl.set(el, { autoAlpha: 1 }, m.t);
  tl.to(el, { strokeDashoffset: 0, duration: Math.min(0.7, 0.25 + len / 2600), ease: "power2.inOut" }, m.t);
  tl.to(el, { autoAlpha: 0, duration: 0.15 }, m.end - 0.12);
}

// ================= 字幕：打字机 + 方块光标 =================
for (const l of lines) {
  l.segs.forEach((sg, k) => {
    const el = document.getElementById("ln-" + l.id + "-" + k);
    const chars = [...el.querySelectorAll("i")], tw = el.querySelector(".tw");
    const segStart = l.start + (k === 0 ? 0 : Math.min(l.chars[sg.from] ?? 0, l.dur));
    const nextSeg = l.segs[k + 1];
    const segEnd = nextSeg ? l.start + Math.min(l.chars[nextSeg.from] ?? l.dur, l.dur) : l.next;
    tl.set(el, { autoAlpha: 1, "--caption-bg-width": "24px" }, segStart); tl.set(tw, { autoAlpha: 1, x: 12 }, segStart);
    chars.forEach((ch) => {
      const ci = +ch.dataset.ci, t = Math.max(segStart, l.start + Math.min(l.chars[ci] ?? 0, l.dur));
      tl.set(ch, { autoAlpha: 1 }, t);
      // 黑底跟着光标走；+36 是为了把右侧 padding 和光标一起包进去
      tl.set(el, { "--caption-bg-width": (ch.offsetLeft + ch.offsetWidth + 36) + "px" }, t);
      tl.set(tw, { x: ch.offsetLeft + ch.offsetWidth + 4 }, t);
    });
    tl.set(tw, { autoAlpha: 0 }, Math.min(segEnd, l.start + l.dur + 0.15));
    // 光标消失后黑底收回到文字右边缘，避免右侧留一块空白
    const finalChar = chars[chars.length - 1];
    if (finalChar) tl.set(el, { "--caption-bg-width": (finalChar.offsetLeft + finalChar.offsetWidth + 12) + "px" }, Math.min(segEnd, l.start + l.dur + 0.15));
    tl.set(el, { autoAlpha: 0 }, segEnd);
  });
}

// ================= 花字（两种样式轮换：乱码扫出 / 斜体重影 pop） =================
stickers.forEach((s, i) => {
  const id = "#" + s.id;
  if (i % 2) { // 第二样式：斜体重影 slam，无乱码
    tl.fromTo(id, { autoAlpha: 0, scale: 2.2, rotate: 8, skewX: -16, xPercent: -50, yPercent: -50 },
      { autoAlpha: 1, scale: 1, rotate: -4, skewX: -8, xPercent: -50, yPercent: -50, duration: 0.35, ease: "power3.in" }, s.t);
  } else {
    tl.fromTo(id, { autoAlpha: 0, scale: 0.5, rotate: 8, xPercent: -50, yPercent: -50 }, { autoAlpha: 1, scale: 1, rotate: -5, xPercent: -50, yPercent: -50, duration: 0.45, ease: "pop" }, s.t);
    tl.to(id, { duration: 0.6, scrambleText: { text: s.text, chars: "▮▯░▒#@GSAP", speed: 0.6 } }, s.t);
  }
  tl.to(id, { scale: 1.05, duration: 0.5, yoyo: true, repeat: 3, ease: "sine.inOut" }, s.t + 0.5);
  tl.to(id, { autoAlpha: 0, scale: 1.25, duration: 0.2, ease: "power2.in" }, s.end);
});
// ================= 场景角标 / 数字滚动 chip =================
for (const c of corners) {
  tl.fromTo("#" + c.id, { autoAlpha: 0, x: -30, scale: 0.8 }, { autoAlpha: 1, x: 0, scale: 1, duration: 0.3, ease: "pop" }, c.t);
  tl.to("#" + c.id, { autoAlpha: 0, x: -24, duration: 0.2 }, c.end - 0.2);
}
for (const c of counters) {
  const el = document.getElementById(c.id);
  tl.fromTo("#" + c.id, { autoAlpha: 0, scale: 0.6 }, { autoAlpha: 1, scale: 1, duration: 0.22, ease: "pop" }, c.t);
  c.steps.forEach((v, k) => tl.set(el, { textContent: v }, c.t + 0.05 + k * 0.07));
  tl.fromTo("#" + c.id, { scale: 1 }, { scale: 1.12, duration: 0.12, yoyo: true, repeat: 1, ease: "power2.out" }, c.t + 0.05 + c.steps.length * 0.07);
  tl.to("#" + c.id, { autoAlpha: 0, duration: 0.15 }, c.end - 0.12);
}
// ================= 关键词轻震（每句第一个 kw，避开开场与切镜） =================
for (const l of lines) {
  if (l.nocap || !(l.kw || []).length) continue;
  const ki = l.text.indexOf(l.kw[0]); if (ki < 0) continue;
  const t = l.start + Math.min(l.chars[ki] ?? 0, l.dur);
  if (t < CFG.hookEnd + 0.3 || t > CFG.ctaStart) continue;
  if (shotEvents.some((se) => Math.abs(se.t - t) < 0.5)) continue;
  tl.fromTo("#root", { scale: 1 }, { scale: 1.008, duration: 0.09, yoyo: true, repeat: 1, ease: "power2.out" }, t);
}
// ================= 辉光呼吸 =================
tl.fromTo("#stageGlow", { opacity: 0.4 }, { opacity: 0.85, duration: 2.2, yoyo: true, repeat: Math.max(1, Math.ceil(CFG.total / 2.2)), ease: "sine.inOut" }, 0);
// ================= 序号徽章（贴纸避让摆位） =================
for (const b of badgeSets) {
  const bScale = placeStickers(b.badges.map((_, i) => b.id + "-" + i), b.t);
  b.badges.forEach((_, i) => {
    const id = "#" + b.id + "-" + i, t0 = b.t + i * 0.7;
    tl.fromTo(id, { autoAlpha: 0, scale: 0.4 * bScale, x: -60 }, { autoAlpha: 1, scale: bScale, x: 0, duration: 0.4, ease: "pop" }, t0);
    tl.to(id, { autoAlpha: 0, x: -40, duration: 0.2 }, b.end - 0.2);
  });
}
// ================= 任务清单进度卡（贴纸避让摆位 + 盖章式砸入、绿勾画上后晃一下，句子结束收走） =================
{
  const groups = {};
  tasks.forEach((tk) => { (groups[tk.end] = groups[tk.end] || []).push(tk); });
  for (const g of Object.values(groups)) {
    const scale = placeStickers(g.map((tk) => tk.id), g[0].t);
    g.forEach((tk, i) => {
      const id = "#" + tk.id, ck = document.getElementById(tk.id + "-ck"), len = ck.getTotalLength();
      const rot = [-2.5, 3, -3.5, 2][i % 4]; // 歪斜方向交替 + 摆位抖动 = 「随手贴上去」的网感
      gsap.set(ck, { strokeDasharray: len, strokeDashoffset: len });
      tl.fromTo(id, { autoAlpha: 0, scale: 1.7 * scale, rotation: rot * 3 }, { autoAlpha: 1, scale, rotation: rot, duration: 0.28, ease: "power3.in" }, tk.t);
      tl.fromTo(id, { y: 0 }, { y: -6, duration: 0.09, yoyo: true, repeat: 1, ease: "power2.out" }, tk.t + 0.28); // 落地弹一下
      tl.fromTo("#root", { scale: 1 }, { scale: 1.006, duration: 0.08, yoyo: true, repeat: 1, ease: "power2.out" }, tk.t + 0.26); // 砸下时画面震一下
      tl.to(ck, { strokeDashoffset: 0, duration: 0.28, ease: "power2.out" }, tk.t + 0.34);
      tl.to(id, { rotation: rot + (rot > 0 ? -2 : 2), duration: 0.12, yoyo: true, repeat: 1, ease: "sine.inOut" }, tk.t + 0.5); // 勾完晃一下
      tl.to(id, { autoAlpha: 0, x: -36, duration: 0.25 }, tk.end - 0.3);
    });
  }
}

// ================= 结尾 =================
// CTA_MINIMAL=1：无胶囊无压暗，末句口播（如「感兴趣的兄弟快去冲吧」）压在最后一个镜头上直接收
if (!${process.env.CTA_MINIMAL ? "true" : "false"}) {
  const t0 = CFG.ctaStart, c = camFor(null, 0.97);
  tl.to("#cam", { scale: c.z, x: c.x, y: c.y, duration: 0.9, ease: "cam" }, t0);
  tl.set("#cursor", { autoAlpha: 0 }, t0); tl.set("#ibeam", { autoAlpha: 0 }, t0);  // 结尾不留光标
  tl.fromTo("#cta-bar", { autoAlpha: 0, y: 40, scale: 0.9, xPercent: -50 }, { autoAlpha: 1, y: 0, scale: 1, xPercent: -50, duration: 0.5, ease: "pop" }, t0 + 0.2);
  ["#ic-like", "#ic-follow", "#ic-comment"].forEach((ic, i) => {
    const p = document.querySelector(ic), len = p.getTotalLength();
    gsap.set(p, { strokeDasharray: len, strokeDashoffset: len });
    tl.fromTo(p.closest(".it"), { autoAlpha: 0, x: -14 }, { autoAlpha: 1, x: 0, duration: 0.3 }, t0 + 0.5 + i * 0.45);
    tl.to(p, { strokeDashoffset: 0, duration: 0.5, ease: "power2.inOut" }, t0 + 0.55 + i * 0.45);
  });
  tl.fromTo("#cta-foot", { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.5 }, t0 + 2.4);
  tl.to("#cta-bar", { y: -8, duration: 0.6, yoyo: true, repeat: 5, ease: "sine.inOut" }, t0 + 2.2);
}
${bgm ? `tl.set("#bgm", { volume: ${BGM_VOL_HI} }, 0);
tl.to("#bgm", { volume: ${BGM_VOL}, duration: 0.4, ease: "power1.out" }, ${lines[1].start.toFixed(2)});
tl.to("#bgm", { volume: ${BGM_VOL_HI}, duration: 0.6, ease: "power1.in" }, ${voice.total.toFixed(2)});
tl.to("#bgm", { volume: 0, duration: 0.8 }, CFG.total - 0.8);` : ""}

window.__timelines = window.__timelines || {}; // 兜底：脱离 HyperFrames 直接开 index.html 也能做视觉自检
window.__timelines["main"] = tl; // 注意：必须保持这一行的赋值写法，hyperframes lint 靠静态匹配它，合并成一行会报 gsap_timeline_not_registered
</script>
</body>
</html>`;

fs.writeFileSync(path.join(projDir, "index.html"), html);
console.log("wrote", path.join(projDir, "index.html"), "duration", total, "s; shots", shotEvents.length, "marks", marks.length, "stickers", stickers.length, "tasks", tasks.length);
