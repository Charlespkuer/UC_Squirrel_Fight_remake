#!/usr/bin/env python3
"""把界面图标按「显示尺寸」高质量放大，消除浏览器拉伸造成的模糊。

## 为什么要这么做（先看这条链路）

`css/classic-refine.css`：

    .uc-button{height:96px;min-width:393px}
    .classic-button-art{width:100%;height:100%;object-fit:fill}

也就是按钮底图会被**拉伸铺满** 393×96 的盒子。而现有素材的原始尺寸是：

    status-normal.png   208×66      → 被拉伸 1.89×/1.45×
    skill-normal.png    206×65      → 1.91×/1.48×
    return-menu.png     312×82      → 1.26×/1.17×

浏览器用的是双线性插值，放大近 2 倍时边缘发糊；`object-fit:fill` 还会
横向多拉 30%（208×66 的宽高比 3.15，被塞进 393×96 的 4.09）。

## 这个脚本做什么

把素材**离线**用 Lanczos 重采样到「显示尺寸的 N 倍」（默认 2 倍），
浏览器随后只需要按整数比例缩小（2:1），比放大清楚得多，
而且**布局完全不变**（因为 CSS 的盒子尺寸没动）。

- 保留 alpha：RGBA 先分离 alpha 再分别重采样，避免半透明边缘出现黑边/白边。
- 轻微锐化（UnsharpMask）：补偿重采样带来的软化。
- 默认不覆盖原文件，输出到 `--out` 指定的目录；加 `--in-place` 才覆盖（会先备份）。

## 关于 `--fit-box`（**本项目不用**）

`--fit-box` 会把素材补成盒子的宽高比，从而消除 `object-fit:fill` 的拉伸、按钮变成素材的
天然比例。**实测后用户明确否掉了**：原版观感就是「拉宽铺满整格」的那种比例，补边后按钮
变窄反而与截图不符。所以按钮走的是**直接拉伸到盒子的 2 倍尺寸**（几何与改之前逐像素一致，
区别只是离线用 Lanczos 做，比浏览器的双线性放大干净）。

`--fit-box` 保留在工具里备用（其它项目/其它素材可能需要），但**不要**再用到
`new-reference/buttons/` 上。

## 用法

    python tools/upscale-assets.py --preset buttons           # 8 个经典按钮 → out/
    python tools/upscale-assets.py --preset buttons --in-place
    python tools/upscale-assets.py --files a.png b.png --scale 2 --out /tmp/x
    python tools/upscale-assets.py --scan                     # 只报告：哪些图比显示尺寸小
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys

from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 预设：素材目录 → 目标显示尺寸（宽, 高，取自 CSS 的盒子）＋ 需要的倍率
# 只列**已经被 CSS 固定尺寸**的素材，这样放大后布局不会变。
PRESETS = {
    # 经典按钮：CSS .uc-button{height:96px;min-width:393px} + object-fit:fill
    # 原图宽高比与盒子不同，这里直接按盒子尺寸的 2 倍输出，渲染时是纯 2:1 缩小。
    "buttons": {
        "dir": "images/classic/new-reference/buttons",
        "box": (393, 96),
    },
}


def resample(src: Image.Image, size: tuple[int, int]) -> Image.Image:
    """高质量重采样；RGBA 分离 alpha，避免边缘发黑。"""
    if src.mode != "RGBA":
        src = src.convert("RGBA")
    r, g, b, a = src.split()
    rgb = Image.merge("RGB", (r, g, b)).resize(size, Image.LANCZOS)
    alpha = a.resize(size, Image.LANCZOS)
    out = rgb.convert("RGBA")
    out.putalpha(alpha)
    return out


def sharpen(img: Image.Image, percent: float = 80, radius: float = 1.6, threshold: int = 2) -> Image.Image:
    """只锐化 RGB，不动 alpha（否则边缘会出现硬边）。"""
    r, g, b, a = img.split()
    rgb = Image.merge("RGB", (r, g, b)).filter(
        ImageFilter.UnsharpMask(radius=radius, percent=int(percent), threshold=threshold))
    out = rgb.convert("RGBA")
    out.putalpha(a)
    return out


def fit_into_box(img: Image.Image, target: tuple[int, int]) -> Image.Image:
    """等比缩放到目标盒子的**高度**，再横向居中补齐透明边。

    为什么这么做：网页版 CSS 是 .classic-button-art{object-fit:fill}，也就是把素材
    硬拉进 393x96 的盒子。素材原比例 3.15:1、盒子 4.09:1 → 横向被多拉 30%。
    把素材**预先**补成盒子的比例（多出来的是透明边），fill 就不会再拉变形了，
    而盒子的尺寸（=页面布局）一个像素都不用改。
    """
    tw, th = target
    scale = th / img.height
    w = max(1, int(round(img.width * scale)))
    art = img.resize((w, th), Image.LANCZOS)
    canvas = Image.new("RGBA", (tw, th), (0, 0, 0, 0))
    canvas.paste(art, ((tw - w) // 2, 0), art)
    return canvas


def upscale_file(path: str, out_path: str, scale: float, box: tuple[int, int] | None,
                 do_sharpen: bool = True, fit_box: bool = False) -> dict:
    kb_before = os.path.getsize(path) / 1024   # 覆盖写之前先量
    with Image.open(path) as im:
        im.load()
        src_size = im.size
        if box:
            target = (int(round(box[0] * scale)), int(round(box[1] * scale)))
        else:
            target = (int(round(src_size[0] * scale)), int(round(src_size[1] * scale)))
        if fit_box and box:
            # 先按原始比例放大到中间尺寸，再补透明边成盒子比例
            mid = resample(im, (int(round(src_size[0] * scale)), int(round(src_size[1] * scale))))
            out = fit_into_box(mid, target)
        else:
            out = resample(im, target)
        if do_sharpen:
            out = sharpen(out)
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        out.save(out_path, "PNG", optimize=True)
    return {"src": src_size, "out": target,
            "kb_before": kb_before, "kb_after": os.path.getsize(out_path) / 1024}




# ---------------------------------------------------------------------------
# @2x 目录模式：把 images/classic/<dir>/** 整体 2 倍写到 images/classic/@2x/<dir>/**
#
# 为什么不原地覆盖：这些图**没有固定的显示尺寸**（CSS 里没有 .spr 尺寸规则，
# 尺寸由每处调用的 class 决定）。原地放大 2 倍会让它们显示成 2 倍大、撑坏版式。
# 写进 @2x/ 再用 srcset 交给浏览器按屏幕像素密度挑，布局永远不受影响。
# ---------------------------------------------------------------------------
TREE_DIRS = ["sprites", "icons", "characters", "home", "new-reference", "reference-cards", "skins"]


def run_tree(scale: float, do_sharpen: bool, out_dir: str | None) -> int:
    base = os.path.join(ROOT, "images", "classic")
    out_base = out_dir or os.path.join(base, "@2x")
    n = before = after = 0
    for d in TREE_DIRS:
        src_root = os.path.join(base, d)
        if not os.path.isdir(src_root):
            continue
        for dp, _, fs in os.walk(src_root):
            for f in sorted(fs):
                if not f.lower().endswith(".png"):
                    continue
                src = os.path.join(dp, f)
                rel = os.path.relpath(src, base)
                dst = os.path.join(out_base, rel)
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                with Image.open(src) as im:
                    im.load()
                    if im.mode != "RGBA":
                        im = im.convert("RGBA")
                    out = resample(im, (max(1, int(round(im.width * scale))),
                                        max(1, int(round(im.height * scale)))))
                    if do_sharpen:
                        out = sharpen(out)
                    out.save(dst, "PNG", optimize=True)
                n += 1
                before += os.path.getsize(src)
                after += os.path.getsize(dst)
    print("生成 %d 张 @2x" % n)
    print("原素材 %.1f MB → @2x %.1f MB" % (before / 1048576, after / 1048576))
    print("输出：" + out_base)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="界面图标高质量放大（消除浏览器拉伸模糊）")
    ap.add_argument("--preset", choices=sorted(PRESETS))
    ap.add_argument("--files", nargs="*")
    ap.add_argument("--scale", type=float, default=2.0, help="相对显示尺寸的倍率，默认 2")
    ap.add_argument("--box", help="显式盒子尺寸 WxH（覆盖预设）")
    ap.add_argument("--out", help="输出目录（默认 stdout 报告 + 写 out/upscaled）")
    ap.add_argument("--in-place", action="store_true", help="覆盖原文件（先备份到 .bak-upscale/）")
    ap.add_argument("--no-sharpen", action="store_true")
    ap.add_argument("--fit-box", action="store_true", help="等比缩放到盒子的高 + 透明边补齐盒子比例（消除 object-fit:fill 的拉伸）")
    ap.add_argument("--scan", action="store_true", help="只报告：哪些图小于它们的显示尺寸")
    ap.add_argument("--tree", action="store_true", help="整目录 2 倍写到 images/classic/@2x/（配 srcset 用）")
    args = ap.parse_args()

    box = None
    if args.box:
        w, h = args.box.lower().split("x")
        box = (int(w), int(h))

    if args.tree:
        return run_tree(args.scale, not args.no_sharpen, args.out)

    files: list[str] = []
    if args.preset:
        p = PRESETS[args.preset]
        d = os.path.join(ROOT, p["dir"])
        files = [os.path.join(d, f) for f in sorted(os.listdir(d)) if f.lower().endswith(".png")]
        box = box or p["box"]
    elif args.files:
        files = [f if os.path.isabs(f) else os.path.join(ROOT, f) for f in args.files]
    else:
        if not args.scan:
            ap.print_help()
            return 2

    if args.scan:
        print("=== 小于显示尺寸（会被浏览器放大 → 糊）的素材 ===")
        for name, p in PRESETS.items():
            d = os.path.join(ROOT, p["dir"])
            bw, bh = p["box"]
            for f in sorted(os.listdir(d)):
                if not f.lower().endswith(".png"):
                    continue
                with Image.open(os.path.join(d, f)) as im:
                    w, h = im.size
                flag = ""
                if w < bw or h < bh:
                    flag = "  ← 需要放大 %.2fx" % max(bw / w, bh / h)
                print("  %-30s %4dx%-4d 盒子 %dx%d%s" % (f, w, h, bw, bh, flag))
        return 0

    out_root = args.out or os.path.join(ROOT, "out", "upscaled")
    total_before = total_after = 0.0
    for f in files:
        if not os.path.exists(f):
            print("  跳过（不存在）: " + f)
            continue
        if args.in_place:
            bak = os.path.join(os.path.dirname(f), ".bak-upscale", os.path.basename(f))
            os.makedirs(os.path.dirname(bak), exist_ok=True)
            if not os.path.exists(bak):
                shutil.copy2(f, bak)
            out_path = f
        else:
            rel = os.path.relpath(f, ROOT)
            out_path = os.path.join(out_root, rel)
        info = upscale_file(f, out_path, args.scale, box, not args.no_sharpen, args.fit_box)
        total_before += info["kb_before"]
        total_after += info["kb_after"]
        print("  %-28s %4dx%-4d → %4dx%-4d   %6.1f KB → %6.1f KB" % (
            os.path.basename(f), info["src"][0], info["src"][1],
            info["out"][0], info["out"][1], info["kb_before"], info["kb_after"]))
    print()
    print("共 %d 张，合计 %.1f KB → %.1f KB（%.1f×）" % (
        len(files), total_before, total_after, (total_after / total_before) if total_before else 0))
    if not args.in_place:
        print("输出目录：" + out_root)
    return 0


if __name__ == "__main__":
    sys.exit(main())
