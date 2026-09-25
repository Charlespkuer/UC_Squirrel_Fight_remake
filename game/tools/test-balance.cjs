/* Run: node tools/test-balance.cjs. Historical facts and state transitions, using real dictionaries. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
function setup() {
  const storage = new Map(); let now = new Date(2026, 8, 23, 23, 59).getTime(), seed = 183;
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const c = { Date: Clock, location: { search: '?qa=1' }, localStorage: { getItem: k => storage.get(k) || null, setItem: (k,v) => storage.set(k,v) } };
  c.window = c; vm.createContext(c);
  for (const file of ['js/orig/Map.min.js', 'js/orig/GameDict.js', 'js/gamedata.js', 'js/state.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), c, { filename: file });
  const math = vm.runInContext('Math', c); math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  c.State.newGame('规则测试');
  return { ...c, storage, math, advance: ms => now += ms, s: () => c.State.state(), saved: () => JSON.parse(storage.get(c.State.saveKey)) };
}
const tests = [];
const test = (name, run) => tests.push([name, run]);
const same = (a,b) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
const total = s => s.power + s.agility + s.speed + s.maxHp / 5;

test('1至50级所需经验逐项符合reference原表及累计161410', () => {
  const g = setup(), source = fs.readFileSync(path.join(root, 'references/new/reference.md'), 'utf8');
  const rows = source.slice(source.indexOf('累计经验') + 4).trim().split(/\s+/).map(Number);
  let sum = 0;
  for (let i = 0; i < 50; i++) {
    const [level, exp, , cumulative] = rows.slice(i * 4, i * 4 + 4);
    assert.equal(g.GData.nextExp(level), exp, 'level ' + level);
    sum += exp; assert.equal(sum, cumulative);
  }
  assert.equal(sum, 161410); assert.equal(g.GData.nextExp(51), 7530);
});

test('随机开局生命30–50，总属性永远22，无预赠武技且Debug仍可指定武器', () => {
  const g = setup();
  for (let i = 0; i < 200; i++) {
    g.State.newGame('松鼠'); const s = g.s();
    assert.equal(total(s), 22); assert.ok(s.maxHp >= 30 && s.maxHp <= 50); assert.equal(s.maxHp % 5, 0);
    same(s.weapons, []); same(s.skills, []);
  }
  g.State.newGame('调试', { weaponId: 15, weaponLevel: 12 }); same(g.s().weapons, ['15:12']); assert.equal(total(g.s()), 22);
});

test('2至70逐级固定成长、24个指定「三选一」等级、53/59/65属性书', () => {
  const g = setup(), expected = [2,3,4,6,8,10,12,14,16,18,20,23,26,29,32,35,38,41,44,47,50,56,62,68];
  const received = [];
  for (let level = 2; level <= 70; level++) {
    const before = total(g.s()), beforeFree = g.s().freePoints || 0;
    const ups = g.State.gainExp(g.GData.nextExp(level - 1));
    assert.equal(ups.length, 1); assert.equal(ups[0].level, level);
    const free = (g.s().freePoints || 0) - beforeFree;
    if ([53,59,65].includes(level)) {
      assert.equal(total(g.s()), before); assert.equal(free, 0); assert.equal(ups[0].attributeBook, true); assert.equal(ups[0].reward, null);
      assert.equal(ups[0].wsChoice, 0, '属性书等级不发武技三选一');
    } else {
      // 每级 4 个点位：3 点属性 + 生命 5。3 点里 2 点随机、1 点自选；
      // 自选点占比过低时由系统代选（autoPoint），否则挂在 freePoints 上等玩家分配。
      assert.equal(total(g.s()) - before + free, 4);
      assert.equal(free + (ups[0].autoPoint ? 1 : 0), 1);
      assert.ok(ups[0].hp >= 5 && ups[0].hp <= 15); assert.equal(ups[0].hp % 5, 0);
    }
    // 升级只会发「三选一」候选（1~3 个），学会什么由玩家在弹窗里选
    if (ups[0].wsChoice) {
      received.push(level);
      const choices = g.State.currentWSChoices();
      assert.ok(choices.length >= 1 && choices.length <= 3, '候选 1~3 个');
      assert.equal(ups[0].wsChoice, choices.length);
      for (const c of choices) {
        assert.ok(c.kind === 'weapon' || c.kind === 'skill');
        assert.ok(c.name && c.name.length > 0);
        assert.equal(g.GData.canLearn(c.kind, c.id, level), true, level + ' 级不该出现学不了的候选');
      }
      // 玩家随便挑一个，学会后这组出队
      const pick = choices[0];
      const r = g.State.chooseWS(pick.kind, pick.id);
      assert.equal(r.ok, true); assert.equal(g.State.pendingWS(), 0);
      assert.ok(g.State.myWeapons().some(x => x.id === pick.id) || g.State.mySkills().some(x => x.id === pick.id));
    } else {
      assert.equal(g.State.pendingWS(), 0);
    }
    if (level < 50) {
      assert.equal(g.s().weapons.some(x => [16,17].includes(+x.split(':')[0])), false);
      assert.equal(g.s().skills.some(x => [13,23,24].includes(+x.split(':')[0])), false);
    }
  }
  same(received, expected); assert.equal(g.State.wsLimit(), 24); assert.equal(g.s().props[37], 3);
  assert.equal(g.s().weapons.length + g.s().skills.length, 24);
});

test('拜师技能不占随机位置，50级武技门槛和旧存档的超额武技均保留', () => {
  const g = setup(); g.State.setMaster({ name:'师父', level:20 });
  g.State.gainExp(20);
  // 拜师技能 13 先进来；2 级的三选一还没选，所以只算 1 个
  assert.equal(g.s().weapons.length + g.s().skills.length, 1); assert.ok(g.s().skills.includes('13:1'));
  assert.equal(g.State.pendingWS(), 1, '2 级发了一组三选一');
  const first = g.State.currentWSChoices()[0];
  assert.equal(g.State.chooseWS(first.kind, first.id).ok, true);
  assert.equal(g.s().weapons.length + g.s().skills.length, 2);
  // 拜师技能不占随机位置：2 级的 1 个名额已经用掉，所以随机池空了
  assert.equal(g.State.gainRandomWS(), null);
  for (const [kind,id] of [['weapon',16],['weapon',17],['skill',23],['skill',24]]) {
    assert.equal(g.GData.canLearn(kind,id,49), false); assert.equal(g.GData.canLearn(kind,id,50), true);
  }
  const old = { ...g.s(), level:1, power:88, agility:44, speed:55, maxHp:555, weapons:['16:15'], skills:['3:15','13:1','24:12'] };
  g.storage.set(g.State.saveKey, JSON.stringify(old)); g.State.load();
  same(g.s().weapons, old.weapons); same(g.s().skills, old.skills); assert.equal(g.s().power,88); assert.equal(g.s().maxHp,555);
});

test('属性书仅接受总计8点的自由分配，坏参数不吃书', () => {
  const g = setup(), s = g.s(); s.props[37] = 2;
  const before = [s.power,s.agility,s.speed];
  for (const param of [undefined, null, {}, {power:8}, {power:9,agility:-1,speed:0}, {power:7.5,agility:.5,speed:0}, {power:7,agility:0,speed:0}]) {
    assert.equal(g.State.useProp(37,param).ok, false); assert.equal(s.props[37],2);
  }
  assert.equal(g.State.useProp(37,{power:1,agility:3,speed:4}).ok, true);
  same([s.power,s.agility,s.speed], [before[0]+1,before[1]+3,before[2]+4]); assert.equal(s.props[37],1);
  assert.equal(g.State.useProp(37,{power:0,agility:0,speed:8}).ok, true); assert.equal(s.props[37],undefined);
});

test('普通商品每天每种5个，稀有1个，批量和重载均不能越额', () => {
  const g = setup(), s=g.s(); s.goldPoint=5000;
  assert.equal(g.State.shopLimit(2),5); assert.equal(g.State.shopLimit(13),1); assert.equal(g.State.shopLimit(47),1);
  assert.equal(g.State.buyProp(2,3).ok,true); assert.equal(g.State.purchaseStatus(2).remaining,2);
  const gold=s.goldPoint, owned=s.props[2];
  assert.equal(g.State.buyProp(2,3).limited,true); assert.equal(s.goldPoint,gold); assert.equal(s.props[2],owned);
  assert.equal(g.State.buyProp(2,2).ok,true); assert.equal(g.State.buyProp(2,1).ok,false);
  assert.equal(g.State.buyProp(1,5).ok,true); assert.equal(g.State.buyProp(13).ok,true); assert.equal(g.State.buyProp(13).limited,true);
  g.State.load(); assert.equal(g.State.purchaseStatus(2).remaining,0); assert.equal(g.State.buyProp(2).limited,true);
  assert.equal(g.saved().shopPurchases[2],5); assert.equal(g.saved().shopPurchases[13],1);
});

test('午夜自动滚动限额，失败购买/礼包/持有数量不影响额度，金杯商店的按天限兑不被牵连', () => {
  const g=setup(),s=g.s(); s.goldPoint=0; s.rankPurchases={11:1}; s.rankPurchaseDay='2026-09-23';
  assert.equal(g.State.buyProp(2).ok,false); assert.equal(g.State.purchaseStatus(2).bought,0);
  s.goldPoint=1000; s.props[2]=999; g.State.buyProp(2,5);
  const date=g.State.purchaseStatus(2).date; g.advance(120000);
  assert.notEqual(g.State.purchaseStatus(2).date,date); assert.equal(g.State.purchaseStatus(2).remaining,5);
  assert.equal(g.State.buyProp(2,5).ok,true); assert.equal(s.props[2],1009);
  same(s.rankPurchases,{11:1}); assert.equal(s.rankPurchaseDay,'2026-09-23');
  assert.equal(g.State.purchaseStatus(16).buyable,false); assert.equal(g.State.buyProp(16).ok,false);
});

test('限购迁移兼容无字段/破损字段，Debug免费购买保留且不越日限', () => {
  const g=setup();
  g.storage.set(g.State.saveKey,JSON.stringify({goldPoint:80,shopPurchases:{1:4,2:-4,999:5},shopPurchaseDate:''}));
  g.State.load(); assert.equal(g.State.purchaseStatus(1).remaining,1); assert.equal(g.State.purchaseStatus(2).remaining,5);
  g.window.Debug={enabled:key=>key==='freeShop'}; assert.equal(g.State.buyProp(1,1).ok,true); assert.equal(g.s().goldPoint,80);
  assert.equal(g.State.buyProp(1).limited,true); assert.equal(g.State.buyProp(47,2).limited,true); assert.equal(g.State.buyProp(47).ok,true);
  g.State.load(); assert.equal(g.State.purchaseStatus(1).remaining,0);
  g.storage.set(g.State.saveKey,JSON.stringify({shopPurchases:[],shopPurchaseDate:null}));g.State.load();assert.equal(g.State.purchaseStatus(1).remaining,5);
});

test('转生50级前保留物品装备且不重复礼包，50级后拒绝且不吃果', () => {
  const g=setup(),s=g.s();s.level=49;s.props[13]=2;s.props[23]=9;s.weapons=['16:10'];s.skills=['24:10'];
  const gear=g.State.addGear(1);g.State.wear(gear.key);const gold=s.goldPoint;
  assert.equal(g.State.useProp(13).ok,true);assert.equal(s.level,1);assert.equal(total(s),22);same(s.weapons,[]);same(s.skills,[]);
  assert.equal(s.gears.length,1);assert.equal(s.gears[0].used,false);assert.equal(s.props[23],9);assert.equal(s.props[13],1);
  g.State.gainExp(440);assert.equal(s.level,5);assert.equal(s.goldPoint,gold);
  s.level=50;const before=JSON.stringify(s);assert.equal(g.State.useProp(13).ok,false);assert.equal(JSON.stringify(s),before);
});

test('升级按原词典费用/卷轴/等级/成功率，装死和师父不升级，技能10封顶', () => {
  const g=setup(),s=g.s();s.level=50;s.goldPoint=10000;s.props[21]=999;s.props[22]=999;
  const rates=[100,100,100,70,60,40,25,15,10,100,8,5,4,3];
  for(let lv=1;lv<15;lv++) {
    s.weapons=['1:'+lv];const info=g.State.upgradeInfo('weapon',1);
    assert.equal(info.rate,rates[lv-1]);assert.equal(info.coin,lv===10?100:50);
    g.math.random=()=>rates[lv-1]/100-.00001;assert.equal(g.State.doUpgrade('weapon',1).ok,true);assert.equal(s.weapons[0],'1:'+(lv+1));
  }
  s.skills=['6:1','13:1','1:10','3:15'];
  for(const id of [6,13,1,3])assert.equal(g.State.doUpgrade('skill',id).ok,false);
  s.weapons=['1:4'];g.math.random=()=>.7;assert.equal(g.State.doUpgrade('weapon',1).ok,false);
  s.weapons=['1:1'];s.level=4;assert.equal(g.State.doUpgrade('weapon',1).ok,false);
  g.window.Debug={enabled:key=>['freeUpgrade','noUpgradeFail'].includes(key)};assert.equal(g.State.doUpgrade('weapon',1).ok,true);
});

test('被动初始值风驰2速/体壮5血，10级分别11速/77血，药剂价格和效果符合字典', () => {
  const g=setup(),s=g.s();s.skills=['3:1','4:1'];let stats=g.State.totalStats({useProps:false});
  assert.equal(stats.speed-s.speed,2);assert.equal(stats.hp-s.maxHp,5);
  s.skills=['3:10','4:10'];stats=g.State.totalStats({useProps:false});assert.equal(stats.speed-s.speed,11);assert.equal(stats.hp-s.maxHp,77);
  for(const [id,cost] of [[1,3],[2,5],[3,20],[4,20],[5,20],[7,20],[13,300],[23,20],[36,10],[39,10],[47,200]])assert.equal(+g.propMap.getValue(id).price,cost);
  s.energy=0;s.props[1]=1;s.props[2]=1;g.State.useProp(1);g.State.useProp(2);assert.equal(s.energy,40);
  s.power=10;s.props[3]=1;g.State.useProp(3);assert.equal(g.State.totalStats().power,15);assert.equal(g.State.totalStats({useProps:false}).power,10);assert.equal(s.propsStates[3],20);
  s.power=29;assert.equal(g.State.totalStats().power,34); // PPT FAQ: potion percentage uses floor.
});

test('同级AI基础成长预算一致，武技等级门槛及装备词条不越界且实际生效',()=>{
  const g=setup();g.s().level=70;
  for(const level of [1,2,4,5,10,20,30,49,50,53,65,70])for(let sample=0;sample<12;sample++){
    const foe=g.State.genAI(level,'',{levelJitter:0,gearSelfLevel:true}),base=foe.baseStats;
    const books=[53,59,65].filter(lv=>lv<=level).length;
    assert.equal(base.power+base.agility+base.speed+base.hp/5,22+(level-1)*4+books*4);
    assert.equal(foe.weapons.length+foe.skills.length,g.GData.wsLimit(level));
    for(const kind of ['weapon','skill'])for(const value of foe[kind==='weapon'?'weapons':'skills']){
      const [id,lv]=value.split(':').map(Number);assert.equal(g.GData.canLearn(kind,id,level),true);
      if(lv>1)assert.ok(+g.upgradeMap.getValue(lv-1).levelLimit<=level);
      if(kind==='skill'){assert.ok(lv<=10);if(id===6)assert.equal(lv,1);}
    }
    const expected={...base},effects={};const slots=new Set();
    for(const gear of foe.gears||[]){
      const info=g.State.gearInst(gear.id);assert.ok(info.useLevel<=level);assert.equal(slots.has(info.type),false);slots.add(info.type);
      assert.equal(gear.ext.length,info.quality>=3?2:info.quality===2?1:0);
      for(const ext of gear.ext){assert.ok(ext.level<=(info.quality===2?2:3));const amount=+g.attachmentMap.getValue(ext.id).ability.split(',')[ext.level-1];effects[ext.id]=Math.max(effects[ext.id]||0,amount);}
      expected[['agility','power','hp','speed'][info.type]]+=info.abilityVal;
    }
    for(const value of foe.skills){const[id,lv]=value.split(':').map(Number),attr={1:'power',2:'agility',3:'speed',4:'hp'}[id];if(attr)expected[attr]+=Math.round(g.GData.passiveBonus(id,lv)*(1+(effects[id+26]||0)/100));}
    for(const attr of ['power','agility','speed','hp'])assert.equal(foe[attr],expected[attr]);same(foe.effects,effects);
  }
});

test('新合成蓝装只有1条最高2星词条，已有高星蓝装旧档不被清空',()=>{
  const g=setup(),s=g.s();s.level=50;s.goldPoint=10000;s.props[26]=1000;g.math.random=()=>.999;
  for(let i=0;i<30;i++){const made=g.State.composeGear(26);assert.equal(made.ok,true);assert.equal(made.gear.ext.length,1);assert.equal(made.gear.ext[0].level,2);}
  const old=g.State.addGear(s.gears[0].id,[{id:1,level:3}]);g.State.load();assert.equal(g.s().gears.find(x=>x.key===old.key).ext[0].level,3);
});

test('关卡每次击败NPC都可能掉0–6片，白绿蓝按螳螂仙鹤熊猫，高星可越级，HP按攻略数值表', () => {
  const g=setup(),s=g.s();s.level=60;s.props[23]=99;
  // rng=0：掉率判定必过、数量取下限、普通档分支（<tierUp）成立
  g.math.random=()=>0;
  const FRAG=g.GData.STAGE_FRAGMENT, MIN=FRAG.min, MAX=FRAG.max;
  // 期望回到最初水平（掉率 45%~60% × 数量均值 3.5 ≈ 1.58~2.1 片/场），但数量区间仍比最初的 1~6 窄
  {
    const mean=(MIN+MAX)/2, sd=Math.sqrt((Math.pow(MAX-MIN+1,2)-1)/12);
    for(const star of [1,3,6]){
      const exp=g.GData.stageFragmentChance(star)*mean;
      assert.ok(exp>1.5&&exp<2.2,'★'+star+' 单场期望应回到 1.58~2.1，实际 '+exp.toFixed(2));
    }
    assert.ok(sd<1.5,'数量标准差不应回到 1~6 的水平，实际 '+sd.toFixed(2));
  }
  for(const id of [1,6,7,12,13,18]) {
    if(id>1)g.State.setStageProgress(id-1,{passed:true,npcIndex:3});
    const base=24+Math.floor((id-1)/6);
    const before=s.props[base]||0;
    for(let npc=1;npc<=3;npc++) {
      const start=g.State.beginStageBattle(id);assert.equal(start.ok,true);
      const rw=g.State.finishStageBattle(id,start.token,true);
      // 每一场胜利都可能掉碎片（不再只在最后一个NPC结算）
      assert.ok(rw.drop,'第'+npc+'个NPC胜利应可能掉碎片');
      assert.equal(rw.drop.id,base,'螳螂白/仙鹤绿/熊猫蓝');
      assert.ok(rw.drop.count>=MIN&&rw.drop.count<=MAX,'数量应落在'+MIN+'~'+MAX);
    }
    assert.equal(s.props[base],before+3*MIN,'三次胜利各掉下限片数');
  }
  // 越级掉落：★3-4 越 1 级、★5-6 越 2 级；★1-2 没有更高档可越。
  // 随机数序列 [0, 0.99, 0.5] —— 掉率判定 0 必过、越级判定 0.99≥0.72 成立、数量落在 1–6。
  {
    const runner=(id, expectUp)=>{
      if(id>1)g.State.setStageProgress(id-1,{passed:true,npcIndex:3});
      const base=24+Math.floor((id-1)/6), star=g.GData.stageStar(id);
      const seq=[0,0.99,0.5]; let i=0; g.math.random=()=>{ const v=seq[i++]; return v===undefined?0.5:v; };
      const beforeBase=s.props[base]||0, beforeUp=s.props[Math.min(base+expectUp,26)]||0;
      const start=g.State.beginStageBattle(id);assert.equal(start.ok,true);
      const rw=g.State.finishStageBattle(id,start.token,true);
      assert.ok(rw.drop,'★'+star+'关卡应掉碎片');
      assert.equal(rw.drop.id,base+(expectUp?expectUp:0),'★'+star+'越级数='+expectUp);
      assert.ok(rw.drop.count>=MIN&&rw.drop.count<=MAX,'数量应落在'+MIN+'~'+MAX);
      if(expectUp){
        assert.equal(s.props[base+expectUp],beforeUp+rw.drop.count,'碎片进了高一级口袋');
        assert.equal(s.props[base],beforeBase,'没有掉到低一级口袋');
      }else{
        assert.equal(s.props[base],beforeBase+rw.drop.count,'不掉级');
      }
    };
    runner(3,1);   // ★3 -> 越 1 级
    runner(6,2);   // ★6 -> 越 2 级
    runner(2,0);   // ★2 -> 不越级
  }
  // 关卡强度按「推荐等级模型」标定：血量/三维由推荐等级下的玩家均值推出
  // （螳螂 10-15、仙鹤 15-20、熊猫 20-25；见 GData.STAGE_ROLE_* 与 tools/stage-balance.cjs）
  assert.equal(g.GData.STAGE_USE_LEVEL_MODEL, true);
  for (const stage of [1, 6, 13, 18]) {
    const lv = g.GData.stageTargetLevel(stage);
    const hp = g.GData.stagePlayerHp(lv), st = g.GData.stagePlayerStat(lv);
    for (let i = 1; i <= 3; i++) {
      const npc = g.State.npcOf(stage, i);
      assert.equal(+npc.hp, Math.max(1, Math.round(hp * g.GData.STAGE_ROLE_HP[i - 1])), '关卡 ' + stage + ' 第' + i + '个血量');
      const three = g.GData.stageNpcStats(npc);
      const scale = g.GData.stageTypeScale(stage);
      assert.equal(three.power, Math.max(1, Math.round(st * g.GData.STAGE_ROLE_STAT[i - 1] * scale)), '关卡 ' + stage + ' 第' + i + '个力量');
      assert.ok(three.agility >= 1 && three.speed >= 1);
    }
  }
  // 推荐等级：螳螂 ★1-6 = 10-15、仙鹤 = 15-20、熊猫 = 20-25
  assert.equal(g.GData.stageTargetLevel(1), 10); assert.equal(g.GData.stageTargetLevel(6), 15);
  assert.equal(g.GData.stageTargetLevel(7), 15); assert.equal(g.GData.stageTargetLevel(12), 20);
  assert.equal(g.GData.stageTargetLevel(13), 20); assert.equal(g.GData.stageTargetLevel(18), 25);
  // 大侠要比拳师更耐打（boss 感），但三维不再是压倒性优势
  assert.ok(g.GData.STAGE_ROLE_HP[2] > g.GData.STAGE_ROLE_HP[1], '大侠血量倍率最高');
  assert.ok(g.GData.STAGE_ROLE_STAT[2] < g.GData.STAGE_ROLE_STAT[1] + 0.001, '大侠三围不再碾压拳师');
  // 攻略血量表仍是历史参考，没被删掉
  assert.equal(g.GData.STAGE_NPC_HP[5][2], 901);
  assert.equal(g.State.npcOf(4,1).name,'4星螳螂学徒');assert.equal(g.State.npcOf(10,1).name,'4星仙鹤学徒');
});

test('宝石合成：3个同级+10金，成功升级，失败扣费且可能降级或碎裂', () => {
  const g = setup(), s = g.s();
  s.props[101] = 2; assert.equal(g.State.mergeGems(101).ok, false);          // 数量不足
  s.props[101] = 3; s.goldPoint = 5; assert.equal(g.State.mergeGems(101).ok, false); // 金松果不足
  s.goldPoint = 100;
  g.math.random = () => 0.3;   // 0.3 < 60% 成功
  const ok = g.State.mergeGems(101);
  assert.equal(ok.success, true); assert.equal(s.props[102], 1); assert.equal(s.props[101], 0); assert.equal(s.goldPoint, 90);
  s.props[102] = 3;
  g.math.random = () => 0.9;   // 0.9 > 50% 失败，且 0.9 > 50% 不降级
  const keep = g.State.mergeGems(102);
  assert.equal(keep.success, false); assert.equal(s.props[102], 0); assert.equal(s.props[101], 0);
  s.props[102] = 3;
  const seq = [0.9, 0.3];      // 失败 + 降级
  g.math.random = () => seq.shift();
  const down = g.State.mergeGems(102);
  assert.equal(down.success, false); assert.equal(s.props[101], 1, '一颗材料降为1级');
  s.props[101] = 3;
  g.math.random = () => 0.9;   // 1级失败且降级 → 碎裂不退回
  g.State.mergeGems(101);
  assert.equal(s.props[101], 0); assert.equal(s.props[100], undefined);
  assert.equal(g.State.mergeGems(107).ok, false, '7级已是最高');
});

test('橙装：3件相同紫装融合为同名传说，宝石免费镶嵌、拆卸5金并退回', () => {
  const g = setup(), s = g.s(); s.level = 50; s.goldPoint = 200;
  const keys = [1, 2, 3].map(() => g.State.addGear(202, [{ id: 5, level: 2 }]).key);
  const fused = g.State.mergeGears(keys);
  assert.equal(fused.ok, true); assert.equal(fused.gear.orange, true); assert.equal(fused.gear.quality, 4);
  assert.equal(fused.gear.id, 202); assert.equal(fused.gear.ext[0].level, 2, '继承材料词条');
  assert.equal(g.State.mergeGems(101).ok, false);
  // 镶嵌
  s.props[103] = 1;
  const plain = g.State.addGear(1, []);
  assert.equal(g.State.socketGem(plain.key, 103).ok, false, '非橙装不能镶嵌');
  const before = g.State.totalStats({ useProps: false }).power;
  const sock = g.State.socketGem(fused.gear.key, 103);
  assert.equal(sock.ok, true); assert.equal(s.props[103], 0); assert.equal(s.goldPoint, 150, '镶嵌免费');
  g.State.wear(fused.gear.key);
  const after = g.State.totalStats({ useProps: false }).power;
  assert.equal(after, before + Math.round(25 * 1.12), '三级宝石主属性+12%');
  assert.equal(g.State.socketGem(fused.gear.key, 103).ok, false, '每件限1颗');
  s.goldPoint = 3; assert.equal(g.State.unsocketGem(fused.gear.key).ok, false, '拆卸需5金');
  s.goldPoint = 50;
  assert.equal(g.State.unsocketGem(fused.gear.key).ok, true); assert.equal(s.props[103], 1); assert.equal(s.goldPoint, 45);
  g.State.save(); g.State.load();
  assert.equal(g.s().gears.find(x => x.key === plain.key).orange, undefined, '普通装备无橙装标记');
});

test('宝石掉落需45级，关卡通关20%、1级75%/2级25%', () => {
  const g = setup(), s = g.s();
  s.level = 44; g.math.random = () => 0;
  assert.equal(g.State.rollGemDrop(100), null, '44级不掉');
  s.level = 45; g.math.random = () => 0;
  const g1 = g.State.rollGemDrop(100); assert.equal(g1.id, 102, '低随机值给2级');
  g.math.random = () => 0.9;
  const g2 = g.State.rollGemDrop(100); assert.equal(g2.id, 101, '高随机值给1级');
});

let failed=0;
for(const [name,run] of tests){try{run();console.log('PASS',name);}catch(error){failed++;console.error('FAIL',name,error.stack);}}
console.log(`${tests.length-failed}/${tests.length} balance tests passed`);process.exitCode=failed?1:0;
