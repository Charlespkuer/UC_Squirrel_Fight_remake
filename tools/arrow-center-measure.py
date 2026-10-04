# -*- coding: utf-8 -*-
"""箭头居中测量 v2：自动发现圆环 → 圆心；只在圆内取样墨迹（白色字面 ∪ 深棕描边/投影）。
用法: python tools/arrow-center-measure.py <png> [scale]"""
import sys
from PIL import Image

def clusters_x(pts, gap=30):
    """按 x 间隙把点集切成簇（每个簇 = 一个圆环）。"""
    if not pts: return []
    xs = sorted(set(p[0] for p in pts))
    groups, start, prev = [], xs[0], xs[0]
    for x in xs[1:]:
        if x - prev > gap:
            groups.append((start, prev)); start = x
        prev = x
    groups.append((start, prev))
    out = []
    for lo, hi in groups:
        out.append([p for p in pts if lo <= p[0] <= hi])
    return out

def measure_row(img, y0, y1, ring_rgb, face_test, dark_test, label, shrink):
    px = img.load()
    ring = []
    for y in range(y0, y1):
        for x in range(0, img.width):
            r, g, b = px[x, y][:3]
            if abs(r - ring_rgb[0]) < 30 and abs(g - ring_rgb[1]) < 30 and abs(b - ring_rgb[2]) < 30:
                ring.append((x, y))
    for i, pts in enumerate(clusters_x(ring)):
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        x0, x1, yb0, yb1 = min(xs), max(xs), min(ys), max(ys)
        rcx, rcy = (x0 + x1) / 2, (yb0 + yb1) / 2
        ink_raw = set()
        for y in range(yb0 + shrink, yb1 - shrink):
            for x in range(x0 + shrink, x1 - shrink):
                r, g, b = px[x, y][:3]
                if face_test(r, g, b) or (dark_test and dark_test(r, g, b)):
                    ink_raw.add((x, y))
        # 去噪：孤立的抗锯齿散点（圆环边缘）会钉住包围盒，只保留有 ≥2 个墨迹邻居的点
        ink = [p for p in ink_raw
               if sum((p[0] + dx, p[1] + dy) in ink_raw for dx in (-1, 0, 1) for dy in (-1, 0, 1)) >= 3]
        if not ink:
            print(f"{label}[{i}]: 圆内无墨迹"); continue
        ixs = [p[0] for p in ink]; iys = [p[1] for p in ink]
        icx, icy = (min(ixs) + max(ixs)) / 2, (min(iys) + max(iys)) / 2
        mcx, mcy = sum(ixs) / len(ixs), sum(iys) / len(iys)
        print(f"{label}[{i}]: 圆心=({rcx:.1f},{rcy:.1f}) 直径={x1 - x0 + 1}px "
              f"盒心偏移: dx={icx - rcx:+.2f} dy={icy - rcy:+.2f} 质心偏移: dx={mcx - rcx:+.2f} dy={mcy - rcy:+.2f} "
              f"(墨迹 {len(ink)}px, 高={max(iys) - min(iys) + 1}px, {SCALE}x 截图)")

SCALE = float(sys.argv[2]) if len(sys.argv) > 2 else 2.0
img = Image.open(sys.argv[1]).convert('RGB')
H = img.height
a = lambda v: int(round(v * SCALE))
white = lambda r, g, b: r > 232 and g > 232 and b > 222
darkbrown = lambda r, g, b: 70 < r < 145 and 45 < g < 115 and 20 < b < 90
cream = lambda r, g, b: r > 225 and g > 215 and 175 < b < 235

# 行带: 每行 170 CSS px
measure_row(img, a(0), a(170), (39, 128, 0), cream, None, 'A 62px Arial (bag/shop/融合列表)', a(8))
measure_row(img, a(170), a(340), (101, 81, 51), white, darkbrown, 'B 52px base', a(8))
measure_row(img, a(340), a(510), (101, 81, 51), white, darkbrown, 'C 31px Georgia (融合)', a(6))
