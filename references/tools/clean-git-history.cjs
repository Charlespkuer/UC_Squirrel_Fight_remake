/* 清掉 .git 里「早就该退出仓库」的历史包袱（.git 从 163 MB 缩到几十 MB）。
 *
 *   node references/tools/clean-git-history.cjs            # 演练：只报告会删什么、能省多少
 *   node references/tools/clean-git-history.cjs --apply    # 真的重写历史（需要重新 clone 或 force push）
 *
 * 为什么需要：`.gitignore` 早就把 `references/*`（原 APK、参考截图）、旧的 `tools/`（已搬到
 * references/tools）、`fonts/` 排除在外了，但它们**早期已经被提交过**，打包进 .git 之后
 * 即使工作区删掉也还在历史里（原 APK 单个就 34 MB）。
 *
 * 做法：不碰工作区，只重写**已提交的历史**——
 *   1. 克隆出一个只含提交历史的临时副本（工作区里未提交的改动原封不动留着）；
 *   2. 在副本里用 `git filter-branch --index-filter` 把这些路径从每个提交里移除；
 *   3. 清理 reflog 并 gc，然后把副本的 .git 换回项目里（工作区文件一个都不会动）。
 *
 * 注意：重写历史会改变提交 hash。如果已经推到 GitHub，需要 `git push --force --all` 与
 * `git push --force --tags`，别人要重新 clone（旧 clone 上的 pull 会冲突）。
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const APPLY = process.argv.includes('--apply');
const TMP = path.join(os.tmpdir(), 'ssdz-git-clean');

// 这些路径在**当前版本里都不再被跟踪**（见 .gitignore）：references/ 全是本地参考素材，
// tools/ 是旧位置（内容已搬到 references/tools），fonts/ 已弃用，根目录那几个是历史遗留文件。
const PURGE = [
  ':(glob)references/**',
  ':(glob)tools/**',
  ':(glob)fonts/**',
  ':(glob)electron/**',
  'package.json',
  'package-lock.json',
  'start-mac.command',
  'start-win.cmd',
];

function git(cwd, args, opts) {
  const r = spawnSync('git', args, Object.assign({ cwd, encoding: 'utf8' }, opts || {}));
  if (r.status !== 0 && !(opts && opts.allowFail)) {
    console.error('[x] git ' + args.join(' ') + '\n' + (r.stderr || ''));
    process.exit(r.status || 1);
  }
  return (r.stdout || '').trim();
}

function dirSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) stack.push(full);
      else total += fs.statSync(full).size;
    }
  }
  return total;
}
const mb = (n) => (n / 1048576).toFixed(1) + ' MB';

const before = dirSize(path.join(ROOT, '.git'));
const trackedBefore = git(ROOT, ['ls-files']).split('\n').filter(Boolean);

// 会从历史里消失、且当前仍被跟踪的文件（这些在工作区里会变成「本地文件、不再跟踪」）
const affected = trackedBefore.filter((p) =>
  /^(tools|fonts|electron)\//.test(p) || /^references\//.test(p) ||
  ['package.json', 'package-lock.json', 'start-mac.command', 'start-win.cmd'].includes(p));

console.log('.git 现在 ' + mb(before) + '，跟踪 ' + trackedBefore.length + ' 个文件');
console.log('将从历史中移除的路径模式：');
for (const p of PURGE) console.log('  · ' + p);
console.log('其中当前仍被跟踪、会变成「不跟踪」的文件：' + affected.length + ' 个（工作区文件不会删）');
if (affected.length) {
  const byTop = {};
  for (const p of affected) {
    const top = p.split('/')[0];
    byTop[top] = (byTop[top] || 0) + 1;
  }
  console.log('  ' + Object.entries(byTop).map(([k, v]) => k + ': ' + v).join('，'));
}

if (!APPLY) {
  console.log('\n（演练模式）加 --apply 才会真的重写历史。');
  process.exit(0);
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log('\n— 克隆一份只含提交历史的副本：' + TMP);
git(process.cwd(), ['clone', '--no-hardlinks', '--quiet', ROOT, TMP]);
git(TMP, ['checkout', '--quiet']);

console.log('— 重写历史（filter-branch）…');
const filter = 'git rm -r --cached --ignore-unmatch -- ' + PURGE.map((p) => "'" + p + "'").join(' ');
git(TMP, ['filter-branch', '--force', '--index-filter', filter, '--prune-empty', '--tag-name-filter', 'cat', '--', '--all']);

fs.rmSync(path.join(TMP, '.git', 'refs', 'original'), { recursive: true, force: true });
git(TMP, ['reflog', 'expire', '--expire=now', '--all']);
console.log('— gc 压缩…');
git(TMP, ['gc', '--prune=now', '--aggressive', '--quiet']);

const afterSize = dirSize(path.join(TMP, '.git'));
console.log('副本 .git：' + mb(afterSize) + '（原 ' + mb(before) + '，省 ' + mb(before - afterSize) + '）');

// 换回去之前先核对：除被移除的路径外，两边每个文件的 blob hash 必须完全一致。
// 注意 ls-tree 默认会把非 ASCII 路径加引号转义（core.quotepath），必须关掉，否则
// 中文文件名会被判成「丢失」（这一版第一次跑就是这么误报的）。
function kept(cwd) {
  const out = {};
  const lines = spawnSync('git', ['-c', 'core.quotepath=false', 'ls-tree', '-r', 'HEAD'], { cwd, encoding: 'utf8' }).stdout || '';
  for (const line of lines.split('\n').filter(Boolean)) {
    const m = line.match(/^\d+ blob ([0-9a-f]+)\t(.*)$/);
    if (!m) continue;
    const name = m[2].replace(/^"(.*)"$/, '$1');
    if (/^(tools|fonts|electron)\//.test(name) || /^references\//.test(name)) continue;
    if (['package.json', 'package-lock.json', 'start-mac.command', 'start-win.cmd'].includes(name)) continue;
    out[name] = m[1];
  }
  return out;
}
const a = kept(ROOT), b = kept(TMP);
const aKeys = Object.keys(a), bKeys = Object.keys(b);
const missing = aKeys.filter((k) => !(k in b));
const changed = aKeys.filter((k) => k in b && a[k] !== b[k]);
console.log('核对：保留文件 ' + aKeys.length + ' → ' + bKeys.length + '，丢失 ' + missing.length + '，内容变化 ' + changed.length);
if (missing.length || changed.length) {
  console.error('[x] 核对没通过，放弃替换（临时副本留在 ' + TMP + '）');
  if (missing.length) console.error('    丢失示例：' + missing.slice(0, 5).join(', '));
  if (changed.length) console.error('    变化示例：' + changed.slice(0, 5).join(', '));
  process.exit(1);
}

const projectGit = path.join(ROOT, '.git');
const stash = path.join(ROOT, '.git-old-' + Date.now());
fs.renameSync(projectGit, stash);
fs.cpSync(path.join(TMP, '.git'), projectGit, { recursive: true });
const remote = git(ROOT, ['remote', 'get-url', 'origin'], { allowFail: true });
if (remote && !remote.includes(ROOT)) console.log('（origin 仍是 ' + remote + '）');
git(ROOT, ['remote', 'set-url', 'origin', 'https://github.com/Charlespkuer/UC_Squirrel_Fight_remake.git'], { allowFail: true });

const nowSize = dirSize(projectGit);
console.log('\n✓ 已替换 .git：' + mb(before) + ' → ' + mb(nowSize) + '，释放 ' + mb(before - nowSize));
console.log('  旧 .git 备份在 ' + path.relative(ROOT, stash) + '（确认没问题后删掉它）');
console.log('  工作区文件完全没动；' + affected.length + ' 个原被跟踪的参考素材现在是「本地文件、不再跟踪」。');
console.log('  如果已经推到 GitHub：git push --force --all && git push --force --tags（别人需重新 clone）。');
fs.rmSync(TMP, { recursive: true, force: true });
