/* Run: node tools/test-battle-drops.cjs. Real rewards/state with a minimal DOM for pickup interaction. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const project = path.resolve(__dirname, '..');
function setup() {
  const storage = new Map(), nodes = [];
  function element(tag) {
    return { tag, attributes:{}, removed:false, setAttribute(key,value){this.attributes[key]=value;}, remove(){this.removed=true;} };
  }
  const c={location:{search:'?qa=1'},document:{createElement:element},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)}};
  c.window=c;vm.createContext(c);
  for(const file of ['js/orig/Map.min.js','js/orig/GameDict.js','js/gamedata.js','js/state.js','js/battle-drops.js'])vm.runInContext(fs.readFileSync(path.join(project,file),'utf8'),c,{filename:file});
  c.State.newGame('掉落测试');
  const root={appendChild(node){nodes.push(node);}};
  function create(values=[0,0,0,0],withRoot=true,kind){let i=0;return c.BattleDrops.create({root:withRoot?root:undefined,random:()=>values[i++]??0,kind});}
  function advance(drop,ms){while(ms>0){const step=Math.min(100,ms);drop.tick(step);ms-=step;}}
  return {c,nodes,create,advance,s:()=>c.State.state(),live:tag=>nodes.filter(n=>!n.removed&&(!tag||n.tag===tag)),saved:()=>JSON.parse(storage.get(c.State.saveKey))};
}
const tests=[],test=(name,run)=>tests.push([name,run]);
const same=(a,b)=>assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)));

test('计划固定3次，15FPS的30/180/340帧加共同随机偏移',()=>{
  const g=setup(),minimum=g.c.BattleDrops.plan(()=>0),maximum=g.c.BattleDrops.plan(()=>1);
  same(minimum.map(x=>x.at),[2000,12000,340/15*1000]);
  same(maximum.map(x=>x.at),[160/15*1000,310/15*1000,470/15*1000]);
  same(minimum.map(x=>x.index),[0,1,2]);assert.equal(minimum.length,3);assert.equal(maximum.length,3);
  assert.ok(g.c.BattleDrops.rules.lifetime>=2000&&g.c.BattleDrops.rules.lifetime<2100);
});

test('没有到出场时刻不可领取，三次逐次出现且按钮实际点击发奖',()=>{
  const g=setup(),drop=g.create([0,0,.4,.6]),times=[2000,12000,340/15*1000];let elapsed=0;
  assert.equal(drop.collect(0),false);
  for(let i=0;i<3;i++){
    g.advance(drop,times[i]-elapsed+1);elapsed=times[i]+1;
    const buttons=g.live('button');assert.equal(buttons.length,1);assert.match(buttons[0].attributes['aria-label'],/拾取/);
    buttons[0].onclick();assert.equal(g.live('button').length,0);assert.equal(drop.summary().items.length,i+1);
  }
  same(drop.summary().items.map(x=>x.id),[15,8,21]);assert.equal(g.s().exp,5);assert.equal(g.s().goldPoint,102);assert.equal(g.s().props[21],1);
  assert.equal(g.saved().props[21],1);
});

test('拾取战斗掉落会计入每日任务的 pickup 计数',()=>{
  const g=setup(),drop=g.create([0,.4,.4,.4]);
  g.c.State.questStatus();   // 先建好当天计数器
  assert.equal(g.s().dailyCounters.pickup,0);
  g.advance(drop,2000);g.live('button')[0].onclick();
  assert.equal(g.s().dailyCounters.pickup,1,'点一次算一次');
  drop.skip();               // 跳过补齐剩下的两枚
  assert.equal(g.s().dailyCounters.pickup,3,'补领的也要计数');
  assert.equal(g.saved().dailyCounters.pickup,3);
});

test('约2秒未点击消失不发奖，过期的旧按钮也不能补领',()=>{
  const g=setup(),drop=g.create();g.advance(drop,2000);const old=g.live('button')[0];
  g.advance(drop,2100);assert.equal(g.live('button').length,0);assert.equal(drop.collect(0),false);old.onclick();
  assert.equal(drop.summary().items.length,0);assert.equal(g.s().exp,0);
  g.advance(drop,7901);assert.equal(g.live('button').length,1);assert.equal(drop.collect(1),true);assert.equal(g.s().exp,5);
});

test('重复点击、错误序号与过时按钮不重复发奖，提示会清理',()=>{
  const g=setup(),drop=g.create([0,.4,.4,.4]);g.advance(drop,2000);const click=g.live('button')[0].onclick;
  assert.equal(drop.collect(1),false);click();click();assert.equal(drop.collect(0),false);assert.equal(g.s().goldPoint,102);
  assert.equal(drop.summary().items.length,1);assert.equal(g.live('div').length,1);
  g.advance(drop,1701);assert.equal(g.live('div').length,0);
  const snapshot=drop.summary();snapshot.items[0].count=999;assert.equal(drop.summary().items[0].count,2);
});

test('跳过补齐包括过期和未出现的3奖，已点奖不重复且重复跳过无效',()=>{
  const g=setup(),drop=g.create([0,.4,.6,.72]);
  g.advance(drop,4200);assert.equal(drop.summary().items.length,0); // First gold pickup missed.
  g.advance(drop,7801);assert.equal(drop.collect(1),true);assert.equal(g.s().props[21],1);
  drop.skip();same(drop.summary().items.map(x=>x.id),[21,8,22]);
  assert.equal(g.s().goldPoint,102);assert.equal(g.s().props[21],1);assert.equal(g.s().props[22],1);assert.equal(g.live().length,0);
  const saved=JSON.stringify(g.saved());drop.skip();g.advance(drop,100000);assert.equal(JSON.stringify(g.saved()),saved);assert.equal(drop.summary().items.length,3);
});

test('自然close或取消只保留已点击奖励，绝不补未领取奖励',()=>{
  for(const collected of [false,true]){
    const g=setup(),drop=g.create([0,.4,.4,.4]);g.advance(drop,2000);
    if(collected)drop.collect(0);
    drop.close();drop.skip();g.advance(drop,50000);assert.equal(drop.collect(1),false);
    assert.equal(g.s().goldPoint,collected?102:100);assert.equal(drop.summary().items.length,collected?1:0);assert.equal(g.live().length,0);
  }
});

test('换档和重载后旧战斗不能把掉落发给新玩家，也不能继续改旧玩家',()=>{
  for(const action of ['new','load']){
    const g=setup(),drop=g.create([0,.4,.56,.68]),owner=g.s();g.advance(drop,2000);
    if(action==='new')g.c.State.newGame('新玩家');else g.c.State.load();
    const next=g.s(),before=JSON.stringify(next);assert.notEqual(next,owner);
    assert.equal(drop.collect(0),false);drop.skip();assert.equal(drop.summary().items.length,0);
    assert.equal(JSON.stringify(next),before);assert.equal(owner.goldPoint,100);assert.equal(g.live().length,0);
  }
});

test('经验掉落走真实升级，跳过3次累计15经验且汇总属性成长与武技三选一',()=>{
  const g=setup();g.s().exp=18;g.c.State.save();const drop=g.create();
  drop.skip();assert.equal(g.s().level,2);assert.equal(g.s().exp,13);
  const summary=drop.summary();assert.equal(summary.items.length,3);assert.equal(summary.ups.length,1);assert.equal(summary.ups[0].level,2);
  // 2 级是武技等级：发一组「三选一」候选（还没学会），玩家在弹窗里选
  assert.ok(summary.ups[0].wsChoice >= 1 && summary.ups[0].wsChoice <= 3, '有三选一候选');
  assert.equal(summary.ups[0].reward, null, '不再自动领悟');
  assert.equal(g.c.State.pendingWS(), 1);
  const choices = g.c.State.currentWSChoices();
  assert.equal(choices.length, summary.ups[0].wsChoice);
  assert.ok(choices.every((c) => ['weapon','skill'].includes(c.kind) && c.name));
  assert.equal(g.c.State.chooseWS(choices[0].kind, choices[0].id).ok, true);
  assert.equal(g.c.State.pendingWS(), 0);
  // 每级 4 个点位：3 点属性 + 生命 5。其中 1 点自选：占比过低时系统代选（autoPoint 已进属性），
  // 否则挂在 freePoints 上等玩家分配，所以要把这两者一起算进预算。
  const u = summary.ups[0];
  assert.equal(u.power + u.agility + u.speed + u.hp / 5 + (u.freePoint || 0) + (u.autoPoint ? 1 : 0), 4);
  assert.equal(g.saved().level,2);assert.equal(g.saved().exp,13);drop.skip();assert.equal(g.s().exp,13);
});

test('无DOM仍可按时领取与跳过，暂停和非法dt不提前结算',()=>{
  const g=setup(),drop=g.create([0,.4,.4,.4],false);
  for(const dt of [0,-100,NaN,'bad'])drop.tick(dt);assert.equal(drop.collect(0),false);
  drop.tick(999999);assert.equal(drop.collect(0),false); // A suspended frame is capped to 100ms.
  g.advance(drop,1900);assert.equal(drop.collect(0),true);drop.skip();assert.equal(g.s().goldPoint,106);assert.equal(g.nodes.length,0);
});

test('天梯战用专属掉落表：飘出来的是天梯碎片与恶魔果实种子',()=>{
  const g=setup();
  // 全 0 的随机源必中每条掉落的第一项：天梯表第一条就是天梯碎片（id 51）
  const drop=g.create([0,0,0,0],true,'rank');
  g.advance(drop,2100);assert.equal(drop.collect(0),true);
  assert.equal(g.s().props[51],1,'点一下拿到天梯碎片');
  drop.skip();assert.equal(g.s().props[51],3,'跳过会补领剩下两帧（都是碎片）');
  const afterRank=g.s().props[51];
  // 普通战斗不会掉天梯碎片
  const plain=g.create([0,0,0,0],true,'challenge');
  g.advance(plain,2100);plain.collect(0);plain.skip();
  assert.equal(g.s().props[51],afterRank,'普通战斗不掉天梯碎片');
  assert.equal(g.c.BattleDrops.poolFor('rank').some(p=>p.id===51),true);
  assert.equal(g.c.BattleDrops.poolFor().some(p=>p.id===51),false);
  assert.equal(g.c.BattleDrops.poolFor('rank').some(p=>p.id===46),true,'天梯也掉恶魔果实种子');
});

test('10 个天梯碎片 + 50 金松果随机合成一个转化丸',()=>{
  const g=setup(),s=g.s();
  assert.equal(g.c.State.composeConvertPill().ok,false,'碎片不够不能合成');
  s.props[51]=10;s.goldPoint=200;
  const r=g.c.State.composeConvertPill();
  assert.equal(r.ok,true);
  assert.ok([10,11,12].includes(r.prop),'产出的应是力量/敏捷/速度转化丸之一');
  assert.equal(s.props[51],0,'消耗 10 个碎片');
  assert.equal(s.goldPoint,150,'消耗 50 金松果');
  assert.equal(s.props[r.prop],1,'转化丸进背包');
  assert.equal(g.c.State.composeConvertPill().ok,false,'碎片用完后不能再合');
});

let failed=0;for(const[name,run]of tests){try{run();console.log('PASS',name);}catch(error){failed++;console.error('FAIL',name,error.stack);}}
console.log(`${tests.length-failed}/${tests.length} battle-drop tests passed`);process.exitCode=failed?1:0;
