"""Eight complete classic buttons, retaining original lettering and brown frames.

Only the exterior is masked. Boundary flood fill stops at the original outline;
the center component removes unrelated header lines in the surrounding crop.
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
    return mask.filter(ImageFilter.MaxFilter(3))

manifest_path=OUT/'manifest.json'
manifest=json.loads(manifest_path.read_text(encoding='utf8'))
manifest.setdefault('buttons',{})
outputs=[]
for name,source,rect,active in SPECS:
    x,y,w,h=rect
    im=Image.open(ROOT/'references/new'/source).convert('RGBA').crop((x,y,x+w,y+h))
    mask=silhouette(im,active)
    # The return button touches the page frame above it. Retire that unrelated
    # horizontal rule at the very top before cropping the resulting alpha bounds.
    if name=='return-menu':
        d=ImageDraw.Draw(mask);d.rectangle((0,0,w-1,3),fill=0)
        # At source y474–476 the page rule touches the button. The capsule's
        # measured top outline lies only between these bounds; retain those
        # original pixels and clear the unrelated straight extensions.
        for yy,left,right in [(4,40,279),(5,33,286),(6,28,291)]:
            d.line((0,yy,left-1,yy),fill=0)
            d.line((right+1,yy,w-1,yy),fill=0)
    bbox=mask.getbbox();im.putalpha(mask)
    im=im.crop(bbox);pixels=im.load()
    for yy in range(im.height):
        for xx in range(im.width):
            if pixels[xx,yy][3]==0:pixels[xx,yy]=(0,0,0,0)
    target='buttons/'+name+'.png';im.save(OUT/target)
    bx,by,ex,ey=bbox;actual=[x+bx,y+by,ex-bx,ey-by]
    entry={'source':'references/new/'+source,'rect':actual,'size':list(im.size),'containsLabel':True,'containsBackground':True,'completeButton':True,'active':active,'processing':'Boundary flood fill outside original outline; center component; one source-pixel antialias fringe; transparent pixels zeroed.'}
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
