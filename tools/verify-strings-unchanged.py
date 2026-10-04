# -*- coding: utf-8 -*-
"""完整性校验：比对 HEAD 与当前工作区的字符串字面量多重集。
注释清理不应改动任何字符串；除白名单（本轮有意改的文案）外不应有差异。"""
import subprocess
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

FILES = ['tower.js', 'tower-data.js', 'tower-ui.js', 'state.js', 'ui.js', 'classic-ui.js',
         'classic-extras.js', 'sim.js', 'battle.js', 'gamedata.js', 'engine.js', 'main.js',
         'debug.js', 'classic-fusion.js', 'battle-drops.js']


def strings(src):
    out = []
    i, n = 0, len(src)
    while i < n:
        ch = src[i]
        if ch in ('\'', '"', '`'):
            q = ch
            j = i + 1
            while j < n:
                if src[j] == '\\':
                    j += 2
                    continue
                if src[j] == q:
                    break
                j += 1
            out.append(src[i:j + 1])
            i = j + 1
            continue
        if ch == '/' and i + 1 < n and src[i + 1] == '/':
            j = src.find('\n', i)
            i = n if j < 0 else j
            continue
        if ch == '/' and i + 1 < n and src[i + 1] == '*':
            j = src.find('*/', i + 2)
            i = n if j < 0 else j + 2
            continue
        i += 1
    return Counter(out)


def main():
    for f in FILES:
        old = subprocess.run(['git', 'show', 'HEAD:js/' + f], capture_output=True,
                             text=True, encoding='utf-8', cwd=ROOT).stdout
        new = (ROOT / 'js' / f).read_text(encoding='utf-8')
        so, sn = strings(old), strings(new)
        missing = so - sn
        added = sn - so
        if missing or added:
            print('== %s  缺失 %d  新增 %d' % (f, sum(missing.values()), sum(added.values())))
            for s, c in list(missing.items())[:10]:
                print('   - x%d %r' % (c, s[:90]))
            for s, c in list(added.items())[:10]:
                print('   + x%d %r' % (c, s[:90]))
    print('scan done')


if __name__ == '__main__':
    main()
