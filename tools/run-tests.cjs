#!/usr/bin/env node
/* ============================================================
 * tools/run-tests.cjs —— 并行跑 `tools/test-*.cjs`（CI 与本机通用）
 *
 *   node tools/run-tests.cjs              # 默认 4 路并行（按 CPU 数封顶）
 *   node tools/run-tests.cjs --jobs 2     # 指定并行度
 *   node tools/run-tests.cjs --serial     # 串行（排查顺序问题时用）
 *   node tools/run-tests.cjs --only tower # 只跑文件名匹配的套件
 *
 * 为什么单独一个入口：
 *   · 单机版 26 个套件串行要一分多钟，其中 test-fixes-round / test-save-boot / test-sync /
 *     test-mint-shop / test-ssfight-render 最慢；套件之间没有共享端口（各套件自己随机端口 /
 *     独立临时目录），所以可以安全并行 —— 4 路通常能把等待压掉一半以上。
 *   · CI 的三个平台共用这一份逻辑：失败仍按原来的格式打 `::error::` 注解，并把
 *     该套件最后 25 行写进 job summary（远程排查不用 admin 权限）。
 *
 * 门槛：零第三方依赖；不带参数就能跑。CI 枚举的仍然是 tools/test-*.cjs，
 * 新增/改名套件不用改本文件或 workflow。`test-battle.js` 不是 .cjs，CI 里单独跑。
 * ============================================================ */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const onlyAt = argv.indexOf('--only');
const jobsAt = argv.indexOf('--jobs');
const only = onlyAt >= 0 ? new RegExp(argv[onlyAt + 1]) : null;
const serial = argv.includes('--serial');
const TIMEOUT_MS = 600000;

const files = fs.readdirSync(path.join(ROOT, 'tools'))
  .filter((f) => /^test-.*\.cjs$/.test(f))
  .filter((f) => !only || only.test(f))
  /* 长的先跑：整体耗时由最慢的套件决定，先排它们能让并行末尾少空等几秒。 */
  .sort((a, b) => {
    const slow = ['test-fixes-round.cjs', 'test-save-boot.cjs', 'test-sync.cjs',
      'test-mint-shop.cjs', 'test-ssfight-render.cjs', 'test-tower-hero.cjs'];
    const ra = slow.indexOf(a), rb = slow.indexOf(b);
    if (ra !== rb) return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
    return a.localeCompare(b);
  });
if (!files.length) { console.error('没有匹配的 tools/test-*.cjs'); process.exit(1); }

const defaultJobs = Math.max(2, Math.min(4, os.cpus().length));
const jobs = serial ? 1 : Math.max(1, Number(jobsAt >= 0 ? argv[jobsAt + 1] : defaultJobs) || 1);

function runSuite(file) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [path.join(ROOT, 'tools', file)], { cwd: ROOT });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => {
      out += '\n[run-tests] 超时 ' + Math.round(TIMEOUT_MS / 1000) + 's，已终止';
      try { child.kill(); } catch (e) {}
    }, TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ file, code: code == null ? 1 : code, ms: Date.now() - started, out });
    });
  });
}

function tail(text, n) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n').filter((l) => l.length);
  return lines.slice(-n).join('\n');
}

(async () => {
  const started = Date.now();
  const results = [];
  let cursor = 0;
  async function worker() {
    for (;;) {
      const at = cursor++;
      if (at >= files.length) return;
      const result = await runSuite(files[at]);
      results.push(result);
      const tag = result.code === 0 ? '✓' : '✗';
      console.log(tag + ' ' + result.file.padEnd(34) + String(result.ms).padStart(7) + 'ms'
        + (result.code === 0 ? '' : '  exit=' + result.code));
    }
  }
  await Promise.all(Array.from({ length: Math.min(jobs, files.length) }, worker));

  results.sort((a, b) => a.file.localeCompare(b.file));
  const failed = results.filter((r) => r.code !== 0);
  const total = ((Date.now() - started) / 1000).toFixed(1);
  console.log('\n' + results.length + ' 个套件 · ' + jobs + ' 路并行 · ' + total + 's · '
    + (results.length - failed.length) + ' 通过 / ' + failed.length + ' 失败');
  if (failed.length) {
    for (const r of failed) {
      console.log('\n──── ' + r.file + '（exit=' + r.code + '）────');
      console.log(tail(r.out, 25));
    }
    /* GitHub Actions 注解 + job summary（沿用 CI 原来的排障口径）。 */
    for (const r of failed) {
      console.log('::error title=套件失败（' + os.platform() + '）::' + r.file + ' 未通过');
    }
    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (summaryPath) {
      try {
        let text = '';
        for (const r of failed) {
          text += '### ❌ ' + r.file + '（' + os.platform() + '）\n```\n' + tail(r.out, 25) + '\n```\n';
        }
        fs.appendFileSync(summaryPath, text);
      } catch (e) { /* summary 写失败不能盖住真正的失败 */ }
    }
    process.exitCode = 1;
  }
})();
