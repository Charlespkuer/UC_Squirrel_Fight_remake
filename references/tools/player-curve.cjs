/* ============================================================
 * 玩家成长曲线实测：用同等级 AI（与玩家共用一套成长预算 + 该等级装备）
 * 采样，给出三围与生命的均值，并做线性拟合。
 *
 *   node tools/player-curve.cjs [每级采样数] [起始等级] [结束等级]
 *
 * 拟合结果用来标定 GData.STAGE_PLAYER_CURVE —— 关卡 NPC 的强度就是按
 * 「推荐等级下的随机玩家均值」算出来的，成长规则一改就要重新跑一遍。
 * ============================================================ */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');
const SAMPLES = Math.max(20, Number(process.argv[2]) || 400);
const LO = Math.max(1, Number(process.argv[3]) || 1);
const HI = Math.min(70, Number(process.argv[4]) || 70);

function setup() {
  const storage = new Map();
  class ClockDate extends Date { static now() { return new Date(2026, 8, 24, 12).getTime(); } }
  const c = { Date: ClockDate, location: { search: '?qa=1' }, localStorage: { getItem: (k) => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) } };
  c.window = c;
  vm.createContext(c);
  for (const file of ['js/orig/Map.min.js', 'js/orig/GameDict.js', 'js/gamedata.js', 'js/state.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), c, { filename: file });
  }
  c.State.newGame('曲线测试');
  return c;
}
const ctx = setup();
const { State, GData } = ctx;

function sample(level) {
  const acc = { power: 0, agility: 0, speed: 0, hp: 0, stat: 0 };
  for (let i = 0; i < SAMPLES; i++) {
    const me = State.genAI(level, '', { levelJitter: 0, gearSelfLevel: true });
    acc.power += me.power; acc.agility += me.agility; acc.speed += me.speed;
    acc.hp += me.hp; acc.stat += (me.power + me.agility + me.speed) / 3;
  }
  for (const k of Object.keys(acc)) acc[k] /= SAMPLES;
  return acc;
}
/** 最小二乘 y = a·x + b（用真实等级，不是拟合出来的等效等级）。 */
function fit(points) {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / n, my = points.reduce((s, p) => s + p.y, 0) / n;
  let sxy = 0, sxx = 0;
  for (const p of points) { sxy += (p.x - mx) * (p.y - my); sxx += (p.x - mx) ** 2; }
  const a = sxy / sxx;
  return { a, b: my - a * mx };
}
const f2 = (v) => v.toFixed(2);
const rows = [];
for (let lv = LO; lv <= HI; lv++) rows.push({ lv, ...sample(lv) });

console.log('每级 ' + SAMPLES + ' 个 genAI 采样（同等级装备 + 武技）');
console.log('等级   力量    敏捷    速度    三围均值   生命');
for (const r of rows) {
  console.log(String(r.lv).padStart(4) + '  ' + [r.power, r.agility, r.speed, r.stat, r.hp].map((v) => f2(v).padStart(7)).join(' '));
}

// 关卡模型只用得到 10~25 级这一段，拟合也只取这一段（和当初定标的口径一致）
const band = rows.filter((r) => r.lv >= 10 && r.lv <= 25);
const statFit = fit(band.map((r) => ({ x: r.lv, y: r.stat })));
const hpFit = fit(band.map((r) => ({ x: r.lv, y: r.hp })));
const err = (points, f) => Math.max(...points.map((p) => Math.abs(f.a * p.x + f.b - p.y)));
console.log('\n10~25 级线性拟合：');
console.log('  三围 ≈ ' + f2(statFit.a) + '×等级 ' + (statFit.b >= 0 ? '+ ' : '− ') + f2(Math.abs(statFit.b)) +
  '   最大偏差 ' + f2(err(band.map((r) => ({ x: r.lv, y: r.stat })), statFit)));
console.log('  生命 ≈ ' + f2(hpFit.a) + '×等级 ' + (hpFit.b >= 0 ? '+ ' : '− ') + f2(Math.abs(hpFit.b)) +
  '   最大偏差 ' + f2(err(band.map((r) => ({ x: r.lv, y: r.hp })), hpFit)));
console.log('\n当前 GData.STAGE_PLAYER_CURVE = ' + JSON.stringify(GData.STAGE_PLAYER_CURVE));
console.log('建议改成 { statPer: ' + f2(statFit.a) + ', statBase: ' + f2(statFit.b) +
  ', hpPer: ' + f2(hpFit.a) + ', hpBase: ' + f2(hpFit.b) + ' }');
