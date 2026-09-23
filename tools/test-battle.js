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
  const wear = E.wearsFor([{ id: 61, used: true, ext: [{ id: 1, level: 3 }] }]);
  assert(wear.some(Boolean), 'real equipment definitions map to sprite slots');
  await E.loadWears([{ id: 61, used: true, ext: [{ id: 1, level: 3 }] }]);
  const idle = E.anim('standby')[0];
  const bb = E.frameBounds(idle, { sheets: ['SQ_01', 'SQ_02'], exclude: ['54'] });
  assert(bb.w > 100 && bb.w < 600 && bb.h > 150 && bb.h < 450, 'transformed frame bounds include rotated sprite corners');
  let skippedEnd = 0;
  const skip = await B.run({ canvas, me: fighter, foe: fighter, result, onEnd: () => skippedEnd++ });
  skip.skip(); await tick(); assert.equal(skippedEnd, 1, 'skip wakes countdown and completes exactly once');
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
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('Battle regression checks passed; original-atlas renders: tools/research/battle-check');
})().catch((error) => { console.error(error); process.exitCode = 1; });
