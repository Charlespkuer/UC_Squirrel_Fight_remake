#!/usr/bin/env python3
"""用 AI 超分（waifu2x-ncnn-vulkan）把素材**真正**变清晰，而不是插值抹平。

## 和 tools/upscale-assets.py（Lanczos 版）的区别

Lanczos 只是插值：像素变多了，边缘只是被抹平滑，**没有新细节**。
waifu2x 是 CNN 超分，见过大量卡通线稿，能把笔画/描边/渐变**重建**出来。
实测同一张按钮底图锐度：原始 1095 → Lanczos 1771 → waifu2x 2905。

## 透明图怎么处理（这里踩过坑，别再改回去）

waifu2x **不认 alpha**。第一版的做法是「同一张图合成到白底和黑底各跑一次再反推」：

    a = 1 - (white - black)/255 ,  c = black/a

**这个做法有严重缺陷**：AI 对边缘是**非线性重建**的，两次推理在边界处会算出不一致的
结果，于是 a 出现噪声、c 又被 1/a 放大 → 成品边缘出现**灰带和白色光晕**。返回菜单
与村庄图标就是这么脏掉的：原图半透明像素 0 个，成品却有 1000+ 个。

现在改成：

1. **alpha 完全不用 AI**：拿原图 alpha 直接 Lanczos 放大 → 干净、无噪声、和原图抠图
   完全一致；再把极淡的杂边（a < 8/255）清零。
2. **颜色合到中性灰(128) 上跑一次 AI**（只跑一次，比双底快一倍），再精确反混合：

       comp = c*a + 128*(1-a)   →   c = (comp - 128*(1-a)) / a

   除数下限取 1/16 防噪声放大；a≈0 的地方颜色本来就看不见，不影响观感。
3. **按预乘方式降采样**：p = c*a 与 a 分别 LANCZOS 缩放后再 c = p/a，边缘不会因为
   「未预乘缩放」而发暗或发白。

## 用法

    python tools/ai-upscale.py --buttons     # 8 个经典按钮 → 786x192（原地，备份在 .bak-upscale）
    python tools/ai-upscale.py --tree        # images/classic/** → images/classic/@2x/**
    python tools/ai-upscale.py --files a.png --out DIR
    python tools/ai-upscale.py --tree --no-ai   # 只做后处理，复用上次的 4x 中间产物

环境变量 `WAIFU2X` 指定 waifu2x 目录；`WAIFU2X_GPU` 选 GPU（默认 0）。
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.path.join(os.environ.get("TEMP", ROOT), "ssdz-ai-upscale")
MATTE = 128.0                      # 颜色合成用的中性灰

DEFAULT_WAIFU2X = r"E:\dev\sr\waifu2x\waifu2x-ncnn-vulkan-20250915-windows"
TREE_DIRS = ["sprites", "icons", "characters", "home", "new-reference", "reference-cards", "skins"]
# 这些子目录**不要**做 @2x：它们是「整图原地替换」的，再做一次就是二次放大
TREE_SKIP_SUBDIRS = ["new-reference/buttons"]
# 需要单独补 @2x 的散图（canvas 绘制，srcset 管不到，走 DPR 判断加载）
EXTRA_FILES = ["images/classic/squirrel-classic.png",
               "images/classic/squirrel-berserker-classic.png"]
BUTTON_BOX = (393, 96)
# 源图边缘残留背景色时，先把 alpha 腐蚀掉 N 像素再放大（单位：源图像素）。
# 为什么不能靠颜色自动判别：美术自身的深色描边和「残留背景」颜色差一样大。
# 所以按来源分组指定——从截图里抠出来的（按钮、首页图标）才会有残边。
BUTTON_ERODE = 2
TREE_ERODE = {"home/": 2}


def find_tool() -> str:
    base = os.environ.get("WAIFU2X") or DEFAULT_WAIFU2X
    if not os.path.exists(os.path.join(base, "waifu2x-ncnn-vulkan.exe")):
        sys.exit("找不到 waifu2x：%s（用环境变量 WAIFU2X 指定目录）" % base)
    return base


def alpha_min(path: str) -> int:
    with Image.open(path) as im:
        if im.mode not in ("RGBA", "LA", "PA"):
            return 255
        return int(np.asarray(im.convert("RGBA").split()[3]).min())


def prepare(path: str, in_dir: str, alpha_dir: str, rel: str, erode: int = 0) -> str:
    """铺 AI 输入：有透明的合到中性灰上（原 alpha 另存），否则直接 RGB。

    erode>0 时先把 alpha 腐蚀 N 像素，切掉源图边缘残留的背景色带。
    """
    with Image.open(path) as im:
        im = im.convert("RGBA")
        out = os.path.join(in_dir, rel)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        if alpha_min(path) >= 250:                          # 全不透明
            im.convert("RGB").save(out)
            return "opaque"
        if erode > 0:
            im.putalpha(im.split()[3].filter(ImageFilter.MinFilter(2 * erode + 1)))
        a = np.asarray(im.split()[3]).astype(np.float32)[..., None] / 255.0
        rgb = np.asarray(im.convert("RGB")).astype(np.float32)
        comp = np.clip(rgb * a + MATTE * (1 - a), 0, 255).astype(np.uint8)
        Image.fromarray(comp).save(out)
        ap = os.path.join(alpha_dir, rel)                    # 原 alpha（灰度）
        os.makedirs(os.path.dirname(ap), exist_ok=True)
        im.split()[3].save(ap)
        return "alpha"


def run_ai(tool_dir: str, in_dir: str, out_dir: str, gpu: str) -> None:
    """目录模式跑一次（比逐张调用省掉每次启动开销）。"""
    os.makedirs(out_dir, exist_ok=True)
    exe = os.path.join(tool_dir, "waifu2x-ncnn-vulkan.exe")
    cmd = [exe, "-i", in_dir, "-o", out_dir, "-s", "4", "-n", "-1",
           "-m", os.path.join(tool_dir, "models-cunet"), "-g", gpu]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.exit("waifu2x 失败：\n" + (proc.stderr or "")[-2000:])


def resize_pma(rgb: np.ndarray, a: np.ndarray, size: tuple[int, int]) -> tuple[np.ndarray, np.ndarray]:
    """按预乘方式缩放：颜色先乘 alpha，缩放后再除回来（避免边缘发暗/发白）。"""
    p = np.clip(rgb * a[..., None], 0, 255).astype(np.uint8)
    p_i = Image.fromarray(p).resize(size, Image.LANCZOS)
    a_i = Image.fromarray((a * 255).astype(np.uint8)).resize(size, Image.LANCZOS)
    p2 = np.asarray(p_i).astype(np.float32)
    a2 = np.asarray(a_i).astype(np.float32) / 255.0
    rgb2 = p2 / np.maximum(a2, 1e-3)[..., None]
    return np.clip(rgb2, 0, 255), a2


def decontaminate(rgb: np.ndarray, a: np.ndarray, rounds: int = 10) -> np.ndarray:
    """边缘去污：把半透明像素的颜色换成「最近的不透明像素」的颜色。

    为什么需要：这些图是从截图里抠出来的，最外圈常常残留背景色（返回菜单左缘的
    绿色细线、更换装备外圈的白边）。放大只会把它一起放大。做法是把 a<0.9 的像素
    逐轮用邻居里不透明像素的颜色填掉——只改颜色、**不动 alpha**，所以形状不变。
    """
    out = rgb.copy()
    solid = a >= 0.9
    known = solid.copy()
    for _ in range(rounds):
        if known.all():
            break
        # 每轮把「已知颜色」向未知区域扩散一格
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            shifted = np.roll(out, (dy, dx), axis=(0, 1))
            kshift = np.roll(known, (dy, dx), axis=(0, 1))
            take = (~known) & kshift
            if take.any():
                out[take] = shifted[take]
                known |= take
    return out


def finish(rel: str, kind: str, out4: str, alpha_dir: str, alpha4_dir: str, target: tuple[int, int] | None, dst: str) -> None:
    src4 = os.path.join(out4, rel)
    if kind == "alpha":
        comp = np.asarray(Image.open(src4).convert("RGB")).astype(np.float32)
        ap4 = os.path.join(alpha4_dir, rel)
        aim = Image.open(ap4 if os.path.exists(ap4) else os.path.join(alpha_dir, rel)).convert("L")
        a4 = np.asarray(aim.resize((comp.shape[1], comp.shape[0]), Image.LANCZOS)).astype(np.float32) / 255.0
        c4 = (comp - MATTE * (1 - a4)[..., None]) / np.maximum(a4, 1 / 16.0)[..., None]
        c4 = np.clip(c4, 0, 255)
        if target:
            rgb, a = resize_pma(c4, a4, target)
        elif c4.shape[0] % 2 == 0 and c4.shape[1] % 2 == 0:
            # 没有指定目标时默认出「原图 2 倍」：AI 跑的是 4 倍，这里降一半。
            # （漏掉这一步会让 @2x 目录变成 4 倍：字节数 4 倍、@2x 名不副实。）
            rgb, a = resize_pma(c4, a4, (c4.shape[1] // 2, c4.shape[0] // 2))
        else:
            rgb, a = c4, a4
        a = np.where(a < 8 / 255.0, 0.0, a)                  # 清掉极淡杂边
        # 边缘像素的颜色直接用「最近的不透明像素色」：
        #   1) 切掉源图残留的背景色边（返回菜单左缘的绿线、更换装备外圈的白边）；
        #   2) 低 alpha 处反混合要除以 a，噪声会被放大十几倍 —— 看起来没事，但 PNG
        #      完全压不动（@2x 会从 75 MB 涨到 161 MB）。用邻色替代后既干净又小。
        clean = decontaminate(rgb, a)
        edge = (a < 0.9)[..., None]
        rgb = np.where(edge, clean, rgb)
        rgb[a <= 0] = 0
        im = Image.fromarray(np.dstack([np.clip(rgb, 0, 255), a * 255.0]).astype(np.uint8), "RGBA")
    else:
        im = Image.open(src4).convert("RGBA")
        if target:
            im = im.resize(target, Image.LANCZOS)
        elif im.width % 2 == 0 and im.height % 2 == 0:
            im = im.resize((im.width // 2, im.height // 2), Image.LANCZOS)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if dst.lower().endswith((".jpg", ".jpeg")):
        im.convert("RGB").save(dst, "JPEG", quality=95, subsampling=0, optimize=True)
    else:
        im.save(dst, "PNG", optimize=True)


def collect(args) -> list[tuple[str, tuple[int, int] | None, str, int]]:
    jobs: list[tuple[str, tuple[int, int] | None, str, int]] = []
    if args.buttons:
        d = os.path.join(ROOT, "images/classic/new-reference/buttons")
        bak = os.path.join(d, ".bak-upscale")
        src_dir = bak if os.path.isdir(bak) else d
        for f in sorted(os.listdir(src_dir)):
            if f.lower().endswith(".png"):
                jobs.append((os.path.join(src_dir, f), (BUTTON_BOX[0] * 2, BUTTON_BOX[1] * 2), os.path.join(d, f), BUTTON_ERODE))
    elif args.tree:
        base = os.path.join(ROOT, "images/classic")
        out_base = args.out or os.path.join(base, "@2x")
        files: list[str] = []
        for sub in TREE_DIRS:
            root = os.path.join(base, sub)
            if not os.path.isdir(root):
                continue
            for dp, _, fs in os.walk(root):
                for f in sorted(fs):
                    if f.lower().endswith(".png"):
                        files.append(os.path.join(dp, f))
        for extra in EXTRA_FILES:
            p = os.path.join(ROOT, extra)
            if os.path.exists(p):
                files.append(p)
        for src in files:
            rel = os.path.relpath(src, base).replace("\\", "/")
            if any(rel.startswith(s) for s in TREE_SKIP_SUBDIRS):
                continue
            erode = 0
            for prefix, n in TREE_ERODE.items():
                if rel.startswith(prefix):
                    erode = n
            jobs.append((src, None, os.path.join(out_base, rel), erode))
    elif args.files:
        for f in args.files:
            src = f if os.path.isabs(f) else os.path.join(ROOT, f)
            jobs.append((src, None, os.path.join(args.out or os.path.join(ROOT, "out/ai"), os.path.basename(f)), 0))
    return jobs


def main() -> int:
    ap = argparse.ArgumentParser(description="用 waifu2x 做 AI 超分（真正重建细节）")
    ap.add_argument("--buttons", action="store_true")
    ap.add_argument("--tree", action="store_true")
    ap.add_argument("--files", nargs="*")
    ap.add_argument("--out")
    ap.add_argument("--gpu", default=os.environ.get("WAIFU2X_GPU", "0"))
    ap.add_argument("--no-ai", action="store_true", help="跳过推理，复用上次的 4x 产物")
    args = ap.parse_args()

    jobs = collect(args)
    if not jobs:
        ap.print_help()
        return 2

    tool = find_tool()
    in_dir = os.path.join(WORK, "in")
    out4_dir = os.path.join(WORK, "out4")
    alpha_dir = os.path.join(WORK, "alpha")
    alpha4_dir = os.path.join(WORK, "alpha4")

    if not args.no_ai:
        for d in (in_dir, out4_dir, alpha_dir, alpha4_dir):
            if os.path.isdir(d):
                shutil.rmtree(d)
        print("1) 铺输入…")
        kinds = {}
        for i, (src, _, _, erode) in enumerate(jobs):
            kinds[i] = prepare(src, in_dir, alpha_dir, "%06d.png" % i, erode)
        n_a = sum(1 for k in kinds.values() if k == "alpha")
        print("   %d 张（%d 张带透明：中性灰合成 + 原 alpha）" % (len(jobs), n_a))
        print("2) waifu2x 4x 推理（颜色）…")
        t0 = time.time()
        run_ai(tool, in_dir, out4_dir, args.gpu)
        # alpha 也过一遍 AI：单通道跑不会像白/黑双底那样在边界处发散，
        # 却能把源图自身的锯齿修成平滑曲线（change-equipment 那种台阶边就是这个原因）。
        if n_a:
            print("   颜色用时 %.1fs；再跑 alpha…" % (time.time() - t0))
            run_ai(tool, alpha_dir, alpha4_dir, args.gpu)
        print("   合计用时 %.1fs" % (time.time() - t0))
    else:
        kinds = {i: ("alpha" if os.path.exists(os.path.join(alpha_dir, "%06d.png" % i)) else "opaque")
                 for i in range(len(jobs))}
        print("1) 跳过推理，复用 " + out4_dir)

    print("3) 反混合 + 预乘降采样…")
    for i, (src, target, dst, _erode) in enumerate(jobs):
        finish("%06d.png" % i, kinds[i], out4_dir, alpha_dir, alpha4_dir, target, dst)
        if (i + 1) % 200 == 0:
            print("   %d/%d" % (i + 1, len(jobs)))
    total = sum(os.path.getsize(j[2]) for j in jobs if os.path.exists(j[2]))
    print("完成 %d 张，输出合计 %.1f MB" % (len(jobs), total / 1048576))
    return 0


if __name__ == "__main__":
    sys.exit(main())
