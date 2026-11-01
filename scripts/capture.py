"""
自动录屏（截图版）：读取 shots.json，逐镜头打开页面、定位目标元素、执行动作，
输出 out/shots/<id>.png 与 out/shots.json（含目标 bbox、视口、动作），供合成器做缩放和光标。
"""
import json, sys, time, pathlib, subprocess
from playwright.sync_api import sync_playwright

def translate_url(url):
    """镜头带 translate: true 时，把 URL 改写成 Google 翻译代理（translate.goog），整页机翻成中文再采。
    仅 http(s) 有效；GitHub/官网大多可用，个别站点会拦代理，采完必查截图，不行就去掉 translate 用原文。"""
    from urllib.parse import urlsplit
    sp = urlsplit(url)
    if sp.scheme not in ("http", "https"):
        return url
    host = sp.netloc.replace("-", "--").replace(".", "-") + ".translate.goog"
    q = (sp.query + "&" if sp.query else "") + "_x_tr_sl=auto&_x_tr_tl=zh-CN&_x_tr_hl=zh-CN"
    return f"{sp.scheme}://{host}{sp.path}?{q}" + (f"#{sp.fragment}" if sp.fragment else "")

def goto(pg, url, wait="domcontentloaded", tries=3):
    for i in range(tries):
        try:
            pg.goto(url, wait_until=wait, timeout=60000); return
        except Exception as e:
            print("goto retry", i + 1, url, str(e)[:60])
            if i == tries - 1: raise

def do_clicks(pg, s):
    """locale=zh-CN 不等于中文站。用 clicks: ["EN","中文"] 点语言菜单；点不到就 skip，不能卡死。"""
    clicks = list(s.get("clicks") or [])
    if s.get("click_text") and s["click_text"] not in clicks:
        clicks.append(s["click_text"])
    for t in clicks:
        loc = pg.get_by_text(t, exact=True).first
        try:
            loc.click(timeout=5000)
            pg.wait_for_timeout(800)
        except Exception as e:
            print("click skip", t, str(e)[:80])

def record_shot(ctx, s, out, vw, vh):
    """录一段网页视频：用 CDP screencast 按真实时间戳抓帧（Playwright 自带录像时间轴不准），
    按 scroll 时间表平滑滚动，时长 record 秒，用 ffmpeg concat 按真实间隔拼成 mp4。"""
    import base64
    pg = ctx.new_page()
    goto(pg, translate_url(s["url"]) if s.get("translate") else s["url"])
    try:
        pg.wait_for_load_state("networkidle", timeout=15000)
    except Exception:
        pass
    pg.mouse.move(vw // 2, vh // 2)
    pg.wait_for_timeout(int(s.get("settle", 2.5) * 1000))
    if s.get("translate"):  # 藏掉 translate.goog 顶部横幅
        pg.add_style_tag(content="#gt-nvframe,iframe[id^='gt-']{display:none!important} body{top:0!important}")
    if s.get("hide"):
        pg.add_style_tag(content=",".join(s["hide"]) + "{display:none!important}")
    if s.get("css"):  # 任意注入样式（如把独立资源居中：body{display:flex;justify-content:center;...}）
        pg.add_style_tag(content=s["css"])
    do_clicks(pg, s)
    fdir = out / "rec" / s["id"]; fdir.mkdir(parents=True, exist_ok=True)
    frames = []
    cdp = ctx.new_cdp_session(pg)
    def on_frame(ev):
        try:
            cdp.send("Page.screencastFrameAck", {"sessionId": ev["sessionId"]})
        except Exception:
            return
        frames.append((time.time(), ev["data"]))
    cdp.on("Page.screencastFrame", on_frame)
    cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 85, "maxWidth": vw, "maxHeight": vh, "everyNthFrame": 1})
    t0 = time.time(); y = 0
    for at, target in s.get("scroll", []):
        while time.time() - t0 < at:
            pg.wait_for_timeout(20)
        steps = 30; prev = y
        for k in range(1, steps + 1):
            yy = y + (target - y) * (1 - (1 - k / steps) ** 3)  # ease-out
            pg.mouse.wheel(0, yy - prev); prev = yy
            pg.wait_for_timeout(20)
        y = target
    bbox = None; bbox_t = None
    if s.get("hover_text"):
        el = pg.get_by_text(s["hover_text"], exact=s.get("exact", False)).first
        card = el
        if s.get("hover_up"):  # 往上找 N 层，圈整张卡片
            card = el.locator(" xpath=" + "/".join([".."] * s["hover_up"]))
        card.scroll_into_view_if_needed(); pg.wait_for_timeout(200)
        card.hover(); pg.wait_for_timeout(300)
        b = card.bounding_box(); bbox = {k: round(v, 1) for k, v in b.items()} if b else None
        bbox_t = round(time.time() - t0, 2)  # 目标元素在录像里就位的时刻（画重点不能早于它）
    while time.time() - t0 < s["record"]:
        pg.wait_for_timeout(20)
    t_end = time.time()
    cdp.send("Page.stopScreencast")
    pg.close()
    # 写帧 + concat 清单（按真实时间间隔）
    lst = fdir / "list.txt"
    with open(lst, "w") as f:
        for i, (t, data) in enumerate(frames):
            fp = fdir / f"f{i:05d}.jpg"
            fp.write_bytes(base64.b64decode(data))
            nxt = frames[i + 1][0] if i + 1 < len(frames) else t_end
            f.write(f"file '{fp.resolve()}'\nduration {max(0.005, nxt - t):.4f}\n")
        if frames:
            f.write(f"file '{(fdir / f'f{len(frames)-1:05d}.jpg').resolve()}'\n")
    mp4 = out / "shots" / f"{s['id']}.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-vsync", "vfr",
                    "-vf", f"scale={vw}:{vh}:force_original_aspect_ratio=decrease,pad={vw}:{vh}:(ow-iw)/2:(oh-ih)/2,fps=30",
                    "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", "-t", str(s["record"]), str(mp4)])
    print("rec ", s["id"], mp4.name, f"{len(frames)} frames in {time.time()-t0:.1f}s")
    scroll_end = max([at for at, _ in s.get("scroll", [])] + [0]) + 0.9
    return {**s, "video": str(mp4.relative_to(out)), "bbox": bbox, "bbox_t": bbox_t if bbox_t is not None else round(scroll_end, 2), "viewport": {"width": vw, "height": vh}}

def run(shots_path, out_dir):
    cfg = json.load(open(shots_path))
    out = pathlib.Path(out_dir); (out / "shots").mkdir(parents=True, exist_ok=True)
    vw, vh = cfg.get("viewport", {"width": 1600, "height": 1000}).values()
    result = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": vw, "height": vh}, device_scale_factor=2,
                                  color_scheme=cfg.get("color_scheme", "dark"), locale="zh-CN")
        page = ctx.new_page()
        rec_ctx = browser.new_context(viewport={"width": vw, "height": vh}, color_scheme=cfg.get("color_scheme", "dark"), locale="zh-CN")
        cur_url = None
        for s in cfg["shots"]:
            if s.get("video_src"):
                # 本地动图/视频直接当镜头：缩放居中 pad 到视口，末尾定格补足 record 秒，不经过浏览器
                mp4 = out / "shots" / f"{s['id']}.mp4"
                src = pathlib.Path(s["video_src"]).resolve()
                bg = s.get("bg", "#000000").lstrip("#")
                rec = float(s["record"])
                subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src),
                    "-vf", f"scale={vw}:{vh}:force_original_aspect_ratio=decrease,pad={vw}:{vh}:(ow-iw)/2:(oh-ih)/2:color=0x{bg},tpad=stop_mode=clone:stop_duration={rec},fps=30",
                    "-t", str(rec), "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", str(mp4)])
                # bbox 允许手写透传（视频画面里主体的大致区域，供贴纸避让/相机推近用）
                result.append({**s, "video": str(mp4.relative_to(out)), "bbox": s.get("bbox"), "bbox_t": 0,
                               "viewport": {"width": vw, "height": vh}})
                print("vid ", s["id"], mp4.name); continue
            if s.get("record"):
                result.append(record_shot(rec_ctx, s, out, vw, vh)); continue
            url = s.get("url") or cur_url
            real_url = translate_url(url) if s.get("translate") else url
            if real_url != cur_url:
                goto(page, real_url, "load")
                page.wait_for_timeout(1200)
                cur_url = real_url
            if s.get("translate"):  # 藏掉 translate.goog 顶部横幅
                page.add_style_tag(content="#gt-nvframe,iframe[id^='gt-']{display:none!important} body{top:0!important}")
            # 隐藏 GitHub 顶部粘性通知等干扰
            if s.get("hide"):
                page.add_style_tag(content=",".join(s["hide"]) + "{display:none!important}")
            if s.get("css"):
                page.add_style_tag(content=s["css"])
            do_clicks(page, s)
            box = None
            if s.get("target") or s.get("text"):
                root = page.frame_locator(s["frame"]) if s.get("frame") else page  # frame: 目标在 iframe 里（如推文 embed）
                el = (root.locator(s["target"]) if s.get("target")
                      else root.get_by_text(s["text"], exact=s.get("exact", False))).first
                if s.get("up"):
                    el = el.locator(" xpath=" + "/".join([".."] * s["up"]))
                el.wait_for(state="visible", timeout=15000)
                if s.get("extend"):
                    # 标题贴近顶部，给下面的正文留出可视空间
                    for _ in range(3):
                        el.evaluate("e=>{const h=e.closest('.markdown-heading')||e;window.scrollBy(0,h.getBoundingClientRect().top-90)}")
                        page.wait_for_timeout(250)
                else:
                    # 目标放在视口 42% 高度处（底部留给字幕），页面懒加载会抖，滚三次收敛
                    for _ in range(3):
                        el.evaluate("e=>{const r=e.getBoundingClientRect();window.scrollBy(0,r.top+r.height/2-innerHeight*0.42)}")
                        page.wait_for_timeout(250)
                page.wait_for_timeout(300)
                act = s.get("action", "hover")
                if act == "hover":
                    el.hover()
                elif act == "click":
                    el.click(); page.wait_for_timeout(600)
                elif act == "select":
                    el.evaluate("""e=>{const r=document.createRange();r.selectNodeContents(e);
                        const sel=window.getSelection();sel.removeAllRanges();sel.addRange(r);}""")
                    el.hover()
                elif act == "point":
                    pass  # 只定位不悬停，避免触发 tooltip
                page.wait_for_timeout(200)
                b = el.bounding_box()
                # extend: 把后面 N 个兄弟节点并入目标框（如标题+正文）
                if s.get("extend"):
                    ext = el.evaluate("""(e,n)=>{e=e.closest('.markdown-heading')||e;let r=e.getBoundingClientRect(),x1=r.left,y1=r.top,x2=r.right,y2=r.bottom,c=e;
                        for(let i=0;i<n&&c.nextElementSibling;i++){c=c.nextElementSibling;if(/^H[1-6]$/.test(c.tagName)||c.classList.contains('markdown-heading'))break;
                        const q=c.getBoundingClientRect();x1=Math.min(x1,q.left);y1=Math.min(y1,q.top);x2=Math.max(x2,q.right);y2=Math.max(y2,q.bottom);}
                        return {x:x1,y:y1,width:x2-x1,height:y2-y1}}""", s["extend"])
                    ext["height"] = min(ext["height"], vh - ext["y"] - 10)  # 截到视口底
                    b = ext
                if b and (b["width"] >= 1500 or b["height"] >= 800):
                    print("WARN bbox too big", s.get("id"), b, "likely crawled into article/main/body, reduce up")
                box = {k: round(v, 1) for k, v in b.items()}
            elif s.get("scroll_to"):
                page.evaluate(f"window.scrollTo(0,{s['scroll_to']})"); page.wait_for_timeout(300)
            png = out / "shots" / f"{s['id']}.png"
            if s.get("tall"):
                # 长图滚动镜头：从当前滚动位置截 vh*tall 高的长图，build 端做页面缓慢上滚（浏览感）。
                # bbox 只用于定位截取起点，渲染时不推镜不画重点（内容在动，框会漂）。
                tall = float(s["tall"])
                sy = page.evaluate("window.scrollY")
                page.screenshot(path=str(png), full_page=True,
                                clip={"x": 0, "y": sy, "width": vw, "height": int(vh * tall)})
            else:
                page.screenshot(path=str(png))
            result.append({**s, "url": url, "png": str(png.relative_to(out)), "bbox": box,
                           "viewport": {"width": vw, "height": vh}})
            print("shot", s["id"], box, f"tall={s.get('tall')}" if s.get("tall") else "")
        rec_ctx.close(); browser.close()
    json.dump(result, open(out / "shots.json", "w"), ensure_ascii=False, indent=2)

if __name__ == "__main__":
    run(sys.argv[1], sys.argv[2])
