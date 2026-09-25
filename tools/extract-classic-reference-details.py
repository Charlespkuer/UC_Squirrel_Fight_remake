"""Extract additional classic 2D artwork from the user's screenshot references.

No unknown colour/state variants are generated. Reference cards preserve the
exact learned/locked/true/selected appearance visible in each source image.
"""
from pathlib import Path
from collections import deque
import json
import statistics
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent
OUT = ROOT/'images'/'classic'
RECORDS = {}

def source(stamp):
    return Image.open(ROOT/'references'/f'屏幕截图 2026-09-23 {stamp}.png').convert('RGBA')

def write(im,name,stamp,bounds,**extra):
    p=OUT/name
    p.parent.mkdir(parents=True,exist_ok=True)
    # Clear RGB under alpha as well: some image inspectors ignore PNG alpha
    # when creating their preview and otherwise display the discarded UI.
    if im.mode=='RGBA':
        im.putdata([(0,0,0,0) if px[3]==0 else px for px in im.getdata()])
    im.save(p,optimize=True)
    RECORDS[name]={'source':f'references/屏幕截图 2026-09-23 {stamp}.png','crop':list(bounds),'size':list(im.size),**extra}

def outside_fill(im, predicate):
    pixels=im.load(); w,h=im.size
    queue=deque([(x,0) for x in range(w)]+[(x,h-1) for x in range(w)]+[(0,y) for y in range(h)]+[(w-1,y) for y in range(h)])
    seen=set()
    while queue:
        x,y=queue.popleft()
        if not(0<=x<w and 0<=y<h) or (x,y) in seen:
            continue
        seen.add((x,y))
        r,g,b,a=pixels[x,y]
        if a==0 or predicate(r,g,b):
            pixels[x,y]=(r,g,b,0)
            queue.extend([(x-1,y),(x+1,y),(x,y-1),(x,y+1)])
    return im

def polygon_crop(stamp,bounds,polygon,name,predicate=None,**extra):
    im=source(stamp).crop(bounds)
    mask=Image.new('L',im.size,0)
    points=[(x-bounds[0],y-bounds[1]) for x,y in polygon]
    ImageDraw.Draw(mask).polygon(points,fill=255)
    im.putalpha(mask)
    if predicate:
        outside_fill(im,predicate)
    im=im.crop(im.getbbox())
    write(im,name,stamp,bounds,method='Reference crop with manually bounded silhouette and boundary-connected background removal.',**extra)

# Antennae extend beyond the body, so the outline includes narrow antenna
# corridors while excluding the adjacent EXP label and statistics.
polygon_crop('161800',(115,184,858,642),[
 (115,263),(324,246),(418,210),(584,281),(706,205),(712,212),
 (636,324),(844,264),(855,273),(714,383),(733,494),(637,585),
 (614,638),(288,641),(211,572),(151,541),(115,467)
],'squirrel-berserker-classic.png',
 lambda r,g,b:(r>165 and g>140 and b>100 and r>=g*.95 and g>=b*.9) or (r>90 and g>130 and b>60 and g>r*.9 and g>b*1.1),
 note='Classic purple berserker costume, including the original antennae; taken from the status screen.')

# These include the exact original activity/village word art when it overlaps
# the icon. The chat bubble is separately available without its label.
polygon_crop('161746',(25,413,174,568),[
 (55,421),(70,417),(83,420),(99,438),(124,421),(147,423),(155,439),
 (151,446),(168,454),(168,519),(153,532),(165,553),(152,565),
 (47,565),(36,553),(42,532),(31,519),(28,460),(52,448)
],'home/activity.png',note='Includes original 活动 lettering because it overlaps the gift.')
polygon_crop('161746',(17,579,177,707),[
 (95,583),(130,587),(157,600),(171,624),(173,649),(163,675),
 (136,692),(83,700),(47,695),(20,704),(27,684),(23,666),
 (20,643),(26,616),(48,594),(74,584)
],'home/chat.png')
polygon_crop('161746',(1344,545,1543,723),[
 (1367,669),(1370,611),(1381,580),(1404,557),(1431,548),
 (1458,554),(1479,573),(1492,601),(1498,661),(1495,679),
 (1520,671),(1540,689),(1539,699),(1517,719),(1492,722),
 (1480,709),(1467,706),(1459,714),(1348,715),(1345,677)
],'home/village.png',note='Includes original 村庄 word art and direction arrow.')

# A round card retains the real artwork, grey variants and true-skill stamp.
def cards(stamp,kind,ids,locked,true_ids,selected):
    im=source(stamp)
    for index,ident in enumerate(ids):
        row,col=divmod(index,5)
        x=161+260*col
        y=170+307*row
        bounds=(x,y,x+232,y+233)
        card=im.crop(bounds)
        outside_fill(card,lambda r,g,b:r>215 and g>200 and b>165)
        write(card,f'reference-cards/{kind}-{ident}.png',stamp,bounds,
          id=ident,locked=ident in locked,true=ident in true_ids,selected=ident==selected,
          note='Exact screenshot state; no unseen colour or locked variant invented.')

cards('162315','weapon',list(range(1,11)),{2,3,4,7,9,10},{1,5,6,8},1)
cards('162341','skill',list(range(1,11)),{3,7,8,9},{1,2,4,5,10},1)
cards('162407','skill',[11,12,13,14,15,16,17,18,23,24],{14,15,18,23},{11,12,16,17,24},13)

# The halberd's red true-weapon stamp occupies empty space, so its actual
# classic artwork can be isolated without reconstructing any covered pixels.
polygon_crop('162315',(181,190,363,381),[
 (181,190),(362,190),(362,297),(287,297),(227,380),(181,380)
],'icons/weapon-1-classic.png',
 lambda r,g,b:r>110 and g>120 and g>=b*.9 and g>=r*.75,
 note='Classic coloured halberd only; the true stamp is excluded without inventing occluded weapon pixels.')

# Restore closed pale metal interiors: the source's antialiased outlines can
# otherwise leak a colour-based background flood. A one-pixel closed outline
# mask keeps the actual source colours intact.
weapon_bounds=(181,190,363,381)
weapon=source('162315').crop(weapon_bounds)
w,h=weapon.size
outline=Image.new('L',weapon.size,0)
outline.putdata([255 if max(px[:3])<180 else 0 for px in weapon.getdata()])
outline=outline.filter(ImageFilter.MaxFilter(3))
region=Image.new('L',weapon.size,0)
ImageDraw.Draw(region).polygon([(0,0),(181,0),(181,107),(106,107),(46,190),(0,190)],fill=255)
alpha=region.copy(); a=alpha.load(); border=outline.load()
q=deque([(x,0) for x in range(w)]+[(x,h-1) for x in range(w)]+[(0,y) for y in range(h)]+[(w-1,y) for y in range(h)])
seen=set()
while q:
    x,y=q.popleft()
    if not(0<=x<w and 0<=y<h) or (x,y) in seen: continue
    seen.add((x,y))
    if region.getpixel((x,y))==0 or border[x,y]==0:
        a[x,y]=0
        q.extend([(x-1,y),(x+1,y),(x,y-1),(x,y+1)])
weapon.putalpha(alpha)
weapon=weapon.crop(weapon.getbbox())
write(weapon,'icons/weapon-1-classic.png','162315',weapon_bounds,
  method='Classic weapon crop using a one-pixel closed outline barrier; original coloured pixels preserved; true stamp excluded.')

# Blank button skins retain source contours, shading and bevels. Text is removed
# by extending unobstructed same-row pixels across only the original label area.
def button_skin(stamp,bounds,clear_box,sample_columns,radius,name):
    im=source(stamp).crop(bounds)
    pix=im.load()
    x0,y0,x1,y1=clear_box
    for yy in range(y0,y1):
        samples=[pix[xx,yy] for xx in sample_columns]
        if 'green' in name:
            suitable=[p for p in samples if p[1]>110 and p[1]>p[0]*1.04 and p[2]<150]
        elif 'gold' in name:
            suitable=[p for p in samples if p[0]>190 and p[1]>70 and p[2]<160]
        else:
            suitable=[p for p in samples if p[0]>180 and p[1]>160 and p[2]>120]
        if suitable: samples=suitable
        rgb=tuple(round(statistics.median(p[channel] for p in samples)) for channel in range(3))
        for xx in range(x0,x1):
            blend=min(1,(xx-x0+1)/3,(x1-xx)/3,(yy-y0+1)/3,(y1-yy)/3)
            old=pix[xx,yy]
            pix[xx,yy]=(*[round(rgb[c]*blend+old[c]*(1-blend)) for c in range(3)],255)
    mask=Image.new('L',im.size,0)
    ImageDraw.Draw(mask).rounded_rectangle((1,1,im.width-2,im.height-2),radius=radius,fill=255)
    im.putalpha(mask)
    if 'cream' in name:
        outside_fill(im,lambda r,g,b:r>190 and g>110 and b<145)
    write(im,name,stamp,bounds,method='Original button skin; source text region filled from unoccluded neighbouring pixels on each row.')

button_skin('161746',(989,758,1258,947),(46,40,229,147),list(range(35,44))+list(range(230,239)),88,'skins/menu-green.png')
button_skin('162315',(515,800,1047,943),(95,20,440,123),list(range(79,89))+list(range(444,455)),70,'skins/return-gold.png')
button_skin('161800',(147,27,495,132),(65,5,298,101),list(range(44,53))+list(range(302,311)),51,'skins/tab-green.png')
button_skin('162315',(147,27,495,132),(65,5,298,101),list(range(44,53))+list(range(302,311)),51,'skins/tab-gold.png')
button_skin('162341',(1027,27,1378,132),(65,5,298,101),list(range(44,53))+list(range(302,311)),51,'skins/tab-cream.png')

(OUT/'reference-details.json').write_text(json.dumps(RECORDS,ensure_ascii=False,indent=2),encoding='utf8')
print(f'Extracted {len(RECORDS)} classic reference assets.')
