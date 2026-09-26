"""重新裁三张首页小图标（活动 / 聊天 / 村庄）与经典松鼠立绘。

用户在反馈里提了两件事：

1. 「活动 / 聊天 / 村庄三个图标没裁干净的边角裁一下」——原先是
   `extract-classic-reference-details.py` 里用手绘多边形抠图，但**没有传背景判定**，
   所以多边形内部残留的草地/树叶绿被留了下来（活动图标底部一条墨绿、聊天气泡
   左侧与底部、村庄门周围的绿），而且多边形正好压在美术上，边是平切的。
2. 「应用图标能不能裁一个没有背景的松鼠出来」——`images/classic/squirrel-classic.png`
   本身就是透明背景，但早先生成的 `src-tauri/app-icon.png` 是贴在米黄底上的。

这个脚本只做这两件事，源图与多边形沿用原来的定义：

* 多边形按 `DILATE` 像素向外扩一圈，让被多边形切平的美术边角长回来；
* 再用「与边界连通的绿色背景」判定把多边形内外残留的绿色背景清掉
  （判定同时覆盖浅绿面板 (210,244,218) 与草地/树叶的深绿）；
* 松鼠用外扩后的矩形 + 米黄判定（与 `extract-ui-assets.py` 的 `reference_cutout` 相同），
  上/左/右各外扩 24px 找回被裁掉的耳朵与尾巴，下边不动以免带进界面上的其它控件；
* 最后按 alpha 包围盒裁掉透明边，并重新生成 1024×1024、**透明背景**的 `src-tauri/app-icon.png`。

用法：`python tools/refine-classic-icons.py [--dilate N] [--grey] [--out DIR]`
      `--dilate` 负数表示向内收（保底做法：宁可少一圈也不留背景渣）
      `--grey`   额外把「浅灰」也算背景（有的截图里图标周围是灰白阴影）
      `--out`    输出目录，默认写回仓库（`--out` 只用来对比效果，不写仓库）
"""
import argparse
from collections import deque
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
def _find_root(start):
    """项目根：从脚本所在目录往上找含 index.html 的那一层（tools/ 放哪都能用）。"""
    d = start
    for _ in range(8):
        if (d / 'index.html').is_file():
            return d
        if d.parent == d:
            break
        d = d.parent
    return start.parent


ROOT = _find_root(Path(__file__).resolve().parent)

parser = argparse.ArgumentParser()
parser.add_argument('--dilate', type=int, default=0)
parser.add_argument('--grey', action='store_true')
parser.add_argument('--green', action='store_true',
                    help='描边法之后再做一遍「全局绿色清理」：把被描边围住、泛洪到不了的草地/树叶渣也清掉')
parser.add_argument('--sky', action='store_true',
                    help='把「蓝天 / 青灰建筑」也算背景（外扩多边形时边缘会带进这些颜色）')
parser.add_argument('--thr', type=int, default=165)
parser.add_argument('--no-junk', dest='junk', action='store_false', help='关掉「深灰树影」这一条背景判定（默认开）')
parser.add_argument('--method', choices=['auto', 'polygon', 'outline', 'hybrid'], default='polygon')
parser.add_argument('--defringe', type=int, default=0,
                    help='抠图后削掉边缘那圈背景混色像素（1 通常就够；默认 0 = 不削）')
parser.add_argument('--out', default=None)
ARGS = parser.parse_args()

OUT = Path(ARGS.out) if ARGS.out else ROOT / 'images' / 'classic'
APP_ICON = ROOT / 'src-tauri' / 'app-icon.png'

HOME_SRC = '屏幕截图 2026-09-23 161746.png'
SQUIRREL_SRC = '屏幕截图 2026-09-23 162807.png'
DILATE = ARGS.dilate     # 多边形外扩像素；负数=向内收，宁可少一圈也不留背景渣
SQUIRREL_PAD = 24        # 松鼠矩形上/左/右外扩；下边不动（下面是界面控件）

# 背景判定：浅绿面板 + 草地/树叶的深绿。纯绿以外的颜色（美术、描边、文字）都不会被清掉。
def is_green(r, g, b):
    # 浅绿面板：必须「绿明显高于红/蓝」，否则纯白（255,253,252）也会被当成背景，
    # 把活动/村庄的白色字啃掉（这是这一版踩过的坑）。
    pale = g > 200 and g > r + 8 and g > b + 8
    # 只清「深色」的草地/树叶；浅色像素可能是白字与草的抗锯齿混合，动了会把字啃掉
    foliage = g > 60 and g >= r * 1.15 and g >= b * 1.03 and max(r, g, b) < 190
    grey = ARGS.grey and abs(r - g) < 26 and abs(g - b) < 26 and abs(r - b) < 30 and min(r, g, b) > 120
    # 村庄那张截图里，门外还有蓝天与青灰色建筑：多边形一外扩就会带进来，
    # 它们既不是绿也不是灰，所以单独一条蓝/青判定（美术本体的红门、白字、黄箭头都不沾）。
    sky = ARGS.sky and b > 110 and b >= r + 6 and b >= g - 6
    if ARGS.junk:
        hi, lo = max(r, g, b), min(r, g, b)
        # 截图里图标周围还有一层「深灰树影」，既不绿也不亮，单独一条规则清掉。
        # 注意不能顺手把「浅灰/白」也当背景：活动/村庄的白色字就是被这条规则啃掉的。
        grey = grey or (hi < 150 and (hi - lo) < 32)
    return pale or foliage or grey or sky


def is_beige(r, g, b):
    # 与 extract-ui-assets.py 的 reference_cutout 保持一致：只清边界连通的米黄/白
    return r > 160 and g > 125 and b > 90 and (r - g) < 100


def is_white(r, g, b):
    """近白像素。只有「聊天」图标用得上：它的气泡下面压着界面上的「聊天」两个白字，
    多边形一放宽就会把字头带进来；气泡内部的白色高光被黄色包住，泛洪够不着，不会被误伤。"""
    return r > 238 and g > 238 and b > 232


def background_predicate(name):
    if name.endswith('chat.png'):
        return lambda r, g, b: is_green(r, g, b) or is_white(r, g, b)
    return is_green


def flood_clear(im, predicate):
    """从四边往内、把与边界连通且符合判定（或本来就是透明）的像素清成透明。"""
    pixels = im.load()
    w, h = im.size
    queue = deque([(x, 0) for x in range(w)] + [(x, h - 1) for x in range(w)] +
                  [(0, y) for y in range(h)] + [(w - 1, y) for y in range(h)])
    seen = set()
    while queue:
        x, y = queue.popleft()
        if not (0 <= x < w and 0 <= y < h) or (x, y) in seen:
            continue
        seen.add((x, y))
        r, g, b, a = pixels[x, y]
        if a == 0 or predicate(r, g, b):
            pixels[x, y] = (r, g, b, 0)
            queue.extend([(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)])
    return im


def defringe(im, passes):
    """把抠图边缘那圈「和背景混出来的浅色像素」清掉（1px 白边 / 绿边）。
    只动「紧邻透明、而且又亮又灰（低饱和）」的像素：美术自己的深色描边 hi 很低会被留下，
    门/字/箭头/盒子/气泡都是暖色（高饱和）也留下，所以只会削掉背景混色那一圈。"""
    for _ in range(max(0, passes)):
        px = im.load()
        w, h = im.size
        kill = []
        for y in range(h):
            for x in range(w):
                r, g, b, a = px[x, y]
                if not a:
                    continue
                border = ((x == 0 or not px[x - 1, y][3]) or (x == w - 1 or not px[x + 1, y][3]) or
                          (y == 0 or not px[x, y - 1][3]) or (y == h - 1 or not px[x, y + 1][3]))
                if not border:
                    continue
                hi, lo = max(r, g, b), min(r, g, b)
                if hi > 168 and (hi - lo) < 70:
                    kill.append((x, y))
        for x, y in kill:
            r, g, b, _ = px[x, y]
            px[x, y] = (r, g, b, 0)
    return im


def write(im, name):
    # alpha=0 的地方把 RGB 也清掉：某些看图工具忽略 PNG alpha，否则会显示被丢弃的背景
    im = im.convert('RGBA')
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a == 0:
                px[x, y] = (0, 0, 0, 0)
    path = OUT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, optimize=True)
    return path


def outline_icon(bounds, name):
    """不靠手绘多边形，靠原图的深色描边当「围墙」：
    从四边往内把「不是描边」的像素当背景清掉，撞到描边就停。这样图标轮廓完全跟着美术走
    （不会再出现多边形切平、或者多边形里残留天空/建筑/草地的情况）。
    描边阈值由 --thr 控制（默认 165；调低才能把深色树丛当背景清掉），描边再故意加粗 1px 堵住抗锯齿造成的缝——和 extract-classic-reference-details.py 里
    处理经典长戟（icons/weapon-1-classic.png）用的是同一套办法。"""
    src = Image.open(ROOT / 'references' / HOME_SRC).convert('RGBA')
    im = src.crop(bounds).convert('RGBA')
    rgb = im.convert('RGB')
    outline = Image.new('L', im.size, 0)
    outline.putdata([255 if max(px) < ARGS.thr else 0 for px in rgb.getdata()])
    outline = outline.filter(ImageFilter.MaxFilter(3))
    wall = outline.load()
    alpha = Image.new('L', im.size, 255)
    a = alpha.load()
    w, h = im.size
    queue = deque([(x, 0) for x in range(w)] + [(x, h - 1) for x in range(w)] +
                  [(0, y) for y in range(h)] + [(w - 1, y) for y in range(h)])
    seen = set()
    while queue:
        x, y = queue.popleft()
        if not (0 <= x < w and 0 <= y < h) or (x, y) in seen:
            continue
        seen.add((x, y))
        if wall[x, y]:
            continue
        a[x, y] = 0
        queue.extend([(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)])
    im.putalpha(alpha)
    if ARGS.green:
        # 泛洪只能清「和裁切框边界连通」的背景；被箭头/文字描边围住的草地够不着，
        # 所以再按颜色全局清一遍绿色（美术本体没有绿色，村庄的门/字/箭头都不受影响）。
        px = im.load()
        for y in range(im.height):
            for x in range(im.width):
                r, g, b, a = px[x, y]
                if a and is_green(r, g, b):
                    px[x, y] = (r, g, b, 0)
    im = im.crop(im.getbbox())
    write(im, name)
    return im


def hybrid_icon(bounds, polygon, name):
    """手绘多边形 + 深色描边围墙 的组合办法，专治这套截图：
    * 多边形保证不会带进旁边的界面元素（图标之间间距很小）；
    * 从多边形**边缘**开始往内泛洪，撞到深色描边才停 —— 多边形内残留的树叶/草地/建筑
      不管深浅都会被清掉，而美术本体被自己的描边圈住、完好保留；
    * 多边形边缘那一圈像素强制清掉，所以即使多边形压在美术上，也只损失 1px，
      不会再出现「沿着多边形直边被切平」的样子。"""
    src = Image.open(ROOT / 'references' / HOME_SRC).convert('RGBA')
    im = src.crop(bounds).convert('RGBA')
    w, h = im.size
    mask = Image.new('L', im.size, 0)
    local = [(x - bounds[0], y - bounds[1]) for x, y in polygon]
    ImageDraw.Draw(mask).polygon(local, fill=255)
    m = mask.load()
    rgb = im.convert('RGB')
    outline = Image.new('L', im.size, 0)
    outline.putdata([255 if max(px) < ARGS.thr else 0 for px in rgb.getdata()])
    outline = outline.filter(ImageFilter.MaxFilter(3))
    wall = outline.load()
    alpha = mask.copy()
    a = alpha.load()
    queue = deque()
    seen = set()
    for y in range(h):
        for x in range(w):
            if not m[x, y]:
                continue
            if (x == 0 or y == 0 or x == w - 1 or y == h - 1 or
                    not (m[x - 1, y] and m[x + 1, y] and m[x, y - 1] and m[x, y + 1])):
                a[x, y] = 0
                queue.append((x, y))
    while queue:
        x, y = queue.popleft()
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if not (0 <= nx < w and 0 <= ny < h) or (nx, ny) in seen:
                continue
            if not m[nx, ny] or wall[nx, ny]:
                continue
            seen.add((nx, ny))
            a[nx, ny] = 0
            queue.append((nx, ny))
    im.putalpha(alpha)
    im = im.crop(im.getbbox())
    write(im, name)
    return im


def auto_icon(bounds, polygon, name, tol=None):
    """「自动」抠图：不靠手绘多边形切边，而是拿裁切框四边的颜色当背景模型 + 原来的绿色判定，
    逐像素判背景；再把「和裁切框边界连通的残留」和「面积很小的碎渣」去掉，最后削一圈混色边。
    多边形在这里只当「允许区」（外扩后），保证不会带进旁边别的界面元素。"""
    tol = int(tol or 46)
    src = Image.open(ROOT / 'references' / HOME_SRC).convert('RGBA')
    im = src.crop(bounds).convert('RGBA')
    w, h = im.size
    px = im.load()
    # 背景色模型：四边各 3 像素
    ring = []
    for x in range(w):
        for y in list(range(0, 3)) + list(range(h - 3, h)):
            ring.append(px[x, y][:3])
    for y in range(h):
        for x in list(range(0, 3)) + list(range(w - 3, w)):
            ring.append(px[x, y][:3])
    # 允许区：多边形外扩（默认 2px，让贴在多边形上的美术边角长回来）
    allow = Image.new('L', im.size, 0)
    local = [(x - bounds[0], y - bounds[1]) for x, y in polygon]
    ImageDraw.Draw(allow).polygon(local, fill=255)
    grow = max(0, DILATE) if DILATE else 2
    if grow:
        allow = allow.filter(ImageFilter.MaxFilter(grow * 2 + 1))
    ap = allow.load()

    def far_from_ring(c):
        for b in ring:
            if (c[0] - b[0]) ** 2 + (c[1] - b[1]) ** 2 + (c[2] - b[2]) ** 2 < tol * tol:
                return False
        return True

    alpha = Image.new('L', im.size, 0)
    al = alpha.load()
    for y in range(h):
        for x in range(w):
            r, g, b, _ = px[x, y]
            if not ap[x, y]:
                continue
            if is_green(r, g, b):
                continue
            if not far_from_ring((r, g, b)):
                continue
            al[x, y] = 255
    im.putalpha(alpha)
    # 去掉和裁切框边界连通的残留（多边形外扩后可能带进来的暗色背景），
    # 以及面积很小的孤立碎渣（抗锯齿噪点）。
    before = sum(1 for p in im.getdata() if p[3] > 0)
    im = drop_connected_to_border(im)
    after = sum(1 for p in im.getdata() if p[3] > 0)
    if after < before * 0.12:      # 兜底：万一美术贴到裁切框边上被整块清掉，就退回不删
        im = src.crop(bounds).convert('RGBA')
        im.putalpha(alpha)
        im = drop_small_blobs(im, 6)
    else:
        im = drop_small_blobs(im, 14)
    im = defringe(im, max(1, ARGS.defringe))
    im = im.crop(im.getbbox())
    write(im, name)
    return im


def drop_connected_to_border(im):
    px = im.load()
    w, h = im.size
    queue = deque()
    seen = set()
    for x in range(w):
        queue.append((x, 0)); queue.append((x, h - 1))
    for y in range(h):
        queue.append((0, y)); queue.append((w - 1, y))
    while queue:
        x, y = queue.popleft()
        if not (0 <= x < w and 0 <= y < h) or (x, y) in seen:
            continue
        seen.add((x, y))
        if px[x, y][3] == 0:
            continue
        px[x, y] = px[x, y][:3] + (0,)
        queue.extend([(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)])
    return im


def drop_small_blobs(im, min_area):
    px = im.load()
    w, h = im.size
    seen = [[False] * w for _ in range(h)]
    for y0 in range(h):
        for x0 in range(w):
            if seen[y0][x0] or px[x0, y0][3] == 0:
                continue
            stack = [(x0, y0)]
            seen[y0][x0] = True
            blob = []
            while stack:
                x, y = stack.pop()
                blob.append((x, y))
                for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                    if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and px[nx, ny][3] > 0:
                        seen[ny][nx] = True
                        stack.append((nx, ny))
            if len(blob) < min_area:
                for x, y in blob:
                    px[x, y] = px[x, y][:3] + (0,)
    return im


def polygon_icon(bounds, polygon, name):
    src = Image.open(ROOT / 'references' / HOME_SRC).convert('RGBA')
    im = src.crop(bounds)
    mask = Image.new('L', im.size, 0)
    local = [(x - bounds[0], y - bounds[1]) for x, y in polygon]
    ImageDraw.Draw(mask).polygon(local, fill=255)
    if DILATE > 0:
        mask = mask.filter(ImageFilter.MaxFilter(DILATE * 2 + 1))
    elif DILATE < 0:
        mask = mask.filter(ImageFilter.MinFilter(-DILATE * 2 + 1))
    im.putalpha(mask)
    flood_clear(im, background_predicate(name))
    im = defringe(im, ARGS.defringe)
    im = im.crop(im.getbbox())
    write(im, name)
    return im


def keep_largest_blob(im):
    """只保留最大的那坨不透明像素，丢掉旁边的碎渣。
    松鼠那片截图外扩后会把别的界面元素带进来（灰黑小弯钩、黄色小斜条），
    它们和松鼠本体不相连，用连通域面积一筛就干净了。首页三个图标不能用这一招：
    村庄是「门 + 文字 + 箭头」三坨，筛了会把文字丢掉。"""
    w, h = im.size
    px = im.load()
    seen = [[False] * w for _ in range(h)]
    best = []
    for y0 in range(h):
        for x0 in range(w):
            if seen[y0][x0] or px[x0, y0][3] == 0:
                continue
            stack = [(x0, y0)]
            seen[y0][x0] = True
            blob = []
            while stack:
                x, y = stack.pop()
                blob.append((x, y))
                for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                    if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and px[nx, ny][3] > 0:
                        seen[ny][nx] = True
                        stack.append((nx, ny))
            if len(blob) > len(best):
                best = blob
    out = Image.new('RGBA', im.size, (0, 0, 0, 0))
    op = out.load()
    for (x, y) in best:
        op[x, y] = px[x, y]
    return out


def squirrel_cutout():
    src = Image.open(ROOT / 'references' / SQUIRREL_SRC).convert('RGBA')
    x0, y0, x1, y1 = (1034, 258, 1426, 567)
    bounds = (x0 - SQUIRREL_PAD, y0 - SQUIRREL_PAD, x1 + SQUIRREL_PAD, y1)
    im = src.crop(bounds)
    flood_clear(im, is_beige)
    im = keep_largest_blob(im)
    im = im.crop(im.getbbox())
    write(im, 'squirrel-classic.png')
    return im


def border_opaque(im):
    px = im.load()
    w, h = im.size
    n = 0
    for x in range(w):
        n += px[x, 0][3] > 8
        n += px[x, h - 1][3] > 8
    for y in range(h):
        n += px[0, y][3] > 8
        n += px[w - 1, y][3] > 8
    return n


if ARGS.method == 'auto':
    activity = auto_icon((25, 405, 180, 578), [(55,421),(70,417),(83,420),(99,438),(124,421),(147,423),(155,439),(151,446),(168,454),(168,519),(153,532),(165,553),(152,565),(47,565),(36,553),(42,532),(31,519),(28,460),(52,448)], 'home/activity.png')
    chat = auto_icon((17, 575, 177, 707), [(95,583),(130,587),(157,600),(171,624),(173,649),(163,675),(136,692),(83,700),(47,695),(20,704),(27,684),(23,666),(20,643),(26,616),(48,594),(74,584)], 'home/chat.png')
    village = auto_icon((1338, 540, 1549, 729), [(1367,669),(1370,611),(1381,580),(1404,557),(1431,548),(1458,554),(1479,573),(1492,601),(1498,661),(1495,679),(1520,671),(1540,689),(1539,699),(1517,719),(1492,722),(1480,709),(1467,706),(1459,714),(1348,715),(1345,677)], 'home/village.png')
elif ARGS.method == 'hybrid':
    activity = hybrid_icon((25, 405, 180, 578), [(55,421),(70,417),(83,420),(99,438),(124,421),(147,423),(155,439),(151,446),(168,454),(168,519),(153,532),(165,553),(152,565),(47,565),(36,553),(42,532),(31,519),(28,460),(52,448)], 'home/activity.png')
    chat = hybrid_icon((17, 575, 177, 707), [(95,583),(130,587),(157,600),(171,624),(173,649),(163,675),(136,692),(83,700),(47,695),(20,704),(27,684),(23,666),(20,643),(26,616),(48,594),(74,584)], 'home/chat.png')
    village = hybrid_icon((1338, 540, 1549, 729), [(1367,669),(1370,611),(1381,580),(1404,557),(1431,548),(1458,554),(1479,573),(1492,601),(1498,661),(1495,679),(1520,671),(1540,689),(1539,699),(1517,719),(1492,722),(1480,709),(1467,706),(1459,714),(1348,715),(1345,677)], 'home/village.png')
elif ARGS.method == 'outline':
    # 外框给足余量：轮廓由描边决定，矩形只负责「不要带进别的控件」。
    activity = outline_icon((25, 405, 180, 578), 'home/activity.png')
    chat = outline_icon((17, 575, 177, 707), 'home/chat.png')
    village = outline_icon((1338, 540, 1549, 729), 'home/village.png')
else:
    activity = polygon_icon((25, 413, 174, 568), [
        (55, 421), (70, 417), (83, 420), (99, 438), (124, 421), (147, 423), (155, 439),
        (151, 446), (168, 454), (168, 519), (153, 532), (165, 553), (152, 565),
        (47, 565), (36, 553), (42, 532), (31, 519), (28, 460), (52, 448),
    ], 'home/activity.png')

    chat = polygon_icon((17, 579, 177, 707), [
        (95, 583), (130, 587), (157, 600), (171, 624), (173, 649), (163, 675),
        (136, 692), (83, 700), (47, 695), (20, 704), (27, 684), (23, 666),
        (20, 643), (26, 616), (48, 594), (74, 584),
    ], 'home/chat.png')

    village = polygon_icon((1344, 545, 1543, 723), [
        (1367, 669), (1370, 611), (1381, 580), (1404, 557), (1431, 548),
        (1458, 554), (1479, 573), (1492, 601), (1498, 661), (1495, 679),
        (1520, 671), (1540, 689), (1539, 699), (1517, 719), (1492, 722),
        (1480, 709), (1467, 706), (1459, 714), (1348, 715), (1345, 677),
    ], 'home/village.png')

squirrel = squirrel_cutout()

for im, name in [(activity, 'home/activity.png'), (chat, 'home/chat.png'),
                 (village, 'home/village.png'), (squirrel, 'squirrel-classic.png')]:
    print('%-24s %-12s border-opaque %d' % (name, '%dx%d' % im.size, border_opaque(im)))

if ARGS.out:
    print('（--out 模式：只生成到 %s，没有写仓库）' % OUT)
    raise SystemExit(0)

# ---------- 应用图标：1024×1024，透明背景，松鼠居中留白 ----------
canvas = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
margin = 0.07                      # 四周留 7% 透明边，图标放进启动器/任务栏不会被切
box = int(1024 * (1 - margin * 2))
scale = min(box / squirrel.width, box / squirrel.height)
art = squirrel.resize((max(1, round(squirrel.width * scale)), max(1, round(squirrel.height * scale))), Image.LANCZOS)
canvas.alpha_composite(art, ((1024 - art.width) // 2, (1024 - art.height) // 2))
canvas.save(APP_ICON, optimize=True)
print('app-icon.png            %dx%d 透明背景，松鼠 %dx%d' % (canvas.size + (art.size)))
print('完成。接下来跑一次：npx tauri icon app-icon.png（重生成 src-tauri/icons/）')
