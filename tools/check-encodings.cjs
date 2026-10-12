#!/usr/bin/env node
/* 编码体检：仓库里的脚本必须是「合法 UTF-8」，而 **.ps1 含非 ASCII 时必须有 UTF-8 BOM**。
 *
 * 为什么需要它（2026-10 真踩过两次）：
 *   · `scripts\打包.cmd` 在没有 pwsh 的机器上回退到 **Windows PowerShell 5.1**；
 *     5.1 对**没有 BOM** 的 `.ps1` 按系统 ANSI 解码 → 脚本里的中文全变乱码，
 *     更糟的是乱码可能把注释块 / 字符串里的引号拆坏，导致**整脚本解析失败**
 *     （实测：`tools/build-release.ps1` 被编辑工具重写、BOM 掉了之后，解析出 27 个语法错）。
 *   · 反过来，`.ps1` 里有中文却按 ANSI 写回（PowerShell 的 Set-Content/Add-Content 老坑）
 *     会产生**非法 UTF-8**，在别的机器/CI 上直接读坏。
 *
 * 用法：node tools/check-encodings.cjs      （退出码 0 = 通过）
 * CI（.github/workflows/ci.yml）会显式跑它；它不是 test-*.cjs，不进套件枚举。
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

/* 只看仓库自己的东西：第三方 / 构建产物 / 本机参考资料 / 本地草稿都跳过。 */
const SKIP_DIR = /(^|[\\/])(node_modules|target|\.git|out|references|dist|gen|save|audio|images)([\\/]|$)/;
const TEXT_EXT = /\.(cjs|js|mjs|json|md|ps1|cmd|bat|yml|yaml|html|css|txt)$/i;

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIR.test(p)) walk(p, acc); }
    else if (TEXT_EXT.test(e.name)) acc.push(p);
  }
  return acc;
}

const ROOT = path.resolve(__dirname, '..');
const decoder = new TextDecoder('utf-8', { fatal: true });
const problems = [];
let checked = 0;

for (const file of walk(ROOT)) {
  const buf = fs.readFileSync(file);
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  checked++;
  let text = null;
  try { text = decoder.decode(buf); } catch (e) { problems.push(rel + '：不是合法 UTF-8（多半是被按 ANSI 写回过）'); continue; }
  if (path.extname(file).toLowerCase() !== '.ps1') continue;
  const hasBom = buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
  const hasNonAscii = /[^\x00-\x7F]/.test(text);
  if (hasNonAscii && !hasBom) {
    problems.push(rel + '：含中文却没有 UTF-8 BOM（Windows PowerShell 5.1 会按 ANSI 解码 → 乱码甚至语法错）');
  }
}

if (problems.length) {
  console.error('✗ 编码体检不通过（' + problems.length + ' 个）：');
  for (const p of problems) console.error('   · ' + p);
  console.error('  修法：用 UTF-8（带 BOM）重写该文件，例如：');
  console.error("    node -e \"const fs=require('fs');const f=process.argv[1];const b=fs.readFileSync(f);if(!(b[0]===0xEF))fs.writeFileSync(f,Buffer.concat([Buffer.from([0xEF,0xBB,0xBF]),b]))\" 文件路径");
  process.exit(1);
}
console.log('✓ 编码体检通过（' + checked + ' 个文本文件；.ps1 含中文的都有 UTF-8 BOM）');
