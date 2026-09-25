/* Developer QA fixture, loaded only by tools/qa.html.
 * Every page load resets ssdz_test_save_v1. The normal save is never read or written.
 * Default: level 50 狂战测试 with the original level-50 set 201–204 equipped.
 * ?outfit=none: level 34 怀旧测试 with all equipment kept in the bag.
 */
(function () {
  'use strict';
  const query = new URLSearchParams(location.search);
  if (query.get('qa') !== '1' || State.saveKey !== 'ssdz_test_save_v1') {
    throw new Error('QA fixture requires qa=1 and the isolated test save key.');
  }
  const noOutfit = query.get('outfit') === 'none';
  const referenceOutfit = query.get('outfit') === 'reference';
  const originalLoad = State.load;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  window.QA_FIXTURE = Object.freeze({ testOnly: true, resetOnReload: true, saveKey: State.saveKey, outfit: referenceOutfit ? '经典忍者混装' : noOutfit ? 'none' : '狂战套装', dropRandom: () => 0 });

  function seed() {
    State.newGame(noOutfit ? '怀旧测试' : '狂战测试');
    const s = State.state();
    Object.assign(s, {
      level: noOutfit ? 34 : 50, exp: noOutfit ? 2535 : 5600,
      power: noOutfit ? 43 : 62, agility: noOutfit ? 41 : 59, speed: noOutfit ? 39 : 56,
      maxHp: noOutfit ? 330 : 480, energy: 180, maxEnergy: 180,
      goldPoint: 19980, goldCup: 42, integral: 1580,
      weapons: Array.from({ length: 17 }, (_, i) => (i + 1) + ':1'),
      skills: [...Array.from({ length: 18 }, (_, i) => i + 1), 23, 24].map((id) => id + ':1'),
      props: {
        1: 12, 2: 6, 3: 8, 4: 8, 5: 8, 7: 5,
        10: 3, 11: 3, 12: 3, 13: 1, 21: 120, 22: 120, 23: 40,
        24: 60, 25: 50, 26: 40, 28: 1, 29: 1, 30: 1, 31: 1, 32: 1,
        36: 5, 37: 2, 38: 3, 39: 6, 41: 4, 42: 4, 43: 4, 44: 3,
        45: 10, 46: 10, 47: 2, 48: 2, 49: 1, 50: 10,
      },
      propsStates: {}, gears: [], wears: {},
      stages: { 1: { npcIndex: 3, passed: true }, 2: { npcIndex: 2, passed: false } },
      dailyWins: 1, dailyFails: 1, allWins: 1, allFails: 1,
      dailyStatsDate: State.localDate(), dailyClaimDate: '',
      lotteryDate: State.localDate(), lotteryFree: 1,
      joinRankCount: 0, woodRecord: 1250, reborn: 0, master: null, prentices: [], battles: [],
      lastEnergyTs: Date.now(),
    });
    // Real item APIs preserve original requirements, bonuses and attachment rules.
    for (const [index, id] of [201, 202, 203, 204].entries()) {
      const gear = State.addGear(id, [{ id: index + 5, level: 1 }]);
      if (!gear) throw new Error('Missing QA gear definition: ' + id);
      if (!noOutfit && !referenceOutfit && !State.wear(gear.key)) throw new Error('Could not equip QA gear: ' + id);
    }
    // Three matching, unequipped blue items let the fusion screen be exercised.
    for (let i = 0; i < 3; i++) State.addGear(21, [{ id: 1, level: 1 }]);
    // Reference comparison only: exact pictured learned/locked cards and outfit.
    if (referenceOutfit) {
      s.name='参考图测试';s.level=34;s.exp=2535;
      s.weapons=['1:8','5:8','7:8','8:8','9:8','15:8'];
      s.skills=['2:9','3:8','4:8','7:4','9:9','13:1','15:8','16:1','18:7'];
      for (const id of [17,14,19,20]) { const gear=State.addGear(id,[]); State.wear(gear.key); }
    }

    const stats = State.totalStats({ useProps: false });
    const me = {
      name: s.name, level: s.level, power: stats.power, agility: stats.agility, speed: stats.speed, hp: stats.hp,
      weapons: State.myWeapons().map((item) => ({ id: item.id, level: item.level, harmLo: item.harmLo, harmHi: item.harmHi })),
      skills: State.mySkills().map((item) => ({ id: item.id, level: item.level })),
      wears: Engine.wearsFor(State.myGears().filter((item) => item.used)),
      effects: State.equipmentEffects(), npcType: null,
    };
    const foe = { name: '松果小侠', level: s.level, power: 46, agility: 42, speed: 39, hp: 320, weapons: [{ id: 3, level: 1 }], skills: [], npcType: null };
    const victory = {
      winner: 0, maxHp: [me.hp, foe.hp], names: [me.name, foe.name], rounds: [
        { attacker: 1, action: 'common', dmg: 15, hpAfter: [me.hp - 15, foe.hp] },
        { attacker: 0, action: 'weapon', id: 3, level: 1, dmg: foe.hp, hpAfter: [me.hp - 15, 0] },
      ],
    };
    const defeat = {
      winner: 1, maxHp: [me.hp, foe.hp], names: [me.name, '森林拳王'], rounds: [
        { attacker: 0, action: 'common', dmg: 26, hpAfter: [me.hp, foe.hp - 26] },
        { attacker: 1, action: 'common', dmg: me.hp, crit: true, hpAfter: [0, foe.hp - 26] },
      ],
    };
    State.recordBattle({ me: clone(me), foe: clone(foe), region: 0, kind: 'challenge', result: victory });
    State.recordBattle({ me: clone(me), foe: { ...clone(foe), name: '森林拳王' }, region: 3, kind: 'challenge', result: defeat });
    s.battles[0].createdAt = Date.now() - 8 * 60 * 1000;
    s.battles[1].createdAt = Date.now() - 22 * 60 * 1000;
    State.save();
  }

  State.load = function loadQaFixtureOnce() {
    State.load = originalLoad;
    seed();
    const loaded = originalLoad();
    if (!loaded) throw new Error('QA fixture could not be saved and loaded.');
    const label = document.getElementById('qa-label');
    if (label) label.textContent = 'QA · ' + State.state().name + ' Lv.' + State.state().level + ' · 独立存档 / 刷新重置';
    return loaded;
  };
})();
