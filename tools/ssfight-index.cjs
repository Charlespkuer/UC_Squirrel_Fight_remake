#!/usr/bin/env node
/* 经典界面只读查询：实时加载链/声明位置 + 已提交的元件与文本索引。
 * 无参数给总览；不读 references/，不执行游戏，不产生文件。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const json = (file) => JSON.parse(read(file));
const help = [
  'node tools/ssfight-index.cjs                         当前加载链、API 与素材包',
  'node tools/ssfight-index.cjs --name info1,expNum       跨包按名字查询，可重复 --name',
  'node tools/ssfight-index.cjs --id 4730                元件 id 或宿主 id',
  'node tools/ssfight-index.cjs --page challenge --name info',
  'node tools/ssfight-index.cjs --code routerOf,fitText   当前声明位置；未找到声明时查引用',
  '--code 范围：js/ssfight/**/*.js 与 js/classic-ui.js、classic-extras.js、classic-fusion.js。',
  '可组合 name/id/code；--page 只筛素材包，--limit 默认 40。',
];

function parse(args) {
  const options = { names: [], ids: [], code: [], page: null, limit: 40 };
  for (let i = 0; i < args.length; ++i) {
    const flag = args[i];
    if (flag === '--help' || flag === '-h') return { help: true };
    if (!['--name', '--id', '--code', '--page', '--limit'].includes(flag)) {
      throw new Error('未知参数 ' + flag + '\n' + help.join('\n'));
    }
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(flag + ' 需要值');
    if (flag === '--limit') {
      if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 200) {
        throw new Error('--limit 必须是 1–200 的整数');
      }
      options.limit = Number(value);
    } else if (flag === '--page') options.page = value;
    else options[{ '--name': 'names', '--id': 'ids', '--code': 'code' }[flag]].push(...value.split(',').filter(Boolean));
  }
  return options;
}

function sourceFiles(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => entry.isDirectory() ? sourceFiles(dir + '/' + entry.name)
      : entry.name.endsWith('.js') ? [dir + '/' + entry.name] : []);
}

function loadedScripts() {
  const html = read('scripts/index.html');
  return [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/gi)]
    .filter((match) => match[2].startsWith('js/ssfight/'))
    .map((match) => {
      const file = match[2];
      const source = read(file);
      return {
        file,
        entryLine: html.slice(0, match.index).split('\n').length,
        exports: [...new Set([...source.matchAll(/\bwindow\.(Sf\w+)\s*=/g)].map((m) => m[1]))],
      };
    });
}

function codeSearch(query, files) {
  const declarations = [], references = [];
  const needle = query.toLowerCase();
  for (const file of files) {
    const lines = read(file).split('\n');
    lines.forEach((line, index) => {
      if (!line.toLowerCase().includes(needle)) return;
      const item = { at: file + ':' + (index + 1), source: line.trim().slice(0, 240) };
      references.push(item);
      const declaration = line.match(/^\s*(?:async\s+)?function\s+([\w$]+)\s*\(/)
        || line.match(/^\s*(?:const|let|var)\s+([\w$]+)\s*=/)
        || line.match(/^\s*window\.([\w$]+)\s*=/)
        || line.match(/^\s*[\w$.]+\.prototype\.([\w$]+)\s*=/);
      if (declaration && declaration[1].toLowerCase().includes(needle)) declarations.push(item);
    });
  }
  return { query, kind: declarations.length ? 'declarations' : 'references', matches: declarations.length ? declarations : references };
}

function take(items, limit) {
  return { total: items.length, shown: items.slice(0, limit), truncated: items.length > limit };
}

function run(options) {
  const symbols = json('images/ssfight/ui/symbol-index.json');
  const texts = json('images/ssfight/ui/textfields-index.json');
  const allBundles = Object.entries(symbols.bundles);
  const bundles = options.page ? allBundles.filter(([key]) => key.toLowerCase() === options.page.toLowerCase()) : allBundles;
  if (!bundles.length) throw new Error('未找到素材包 ' + options.page + '；可选：' + allBundles.map(([key]) => key).join(', '));
  const records = bundles.flatMap(([bundle, value]) => Object.entries(value.names).map(([name, row]) => ({ bundle, name, ...row })));
  const filteredFields = texts.fields.filter((field) => bundles.some(([key]) => key === field.bundle));
  const output = {};
  if (!options.names.length && !options.ids.length && !options.code.length) {
    output.entry = 'scripts/index.html';
    output.classicScripts = loadedScripts();
    output.indexBundles = bundles.map(([key, value]) => ({ key, file: value.bundle, names: Object.keys(value.names).length }));
    output.usage = help;
    return output;
  }
  function queryResult(query, matched, fields) {
    return { query, symbols: take(matched, options.limit), textFields: take(fields, options.limit) };
  }
  if (options.names.length) output.names = options.names.map((query) => {
    const exact = records.filter((row) => row.name === query);
    const matched = exact.length ? exact : records.filter((row) => row.name.toLowerCase().includes(query.toLowerCase()));
    const fields = filteredFields.filter((field) => matched.some((row) => row.bundle === field.bundle && String(row.id) === String(field.id)));
    return queryResult(query, matched, fields);
  });
  if (options.ids.length) output.ids = options.ids.map((query) => {
    const matched = records.filter((row) => String(row.id) === query || String(row.owner) === query);
    const fields = filteredFields.filter((field) => String(field.id) === query
      || matched.some((row) => row.bundle === field.bundle && String(row.id) === String(field.id)));
    return queryResult(query, matched, fields);
  });
  if (options.code.length) {
    const files = sourceFiles('js/ssfight').concat(
      ['js/classic-ui.js', 'js/classic-extras.js', 'js/classic-fusion.js']
        .filter((file) => fs.existsSync(path.join(root, file)))
    );
    output.code = options.code.map((query) => {
      const result = codeSearch(query, files);
      return { query: result.query, kind: result.kind, ...take(result.matches, options.limit) };
    });
  }
  output.scope = '代码范围：js/ssfight/**/*.js 与 classic-ui/extras/fusion 三个经典模块；素材未命中不证明原版没有该元件，byName 仍受当前宿主和帧限制。';
  return output;
}

try {
  const options = parse(process.argv.slice(2));
  if (options.help) console.log(help.join('\n'));
  else console.log(JSON.stringify(run(options), null, 2));
} catch (error) {
  console.error('ssfight-index: ' + error.message);
  process.exitCode = 1;
}
