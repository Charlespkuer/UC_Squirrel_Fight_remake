"""Eight complete classic buttons, retaining original lettering and brown frames.

Only the exterior is masked. Boundary flood fill stops at the original outline;
the center component removes unrelated header lines in the surrounding crop.

The mask is deliberately grown by one source pixel (MaxFilter(3)) so thresholding
never shaves the outline. That extra pixel carries the *screenshot background*
with it, and WebP's 4:2:0 chroma subsampling dyes the outline's own outermost
pixel or two with the background hue too — together that painted a thin green rim
around 返回菜单. `decontaminate_edge` recolors that outer band from the button
itself (alpha untouched), so the silhouette is byte-for-byte the same shape while
the background bleed is gone.

注意运行顺序：本脚本输出的是**原始尺寸**的按钮，会盖掉 `tools/ai-upscale.py
--buttons` 之前写进去的 786x192 成品。所以每次重跑本脚本之后，都要再跑一次
`python tools/ai-upscale.py --buttons` 把超分成品补回来。

`ai-upscale.py --buttons` 读的 1x 原图不是素材目录里的那些成品，而是留档在
`references/new-reference-buttons-1x/`——那样游戏目录里只留 786x192 成品，原图
只作参考。本脚本每次都会顺手把 1x 原图写进那个留档目录，所以两边不会失配。
"""
from collections import deque
from pathlib import Path
import json
from PIL import Image, ImageDraw, ImageFilter, ImageFont
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
OUT = ROOT / 'images/classic/new-reference'
BUTTONS = OUT / 'buttons'
BUTTONS.mkdir(parents=True, exist_ok=True)
# 1x 原图的留档位：ai-upscale.py --buttons 从这里读源图。游戏目录里只留 786x192
# 成品，原图不进游戏也不进仓库（references/ 已被 .gitignore 忽略），只作参考。
ARCHIVE = ROOT / 'references/new-reference-buttons-1x'
SPECS = [
    ('status-active', '8f1d43f8794a4c22672.webp', [82, 9, 210, 72], True),
    ('status-normal', 'b8535e5dde7116e5e.webp', [82, 10, 210, 73], False),
    ('weapon-active', 'b8535e5dde7116e5e.webp', [341, 10, 214, 73], True),
    ('weapon-normal', '8f1d43f8794a4c22672.webp', [341, 9, 214, 73], False),
    ('skill-active', '4b745125e.webp', [604, 10, 213, 73], True),
    ('skill-normal', '8f1d43f8794a4c22672.webp', [602, 9, 213, 73], False),
    ('return-menu', '8f1d43f8794a4c22672.webp', [301, 470, 320, 88], False),
    ('change-equipment', '8f1d43f8794a4c22672.webp', [458, 273, 226, 100], False),
]

def silhouette(im, active):
    w,h=im.size; pix=im.load()
    blocked=set()
    for y in range(h):
        for x in range(w):
            r,g,b,a=pix[x,y]
            brown=r>g*1.08 and g<157 and b<125 and r<205
            green=active and r<115 and g<170 and b<125
            if brown or green: blocked.add((x,y))
    outside=set(); q=deque()
    for x in range(w): q.extend([(x,0),(x,h-1)])
    for y in range(h): q.extend([(0,y),(w-1,y)])
    while q:
        x,y=q.popleft()
        if (x,y) in outside or (x,y) in blocked: continue
        outside.add((x,y))
        for nx,ny in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)):
            if 0<=nx<w and 0<=ny<h: q.append((nx,ny))
    keep=set(); q=deque([(w//2,h//2)])
    while q:
        x,y=q.popleft()
        if (x,y) in outside or (x,y) in keep: continue
        keep.add((x,y))
        for nx,ny in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)):
            if 0<=nx<w and 0<=ny<h: q.append((nx,ny))
    assert len(keep)>w*h*.65, 'Outer frame was not closed'
    mask=Image.new('L',(w,h));mp=mask.load()
    for x,y in keep: mp[x,y]=255
    # Retain a source-pixel fringe so thresholding does not shave antialias edges.
    # 返回 (核心掩膜, 外扩一圈的掩膜)：核心掩膜给 decontaminate_edge 当取色边界。
    return mask,mask.filter(ImageFilter.MaxFilter(3))

def decontaminate_edge(im, core, grown, depth=2):
    """把外圈 depth 像素的颜色换成按钮自身的颜色，**alpha 一个像素都不动**。

    要治两个不同的病，都在同一个 1~2 像素带里：

    1. MaxFilter(3) 是「原样多带 1 像素源图」，带的其实是**截图背景**。返回菜单左缘
       那圈细绿边就是这么来的——背景绿 (94,162,55) 被当成不透明描边留了下来。
    2. 描边**自己**的最外 1~2 像素也被背景污染了：截图是 WebP（色度 4:2:0 子采样），
       背景绿会渗进相邻的描边像素，把深棕 (84,35,0) 染成橄榄绿 (58,52,0)。
       所以只把「多带的那 1 像素」换掉还不够，剩下那圈照样发绿。

    做法：先把核心掩膜往里缩 depth 像素，得到一圈**确定没被污染**的颜色源，
    再逐轮向外扩散，把外圈（含被污染的原描边）统一刷成按钮自身的颜色。
    形状完全不变（alpha 没碰），只是外圈不再带背景色。
    """
    w,h=im.size
    px=im.load();gp=grown.load()
    clean=core.filter(ImageFilter.MinFilter(2*depth+1))
    clp=clean.load()
    src={(x,y):px[x,y] for y in range(h) for x in range(w) if clp[x,y]}
    if not src:                                   # 极细的突出部缩没了：退回核心掩膜
        src={(x,y):px[x,y] for y in range(h) for x in range(w) if core.load()[x,y]}
    q=deque(src)
    while q:
        x,y=q.popleft()
        for nx,ny in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)):
            if 0<=nx<w and 0<=ny<h and (nx,ny) not in src and gp[nx,ny]:
                src[nx,ny]=src[x,y];q.append((nx,ny))
    for (x,y),c in src.items():
        if not clp[x,y]: px[x,y]=c

manifest_path=OUT/'manifest.json'
manifest=json.loads(manifest_path.read_text(encoding='utf8'))
manifest.setdefault('buttons',{})
outputs=[]
for name,source,rect,active in SPECS:
    x,y,w,h=rect
    im=Image.open(ROOT/'references/new'/source).convert('RGBA').crop((x,y,x+w,y+h))
    core,grown=silhouette(im,active)
    # The return button touches the page frame above it. Retire that unrelated
    # horizontal rule at the very top before cropping the resulting alpha bounds.
    if name=='return-menu':
        # 两个掩膜都得切：grown 决定 alpha，core 决定外圈向谁取色。只切 grown 的话，
        # 横线那几行的颜色会被 decontaminate_edge 当成「按钮边缘色」补到外圈上。
        for m in (core,grown):
            d=ImageDraw.Draw(m);d.rectangle((0,0,w-1,3),fill=0)
            # At source y474–476 the page rule touches the button. The capsule's
            # measured top outline lies only between these bounds; retain those
            # original pixels and clear the unrelated straight extensions.
            for yy,left,right in [(4,40,279),(5,33,286),(6,28,291)]:
                d.line((0,yy,left-1,yy),fill=0)
                d.line((right+1,yy,w-1,yy),fill=0)
    # 外圈那 1~2 像素从按钮自身取色：绿边消失，但轮廓一点没变。
    decontaminate_edge(im,core,grown)
    mask=grown
    bbox=mask.getbbox();im.putalpha(mask)
    im=im.crop(bbox);pixels=im.load()
    for yy in range(im.height):
        for xx in range(im.width):
            if pixels[xx,yy][3]==0:pixels[xx,yy]=(0,0,0,0)
    target='buttons/'+name+'.png';im.save(OUT/target)
    # 同一张 1x 原图再留档一份到 references/，供 ai-upscale.py --buttons 当输入。
    # 顺手写在这里，是为了避免「重跑提取后留档还是旧的」这种静默失配。
    ARCHIVE.mkdir(parents=True, exist_ok=True)
    im.save(ARCHIVE/(name+'.png'))
    bx,by,ex,ey=bbox;actual=[x+bx,y+by,ex-bx,ey-by]
    entry={'source':'references/new/'+source,'rect':actual,'size':list(im.size),'containsLabel':True,'containsBackground':True,'completeButton':True,'active':active,'processing':'Boundary flood fill outside original outline; center component; one source-pixel antialias fringe bled from the button itself (no screenshot background); transparent pixels zeroed.'}
    manifest['assets'][target]=entry
    manifest['buttons'][name]={'path':'images/classic/new-reference/'+target,**entry}
    outputs.append((name,im))
manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')

sheet=Image.new('RGB',(900,740),'#658cad');draw=ImageDraw.Draw(sheet)
font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',17)
for i,(name,im) in enumerate(outputs):
    x=(i%2)*450+15;y=(i//2)*185+12
    draw.text((x,y),name+' '+str(im.size),font=font,fill='white')
    preview=im.copy();preview.thumbnail((420,135))
    sheet.paste(preview,(x,y+35),preview)
sheet.save(ROOT/'tools/research/new-reference-buttons-contact.png')
print('Exported 8 complete buttons; preserved other manifest entries.')
