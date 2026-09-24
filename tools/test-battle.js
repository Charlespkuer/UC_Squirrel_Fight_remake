/* Offline regression checks with the original bitmap atlases and animation data.
 * node tools/test-battle.js. Uses the desktop's bundled @napi-rs/canvas when available.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
process.chdir(path.resolve(__dirname, '..'));
let graphics;
try { graphics = require('@napi-rs/canvas'); }
catch { graphics = require(path.join(process.env.USERPROFILE || 'C:/Users/Charles', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas')); }
let time = 0, seq = 0;
const tasks = new Map(), rafs = new Map(), errors = [], children = [];
const canvas = graphics.createCanvas(1170, 690);
const canvasContext = canvas.getContext('2d'), drawnText = [];
const originalFillText = canvasContext.fillText.bind(canvasContext);
canvasContext.fillText = function (text, ...args) { drawnText.push({ text: String(text), at: time }); return originalFillText(text, ...args); };
canvas.style = {}; canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1170, height: 690 });
const ui = { appendChild(node) { children.push(node); } };
const sandbox = {
  console: { log: console.log, warn: (m) => errors.push(m), error: (...a) => errors.push(a.join(' ')) },
  Image: graphics.Image,
  performance: { now: () => time },
  setTimeout(fn, ms) { const id = ++seq; tasks.set(id, { fn, at: time + ms }); return id; },
  clearTimeout(id) { tasks.delete(id); },
  requestAnimationFrame(fn) { const id = ++seq; rafs.set(id, fn); return id; },
  cancelAnimationFrame(id) { rafs.delete(id); },
  document: { getElementById: () => ui, createElement(tag) {
    if (tag === 'canvas') return graphics.createCanvas(122, 122);
    return { style: {}, setAttribute() {}, remove() { const i = children.indexOf(this); if (i >= 0) children.splice(i, 1); } };
  } },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const file of ['js/orig/Map.min.js', 'js/orig/GameDict.js', 'js/orig/assets.js', 'js/orig/asset2.js', 'js/orig/animationStr.js', 'js/engine.js', 'js/battle.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
const E = sandbox.Engine, B = sandbox.Battle;
const instances = [];
const originalPlay = E.playAnim;
E.playAnim = (...args) => { const inst = originalPlay(...args); if (inst) instances.push(inst); return inst; };
async function tick(ms = 50) {
  time += ms;
  const callbacks = [...rafs.values()]; rafs.clear(); callbacks.forEach((cb) => cb(time));
  for (const [id, task] of [...tasks]) if (task.at <= time) { tasks.delete(id); task.fn(); }
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
async function until(target) { while (time < target) await tick(Math.min(50, target - time)); }
function save(name) { fs.mkdirSync('tools/research/battle-check', { recursive: true }); fs.writeFileSync('tools/research/battle-check/' + name + '.png', canvas.toBuffer('image/png')); }
(async () => {
  const fighter = { name: '小松鼠', level: 10, hp: 250, power: 30, agility: 20, speed: 20, weapons: [], skills: [] };
  const result = { winner: 0, rounds: [
    { attacker: 0, action: 'common', dmg: 40, hpAfter: [250, 210] },
    { attacker: 1, action: 'common', dmg: 25, counterDmg: 5, hpAfter: [225, 205] },
    { attacker: 0, action: 'weapon', id: 3, level: 8, dmg: 205, hpAfter: [225, 0] },
  ] };
  let ended = 0;
  const controller = await B.run({ canvas, me: fighter, foe: { ...fighter, name: '螳螂', npcType: 'tl' }, region: 3, result, onEnd: () => ended++ });
  assert(E.frameSize('fightNum_r', '4').w === 45, 'grid number atlas is registered');
  assert(B.weaponLabelFor(3, 8) === '1103');
  await until(1750); save('01-idle-forest');
  const npc = instances.find((i) => i.name === 'tl_rest');
  assert.equal(npc.mirror, false, 'right-side NPC timeline must not be mirrored again');
  const before = time;
  await until(2000); save('02-approach');
  assert(!drawnText.some((t) => t.text === '210/250'), 'HP does not fall before the attack reaches its original hit frame');
  const attack = instances.find((i) => i.name === 'fightCommonAttack');
  assert(attack && !attack.dead, 'original approach timeline is playing');
  await until(2500); save('03-impact');
  assert(drawnText.some((t) => t.text === '210/250'), 'HP falls on impact');
  await until(3150); save('04-npc-attack');
  await until(10000); save('05-result');
  assert.equal(ended, 1, 'complete battle calls onEnd once');
  assert.equal(rafs.size, 0, 'finished battle stops its render loop');
  assert.equal(children.length, 0, 'finished battle removes the accessible skip control');
  assert(instances.some((i) => i.name === 'tl_hurtRunBack'), 'countered NPC attack uses original recoil and return timeline');
  assert(instances.some((i) => i.name === 'fanhui'), 'squirrel attack uses original return timeline');
  assert(instances.some((i) => i.name === 'tl_die' && i.holdLast), 'death frame remains visible');
  // 结算方（关卡连战）要按剩余血量继承；Sim.simulate 只在逐帧给 hpAfter，
  // Battle 必须把最后一帧提到 result 上，否则挑战结算会抛错并丢回主界面。
  assert.deepEqual(Array.from(result.hpAfter), [225, 0], 'battle result exposes the final simulated HP pair');
  const wear = E.wearsFor([{ id: 61, used: true, ext: [{ id: 1, level: 3 }] }]);
  assert(wear.some(Boolean), 'real equipment definitions map to sprite slots');
  await E.loadWears([{ id: 61, used: true, ext: [{ id: 1, level: 3 }] }]);
  const idle = E.anim('standby')[0];
  const bb = E.frameBounds(idle, { sheets: ['SQ_01', 'SQ_02'], exclude: ['54'] });
  assert(bb.w > 100 && bb.w < 600 && bb.h > 150 && bb.h < 450, 'transformed frame bounds include rotated sprite corners');
  let skippedEnd = 0;
  const skipResult = { winner: 0, rounds: [
    { attacker: 0, action: 'common', dmg: 40, hpAfter: [250, 210] },
    { attacker: 1, action: 'common', dmg: 180, hpAfter: [70, 210] },
  ] };
  const skip = await B.run({ canvas, me: fighter, foe: fighter, result: skipResult, onEnd: () => skippedEnd++ });
  skip.skip(); await tick(); assert.equal(skippedEnd, 1, 'skip wakes countdown and completes exactly once');
  assert.deepEqual(Array.from(skipResult.hpAfter), [70, 210], 'skipping still reports final HP so chained stages can inherit it');
  let canceledEnd = 0;
  const cancel = await B.run({ canvas, me: fighter, foe: fighter, result, onEnd: () => canceledEnd++ });
  cancel.cancel(); await tick(); assert.equal(canceledEnd, 0, 'cancel cannot grant a battle result');
  assert.equal(rafs.size, 0, 'cancel stops RAF');
  for (let region = 0; region < 5; region++) {
    const types = ['xh', 'xm', 'wood', 'tl', null];
    const review = await B.run({ canvas, region, me: { ...fighter, wears: wear }, foe: { ...fighter, npcType: types[region] },
      result: { winner: 0, rounds: [{ attacker: 1, action: 'rest', hpAfter: [250, 250] }] } });
    await until(time + 1950); save('scene-' + region); review.cancel(); await tick();
  }
  // The simulator now emits buff/heal actions separately from the next attack.
  // Exercise the real atlases and ensure every await completes without Skip.
  const eventStart = instances.length;
  let eventEnd = 0;
  await B.run({ canvas, me: fighter, foe: fighter, result: { winner: 0, rounds: [
    { attacker: 0, action: 'skill', id: 14, noDmg: true, buffUp: true, actAgain: true, hpAfter: [250, 250] },
    { attacker: 1, action: 'common', dmg: 220, hpAfter: [30, 250] },
    { attacker: 0, action: 'skill', id: 13, noDmg: true, healSelf: 80, hpAfter: [110, 250] },
    { attacker: 0, action: 'dot', selfDot: true, dmg: 4, hpAfter: [106, 250] },
    { attacker: 0, action: 'skill', id: 18, dmg: 10, hpAfter: [106, 240] },
    { attacker: 0, action: 'skill', id: 18, dmg: 10, disarmApplied: true, hpAfter: [106, 230] },
    { attacker: 0, action: 'common', dmg: 10, counterDmg: 105, counterFakeDie: true, hpAfter: [1, 220] },
    { attacker: 0, action: 'common', dmg: 220, hpAfter: [1, 0] },
  ] }, onEnd: () => eventEnd++ });
  await until(time + 34000);
  assert.equal(eventEnd, 1, 'new combat events complete without a hanging animation');
  const played = instances.slice(eventStart);
  assert(played.some((i) => i.name === 'skill_14'), 'cosmos uses its original buff animation');
  assert(played.some((i) => i.name === 'skill_13'), 'master healing uses the original animation');
  assert(played.some((i) => i.name === 'skill_18_1') && played.some((i) => i.name === 'skill_18_2'), 'magnet distinguishes damage from successful disarming');
  assert(played.some((i) => i.name === 'skill_6' && i.side === 0), 'fake death from a counterattack plays the defensive animation');
  assert(drawnText.some((t) => t.text === '属性提升'), 'no-damage cosmos event visibly indicates the buff');
  assert(drawnText.some((t) => t.text === '110/250') && drawnText.some((t) => t.text === '106/250'), 'healing and DOT update HP snapshots');
  assert.equal(children.length, 0, 'event playback cleans up its skip control');
  for (const npcType of ['tl', 'xh', 'xm', 'wood']) {
    let npcEnd = 0;
    const first = instances.length;
    await B.run({ canvas, me: fighter, foe: { ...fighter, npcType }, result: { winner: 0, rounds: [
      { attacker: 0, action: 'skill', id: 18, dmg: 250, disarmApplied: true, hpAfter: [250, 0] },
    ] }, onEnd: () => npcEnd++ });
    await until(time + 10000);
    assert.equal(npcEnd, 1, npcType + ': magnet reaction and death finish');
    assert(instances.slice(first).some((i) => i.name === (npcType === 'wood' ? 'wood_hitMe' : npcType + '_hitMe')), npcType + ': uses NPC reaction art');
    assert(!instances.slice(first).some((i) => /^skill_18_[12]$/.test(i.name) && i.side === 1), npcType + ': does not use squirrel-only disarm art');
  }
  const counterStart = drawnText.length;
  let overkillEnd = 0;
  await B.run({ canvas, me: { ...fighter, hp: 100 }, foe: { ...fighter, hp: 100 }, result: { winner: 1, rounds: [
    { attacker: 1, action: 'common', dmg: 58, hpAfter: [42, 100] },
    // The counter overkills 42 HP by 19. The first impact must leave HP at 42,
    // then the counter's own hit frame changes it to zero, never briefly 61.
    { attacker: 0, action: 'common', dmg: 30, counterDmg: 61, hpAfter: [0, 70] },
  ] }, onEnd: () => overkillEnd++ });
  await until(time + 12000);
  assert.equal(overkillEnd, 1, 'overkill counter completes normally');
  const overkillHud = drawnText.slice(counterStart).map((entry) => entry.text);
  assert(overkillHud.includes('42/100') && overkillHud.includes('0/100'), 'overkill counter shows actual HP before and after its hit');
  assert(!overkillHud.includes('61/100'), 'overkill damage cannot temporarily restore the attacker HP');
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('Battle regression checks passed; original-atlas renders: tools/research/battle-check');
})().catch((error) => { console.error(error); process.exitCode = 1; });
