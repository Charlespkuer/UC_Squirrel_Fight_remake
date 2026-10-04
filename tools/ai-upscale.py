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

1. **alpha 照样过一趟 AI**（单通道，不会像白/黑双底那样在边界处发散），但**别指望
   它去锯齿**：按钮的 alpha 是二值掩膜（0/255），waifu2x 对硬边倾向于「保持硬」，
   实测换 anime 模型或加降噪台阶都一样明显。真正的锯齿要单独磨圆，见下一条。
2. **外缘磨圆**（`--buttons` 默认开启，半径 `--alpha-smooth`，见 `smooth_alpha`）：
   高斯 → 取 0.5 等值线 → 补一点点抗锯齿。只动 alpha，轮廓平均位移约 0.002 像素。
   为什么不是单纯高斯：那样边缘会糊成一条宽带，锯齿没了但整块发虚。
3. **颜色合到中性灰(128) 上跑一次 AI**（只跑一次，比双底快一倍），再精确反混合：

       comp = c*a + 128*(1-a)   →   c = (comp - 128*(1-a)) / a

   除数下限取 1/16 防噪声放大；a≈0 的地方颜色本来就看不见，不影响观感。
4. **按预乘方式降采样**：p = c*a 与 a 分别 LANCZOS 缩放后再 c = p/a，边缘不会因为
   「未预乘缩放」而发暗或发白。

## 用法

    python tools/ai-upscale.py --buttons     # 8 个经典按钮 → 786x192（原地；1x 原图读 references/new-reference-buttons-1x）
    python tools/ai-upscale.py --dir images/classic/icons --soft-alpha --alpha-smooth 0.6
                                             # 整目录原地 2 倍（icons；自动备份到 .bak-upscale/）
    python tools/ai-upscale.py --tree        # images/classic/** → images/classic/@2x/**
    python tools/ai-upscale.py --files a.png --out DIR
    python tools/ai-upscale.py --files a.png --max-dim 260 --out DIR   # 缩放到最长边 260 再超分
    python tools/ai-upscale.py --tree --no-ai   # 只做后处理，复用上次的 4x 中间产物
    python tools/ai-upscale.py --buttons --erode 1 --out DIR   # 试参数，不动原地文件
    python tools/ai-upscale.py --buttons --alpha-smooth 3.5 --out DIR   # 边缘再圆一点

三种输入模式，怎么选：

* `--buttons`：8 张经典按钮，固定出 786x192，源图从 references 留档读；
* `--dir DIR`：整目录原地放大（默认每张 2 倍），尺寸由 CSS 锁死、只会被缩小的素材用
  （icons 就是）。会自动备份到该目录下的 `.bak-upscale/`，并优先从备份读源图，
  所以重复跑不会把 2x 又放大成 4x；
* `--files a.png...`：零散单图，配 `--out` 决定落盘位置；加 `--max-dim N` 缩放源图。

`--buttons` 的输出目录默认是素材原地，加 `--out` 可改成只写别处（方便对比不同
`--erode` / `--alpha-smooth`）。按钮的默认腐蚀是 0：素材外圈已经由
`extract-new-reference-buttons.py` 的 `decontaminate_edge` 从按钮自身取色，
没有需要切掉的背景色，再腐蚀只会削薄描边。
觉得边缘还有台阶就把 `--alpha-smooth` 调大（2.5 是当前默认，3.5 更圆但会略失形状）；
调成 0 则完全不动轮廓。

`--buttons` 的 **1x 原图不再放在素材目录里**（那里只有 786x192 成品），而是留档在
`references/new-reference-buttons-1x/`——只作参考、不进游戏、也不进仓库。
读错目录会被 `main()` 的「拒绝二次放大」拦下，不会把 2x 又放大成 4x。

alpha 有两档处理，按素材来源选（详见 `smooth_alpha` 与 `prepare`）：

* **二值掩膜**（从截图抠出来的按钮）：合到中性灰跑 AI，再反混合；外缘用
  `--alpha-smooth 2.5` + 取等值线磨圆（`--alpha-threshold 0.5`，`--buttons` 默认）。
* **干净素材**（icons、原版资源图这种本来就有柔光 alpha 的）：加 `--soft-alpha`。
  它不合灰底、不反混合、不去污——那套反混合要求 AI 对合成图和 alpha 图的重建互相
  一致，柔光素材不满足，会把柔光的颜色算成暗色甚至纯黑（prop-25 的绿光实测从
  (48,255,68) 掉到 (13,78,20)）。这一档只做 `--alpha-smooth` 的单纯柔化。

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
# 按钮外缘磨圆（只对 --buttons 生效；见 smooth_alpha）。
#
# 为什么不交给 AI：按钮的 alpha 是从截图抠出来的**二值掩膜**（只有 0/255），
# waifu2x 对硬边的倾向是「保持硬」——实测 cunet/-n -1 与 anime 模型/-n 2 出来的
# 台阶一样明显（anime 那版半透明像素反而更少、更硬）。放大 2.5 倍之后，
# 台阶就是肉眼可见的锯齿，只能显式把轮廓磨圆。
#
#   ALPHA_SMOOTH_BUTTONS = 取等值线前的高斯半径，越大越圆（输出像素）；
#   ALPHA_AA             = 收边时补的抗锯齿半径，只影响边缘软硬，不影响圆润度。
# 与「面积覆盖率」参考轮廓相比，磨圆只把轮廓平均挪动约 0.002 像素，形状不变。
ALPHA_SMOOTH_BUTTONS = 2.5
ALPHA_AA = 0.8
# 边缘去污深度（输出像素）：离边界这么近的颜色都不可信，用更靠里的颜色替换。
# 3 像素足以盖掉 AI 反混合在边缘留下的脏色/黑点，又不会啃进描边本身。
EDGE_MARGIN = 3

BUTTON_DIR = "images/classic/new-reference/buttons"
# 1x 原始按钮的留档位置（按优先级；见 find_button_source）。
BUTTON_SOURCE_DIRS = [
    "references/new-reference-buttons-1x",
    BUTTON_DIR + "/.bak-upscale",
]
# 源图边缘残留背景色时，先把 alpha 腐蚀掉 N 像素再放大（单位：源图像素）。
# 为什么不能靠颜色自动判别：美术自身的深色描边和「残留背景」颜色差一样大。
# 所以按来源分组指定——从截图里抠出来的（按钮、首页图标）才会有残边。
# 按钮这里现在是 0：外圈已经由 extract-new-reference-buttons.py 的
# decontaminate_edge 从按钮自身取色（返回菜单那圈细绿边就是它去掉的），
# 没有再需要「切掉」的背景，腐蚀只会白白削薄描边。要更保险可用 --erode 1。
BUTTON_ERODE = 0
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


def prepare(path: str, in_dir: str, alpha_dir: str, rel: str, erode: int = 0,
            soft: bool = False) -> str:
    """铺 AI 输入：有透明的合到中性灰上（原 alpha 另存），否则直接 RGB。

    erode>0 时先把 alpha 腐蚀 N 像素，切掉源图边缘残留的背景色带。

    soft=True 走「干净素材」那条路：**不合灰底**，原 RGB 直接喂给 AI，alpha 另存。
    为什么：灰底 + 反混合这套是为「从截图抠出来的脏边」设计的，它要求 AI 对合成图
    和 alpha 图的重建**互相一致**。icons 这种本来就带大块柔光（半透明占 30%）的
    干净素材不满足这个前提——AI 按线稿习惯把 alpha 提硬，合成图却还是软的，反混合
    一算就把柔光的颜色算成暗色甚至纯黑。实测 prop-25 的绿光 (48,255,68) 会掉到
    (13,78,20)。所以这类素材绕过灰底：RGB 直接超分，alpha 用 LANCZOS 放大。
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
        ap = os.path.join(alpha_dir, rel)                    # 原 alpha（灰度）
        os.makedirs(os.path.dirname(ap), exist_ok=True)
        im.split()[3].save(ap)
        if soft:
            im.convert("RGB").save(out)
            return "soft"
        a = np.asarray(im.split()[3]).astype(np.float32)[..., None] / 255.0
        rgb = np.asarray(im.convert("RGB")).astype(np.float32)
        comp = np.clip(rgb * a + MATTE * (1 - a), 0, 255).astype(np.uint8)
        Image.fromarray(comp).save(out)
        return "alpha"


def run_ai(tool_dir: str, in_dir: str, out_dir: str, gpu: str,
           model: str = "models-cunet", noise: str = "-1") -> None:
    """目录模式跑一次（比逐张调用省掉每次启动开销）。"""
    os.makedirs(out_dir, exist_ok=True)
    exe = os.path.join(tool_dir, "waifu2x-ncnn-vulkan.exe")
    cmd = [exe, "-i", in_dir, "-o", out_dir, "-s", "4", "-n", noise,
           "-m", os.path.join(tool_dir, model), "-g", gpu]
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


def erode_mask(mask: np.ndarray, r: int) -> np.ndarray:
    """把布尔掩膜向内缩 r 像素（奇数/偶数半径都支持）。"""
    if r <= 0:
        return mask
    im = Image.fromarray((mask * 255).astype(np.uint8))
    for _ in range(r):
        im = im.filter(ImageFilter.MinFilter(3))
    return np.asarray(im) > 127


def decontaminate(rgb: np.ndarray, a: np.ndarray, margin: int = EDGE_MARGIN,
                  rounds: int = 24) -> tuple[np.ndarray, np.ndarray]:
    """边缘去污：靠边界 margin 像素以内的颜色，一律换成更靠里的可靠颜色。

    为什么必需：这些图是从截图里抠出来的，最外圈常常残留背景色（返回菜单左缘的
    绿色细线、更换装备外圈的白边），放大只会把它一起放大。

    为什么**不能只看 alpha**（旧版就是 `a < 0.9`，这里踩过坑）：反混合
    `c = (comp - 128*(1-a)) / a` 在低 alpha 处会把噪声放大十几倍，偶尔直接算出
    **纯黑**；而磨圆之后边缘一圈的 alpha 有不少已经接近 1，`a < 0.9` 根本筛不掉，
    黑点就留在成品边上了。所以改成按「离边界多远」判断：

      1. 把不透明区域向内缩 margin 像素 → 得到「取色可信」的核心；
      2. 核心颜色逐轮向外扩散，填满整张图；
      3. 只保留核心的原色，其余（整个边缘带）用扩散来的颜色。

    只改颜色、**不动 alpha**，所以形状不变。核心缩没了（极细的突出部）就退回
    按 alpha 判断，避免整块图被替换成邻色。
    """
    solid = a >= 0.9
    core = erode_mask(solid, margin)
    if not core.any():
        core = solid
    out = rgb.copy()
    known = core.copy()
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
    return out, core


def smooth_alpha(a: np.ndarray, sigma: float, aa: float = ALPHA_AA,
                 threshold: float | None = None) -> np.ndarray:
    """柔化 / 磨圆 alpha 外缘（单位：输出图像素）。两种模式：

    **threshold=None：只柔化**。一次高斯，把硬边变软——这就是「去锐化」。
    适合本来就有渐变 alpha 的素材（icons 里 289 张有 183 张带渐变，多半是柔光/投影），
    取等值线会把那些渐变整块切掉。

    **threshold=0.5：磨圆轮廓**。高斯 → 取等值线 → 补抗锯齿。适合**二值**掩膜：
    按钮是从截图抠出来的 0/255 硬边，放大 2.5 倍后台阶边长 2~3 像素，只柔化会糊成
    一条宽带（锯齿没了但发虚），取等值线才能既圆润又收得干净。

    高斯核对称、阈值取 0.5，所以形状与位置基本不动（凸弧上收缩约 sigma²/2R）。
    """
    if sigma <= 0:
        return a
    im = Image.fromarray(np.clip(a * 255.0, 0, 255).astype(np.uint8))
    m = np.asarray(im.filter(ImageFilter.GaussianBlur(sigma))).astype(np.float32) / 255.0
    if threshold is None:
        return m                                   # 只柔化，不动轮廓
    m = (m >= threshold).astype(np.float32)         # 平滑轮廓
    if aa > 0:
        m = np.asarray(Image.fromarray((m * 255.0).astype(np.uint8))
                       .filter(ImageFilter.GaussianBlur(aa))).astype(np.float32) / 255.0
    return m


def finish(rel: str, kind: str, out4: str, alpha_dir: str, alpha4_dir: str,
           target: tuple[int, int] | None, dst: str, smooth: float = 0.0,
           aa: float = ALPHA_AA, margin: int = EDGE_MARGIN,
           threshold: float | None = 0.5) -> None:
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
        # 磨圆外缘要放在「去污染」之前：new 的半透明像素随后会被下面一步填成
        # 最近的不透明色，不会因为 a 变小而露出灰垫色。
        a = smooth_alpha(a, smooth, aa, threshold)
        a = np.where(a < 8 / 255.0, 0.0, a)                  # 清掉极淡杂边
        # 边缘像素的颜色直接用「最靠里的可靠色」：切掉源图残留的背景色边
        # （返回菜单左缘的绿线、更换装备外圈的白边），同时盖掉反混合在低 alpha
        # 处放大出来的噪声/纯黑点。判据是离边界的距离，不是 alpha 大小。
        clean, core = decontaminate(rgb, a, margin)
        rgb = np.where(core[..., None], rgb, clean)
        rgb[a <= 0] = 0
        im = Image.fromarray(np.dstack([np.clip(rgb, 0, 255), a * 255.0]).astype(np.uint8), "RGBA")
    elif kind == "soft":
        # 干净素材：RGB 是 AI 直接超分出来的（没合过灰底），alpha 自己 LANCZOS 放大。
        # 不做灰底反混合，因此也没有「低 alpha 处噪声被 1/a 放大」的问题，
        # 所以这里**不做去污**——去污会把柔光的颜色换成内部实色，正好毁掉它。
        rgb4 = np.asarray(Image.open(src4).convert("RGB")).astype(np.float32)
        a1 = Image.open(os.path.join(alpha_dir, rel)).convert("L")
        if target:
            size = target
        elif rgb4.shape[1] % 2 == 0 and rgb4.shape[0] % 2 == 0:
            size = (rgb4.shape[1] // 2, rgb4.shape[0] // 2)
        else:
            size = (rgb4.shape[1], rgb4.shape[0])
        rgb = np.asarray(Image.fromarray(rgb4.astype(np.uint8)).resize(size, Image.LANCZOS)).astype(np.float32)
        a = np.asarray(a1.resize(size, Image.LANCZOS)).astype(np.float32) / 255.0
        a = smooth_alpha(a, smooth, aa, threshold)
        a = np.where(a < 8 / 255.0, 0.0, a)
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


def find_button_source() -> str:
    """1x 原始按钮从哪读。

    这些原图**不再进游戏、也不再进仓库**，只当参考留档，所以放在 references/
    （.gitignore 已忽略 references/）。兼容顺序：

      1. references/new-reference-buttons-1x/  —— 现在的留档位置；
      2. images/.../buttons/.bak-upscale/      —— 旧位置，留着兼容；
      3. images/.../buttons/ 本身              —— 兜底，但那里已是 786x192 成品，
                                                 再跑一次就是二次放大（main() 会拦）。
    """
    for rel in BUTTON_SOURCE_DIRS:
        p = os.path.join(ROOT, rel)
        if os.path.isdir(p):
            return p
    return os.path.join(ROOT, BUTTON_DIR)


def collect(args) -> list[tuple[str, tuple[int, int] | None, str, int]]:
    jobs: list[tuple[str, tuple[int, int] | None, str, int]] = []
    if args.buttons:
        d = os.path.join(ROOT, BUTTON_DIR)
        src_dir = find_button_source()
        out_dir = args.out or d
        erode = BUTTON_ERODE if args.erode is None else args.erode
        for f in sorted(os.listdir(src_dir)):
            if f.lower().endswith(".png"):
                jobs.append((os.path.join(src_dir, f), (BUTTON_BOX[0] * 2, BUTTON_BOX[1] * 2), os.path.join(out_dir, f), erode))
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
    elif args.dir:
        # 整目录原地放大（icons 这种「尺寸由 CSS/属性锁死」的素材用）。
        # 和 --buttons 一样先备份到 .bak-upscale/，并且优先从备份读源图 —— 这样
        # 重复跑不会把 2x 又放大成 4x。
        d = os.path.join(ROOT, args.dir)
        if not os.path.isdir(d):
            sys.exit("目录不存在：%s" % args.dir)
        bak = os.path.join(d, ".bak-upscale")
        src_dir = bak if os.path.isdir(bak) else d
        if not os.path.isdir(bak):
            os.makedirs(bak, exist_ok=True)
            for f in sorted(os.listdir(src_dir)):
                if f.lower().endswith(".png"):
                    shutil.copy2(os.path.join(src_dir, f), os.path.join(bak, f))
            print("   已备份原始素材到 " + os.path.relpath(bak, ROOT))
        for f in sorted(os.listdir(src_dir)):
            if not f.lower().endswith(".png"):
                continue
            src = os.path.join(src_dir, f)
            target = None
            if args.max_dim:
                with Image.open(src) as im:
                    w, h = im.size
                k = args.max_dim / float(max(w, h))
                target = (max(1, round(w * k)), max(1, round(h * k)))
            jobs.append((src, target, os.path.join(d, f), 0))
    elif args.files:
        for f in args.files:
            src = f if os.path.isabs(f) else os.path.join(ROOT, f)
            target = None
            if args.max_dim:
                with Image.open(src) as im:
                    w, h = im.size
                k = args.max_dim / float(max(w, h))
                target = (max(1, round(w * k)), max(1, round(h * k)))
            jobs.append((src, target, os.path.join(args.out or os.path.join(ROOT, "out/ai"), os.path.basename(f)), 0))
    return jobs


def main() -> int:
    ap = argparse.ArgumentParser(description="用 waifu2x 做 AI 超分（真正重建细节）")
    ap.add_argument("--buttons", action="store_true")
    ap.add_argument("--tree", action="store_true")
    ap.add_argument("--dir", help="原地放大整个目录（相对项目根，如 images/classic/icons）；尺寸交给 CSS 锁定的素材用这个")
    ap.add_argument("--files", nargs="*")
    ap.add_argument("--max-dim", type=int, help="把源图缩放到最长边=N 再超分（不填则默认出 2 倍）")
    ap.add_argument("--out")
    ap.add_argument("--gpu", default=os.environ.get("WAIFU2X_GPU", "0"))
    ap.add_argument("--erode", type=int, help="覆盖默认的外圈腐蚀像素数（--buttons 用，默认 %d）" % BUTTON_ERODE)
    ap.add_argument("--alpha-noise", default="-1", help="alpha 那趟 AI 的降噪级别（默认沿用颜色那趟的 -1）")
    ap.add_argument("--alpha-model", default="models-cunet", help="alpha 那趟用的模型目录名（默认 models-cunet）")
    ap.add_argument("--alpha-smooth", type=float, help="外缘柔化半径（输出像素；--buttons 默认 %s，其它模式默认 0=不动）" % ALPHA_SMOOTH_BUTTONS)
    ap.add_argument("--alpha-aa", type=float, default=ALPHA_AA, help="磨圆后收边的抗锯齿半径（默认 %s）" % ALPHA_AA)
    ap.add_argument("--alpha-threshold", type=float, help="取等值线的阈值；不给就是「只柔化不磨圆」，给了（如 0.5）才磨圆轮廓")
    ap.add_argument("--edge-margin", type=int, default=EDGE_MARGIN, help="边缘去污深度，单位输出像素（默认 %s）" % EDGE_MARGIN)
    ap.add_argument("--soft-alpha", action="store_true",
                    help="干净素材模式：不合灰底、不反混合、不去污（icons 这种带柔光的图用）")
    ap.add_argument("--no-ai", action="store_true", help="跳过推理，复用上次的 4x 产物")
    args = ap.parse_args()
    # 磨圆只默认用在按钮上：@2x 树里的精灵/图标没验证过，保持原样最稳。
    if args.alpha_smooth is None:
        args.alpha_smooth = ALPHA_SMOOTH_BUTTONS if args.buttons else 0.0
    # 取等值线也只默认给按钮：icons 大多带渐变 alpha，切等值线会把柔光整块切掉。
    if args.alpha_threshold is None and args.buttons:
        args.alpha_threshold = 0.5

    jobs = collect(args)
    if not jobs:
        ap.print_help()
        return 2

    # 防二次放大：源图如果已经不小于目标尺寸，说明读错了目录（例如读到了成品），
    # 再跑一次只会把 2x 变成 4x。这里直接拦住，别等出图才发现。
    for src, target, _dst, _erode in jobs:
        if not target:
            continue
        with Image.open(src) as im:
            w, h = im.size
        if w >= target[0] or h >= target[1]:
            sys.exit("拒绝二次放大：源图 %s 已是 %dx%d，目标却是 %dx%d。\n"
                     "1x 原图应放在 %s（当前解析到：%s）" % (
                         os.path.relpath(src, ROOT), w, h, target[0], target[1],
                         BUTTON_SOURCE_DIRS[0], os.path.relpath(find_button_source(), ROOT)))
    if args.buttons:
        print("源图目录（1x 原图）：" + os.path.relpath(find_button_source(), ROOT))

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
            kinds[i] = prepare(src, in_dir, alpha_dir, "%06d.png" % i, erode, args.soft_alpha)
        n_a = sum(1 for k in kinds.values() if k == "alpha")
        if args.soft_alpha:
            print("   %d 张（干净素材模式：RGB 直接超分，alpha 走 LANCZOS，不合灰底）" % len(jobs))
        else:
            print("   %d 张（%d 张带透明：中性灰合成 + 原 alpha）" % (len(jobs), n_a))
        print("2) waifu2x 4x 推理（颜色）…")
        t0 = time.time()
        run_ai(tool, in_dir, out4_dir, args.gpu)
        # alpha 是二值掩膜时才需要单独过 AI（单通道不会像白/黑双底那样在边界处发散，
        # 但 cunet + `-n -1` 会把台阶原样放大）。干净素材模式不用：那边 alpha 直接
        # LANCZOS 放大，AI 提硬反而会毁掉柔光。
        if n_a and not args.soft_alpha:
            print("   颜色用时 %.1fs；再跑 alpha（%s / -n %s）…" % (time.time() - t0, args.alpha_model, args.alpha_noise))
            run_ai(tool, alpha_dir, alpha4_dir, args.gpu, args.alpha_model, args.alpha_noise)
        print("   合计用时 %.1fs" % (time.time() - t0))
    else:
        kinds = {i: ("soft" if args.soft_alpha and os.path.exists(os.path.join(alpha_dir, "%06d.png" % i))
                     else "alpha" if os.path.exists(os.path.join(alpha_dir, "%06d.png" % i)) else "opaque")
                 for i in range(len(jobs))}
        print("1) 跳过推理，复用 " + out4_dir)

    print("3) 反混合 + 预乘降采样…")
    for i, (src, target, dst, _erode) in enumerate(jobs):
        finish("%06d.png" % i, kinds[i], out4_dir, alpha_dir, alpha4_dir, target, dst,
               args.alpha_smooth, args.alpha_aa, args.edge_margin, args.alpha_threshold)
        if (i + 1) % 200 == 0:
            print("   %d/%d" % (i + 1, len(jobs)))
    total = sum(os.path.getsize(j[2]) for j in jobs if os.path.exists(j[2]))
    print("完成 %d 张，输出合计 %.1f MB" % (len(jobs), total / 1048576))
    return 0


if __name__ == "__main__":
    sys.exit(main())
