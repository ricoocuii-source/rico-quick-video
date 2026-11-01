// 导出剪映可用的字幕文件：复用 build.mjs 里的分段逻辑，保证 SRT 切点和视频里已烧录的字幕完全一致。
// 用法：node build/export_srt.mjs out video/renders/<最终视频>.mp4
import fs from "node:fs";
import path from "node:path";

const [, , outDir = "out", videoFile] = process.argv;
const voice = JSON.parse(fs.readFileSync(path.join(outDir, "voice.json"), "utf8"));

const MAXC = 18;
function segments(l) {
  const t = l.text, segs = [];
  const isWordChar = (c) => /[A-Za-z0-9.]/.test(c);
  const clauses = []; let start = 0;
  for (let i = 0; i < t.length; i++) if (/[，。！？；：!?]/.test(t[i]) || i === t.length - 1) { clauses.push({ from: start, to: i + 1 }); start = i + 1; }
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
  return segs.map((sg) => ({ ...sg, text: sg.text.replace(/[，。；：、]$/, "") }));
}

const lines = voice.lines.map((l, i) => ({ ...l, next: voice.lines[i + 1]?.start ?? voice.total }));
const cues = [];
for (const l of lines) {
  if (l.nocap) { cues.push({ start: l.start, end: l.next, text: l.text }); continue; } // 不上字的句子也保留整句，方便剪映里手动核对
  const segs = segments(l);
  segs.forEach((sg, k) => {
    const segStart = l.start + (k === 0 ? 0 : Math.min(l.chars[sg.from] ?? 0, l.dur));
    const nextSeg = segs[k + 1];
    const segEnd = nextSeg ? l.start + Math.min(l.chars[nextSeg.from] ?? 0, l.dur) : l.next;
    cues.push({ start: segStart, end: Math.max(segStart + 0.3, segEnd), text: sg.text });
  });
}

const ts = (s) => {
  const ms = Math.round(s * 1000);
  const h = String(Math.floor(ms / 3600000)).padStart(2, "0");
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0");
  const sec = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
  const mmm = String(ms % 1000).padStart(3, "0");
  return `${h}:${m}:${sec},${mmm}`;
};

const srt = cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join("\n");
const outDirPath = path.join(outDir, "剪映导入");
fs.mkdirSync(outDirPath, { recursive: true });
fs.writeFileSync(path.join(outDirPath, "字幕.srt"), srt);

// 口播稿纯文本（整句，不切段），方便核对/复制
const script = lines.map((l) => l.text).join("\n");
fs.writeFileSync(path.join(outDirPath, "口播稿.txt"), script);

if (videoFile && fs.existsSync(videoFile)) {
  fs.copyFileSync(videoFile, path.join(outDirPath, "视频.mp4"));
}
fs.copyFileSync(path.join(outDir, "voice.mp3"), path.join(outDirPath, "口播音轨.mp3"));

console.log("wrote", outDirPath, `(${cues.length} 条字幕)`);
