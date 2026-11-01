"""
本地声音克隆版口播合成：用 F5-TTS + 用户自己的参考音频，替代 edge-tts。
接口与 tts.py 一致：吃 script.json，吐 out/voice.mp3 + out/voice.json（含字级时间戳）。

字级时间戳来源：F5-TTS 不直接给词级时间戳，这里用 whisper 转写整段合成音频，
再用字符在原文里的顺序位置对齐 whisper 词的起止时间（whisper 词序基本与原文顺序一致，
标点会被吞掉，用字符匹配兜底）。
"""
import asyncio, json, sys, pathlib, subprocess, re, os

F5_ROOT = pathlib.Path("/Users/cuiguangzhen/projects/火柴人视频探索/open-source-tts/f5tts")
F5_PY = F5_ROOT / ".venv" / "bin" / "python"
REF_AUDIO = "/Users/cuiguangzhen/projects/火柴人视频探索/assets/voice/user-video/clone-sample-12s.wav"
REF_TEXT = "大家好，我之前发过一篇如何让 Claude 辅助生成设计系统的文章，也是非常感谢大家的喜欢。同时呢，有很多小伙伴私信问我。"
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", os.path.expanduser("~/models/ggml-small.bin"))
GAP = 0.15

# 起始几个字容易被模型吞掉/念糊，前面垫一个短语再切掉（F5-TTS 已知的开头不稳定问题）
LEAD_IN = "嗯，"

SYNTH_WORKER = r'''
import sys, json
from f5_tts.api import F5TTS

ref_audio, ref_text, jobs_path, out_dir, nfe, speed = sys.argv[1:7]
jobs = json.load(open(jobs_path))
tts = F5TTS(model="F5TTS_v1_Base", device="mps")
for j in jobs:
    wav, sr, _ = tts.infer(
        ref_file=ref_audio, ref_text=ref_text, gen_text=j["text"],
        nfe_step=int(nfe), speed=float(speed), seed=j.get("seed", 0),
        file_wave=f"{out_dir}/{j['id']}.wav",
    )
    print("OK", j["id"])
'''

def dur(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                       capture_output=True, text=True)
    return float(r.stdout.strip())

def main(script_path, out_dir):
    cfg = json.load(open(script_path))
    out = pathlib.Path(out_dir); (out / "tts").mkdir(parents=True, exist_ok=True)
    nfe = cfg.get("nfe_step", 48); speed = cfg.get("speed", 0.92)

    out = out.resolve()
    jobs = [{"id": ln["id"], "text": LEAD_IN + ln["text"], "seed": i} for i, ln in enumerate(cfg["lines"])]
    jobs_path = out / "tts" / "_jobs.json"
    json.dump(jobs, open(jobs_path, "w"), ensure_ascii=False)
    worker = out / "tts" / "_worker.py"; worker.write_text(SYNTH_WORKER)

    print(f"[f5] synthesizing {len(jobs)} lines with cloned voice (nfe={nfe}, speed={speed})...")
    subprocess.run([str(F5_PY), str(worker), REF_AUDIO, REF_TEXT, str(jobs_path), str(out / "tts"), str(nfe), str(speed)],
                    cwd=str(F5_ROOT), check=True)

    # 裁掉垫的引导词，量出每句真实时长
    lines_meta = []
    for ln in cfg["lines"]:
        raw = out / "tts" / f"{ln['id']}.wav"
        total_d = dur(raw)
        # 垫的字按整句语速估算时长再裁掉（LEAD_IN 2 个字）
        lead_frac = len(LEAD_IN) / (len(LEAD_IN) + len(ln["text"]))
        cut = max(0.15, total_d * lead_frac * 0.75)  # 语气词通常比正文字略短，打个折
        trimmed = out / "tts" / f"{ln['id']}_trim.wav"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(raw), "-af", f"atrim=start={cut:.3f},afade=t=in:st=0:d=0.05",
                        "-ar", "24000", "-ac", "1", str(trimmed)], check=True)
        lines_meta.append({**ln, "wav": trimmed})

    # 逐句转写拿字级时间戳
    t = 0.0; out_lines = []; parts = []
    for ln in lines_meta:
        d = dur(ln["wav"])
        chars = align_chars(ln["wav"], ln["text"], d)
        out_lines.append({k: v for k, v in ln.items() if k != "wav"} | {
            "start": round(t, 3), "end": round(t + d, 3), "dur": round(d, 3), "chars": chars})
        parts.append(str(ln["wav"])); t += d + GAP
        print(f"{ln['id']:>10} {d:5.2f}s  {ln['text']}")

    lst = out / "tts" / "list.txt"
    gap_wav = out / "tts" / "gap.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", str(GAP), str(gap_wav)])
    with open(lst, "w") as f:
        for p in parts:
            f.write(f"file '{pathlib.Path(p).resolve()}'\n")
            f.write(f"file '{gap_wav.resolve()}'\n")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(lst),
                    "-ar", "44100", "-ac", "2", str(out / "voice.mp3")])
    json.dump({"voice": "cuivoice-f5", "rate": f"speed={speed}", "total": round(t, 3), "lines": out_lines},
              open(out / "voice.json", "w"), ensure_ascii=False, indent=1)
    print("total", round(t, 2), "s")

def align_chars(wav_path, text, d):
    """whisper 转写 + 词级时间戳，按顺序把词对应到原文里的字符上；对不上的字符线性插值。"""
    prefix = str(wav_path) + "_asr"
    subprocess.run(["whisper-cli", "-m", WHISPER_MODEL, "-l", "zh", "-f", str(wav_path),
                    "-oj", "-of", prefix, "-nt"], capture_output=True)
    jf = pathlib.Path(prefix + ".json")
    times = [None] * len(text)
    if jf.exists():
        data = json.loads(jf.read_text())
        pos = 0
        for seg in data.get("transcription", []):
            word = seg.get("text", "").strip()
            if not word:
                continue
            t0 = seg["offsets"]["from"] / 1000.0
            i = text.find(word[0], pos) if word else -1
            if i < 0:
                # 逐字符找，宽松匹配
                for ch in word:
                    i2 = text.find(ch, pos)
                    if i2 >= 0:
                        times[i2] = t0; pos = i2 + 1
                continue
            n = len(word)
            for k in range(n):
                if i + k < len(times):
                    times[i + k] = t0
            pos = i + n
    last = 0.0
    for i, tt in enumerate(times):
        if tt is None:
            times[i] = last
        else:
            last = max(last, tt)
    # 保证单调不减且不超过 d
    prev = 0.0
    for i in range(len(times)):
        times[i] = min(d, max(prev, times[i])); prev = times[i]
    return [round(x, 3) for x in times]

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
