# -*- coding: utf-8 -*-
"""tower-ui.js / tower-data.js：统一分节横幅 + 头部目录（纯注释级改动，不搬代码）。"""
import io

def banner(no, title):
    return ('  /* ============================================================\n'
            f'   * 【{no}】{title}\n'
            '   * ============================================================ */\n')

def apply(path, repls, inserts, head_old, head_new):
    src = io.open(path, encoding='utf-8').read()
    for old, no, title in repls:
        assert src.count(old) == 1, (path, old)
        src = src.replace(old, banner(no, title), 1)
    for anchor, no, title in inserts:
        assert src.count(anchor) == 1, (path, anchor)
        src = src.replace(anchor, banner(no, title) + anchor, 1)
    assert src.count(head_old) == 1, (path, 'head')
    src = src.replace(head_old, head_new, 1)
    io.open(path, 'w', encoding='utf-8', newline='').write(src)
    print('OK', path, len(src.splitlines()), 'lines')

# ================= tower-ui.js =================
ui_repls = [
    ('  // ---------- 通用小件 ----------', 'U2', '通用小件 —— 血条 / 悬停提示 / 弹窗封装 / 环境词缀胶囊'),
    ('  // ---------- 主塔 ----------', 'U6', '主塔页面 —— openTower'),
    ('  // ---------- 无尽 ----------', 'U7', '无尽页面 —— openEndless'),
    ('  // ---------- 战斗闭环 ----------', 'U8', '战斗闭环 —— fight / winModal / afterBattle'),
    ('  // ---------- 场间 4 选 1 ----------', 'U9', '场间抉择弹窗（4 选 1） —— offerChoice / choiceCard'),
    ('  // ---------- 主塔结算 ----------', 'U10', '主塔结算 —— towerClear / towerDefeat'),
    ('  // ---------- 无尽：试炼币商店 ----------', 'U14', '无尽：试炼币商店 —— openShop'),
    ('  // ---------- 无尽：20 起每 10 层「放弃一个永久增益」 ----------', 'U15', '无尽：永久牺牲（20 起每 10 层放弃一个永久增益） —— openPermSacrifice'),
    ('  // ---------- 无尽：结算点 ----------', 'U16', '无尽：结算点与结算 —— openCheckpoint / settleResult'),
]
ui_ins = [
    ('  const C = () => UI.classic;', 'U1', '基础助手 —— DOM 助手 / 飘字提示 / 排序'),
    ('  /* ---------- 对手头像（第 1 项） ----------', 'U3', '对手头像与立绘 —— foePortraitHtml / fillFoeArt'),
    ('  function buffTag(b, stacks) {', 'U4', '增益面板与货币条 —— buffPanelsHtml / currencyHtml'),
    ('  function buffCatalogHtml() {', 'U5', '入口图鉴与塔身可视化 —— buffCatalogHtml / towerVisual / planHtml'),
    ('  function openPickBuff(pending) {', 'U11', '选取型强化弹窗 —— openPickBuff'),
    ('  const RARITY_SHORT = [', 'U12', '永久增益「满了换一个」 —— offerPermanentReplace / offerReplace'),
    ('  function milestoneModal(rw, next) {', 'U13', '无尽：里程碑 · 重试 · 战败结算 —— milestoneModal / endlessDefeat'),
    ('  window.TowerUI = {', 'U17', '模块导出 —— window.TowerUI'),
]
ui_head_old = '''/* ============================================================
 * tower-ui.js — 无尽挑战塔界面（经典 UI 壳内）
 * 入口在「关卡」页下滑；主塔/无尽两个页面都在这里。
 * 爬塔可视化：左侧塔身楼层条 + 右侧当层对手预告/构筑。
 * ============================================================ */'''
ui_head_new = '''/* ============================================================
 * tower-ui.js — 无尽挑战塔界面（经典 UI 壳内）
 * 入口在「关卡」页下滑；主塔/无尽两个页面都在这里。
 * 爬塔可视化：左侧塔身楼层条 + 右侧当层对手预告/构筑。
 *
 * 目录（Ctrl+F 搜「【U编号】」直达）：
 *   【U1】基础助手              【U7】无尽页面            【U13】无尽：里程碑·重试·战败结算
 *   【U2】通用小件              【U8】战斗闭环            【U14】无尽：试炼币商店
 *   【U3】对手头像与立绘        【U9】场间抉择弹窗        【U15】无尽：永久牺牲
 *   【U4】增益面板与货币条      【U10】主塔结算           【U16】无尽：结算点与结算
 *   【U5】入口图鉴与塔身可视化  【U11】选取型强化弹窗     【U17】模块导出 window.TowerUI
 *                               【U12】永久增益替换
 * ============================================================ */'''
apply('js/tower-ui.js', ui_repls, ui_ins, ui_head_old, ui_head_new)

# ================= tower-data.js =================
d_repls = [
    ('  // ---------- 主塔公式 ----------', 'D1', '主塔公式 —— towerLevel / towerMult / towerGold'),
    ('  // ---------- 无尽公式 ----------', 'D2', '无尽公式 —— endlessLevel / endlessMult / 深层曲线 / 环境词缀数值'),
    ('  // ---------- 计分 ----------', 'D3', '计分 —— SCORE / buffScore / reviveScoreAt'),
    ('  // ---------- 试炼币与商店（无尽局内经济，跨局不继承） ----------', 'D4', '试炼币与商店（无尽局内经济，跨局不继承） —— SHOP / 刷新定价与倾斜'),
    ('  // ---------- 敌方数值系数（v2.2：高血低攻） ----------', 'D5', '敌方数值系数（v2.2：高血低攻） —— FOE_* / bossHpRatio'),
    ('  // ---------- NPC 池（10 个，8 类机制） ----------', 'D6', 'NPC 池（10 个，8 类机制） —— NPCS / NPC_BY_ID'),
    ('  // ---------- 三侠的「贯穿本层」削弱 ----------', 'D7', '三侠的「贯穿本层」削弱 —— HERO_DEBUFF'),
    ('  // ---------- 松鼠形态的固定装备（视觉记忆） ----------', 'D8', '松鼠装备与套装分层 —— GEAR / GEAR_TIER / gearKeyForLayer'),
    ('  // ---------- 松鼠对手（随机 boss 池成员之一） ----------', 'D9', '松鼠对手（随机 boss 池成员之一） —— SQUIRRELS'),
    ('  // ---------- 带机制的松鼠 boss（随机 boss 池的核心 7 个） ----------', 'D10', '带机制的松鼠 boss（随机 boss 池的核心 7 个） —— TRIALS'),
    ('  // ---------- x10 层最后一场：固定狂战松鼠 ----------', 'D11', 'x10 层守关：固定狂战松鼠 —— WARLORD_POOL / warlordFor'),
    ('  // ---------- 随机 boss 池（每层第 4 场） ----------', 'D12', '随机 boss 池与三侠顺序 —— bossFor / heroOrder'),
    ('  // ---------- Buff 池 ----------', 'D13', 'Buff 池 —— BUFFS 全表（稀有度 / 叠层 / mods 都在这里定义）'),
]
d_ins = [
    ('  const BUFF_BY_ID = Object.fromEntries(BUFFS.map((b) => [b.id, b]));', 'D14', 'Buff 索引与杂项常量 —— BUFF_BY_ID / 稀有度权重 / 回血比例 / 里程碑'),
    ('  /* ============================================================\n   * 增益池：**显式池子归属**（需求：严格规范 tag，挑战塔与无尽塔是两个池子）', 'D15', '增益池注册 —— 显式池子归属 / 加载期断言（挑战塔与无尽塔互斥）'),
    ('  window.TowerData = {', 'D16', '模块导出 —— window.TowerData'),
]
d_head_old = '''/* ============================================================
 * tower-data.js — 无尽挑战塔 · 数值与池子定义（纯数据）
 * 依据 docs/无尽挑战塔系统设计文档.md v2.0。'''
d_head_new = '''/* ============================================================
 * tower-data.js — 无尽挑战塔 · 数值与池子定义（纯数据）
 * 依据 docs/无尽挑战塔系统设计文档.md v2.0。
 *
 * 目录（Ctrl+F 搜「【D编号】」直达）：
 *   【D1】主塔公式        【D6】NPC 池            【D11】x10 层守关：狂战松鼠
 *   【D2】无尽公式        【D7】三侠贯穿削弱      【D12】随机 boss 池与三侠顺序
 *   【D3】计分            【D8】松鼠装备分层      【D13】Buff 池（全表）
 *   【D4】试炼币与商店    【D9】松鼠对手          【D14】Buff 索引与杂项常量
 *   【D5】敌方数值系数    【D10】机制松鼠 boss    【D15】增益池注册（含加载期断言）
 *                                                 【D16】模块导出 window.TowerData'''
apply('js/tower-data.js', d_repls, d_ins, d_head_old, d_head_new)

# 导出表去重：RARITY_NAME / RARITY_WEIGHTS 出现了两次（保留第一次）
src = io.open('js/tower-data.js', encoding='utf-8').read()
dup = '''    TOWER_BATTLE_IDS,
    BUFFS, BUFF_BY_ID, RARITY_NAME, RARITY_WEIGHTS, FIXED_HEAL_PCT, AUTO_HEAL_PCT, STACK_MAX,'''
fixed = '''    TOWER_BATTLE_IDS,
    /* RARITY_NAME / RARITY_WEIGHTS 已在上面【商店】一行导出过一次，这里不再重复。 */
    BUFFS, BUFF_BY_ID, FIXED_HEAL_PCT, AUTO_HEAL_PCT, STACK_MAX,'''
assert src.count(dup) == 1
src = src.replace(dup, fixed, 1)
io.open('js/tower-data.js', 'w', encoding='utf-8', newline='').write(src)
print('OK dedup window.TowerData exports')
