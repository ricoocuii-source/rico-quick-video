"""取景预检（跑完 capture.py、写完 script.json 之后，渲染之前跑）。

按 build.mjs 的 camFor/clampCam 逻辑，把 out/shots/*.png 裁成实际出片取景，
并画出每个镜头的画重点框，输出 out/verify/<id>.png（1920x1080）。
一眼就能看出：目标框有没有出画、推镜后目标是不是居中、画重点框会不会被裁。

用法：在项目根目录 `python3 scripts/verify_frames.py out`

硬约束（z 被 clamp 在 [1.5, 2.6]，FOCUS.y 比画面中心高 60px）：
- 静态镜头 z=1.5 时，bbox 高度超过 ~640px 就一定被裁（上下各出画），画重点框随之废掉。
  典型：`extend` 把一个 GitHub 标题 + 整张表格并进 bbox（800+px）→ 直接别给这个镜头挂 mark。
- 输出里 `CUT` 是出画且该镜头挂了 mark，必须改 bbox 或去掉 mark。
- `CROP` 是出画但没挂 mark，可以过，确认取景里主体还在即可。
"""
import json, os, pathlib, sys
from PIL import Image, ImageDraw

PORTRAIT = os.environ.get("FORMAT") == "portrait"
W, H = (1080, 1440) if PORTRAIT else (1920, 1080)
SF = W / 1920
stageL, stageT = (W - 1600) / 2, (H - 1000) / 2
FOCUS = (W / 2, H * 0.40 if PORTRAIT else H / 2 - 60)

def cam_for(b, mul=1.0):
    z = SF * (1.35 if PORTRAIT else 1) * min(2.6, max(1.5, min(1500 / b["width"], 560 / b["height"]))) * mul
    px = stageL + b["x"] + b["width"] / 2
    py = stageT + b["y"] + b["height"] / 2
    x, y = FOCUS[0] - z * px, FOCUS[1] - z * py
    x = min(x, 40 - z * stageL); x = max(x, W - 40 - z * (stageL + 1600))
    y = min(y, 40 - z * stageT); y = max(y, H - 40 - z * (stageT + 1000))
    return z, x, y

out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "out")
vd = out / "verify"; vd.mkdir(parents=True, exist_ok=True)
shots = json.load(open(out / "shots.json"))
voice = json.load(open(out / "voice.json"))
script = json.load(open("script.json"))
by_id = {s["id"]: s for s in shots}

# 每个镜头的画重点 cue
marks = {}
for ln in script["lines"]:
    for c in ln.get("cues", []):
        if c.get("mark"):
            marks.setdefault(c["mark"], []).append(ln["id"])

cut_marked = []
for s in shots:
    b = s.get("bbox")
    if s.get("tall"):
        print(f"{s['id']:>8}  (tall 滚动镜头，整幅轻推不推 bbox，跳过取景校验)")
        continue
    if not b or "png" not in s:
        print(f"{s['id']:>8}  (video/no-png)  zoom={s.get('zoom')} focus={s.get('focus')}")
        continue
    z, cx, cy = cam_for(b)
    im = Image.open(out / s["png"]).convert("RGB")          # 3200x2000 (device 2x)
    cw, ch = int(W / z * 2), int(H / z * 2)
    # 屏幕点 = z*(stageL+vx)+cx  →  取景左上角对应的视口坐标
    left, top = int((-cx / z - stageL) * 2), int((-cy / z - stageT) * 2)
    left, top = max(0, left), max(0, top)
    im = im.crop((left, top, left + cw, top + ch)).resize((W, H), Image.LANCZOS)
    d = ImageDraw.Draw(im)
    pad = max(8, min(18, b["height"] * 0.35))
    x0, y0 = z * (stageL + b["x"] - pad) + cx, z * (stageT + b["y"] - pad) + cy
    x1, y1 = z * (stageL + b["x"] + b["width"] + pad) + cx, z * (stageT + b["y"] + b["height"] + pad) + cy
    if s["id"] in marks:
        d.rectangle([x0, y0, x1, y1], outline=(0, 195, 208), width=5)
    in_frame = y0 > 6 and y1 < H - 6 and x0 > 6 and x1 < W - 6
    has_mark = s["id"] in marks
    if in_frame:
        vis = "OK "
    elif has_mark:
        vis = "CUT"
        cut_marked.append(s["id"])
    else:
        vis = "CROP"
    print(f"{s['id']:>8}  z={z:.2f}  框=({x0:.0f},{y0:.0f})-({x1:.0f},{y1:.0f})  {vis}")
    im.save(vd / f"{s['id']}.png")
print("->", vd)
if cut_marked:
    print("CUT with mark:", ", ".join(cut_marked), "(fix bbox or drop mark)")
    sys.exit(1)
