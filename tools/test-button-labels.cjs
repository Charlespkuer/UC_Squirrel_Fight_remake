#!/usr/bin/env node
/* ============================================================
 * tools/test-button-labels.cjs — 按钮文案规范回归
 *
 * 规范见 docs/界面按钮文案规范.md（用户 2026-10 口径）：
 *   · 动作按钮里的汉字 2~3 个为宜，最多 4 个；
 *   · 不得带中文/英文括号，也不要用省略号；
 *   · 数量、等级、价格、当前状态放在徽章、标题或说明文字里，不塞进动作标签。
 *
 * 这里只检查**按钮工厂的静态字面量**（btn / sysBtn / {label:'…'} / el('button',…,'…')），
 * 动态内容（道具名、玩家名、数字）不参与；js/state.js 的 RESOLUTIONS 等数据标签、
 * js/tower.js 的掉落名不是按钮，所以不在检查范围。
 *
 * 用法：node tools/test-button-labels.cjs
 * ============================================================ */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

/** 项目根：往上找到含 index.html 的那一层。 */
function findRoot(start) {
  let d = start;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(d, 'index.html'))) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return path.resolve(start, '..');
}
const ROOT = findRoot(__dirname);

/** 只看这些文件里的按钮工厂；ssfight 的原版按钮由素材渲染，文案不在 JS 里。 */
const FILES = [
  'js/classic-ui.js',
  'js/classic-extras.js',
  'js/classic-fusion.js',
  'js/ui.js',
  'js/debug.js',
  'js/tower-ui.js',
];

/** 把源码里的 \uXXXX 还原，才能按真实汉字计数。 */
function decodeUnicodeEscapes(text) {
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

const PATTERNS = [
  /\bbtn\(\s*(['"])([^'"]+)\1/g,
  /\bsysBtn\(\s*(['"])([^'"]+)\1/g,
  /\{\s*label\s*:\s*(['"])([^'"]+)\1/g,
  /el\(\s*['"]button['"]\s*,\s*(['"])([^'"]*)\1\s*,\s*(['"])([^'"]+)\3/g,
  /<button[^>]*>([^<>{}]+)<\/button>/g,
];

/** 返回这条文案违反了哪条规则；'' = 通过。 */
function labelProblem(label) {
  const text = String(label || '').trim();
  if (!text) return '';
  const han = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  if (!han) return '';                       // 纯图标/数字/英文不动
  if (/[（）()【】\[\]「」…]/.test(text)) return '不能带括号或省略号';
  if (han < 2) return '至少 2 个汉字';
  if (han > 4) return '最多 4 个汉字';
  return '';
}

const problems = [];
for (const rel of FILES) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) continue;
  const lines = decodeUnicodeEscapes(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).split('\n');
  lines.forEach((line, i) => {
    for (const re of PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line))) {
        const label = m[2] || m[4] || m[1];
        const why = labelProblem(label);
        if (why) problems.push(rel + ':' + (i + 1) + '  「' + label + '」  ' + why);
      }
    }
  });
}

if (problems.length) {
  console.error('按钮文案不符合 docs/界面按钮文案规范.md：');
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log('按钮文案检查通过（' + FILES.length + ' 个界面文件）');
