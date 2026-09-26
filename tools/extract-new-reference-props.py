"""Crop the three classic inventory pages, preserving frames but excluding quantities.

Only props/* and manifest entries belonging to these crops are written. Other
agents' reference assets/metadata are read at the end and merged unchanged.
"""
from pathlib import Path
import json
from PIL import Image, ImageDraw, ImageFont
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
PROPS = OUT / 'props'
PROPS.mkdir(parents=True, exist_ok=True)

# (id, Chinese name, source screenshot, x/y/width/height, selected)
# Page 2 has scrolls, not the rebirth fruit; page 3 only has three occupied cells.
PAGES = [
    ('3d539b600bc5f.webp', [
        (1, '小体力药剂', [88, 98, 139, 140], False),
        (2, '大体力药剂', [248, 98, 140, 140], False),
        (3, '大力丸', [411, 96, 141, 141], True),
        (4, '敏捷丸', [87, 280, 140, 140], False),
        (5, '速度丸', [246, 279, 141, 141], False),
        (10, '力量转化丸', [412, 280, 141, 140], False),
    ]),
    ('aec379310a55b319a73912ae49a98226cefc172c.webp', [
        (11, '敏捷转化丸', [86, 95, 143, 143], True),
        (12, '速度转化丸', [247, 97, 141, 140], False),
        (21, '技能卷轴', [411, 97, 139, 139], False),
        (22, '武器卷轴', [86, 279, 142, 140], False),
        (23, '挑战书', [246, 279, 141, 140], False),
        (24, '白色碎片', [411, 280, 139, 138], False),
    ]),
    ('8d3fd1f445f.webp', [
        (25, '绿色碎片', [83, 95, 144, 143], True),
        (26, '蓝色碎片', [245, 98, 140, 140], False),
        (36, '英雄帖', [409, 98, 141, 140], False),
    ]),
]

entries, mappings = {}, {}
for page_index, (filename, cards) in enumerate(PAGES, 1):
    source = ROOT / 'references/new' / filename
    original = Image.open(source).convert('RGBA')
    for ident, label, rect, selected in cards:
        x, y, width, height = rect
        assert x >= 0 and y >= 0 and x + width <= original.width and y + height <= original.height
        suffix = '-selected' if selected else ''
        relative = f'props/prop-{ident}{suffix}.png'
        original.crop((x, y, x + width, y + height)).save(OUT / relative, optimize=True)
        entries[relative] = {
            'source': f'references/new/{filename}', 'rect': rect, 'size': [width, height],
            'kind': 'prop', 'id': ident, 'name': label, 'inventoryPage': page_index,
            'locked': False, 'selected': selected, 'containsFrame': True,
            'containsQuantity': False, 'usableForNormalUI': not selected,
            'processing': 'Lossless rectangular screenshot crop; original card frame retained; quantity caption excluded.',
        }
        mappings[str(ident)] = {
            'path': f'images/classic/new-reference/{relative}', 'name': label,
            'selected': selected, 'containsFrame': True, 'containsQuantity': False,
            'usableForNormalUI': not selected,
        }

# Re-read immediately before the merge so concurrently added unrelated assets stay intact.
manifest_path = OUT / 'manifest.json'
manifest = json.loads(manifest_path.read_text(encoding='utf-8')) if manifest_path.exists() else {}
manifest.setdefault('assets', {}).update(entries)
manifest.setdefault('cards', {}).setdefault('prop', {}).update(mappings)
manifest['propReferenceNote'] = (
    'Three inventory pages contain 15 items, not 18. IDs 3, 11 and 25 are selected green cards '
    'and must not be used as normal-state icons. Page 2 is 11/12/21/22/23/24; page 3 is 25/26/36. '
    'No prop 13 rebirth fruit appears in these screenshots. All crops exclude quantity captions.'
)
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')

font_file = Path('C:/Windows/Fonts/msyh.ttc')
font = ImageFont.truetype(str(font_file), 18) if font_file.exists() else ImageFont.load_default()
sheet = Image.new('RGB', (900, 600), '#f1ead4')
draw = ImageDraw.Draw(sheet)
for index, (relative, entry) in enumerate(entries.items()):
    column, row = index % 5, index // 5
    card = Image.open(OUT / relative).convert('RGBA')
    x, y = column * 180 + (180 - card.width) // 2, row * 200 + 6
    sheet.paste(card, (x, y), card)
    draw.text((column * 180 + 8, row * 200 + 153), f"{entry['id']} {entry['name']}", font=font, fill='#321a0b')
    draw.text((column * 180 + 8, row * 200 + 177), '选中·仅供参考' if entry['selected'] else '普通·可用于界面', font=font, fill='#26771b' if entry['selected'] else '#65472d')
sheet.save(ROOT / 'tools/research/new-reference-props-contact.png')
print(f'Wrote {len(entries)} crops, {sum(not e["selected"] for e in entries.values())} normal UI cards; merged manifest.')
