# -*- coding: utf-8 -*-
"""tower.js 结构重构：纯代码块搬移 + 分节横幅 + 目录。
所有块都是 IIFE 内的 function/const 声明，提升规则保证搬移不影响运行；
锚点唯一性全部断言，任何一处对不上就整体失败、不写盘。"""
import io, sys

PATH = 'js/tower.js'
src = io.open(PATH, encoding='utf-8').read()

def once(anchor):
    n = src.count(anchor)
    assert n == 1, f'锚点不唯一({n}): {anchor[:60]}'
    return src.index(anchor)

def banner(no, title):
    return ('  /* ============================================================\n'
            f'   * 【{no}】{title}\n'
            '   * ============================================================ */\n')

# ---------- 1) 切出要搬移的块 ----------
M1 = '  /* ============================================================\n   * 计分：所有加分都走这里，顺带记录「本局成就」流水（供界面飘提示与结算展示）\n   * ============================================================ */\n'
M1_END = '  /** 手上有没有重新挑战币（以及有没有可用的快照）。 */'
M2 = '  /* ============================================================\n   * 秘技通神（C33）能抽中的「特殊技能」—— 玩家没学也会进候选，选中即领悟。'
M2_END = '  /** 战斗奖励的稀有度倾斜：按「花了这么多币刷新后」的商店水平取。'
M3 = '  /** 永久增益槽位数：基础 5 + 扩容类 buff 给的名额。 */'
M3_END = '  /** 需求 3：易碎烙印的损毁判定（每场战斗一次，默认 6%）。'
M4 = '  /** 选取型 buff 的三选一候选：从玩家已有的武器/技能里随机挑最多 3 个。 */'
M5_END = '  /** 卖出价：名贵手表这类有固定 sellValue 的按固定值，其它按商店价 40%。'

spans = []          # (start, end, tag)
def cut(start_anchor, end_anchor, tag):
    a, b = once(start_anchor), once(end_anchor)
    assert a < b, tag
    spans.append((a, b, tag))

cut(M1, M1_END, 'T10-计分')        # 978–1046 计分/成就
cut(M2, M2_END, 'T16-选取型常量')   # 1819–1846
cut(M4, M3, 'T16-选取型函数')       # 2556–2657
cut(M3, M3_END, 'T5-状态口径')      # 2658–2838
cut(M3_END, M5_END, 'T14-烙印判定') # 2839–2952 rollFragileBuffs + resetGrowth
spans.sort(reverse=True)
blocks = {}
for a, b, tag in spans:
    blocks[tag] = src[a:b]
    src = src[:a] + src[b:]

# ---------- 2) 块内小修：permUsed 的说明注释归位 ----------
m3 = blocks['T5-状态口径']
mis = ('  /** 本轮第 1 项：**实际占用**的永久槽位数 = 拥有数 − 被「虚空铭文」附魔免占位的数量。\n'
       '   *  槽位判断、面板计数、C34「空槽换攻击」全部走这里，避免三处各算一套。 */\n')
assert m3.count(mis) == 1
m3 = m3.replace(mis, '')
anchor_permused = '  function permUsed(run) {'
assert m3.count(anchor_permused) == 1
m3 = m3.replace(anchor_permused, mis + anchor_permused)
blocks['T5-状态口径'] = m3

# ---------- 3) 重新插入 ----------
def insert_before(anchor, text):
    global src
    i = once(anchor)
    src = src[:i] + text + src[i:]

# T10 计分块 → 战斗结算之后、环境词缀之前（旧小横幅换成 T10 大横幅）
t10 = blocks['T10-计分']
assert t10.startswith(M1[:60])
t10 = t10.replace(M1, banner('T10', '计分与隐藏成就 —— addScore / markAchievement / checkStatAchievements\n   * 所有加分都走这里，顺带记录「本局成就」流水（供界面飘提示与结算展示）。'), 1)
insert_before('  // ---------- 环境词缀（无尽塔）----------', t10)

# T5 状态口径 → buff 聚合之后、敌人构建之前
insert_before('  // ---------- 敌人构建 ----------',
    banner('T5', '对局状态口径：血量 · 槽位 · 计数\n   * 血量是绝对值口径（hpAbs），槽位按「实际占用」计（permUsed），\n   * 「累计获得过几份」与「现在还剩几份」是两个口径（obtainedCountOf vs buffCountOf）。')
    + blocks['T5-状态口径'])

# T14 后半：rollFragileBuffs + resetGrowth 接在 fragileRoll 之后
insert_before('  /** 「获得这个增益时」立刻要结算的东西（新增与叠加两条路径都要走）。',
    blocks['T14-烙印判定'])

# T14 横幅加在 fragile 块开头
insert_before('  /** 需求 3：烙印加成的实际生效值 = 基础 × 0.5（未损毁）+ 已损毁的永久份。',
    banner('T14', '易碎烙印：生效 · 损毁 · 作废 —— fragileBonus / rollFragileBuffs / loseRandomBrokenMark'))

# T15 横幅加在 applyBuffOnAcquire 开头
insert_before('  /** 「获得这个增益时」立刻要结算的东西（新增与叠加两条路径都要走）。',
    banner('T15', '增益的获得 / 失去 / 即时生效 —— addBuff / applyInstant / toggleLimited'))

# T16 选取型 = 常量块 + 函数块，插到商店之前
insert_before('  // ---------- 无尽：试炼币商店 ----------',
    banner('T16', '选取型强化：武器 / 技能 / 虚空铭文 —— pickCandidates / applyPickBuff')
    + blocks['T16-选取型常量'] + blocks['T16-选取型函数'])

# ---------- 4) 既有小节标记统一成编号横幅 ----------
marks = [
    ('  // ---------- 存档 ----------', 'T1', '存档与对局归一化 —— S.tower / S.endless / normalizeRun'),
    ('  // ---------- 解锁 ----------', 'T2', '解锁条件 —— unlocked'),
    ('  // ---------- 层结构 ----------', 'T3', '层结构与敌人预告 —— buildPlan / preview / planInfo'),
    ('  // ---------- buff 聚合 ----------', 'T4', '增益聚合与效果汇总 —— aggregate / buffEffectLines\n   * 结算顺序锁定（见文档 6.5）：基础 → 叠层累积 → C15 全局乘区。'),
    ('  // ---------- 敌人构建 ----------', 'T6', '敌人构建 —— buildFoe / regionOf'),
    ('  // ---------- 开局 ----------', 'T7', '开局：发起对局 —— startTowerRun / startEndlessRun'),
    ('  // ---------- 战斗调度 ----------', 'T8', '战斗调度 —— nextBattle / retryBattle / interruptBattle'),
    ('  // ---------- 战斗结算 ----------', 'T9', '战斗结算 —— reportBattle / 失败与弃权结算'),
    ('  // ---------- 环境词缀（无尽塔）----------', 'T11', '环境词缀（无尽塔） —— rollEnvAfterBattle / applyEnvTo'),
    ('  // ---------- 层通关 ----------', 'T12', '层通关与推进 —— layerClear / advanceLayer'),
    ('  // ---------- 场间 4 选 1 ----------', 'T13', '场间抉择：增益 4 选 1 —— rollChoices / pickChoice'),
    ('  // ---------- 无尽：试炼币商店 ----------', 'T17', '无尽：试炼币商店 —— makeShop / buyShopSlot / sellBuff / rerollShop'),
    ('  // ---------- 无尽：结算点 ----------', 'T18', '无尽：结算点与永久牺牲 —— checkpointInfo / sacrificePerm'),
    ('  // ---------- 放弃 ----------', 'T19', '放弃与认输 —— abandon'),
    ('  // ---------- 展示用信息 ----------', 'T20', '界面展示信息 —— towerInfo / endlessInfo / ownedBuffs'),
]
for old, no, title in marks:
    assert src.count(old) == 1, old
    src = src.replace(old, banner(no, title), 1)

insert_before('  window.Tower = {', banner('T21', '模块导出 —— window.Tower（界面与测试的入口面）'))

# ---------- 5) 头部注释加目录 ----------
old_head = '''/* ============================================================
 * tower.js — 无尽挑战塔 · 主塔 + 无尽模式状态机
 * 依据 docs/无尽挑战塔系统设计文档.md v2.0。
 *
 * 存档字段（normalizeSave 浅校验，这里深校验）：'''
new_head = '''/* ============================================================
 * tower.js — 无尽挑战塔 · 主塔 + 无尽模式状态机
 * 依据 docs/无尽挑战塔系统设计文档.md v2.0。
 *
 * 目录（Ctrl+F 搜「【T编号】」直达；全部是一个 IIFE 里的函数/常量声明，
 * 函数声明提升 + 运行期才取值，因此分节顺序不影响运行）：
 *   【T1】存档与对局归一化      【T8】战斗调度            【T15】增益的获得/失去/即时生效
 *   【T2】解锁条件              【T9】战斗结算            【T16】选取型强化：武器/技能/虚空铭文
 *   【T3】层结构与敌人预告      【T10】计分与隐藏成就     【T17】无尽：试炼币商店
 *   【T4】增益聚合与效果汇总    【T11】环境词缀（无尽塔） 【T18】无尽：结算点与永久牺牲
 *   【T5】对局状态口径          【T12】层通关与推进       【T19】放弃与认输
 *   【T6】敌人构建              【T13】场间抉择：4 选 1   【T20】界面展示信息
 *   【T7】开局：发起对局        【T14】易碎烙印           【T21】模块导出 window.Tower
 *
 * 存档字段（normalizeSave 浅校验，这里深校验）：'''
assert src.count(old_head) == 1
src = src.replace(old_head, new_head, 1)

io.open(PATH, 'w', encoding='utf-8', newline='').write(src)
print('OK, new length =', len(src.splitlines()), 'lines')
