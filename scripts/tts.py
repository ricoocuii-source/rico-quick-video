"""
口播合成：读取 script.json（lines: [{id, text, kw}]），用 edge-tts 逐句合成，
拼成一条 out/voice.mp3，并输出 out/voice.json：每句起止时间 + 字级时间戳（供打字机字幕）。
"""
import asyncio, json, sys, pathlib, subprocess
import edge_tts

VOICE = "zh-CN-XiaoxiaoNeural"
RATE = "+18%"
PITCH = "+0Hz"
GAP = 0.12  # 句间停顿（秒）

async def synth(text, path):
    com = edge_tts.Communicate(text, VOICE, rate=RATE, pitch=PITCH, boundary="WordBoundary")
    words = []
    with open(path, "wb") as f:
        async for ch in com.stream():
            if ch["type"] == "audio":
                f.write(ch["data"])
            elif ch["type"] == "WordBoundary":
                words.append({"text": ch["text"], "t": ch["offset"] / 1e7, "d": ch["duration"] / 1e7})
    return words

def dur(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                       capture_output=True, text=True)
    return float(r.stdout.strip())

def char_times(text, words, line_dur):
    """把词级时间戳摊到每个字符上，返回每个字符出现的时间。"""
    times = [None] * len(text)
    pos = 0
    for w in words:
        i = text.find(w["text"], pos)
        if i < 0:
            continue
        n = len(w["text"])
        for k in range(n):
            times[i + k] = w["t"] + w["d"] * k / n
        pos = i + n
    # 没覆盖到的字符（标点等）按线性插值补齐
    last = 0.0
    for i, t in enumerate(times):
        if t is None:
            times[i] = last
        else:
            last = t
    return times

async def main(script_path, out_dir):
    cfg = json.load(open(script_path))
    global VOICE, RATE
    VOICE = cfg.get("voice", VOICE); RATE = cfg.get("rate", RATE)
    out = pathlib.Path(out_dir); (out / "tts").mkdir(parents=True, exist_ok=True)
    t = 0.0; lines = []; parts = []
    for ln in cfg["lines"]:
        mp3 = out / "tts" / f"{ln['id']}.mp3"
        words = await synth(ln["text"], str(mp3))
        wav = mp3.with_suffix(".wav")
        # edge-tts 每句尾部带 0.5~0.8s 静音，句子一多节奏就被拖垮（22 句能拖出 10+ 秒）。
        # 裁掉尾部静音只保留 0.1s；首部不裁——chars 时间戳基于原始 offset，裁首部会整体错位。
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(mp3), "-ar", "24000", "-ac", "1",
                        "-af", "areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.1,areverse",
                        str(wav)])
        d = dur(str(wav))
        lines.append({**ln, "start": round(t, 3), "end": round(t + d, 3), "dur": round(d, 3),
                      "chars": [round(x, 3) for x in char_times(ln["text"], words, d)]})
        parts.append(str(wav)); t += d + GAP
        print(f"{ln['id']:>10} {d:5.2f}s  {ln['text']}")
    # 拼接：每句后补 GAP 静音
    lst = out / "tts" / "list.txt"
    with open(lst, "w") as f:
        for p in parts:
            f.write(f"file '{pathlib.Path(p).resolve()}'\n")
            f.write(f"file '{(out / 'tts' / 'gap.wav').resolve()}'\n")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", str(GAP), str(out / "tts" / "gap.wav")])
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-ar", "44100", "-ac", "2", str(out / "voice.mp3")])
    json.dump({"voice": VOICE, "rate": RATE, "total": round(t, 3), "lines": lines},
              open(out / "voice.json", "w"), ensure_ascii=False, indent=1)
    print("total", round(t, 2), "s")

if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], sys.argv[2]))
