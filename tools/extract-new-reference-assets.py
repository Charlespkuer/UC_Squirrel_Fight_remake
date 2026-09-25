"""Lossless crops from references/new and exact APK draw frames; no game code edits."""
from pathlib import Path
from collections import deque
import json
import subprocess
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
REF = ROOT / 'references/new'
OUT = ROOT / 'images/classic/new-reference'
OUT.mkdir(parents=True, exist_ok=True)
manifest_file = OUT / 'manifest.json'
manifest = json.loads(manifest_file.read_text(encoding='utf8')) if manifest_file.exists() else {}
manifest['note'] = 'Reference crops retain the pictured frame and learned/locked/selected state. They have no true-weapon stamp. Do not use a locked crop for a learned item.'
manifest.setdefault('assets', {})
manifest.setdefault('cards', {})
for kind in ('weapon', 'skill'):
    manifest['cards'].setdefault(kind, {})

def crop(source, rect, name, **meta):
    image = Image.open(ROOT / source).convert('RGBA')
    x,y,w,h = rect
    assert min(x,y)>=0 and x+w<=image.width and y+h<=image.height
    target = OUT / name
    target.parent.mkdir(parents=True, exist_ok=True)
    image.crop((x,y,x+w,y+h)).save(target)
    manifest['assets'][name] = {'source':source,'rect':rect,'size':[w,h],**meta}
    return target

def card(kind, ident, filename, rect, locked, selected=False, visible_level=None):
    name=f'cards/{kind}-{ident}-{ "locked" if locked else "learned"}.png'
    crop('references/new/'+filename,rect,name,kind=kind,id=ident,locked=locked,selected=selected,visibleLevel=visible_level,containsFrame=True,containsTrueStamp=False)
    manifest['cards'][kind][str(ident)] = {'path':'images/classic/new-reference/'+name,'locked':locked,'selected':selected,'visibleLevel':visible_level,'containsFrame':True,'containsTrueStamp':False}

# Grid crops deliberately omit the LV caption beneath each card.
x1=[94,249,402,557,710]
x2=[94,248,403,557,711]
weapon_first='b8535e5dde7116e5e.webp'
for i in range(1,11):
    row=(i-1)//5;col=(i-1)%5
    learned=i in [1,5,7,8,9]
    card('weapon',i,weapon_first,[x1[col],103 if row==0 else 284,137,136],not learned,visible_level=8 if learned else None)
weapon_second='76c6a7ef6356.webp'
for i in range(11,16):
    card('weapon',i,weapon_second,[x2[i-11],99,137,136],i!=15,selected=i==11,visible_level=8 if i==15 else None)
skill_first='4b745125e.webp'
for i in range(1,11):
    levels={2:9,3:8,4:8,7:4,9:9}
    col=(i-1)%5;row=(i-1)//5
    card('skill',i,skill_first,[98+col*154,100 if row==0 else 282,137,136],i not in levels,visible_level=levels.get(i))
skill_second='6.webp'
for i in range(11,19):
    levels={13:1,15:8,18:7}
    col=(i-11)%5;row=(i-11)//5
    selected=i==16
    card('skill',i,skill_second,[97+col*154,99 if row==0 else 281,137,136],i not in [13,15,16,18],selected,levels.get(i))

drop_file=next(REF.glob('*214628.png'))
crop('references/new/'+drop_file.name,[300,76,111,146],'drop-exp-with-caption-reference.png',note='Raw screenshot crop includes background and classic 请点击 label; reference evidence, not a transparent original sprite.')
icon_path=crop('references/new/'+drop_file.name,[305,80,98,100],'drop-exp-classic.png',note='Classic Exp+ card from screenshot; rounded alpha mask clips only exterior corners. Recompressed source pixels retained.')
im=Image.open(icon_path).convert('RGBA'); mask=Image.new('L',im.size); ImageDraw.Draw(mask).rounded_rectangle((0,0,97,99),radius=17,fill=255); im.putalpha(mask)
pix=im.load()
for y in range(im.height):
    for x in range(im.width):
        if pix[x,y][3]==0:pix[x,y]=(0,0,0,0)
im.save(icon_path)

portrait=crop('references/new/8f1d43f8794a4c22672.webp',[57,110,285,261],'squirrel-green-outfit-reference.png',note='Actual classic reference outfit: ninja headband/body/shoes and fist gloves. Must not replace unrelated equipped costumes.')
im=Image.open(portrait).convert('RGBA'); pix=im.load(); q=deque(); seen=set()
def removable(x,y):
    r,g,b,a=pix[x,y]
    return r>190 and g>180 and b>145 and max(r,g,b)-min(r,g,b)<100
for x in range(im.width):q.extend([(x,0),(x,im.height-1)])
for y in range(im.height):q.extend([(0,y),(im.width-1,y)])
while q:
    x,y=q.popleft()
    if (x,y) in seen:continue
    seen.add((x,y))
    if not removable(x,y):continue
    pix[x,y]=(0,0,0,0)
    for nx,ny in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)):
        if 0<=nx<im.width and 0<=ny<im.height and (nx,ny) not in seen:q.append((nx,ny))
im.save(OUT/'squirrel-green-outfit.png')
manifest['assets']['squirrel-green-outfit.png']={**manifest['assets']['squirrel-green-outfit-reference.png'],'processing':'Boundary-connected pale background removed; closed internal pale face pixels remain. Includes original shadow.'}

# Exact draw resource frames used by Quark.FightProps in the original APK.
node=r"const fs=require('fs'),vm=require('vm'),c={};c.window=c;vm.createContext(c);for(const f of ['Map.min.js','assets.js'])vm.runInContext(fs.readFileSync('js/orig/'+f,'utf8'),c);console.log(JSON.stringify(c.imgMap.getValue('draw')));"
frames=json.loads(subprocess.check_output(['node','-e',node],cwd=ROOT,encoding='utf8'))
for f in frames:crop('images/draw.png',f[1:5],f'draw/draw-{f[0]}.png',sheet='draw',label=str(f[0]),note='Exact APK sprite, HD presentation differs from classic screenshot.')
for pid in [24,25,26]:
    index=pid-1; columns=Image.open(ROOT/'images/daoju.png').width//165
    crop('images/daoju.png',[(index%columns)*165,(index//columns)*165,165,165],f'draw/fragment-{pid}.png',id=pid,note='Exact prop atlas icon. APK FightProps does not list fragments as supported floating reward IDs.')

(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')
font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',15)
entries=list(manifest['assets'])
sheet=Image.new('RGB',(1200,((len(entries)+5)//6)*188),'#ded5bc');d=ImageDraw.Draw(sheet)
for i,name in enumerate(entries):
    asset=Image.open(OUT/name).convert('RGBA');asset.thumbnail((180,148));x=i%6*200;y=i//6*188
    sheet.paste(asset,(x+(180-asset.width)//2,y),asset)
    d.text((x+4,y+149),name.replace('cards/','').replace('draw/','')[:27],font=font,fill='#392819')
    item=manifest['assets'][name]
    d.text((x+4,y+169),str(item['size'])+(' selected' if item.get('selected') else ''),font=font,fill='#392819')
sheet.save(ROOT/'tools/research/new-reference-assets-contact.jpg',quality=95)
print('Exported',len(entries),'assets to',OUT)
