# -*- coding: utf-8 -*-
"""清理 js/ 下各模块的「历史叙事型」注释（需求编号、第 N 项、本轮、起因、修复经过等）。

只动注释，不动代码与字符串：
  - 独立成行的 // 注释：命中模式则整行删除；
  - 独立成块的 /* ... */ 注释：命中模式则整块删除；
  - 行尾 // 注释：命中模式则剥掉注释、保留代码；
  - 内联 /* */ 注释（与代码同行）：不动。

保护（永不删除）：
  - 分节横幅（含 ---- / ==== / 【 的行）；
  - 测试锚点注释（见 PROTECTED）；
  - js/gamedict.js 整个跳过（自动生成，勿手改）。

已验证本仓库没有含 \\/ 或 /* 的正则字面量，词法扫描只处理字符串与注释两种状态。
用法：python tools/clean-history-comments.py [--check]
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

HISTORY = re.compile(
    r'需求|本轮|第 ?\d+ ?项|起因|回归[:：]?|修复|(?<![A-Za-z])[Bb][Uu][Gg](?![A-Za-z])|BUG(?![A-Za-z])|曾经|改成|改为|不再|'
    r'实测|复盘|上一轮|这一版|这次|原来的|旧版|历史坑|早前|后来|当时|踩过|翻车')
# 编号分节横幅（【T3】【UC12】…）永远保护；「【本轮删除】」这类不保护
BANNER_CODE = re.compile(r'【[A-Z]{1,4}\d+】')
# 测试文本锚点（全文件通用）
PROTECTED_ANY = ('----------', '=====',
                 '通用小件',               # test-fixes-round 文本锚点
                 '每 10 层的里程碑奖励',    # test-fixes-round 文本锚点
                 '排序会打乱顺序',           # test-fixes-round 文本锚点
                 )
# 只在指定文件里保护的锚点
PROTECTED_PER_FILE = {
    'tower-ui.js': ('主塔失败',),       # test-fixes-round 文本锚点
}
SKIP_FILES = {'gamedict.js'}  # 自动生成


def scan_comments(text):
    """产出注释 token：(start_line, end_line, standalone, is_block, start_col, end_col, text)。

    状态机覆盖：字符串（' " `）、模板串内的 ${} 不作展开（本仓库模板串里没有注释/反引号嵌套）、
    正则字面量（按「前一个有效字符」启发式判定：=(:,[!&|?{};> 或行首之后视为正则）。
    """
    comments = []
    i, n = 0, len(text)
    line = 0
    line_start = 0
    state = None  # None | "'" | '"' | '`' | 'regex'
    prev_sig = ''  # 上一个有效字符（非空白/非注释内容）
    in_class = False  # 正则的字符类 [...]
    while i < n:
        ch = text[i]
        if ch == '\n':
            line += 1
            line_start = i + 1
            i += 1
            continue
        if state == 'regex':
            if ch == '\\':
                i += 2
                continue
            if ch == '[':
                in_class = True
            elif ch == ']':
                in_class = False
            elif ch == '/' and not in_class:
                state = None
                prev_sig = '/'
            i += 1
            continue
        if state:
            if ch == '\\':
                i += 2
                continue
            if ch == state:
                state = None
                prev_sig = ch
            i += 1
            continue
        if ch in ('"', "'", '`'):
            state = ch
            i += 1
            continue
        if ch == '/' and i + 1 < n:
            nxt = text[i + 1]
            if nxt == '/':
                j = text.find('\n', i)
                j = n if j < 0 else j
                standalone = not text[line_start:i].strip()
                comments.append((line, line, standalone, False, i - line_start, j - line_start, text[i:j]))
                i = j
                continue
            if nxt == '*':
                j = text.find('*/', i + 2)
                j = n if j < 0 else j + 2
                body = text[i:j]
                end_line = line + body.count('\n')
                after_end = text.find('\n', j)
                after = text[j:(after_end if after_end >= 0 else n)]
                standalone = (not text[line_start:i].strip()) and (not after.strip())
                comments.append((line, end_line, standalone, True, i - line_start, 0, body))
                line = end_line
                if '\n' in body:
                    line_start = i + body.rfind('\n') + 1
                i = j
                prev_sig = '/'
                continue
            # 正则字面量 or 除法：按前一个有效字符判定
            if not prev_sig or prev_sig in '=(:,[!&|?{};>+-*%^~<>':
                state = 'regex'
                in_class = False
                i += 1
                continue
            prev_sig = '/'
            i += 1
            continue
        if not ch.isspace():
            prev_sig = ch
        i += 1
    return comments


def clean(text, fname):
    comments = scan_comments(text)
    drop_lines = set()      # 整行删除
    strip_inline = []       # (line, col) 行尾注释剥离
    protected_hits = []
    per_file = PROTECTED_PER_FILE.get(fname, ())
    for (sl, el, standalone, is_block, scol, ecol, ctext) in comments:
        if not HISTORY.search(ctext):
            continue
        if BANNER_CODE.search(ctext) or any(p in ctext for p in PROTECTED_ANY) or any(p in ctext for p in per_file):
            protected_hits.append((sl + 1, ctext.split('\n')[0][:40]))
            continue
        if standalone:
            for ln in range(sl, el + 1):
                drop_lines.add(ln)
        elif not is_block:
            strip_inline.append((sl, scol))
    if not drop_lines and not strip_inline:
        return text, 0, protected_hits
    lines = text.split('\n')
    for ln, col in strip_inline:
        if ln not in drop_lines:
            lines[ln] = lines[ln][:col].rstrip()
    out = [lines[i] for i in range(len(lines)) if i not in drop_lines]
    # 折叠连续空行（2+ → 1）
    collapsed = []
    blank = 0
    for ln in out:
        if ln.strip():
            blank = 0
            collapsed.append(ln)
        else:
            blank += 1
            if blank == 1:
                collapsed.append(ln)
    removed = len(lines) - len(collapsed)
    return '\n'.join(collapsed), removed, protected_hits


def main():
    check_only = '--check' in sys.argv
    total = 0
    for p in sorted((ROOT / 'js').glob('*.js')):
        if p.name in SKIP_FILES:
            continue
        with open(p, 'r', encoding='utf-8', newline='') as fh:  # newline='' 保留 CRLF
            text = fh.read()
        new_text, removed, protected = clean(text, p.name)
        if protected:
            for ln, frag in protected:
                print('  保护 %s:%d %s' % (p.name, ln, frag))
        if removed:
            total += removed
            if not check_only:
                with open(p, 'w', encoding='utf-8', newline='') as fh:  # 保留原行尾？统一 LF
                    fh.write(new_text)
            print('%s %s: 删除 %d 行' % ('(check)' if check_only else 'DONE', p.name, removed))
    print('共删除 %d 行' % total)


if __name__ == '__main__':
    main()
