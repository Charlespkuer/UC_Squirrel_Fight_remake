"""Reproducible crops of shipped UC sprites and user-supplied classic references.

Requires Python/Pillow and Node.js. Runs only the project's original data tables
inside Node's vm, never the original game client or downloaded executable files.
"""
from collections import deque
from pathlib import Path
import json
import math
import re
import subprocess
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'images' / 'classic'
NODE_DATA = r'''
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=process.argv[1],ctx={};ctx.window=ctx;vm.createContext(ctx);
for(const f of ['Map.min.js','assets.js','asset2.js','GameDict.js'])
 vm.runInContext(fs.readFileSync(path.join(root,'js/orig',f),'utf8'),ctx);
const result={frames:{},weapons:ctx.weaponsMap.toArray(),skills:ctx.skillsMap.toArray(),props:ctx.propMap.toArray(),gears:ctx.gearMap.toArray(),gearSets:ctx.gearSetMap.toArray()};
for(const key of ctx.imgMap.keys) result.frames[key]=ctx.imgMap.getValue(key);
console.log(JSON.stringify(result));
'''
DATA = json.loads(subprocess.check_output(['node', '-e', NODE_DATA, str(ROOT)], encoding='utf8'))
MANIFEST = {'provenance': 'UC Android client h5ssdz_9game_4230.apk / assets/game.zip, plus individually identified user references', 'icons': {}, 'sprites': {}, 'characters': {}}
IMAGES = {}

def image(name):
    if name not in IMAGES:
        IMAGES[name] = Image.open(ROOT / 'images' / name).convert('RGBA')
    return IMAGES[name]

def save_crop(source, rect, target, bucket='sprites', metadata=None):
    target_path = OUT / target
    target_path.parent.mkdir(parents=True, exist_ok=True)
    x,y,w,h = map(int, rect)
    bitmap = image(source)
    if min(x,y) < 0 or x+w > bitmap.width or y+h > bitmap.height or min(w,h) <= 0:
        return False
    bitmap.crop((x,y,x+w,y+h)).save(target_path, optimize=True)
    MANIFEST[bucket][target] = {'source': 'images/'+source, 'rect':[x,y,w,h], 'size':[w,h], **(metadata or {})}
    return True

def sprite(sheet, label, target, bucket='sprites', metadata=None):
    for row in DATA['frames'].get(sheet, []):
        if str(row[0]) == str(label):
            return save_crop(sheet+'.png', row[1:5], target, bucket, {'sheet':sheet,'label':str(label),**(metadata or {})})
    return False

def grid_icons(sheet, entries, prefix, paired):
    cols = image(sheet+'.png').width // 165
    for item in entries:
        ident = int(item['id'])
        index = ident - 1
        if sheet == 'daoju' and ident > 100:
            index -= 44
        x = (index % cols) * 165
        y = (index // cols) * 165 * (2 if paired else 1)
        save_crop(sheet+'.png',[x,y,165,165],f'icons/{prefix}-{ident}.png','icons',{'id':ident,'name':item['name'],'locked':False})
        if paired:
            save_crop(sheet+'.png',[x,y+165,165,165],f'icons/{prefix}-{ident}-locked.png','icons',{'id':ident,'name':item['name'],'locked':True})

grid_icons('wuqi',DATA['weapons'],'weapon',True)
grid_icons('wuqi2',DATA['weapons'],'weapon-true',True)
grid_icons('jineng',DATA['skills'],'skill',True)
grid_icons('daoju',DATA['props'],'prop',False)

# Every usable original panel, word-art label and button, at source resolution.
for sheet,frames in DATA['frames'].items():
    if not re.fullmatch(r'resource_?\d+|activity|draw|woodMan|shengbai', sheet):
        continue
    if not (ROOT/'images'/f'{sheet}.png').exists() or not isinstance(frames,list):
        continue
    for row in frames:
        sprite(sheet,row[0],f'sprites/{sheet}-{row[0]}.png')

for name,label in [('mantis',31),('crane',32),('panda',33)]:
    sprite('resource_6',label,f'characters/{name}-card.png','characters',{'note':'Original portrait card includes its pale cyan backdrop and title.'})
save_crop('jineng.png',[825,330,165,165],'characters/master-icon.png','characters')
sprite('woodMan','1','characters/woodman.png','characters')

# Equipment is made from separate animation part sheets. Frame 0 is the
# designated inventory portrait in the original BitmapFactory.getEquipImageData.
GEAR_SETS = {int(item['id']): item for item in DATA['gearSets']}
for gear in DATA['gears']:
    typ = int(gear['type'])
    if typ not in range(4):
        continue
    kind = ['Head','HandO','Body','Foot'][typ]
    # gearMap.setId points to gearSetMap; the image suffix is the set's index.
    # For example the level-50 set has ID 51, image index 32, and gear IDs 201-204.
    costume = int(GEAR_SETS[int(gear['setId'])]['index'])
    stem = f'{kind}_{costume}'
    candidates = [stem+'_1',stem,stem+'_2',stem+'_3']
    for key in candidates:
        file = f'equip/{kind}/{key}.png'
        if not (ROOT/'images'/file).exists():
            continue
        rows = DATA['frames'].get(key,[])
        if not isinstance(rows,list):
            continue
        row = next((r for r in rows if str(r[0])=='0'),None)
        if row and save_crop(file,row[1:5],f'icons/gear-{gear["id"]}.png','icons',{'id':int(gear['id']),'name':gear['name'],'costume':costume,'kind':kind}):
            break

def reference_cutout(filename, bounds, target):
    source = ROOT/'references'/filename
    if not source.exists():
        return
    crop = Image.open(source).convert('RGBA').crop(bounds)
    pixels = crop.load()
    w,h = crop.size
    seen = set()
    queue = deque([(x,0) for x in range(w)]+[(x,h-1) for x in range(w)]+[(0,y) for y in range(h)]+[(w-1,y) for y in range(h)])
    # Only boundary-connected beige/white is removed. White facial regions
    # enclosed by the original outline remain intact.
    while queue:
        x,y = queue.popleft()
        if (x,y) in seen or x<0 or y<0 or x>=w or y>=h:
            continue
        seen.add((x,y))
        r,g,b,a = pixels[x,y]
        if not (r>160 and g>125 and b>90 and r-g<100):
            continue
        pixels[x,y]=(r,g,b,0)
        queue.extend([(x-1,y),(x+1,y),(x,y-1),(x,y+1)])
    crop = crop.crop(crop.getbbox())
    target_path = OUT/target
    target_path.parent.mkdir(parents=True,exist_ok=True)
    crop.save(target_path, optimize=True)
    MANIFEST['characters'][target]={'source':str(source.relative_to(ROOT)).replace('\\','/'),'crop':list(bounds),'size':list(crop.size),'method':'Boundary-connected background removal; original character and enclosed white pixels preserved.'}

reference_cutout('屏幕截图 2026-09-23 162807.png',(1034,258,1426,567),'squirrel-classic.png')
reference_cutout('屏幕截图 2026-09-23 162734.png',(327,101,596,465),'characters/master-classic.png')
cards_source = ROOT/'references'/'屏幕截图 2026-09-23 162707.png'
if cards_source.exists():
    cards = Image.open(cards_source).convert('RGBA')
    for name,bounds in [('mantis',(219,158,496,422)),('crane',(640,158,917,422)),('panda',(1063,158,1340,422))]:
        target=f'characters/{name}-classic-card.png'
        cards.crop(bounds).save(OUT/target,optimize=True)
        MANIFEST['characters'][target]={'source':str(cards_source.relative_to(ROOT)).replace('\\','/'),'crop':list(bounds),'note':'Classic 2D portrait card from supplied reference, retaining original card background.'}

# Preserve the actual classic loss artwork. Only screen-recording clock and
# pointer are cleaned, using local colour interpolation over their small areas.
loss_source = ROOT/'references'/'屏幕截图 2026-09-23 162901.png'
if loss_source.exists():
    loss=Image.open(loss_source).convert('RGB')
    lp=loss.load()
    for x0,y0,x1,y1 in [(799,0,872,62),(960,262,989,294)]:
        for yy in range(y0,y1):
            left,right=lp[x0-1,yy],lp[x1,yy]
            for xx in range(x0,x1):
                t=(xx-x0+1)/(x1-x0+1)
                lp[xx,yy]=tuple(round(a*(1-t)+b*t) for a,b in zip(left,right))
    loss.save(OUT/'result-loss-classic.jpg',quality=94)
    MANIFEST['characters']['result-loss-classic.jpg']={'source':str(loss_source.relative_to(ROOT)).replace('\\','/'),'size':list(loss.size),'method':'Classic reference artwork; recording timer and pointer removed with local colour interpolation.'}

OUT.mkdir(parents=True,exist_ok=True)
(OUT/'manifest.json').write_text(json.dumps(MANIFEST,ensure_ascii=False,indent=2),encoding='utf8')

# Visual QA sheet for every numbered weapon/skill and representative props.
tiles=[]
for key,meta in MANIFEST['icons'].items():
    if key.startswith('icons/weapon-true') or '-locked' in key or key.startswith('icons/gear-'):
        continue
    tiles.append((key,meta))
cellw,cellh,cols=150,156,9
sheet=Image.new('RGB',(cols*cellw,math.ceil(len(tiles)/cols)*cellh),'#f9efcf')
draw=ImageDraw.Draw(sheet)
try: font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',14)
except OSError: font=ImageFont.load_default()
for i,(key,meta) in enumerate(tiles):
    x,y=(i%cols)*cellw,(i//cols)*cellh
    icon=Image.open(OUT/key).convert('RGBA')
    icon.thumbnail((116,116),Image.Resampling.LANCZOS)
    sheet.paste(icon,(x+(cellw-icon.width)//2,y+4),icon)
    draw.text((x+4,y+124),f'{meta["id"]}: {meta["name"]}',font=font,fill='#493419')
(ROOT/'tools'/'research').mkdir(parents=True,exist_ok=True)
sheet.save(ROOT/'tools'/'research'/'classic-icon-contact.jpg',quality=90)
print(f'Exported {len(MANIFEST["icons"])} icons, {len(MANIFEST["sprites"])} UI sprites, {len(MANIFEST["characters"])} character images.')
