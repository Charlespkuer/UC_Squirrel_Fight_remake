#!/usr/bin/env python3
"""首页三张小图（村庄 / 聊天 / 活动）：重新抠图 + 超分 + 去锐化。

## 为什么要重做

这三张原来由 `tools/refine-classic-icons.py` 用「手画多边形 + 去绿背景」从参考截图里裁。
多边形正好压在美术上，切边是平的，还把背景的草绿留在里面——用户明确说
「村庄那张抠图做得很差」。现在换成：

- **village**：从 `references/_tmp_village_region.png` 重抠。主体四周是一圈深棕描边，
  背景是草地绿 / 青蓝瓦片 / 浅棕墙面，都不是「暗且偏红」，所以拿描边当墙、从四边
  flood fill，再把混进主体的草绿剔掉（主体里一点绿色都没有，判据很安全）。
- **chat / activity**：直接改用原版资源图 `images/classic/sprites/resource_1-16.png`
  与 `resource_16-0.png`——本来就是干净透明底，不需要抠。

## 超分与去锐化

三张都走 `tools/ai-upscale.py`（waifu2x ×4 再降采样）。显示盒子是
`.picture-button img{width:78px;height:76px}` 和 `.village-door img`（130×130，contain），
所以输出按「最长边 = 2 倍显示尺寸」出：village 260、chat/activity 156。
浏览器只会缩小，DPR 2 下不再糊。

去锐化用**只柔化、不磨圆**那一档（`--alpha-smooth`，不给 `--alpha-threshold`）：
这三张的 alpha 是手抠/原版资源，本来就没有按钮那种二值台阶，取等值线反而会把
原版的柔光边切掉。

## 用法

    python tools/refine-home-assets.py            # 抠图 + 超分，直接写回仓库
    python tools/refine-home-assets.py --no-ai    # 只重抠 1x，不跑超分

**注意**：本脚本会覆盖 `refine-classic-icons.py` 生成的那三张图。后者不要再跑，
或者跑完之后再跑一次本脚本。
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOME = os.path.join(ROOT, "images/classic/home")
VILLAGE_SRC = os.path.join(ROOT, "references/_tmp_village_region.png")

# 抠图参数
DARK = 140          # 「暗」的亮度上限
RBIAS = 30          # 红比蓝高这么多才算「偏红」（描边 / 红门 / 金门环）
SEED = (122, 150)   # 红门中央：确保取到主体那一块而不是背景
MARGIN_1X = 2       # 1x 阶段的边缘去污深度

# 超分参数：(文件名, 最长边, 柔化半径)
PLAN = [
    ("village.png", 260, 1.0),
    ("chat.png", 156, 0.8),
    ("activity.png", 156, 0.8),
]


def matte_village() -> Image.Image:
    """把村庄门楼从截图区域里抠出来（1x）。"""
    rgb = np.asarray(Image.open(VILLAGE_SRC).convert("RGB")).astype(np.float32)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    barrier = (lum < DARK) & ((r - b) > RBIAS)
    green = (g > r + 8) & (g > b + 8)

    lab, _ = ndimage.label(~barrier, structure=np.ones((3, 3), int))
    border_ids = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1])
    border_ids.discard(0)
    keep = ~np.isin(lab, list(border_ids))
    keep &= ~green

    klab, _ = ndimage.label(keep, structure=np.ones((3, 3), int))
    sx, sy = SEED
    tid = klab[sy, sx]
    if tid == 0:                       # 种子点不在主体里就退回最大块
        tid = 1 + int(np.argmax(np.bincount(klab.ravel())[1:]))
        print("   种子点不在主体里，改用最大连通块")
    mask = ndimage.binary_fill_holes(klab == tid)
    print("   主体面积 %d 像素 (%.1f%%)" % (mask.sum(), 100.0 * mask.mean()))

    # 边缘去污：外圈 MARGIN_1X 像素的颜色换成更靠里的可靠色。
    # 取色源额外排掉「残余草绿」——描边和草地混出来的橄榄绿（如 (102,120,61)）
    # 过不了 mask 那关的绿色阈值，会留在成品上当一小块绿斑；这里只改颜色不改 alpha，
    # 所以文字/描边的轮廓不受影响。
    r2, g2, b2 = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    green_soft = (g2 > r2 + 5) & (g2 > b2 + 5)
    core = mask.copy()
    for _ in range(MARGIN_1X):
        core = ndimage.binary_erosion(core, structure=np.ones((3, 3), bool))
    source = core & ~green_soft
    if not source.any():
        source = core
    kept = source.copy()
    out = rgb.copy()
    for _ in range(40):
        if kept.all():
            break
        grew = False
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            sh = np.roll(out, (dy, dx), axis=(0, 1))
            ks = np.roll(kept, (dy, dx), axis=(0, 1))
            take = (~kept) & ks
            if take.any():
                out[take] = sh[take]
                kept |= take
                grew = True
        if not grew:
            break
    rgb2 = np.where(source[..., None], rgb, out)
    rgb2[~mask] = 0

    ys, xs = np.where(mask)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    res = np.dstack([np.clip(rgb2[y0:y1, x0:x1], 0, 255).astype(np.uint8),
                     (mask[y0:y1, x0:x1] * 255).astype(np.uint8)])
    im = Image.fromarray(res, "RGBA")
    print("   主体 bbox 裁切 (x0=%d y0=%d x1=%d y1=%d) → %dx%d" % (x0, y0, x1, y1, im.width, im.height))
    return im


def upscale(paths: list[str], max_dim: int, smooth: float) -> None:
    cmd = [sys.executable, os.path.join(ROOT, "tools", "ai-upscale.py"),
           "--files", *paths, "--max-dim", str(max_dim), "--out", HOME,
           "--alpha-smooth", str(smooth), "--alpha-aa", "0", "--edge-margin", "2"]
    subprocess.run(cmd, check=True)


def main() -> int:
    ap = argparse.ArgumentParser(description="重抠 + 超分首页三张小图")
    ap.add_argument("--no-ai", action="store_true", help="只重抠 1x，不跑 waifu2x")
    args = ap.parse_args()

    os.makedirs(HOME, exist_ok=True)

    print("1) 重抠 village（源：references/_tmp_village_region.png）")
    village = matte_village()
    village.save(os.path.join(HOME, "village.png"))
    print("   → images/classic/home/village.png %dx%d（1x）" % village.size)

    print("2) 用原版资源图替换 chat / activity")
    for src_rel, dst in (("images/classic/sprites/resource_1-16.png", "chat.png"),
                         ("images/classic/sprites/resource_16-0.png", "activity.png")):
        src = os.path.join(ROOT, src_rel)
        im = Image.open(src).convert("RGBA")
        im.save(os.path.join(HOME, dst))
        print("   %s → images/classic/home/%s %dx%d（1x）" % (src_rel, dst, im.width, im.height))

    if args.no_ai:
        print("3) --no-ai：跳过超分")
        return 0

    print("3) 超分 + 去锐化")
    for name, max_dim, smooth in PLAN:
        print("   → %s（最长边 %d，柔化 %.1f）" % (name, max_dim, smooth))
        upscale([os.path.join(HOME, name)], max_dim, smooth)
    for name, _, _ in PLAN:
        with Image.open(os.path.join(HOME, name)) as im:
            print("   %-14s %dx%d  %.1f KB" % (name, im.width, im.height,
                                               os.path.getsize(os.path.join(HOME, name)) / 1024))
    return 0


if __name__ == "__main__":
    sys.exit(main())
