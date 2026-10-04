# -*- coding: utf-8 -*-
"""给 js/ 下各模块插入编号分节横幅 + 文件头目录（纯插入，不删不改任何已有行）。

用法：python tools/refactor-module-banners.py [--check]
  --check 只校验锚点唯一性，不写文件。

设计约束：
  - 测试（tools/test-*.cjs）按文本锚点切源码，已有注释/代码一律不动；
  - 横幅插在锚点行**上方**，沿用锚点行的缩进；
  - 目录插在文件头注释块之后。
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# file -> (dir_title, [(anchor, code, title), ...])
# anchor 必须是文件里**唯一**的子串；横幅插在该行上方。
CONFIG = {
    'js/state.js': ('玩家状态 / 存档 / 养成系统', [
        ("  const testMode = typeof location", 'S1', '基础：存档键 / 调试开关判定 / 新开局'),
        ("  // ---------- 师徒系统 ----------", 'S2', '师徒系统（拜师/收徒/日供）'),
        ("  // ---------- 存档 ----------", 'S3', '存档：读写 / 校验 / 版本迁移'),
        ("  // ---------- 体力", 'S4', '体力（5 分钟回 1 点）'),
        ("  // ---------- 武器/技能实例", 'S5', '武器/技能实例（含等级换算）'),
        ("  // ---------- 升级武器/技能", 'S6', '升级武器/技能（成功率/费用/失败保护）'),
        ("  /* ---------- 真·武器 / 真·技能", 'S7', '真·武器 / 真·技能（终局线 11~15 级）'),
        ("  // ---------- 装备 ----------", 'S8', '装备：穿戴/出售/融合/星标'),
        ("  // ---------- 宝石", 'S9', '宝石（45 级开启，镶嵌/拆卸）'),
        ("  // ---------- 属性合计", 'S10', '属性合计（基础+装备+药剂）'),
        ("  // ---------- 道具 ----------", 'S11', '道具：使用/出售/合成'),
        ("  /* ---------- 天使果实 / 恶魔果实", 'S12', '天使果实 / 恶魔果实（随机三选一）'),
        ("  // ---------- 自由属性点", 'S13', '自由属性点（升级自选，失衡代选）'),
        ("  // ---------- 每日收益流水", 'S14', '每日收益流水（徒弟日供数据源）'),
        ("  // ---------- 经验 / 升级 ----------", 'S15', '经验 / 升级'),
        ("  // ---------- 战斗后结算", 'S16', '战斗后结算（挑战玩家）'),
        ("  // ---------- 超级松鼠", 'S17', '超级松鼠（原版 VIP）'),
        ("  // ---------- 好友", 'S18', '好友（离线版 NPC 好友）'),
        ("  /* ---------- 复仇", 'S19', '复仇（消息页复仇标签）'),
        ("  // ---------- AI 玩家生成 ----------", 'S20', 'AI 玩家生成'),
        ("  // ---------- 关卡 ----------", 'S21', '关卡（进度/星级/扫荡）'),
        ("  // ---------- 每日任务 ----------", 'S22', '每日任务'),
        ("  window.State = {", 'S23', '导出 window.State'),
    ]),
    'js/ui.js': ('界面层（legacy）：HUD / 面板 / 菜单', [
        ("  function $(sel) { return document.querySelector(sel); }", 'UI1', 'DOM 小件（$/el/esc）'),
        ("  // ---------- 图标", 'UI2', '图标（图集帧 → 小 canvas / dataURL）'),
        ("  // ---------- 主界面 HUD", 'UI3', '主界面 HUD（canvas）'),
        ("  // ---------- 面板框架 ----------", 'UI4', '面板框架'),
        ("  // ---------- 菜单动作表", 'UI5', '菜单动作表（HUD 点击 → 面板）'),
        ("  // ---------- 挑战", 'UI6', '挑战（PVP vs AI）'),
        ("  // ---------- 关卡 ----------", 'UI7', '关卡'),
        ("  // ---------- 竞技场 ----------", 'UI8', '竞技场'),
        ("  // ---------- 天梯赛 ----------", 'UI9', '天梯赛'),
        ("  // ---------- 武器 / 技能 ----------", 'UI10', '武器 / 技能'),
        ("  // ---------- 背包 ----------", 'UI11', '背包'),
        ("  // ---------- 装备 ----------", 'UI12', '装备'),
        ("  // ---------- 商店 ----------", 'UI13', '商店'),
        ("  // ---------- 抽奖 ----------", 'UI14', '抽奖'),
        ("  // ---------- 师徒 ----------", 'UI15', '师徒'),
        ("  // ---------- 帮助 ----------", 'UI16', '帮助'),
        ("  window.UI = {", 'UI17', '导出 window.UI'),
    ]),
    'js/classic-ui.js': ('经典 UC 界面（主界面/背包/装备/挑战/关卡/同步）', [
        ("  const BUFF_PROPS = ", 'UC1', '基础小件：esc / VIP 徽标 / 事件绑定 / 贴图'),
        ("  const NUM_SHEET = 'images/num_28.png'", 'UC2', '位图数字（原版数字贴图渲染）'),
        ("  function atlasIcon(kind, id, locked, trueForm) {", 'UC3', '图标与属性 HTML'),
        ("  function home() { Main.showHome(); }", 'UC4', '页面骨架：tabs / page / modal / notice / toast'),
        ("  function ssdzSizeText(n) {", 'UC5', '存档列表弹窗'),
        ("  function renderHome() {", 'UC6', '主界面首页（canvas 渲染 + 松鼠画像）'),
        ("  function openStatus() {", 'UC7', '状态页与图鉴'),
        ("  function genOpponents() {", 'UC8', '挑战（PVP vs AI）'),
        ("  function stageUpsHtml(ups) {", 'UC9', '关卡（含挑战塔/无尽塔入口）'),
        ("  function openBag(shop,pg) {", 'UC10', '背包与道具（含出售/果实三选一）'),
        ("  function fruitChoiceDialog(r) {", 'UC11', '果实三选一 / 属性分配 / 升级选择'),
        ("  function gearImg(g) {", 'UC12', '装备：列表/详情/出售/镶嵌/融合入口'),
        ("  function canRevenge(r) {", 'UC13', '消息 / 复仇 / 好友 / 聊天'),
        ("  function openDaily() {", 'UC14', '每日（礼包/任务）与存档面板'),
        ("  function pickJsonFile() {", 'UC15', '存档导入（JSON 文件）'),
        ("  async function syncFetch(pathname, opts) {", 'UC16', '云同步（上传/下载/进度）'),
        ("  function openSystem() {", 'UC17', '系统设置 / 村庄 / 攻略'),
        ("  function fallback(key){", 'UC18', '兜底分发与导出 UI.classic'),
    ]),
    'js/classic-extras.js': ('经典 UC 扩展界面（竞技场/天梯/抽奖/师徒/排行/VIP）', [
        ("  const ARENA_EXP = [150, 75, 45, 0];", 'EX1', '竞技场（门票/战斗/结算）'),
        ("  const RANK_LEVEL_BASE = 30", 'EX2', '天梯赛（匹配/积分/商店）'),
        ("  const NORMAL_PILLS = [3, 4, 5, 7];", 'EX3', '抽奖'),
        ("  // ==================== ", 'EX4', '师徒系统'),
        ("  const RANK_LEVEL = 30;   // 原版天梯赛 30 级开启", 'EX5', '排行榜（固定种子模拟榜）'),
        ("  const VIP_PRIVILEGES = [", 'EX6', '超级松鼠（VIP）'),
        ("  window.ClassicExtras = {", 'EX7', '导出 window.ClassicExtras'),
    ]),
    'js/sim.js': ('战斗模拟器（回合事件流）', [
        ("  function R(lo, hi) {", 'SM1', '随机小件与规则表 RULES'),
        ("  function makeCombatant(f, side) {", 'SM2', '参战者构建（含塔机制注入字段）'),
        ("  function reflectImmune(c) {", 'SM3', '状态修正与属性工具'),
        ("  const UNUSED_WEIGHT = 100;", 'SM4', '出手权重与武器/技能选取'),
        ("  function dodgeChance(att, def) {", 'SM5', '闪避 / 暴击 / 被动加成'),
        ("  function dmgReduce(def, dmg, opts) {", 'SM6', '减伤链（护盾/绝对防御/减伤）'),
        ("  function simulate(f0, f1, options) {", 'SM7', '主模拟循环 simulate'),
        ("  window.Sim = {", 'SM8', '导出 window.Sim'),
    ]),
    'js/battle.js': ('战斗播放器（按回合事件流驱动动画）', [
        ("  const W = 1170, H = 690, FPS = 20;", 'BT1', '常量与素材表（图集/特效/命中帧）'),
        ("  function makeAvatar(npcType) {", 'BT2', 'NPC 头像与动画名映射'),
        ("  async function run(opts) {", 'BT3', '战斗播放主流程 run'),
        ("  window.Battle = { run,", 'BT4', '导出 window.Battle'),
    ]),
    'js/gamedata.js': ('复刻版游戏常量（经验/关卡/终局数值）', [
        ("  const EXP_TABLE = [", 'GD1', '经验表与学习限制'),
        ("  const STAGE_TYPES = [", 'GD2', '关卡数值（类型/血量/经验/碎片）'),
        ("  /* ---------- 真·武器 / 真·技能", 'GD3', '真·武器 / 真·技能（终局线）'),
        ("  window.GData = {", 'GD4', '导出 window.GData'),
    ]),
    'js/engine.js': ('素材加载与原版动画播放器', [
        ("  // ---------- 帧表工具", 'EN1', '帧表工具（兼容两种帧表格式）'),
        ("  // ---------- 图片路径表", 'EN2', '图片路径表'),
        ("  // ---------- 图片加载 ----------", 'EN3', '图片加载'),
        ("  // ---------- 标签 -> 图集", 'EN4', '标签 → 图集索引'),
        ("  // ---------- 图集（sheet）注册", 'EN5', '图集（sheet）注册'),
        ("  // ---------- 动画数据 ----------", 'EN6', '动画数据'),
        ("  // ---------- 绘制 ----------", 'EN7', '绘制'),
        ("  // ---------- 动画播放器 ----------", 'EN8', '动画播放器'),
        ("  // ---------- 数字", 'EN9', '位图数字'),
        ("  // ---------- 文字（描边） ----------", 'EN10', '文字（描边）'),
        ("  // ---------- 位图按钮", 'EN11', '位图按钮'),
        ("  // ---------- 模块内用到的所有图集 id", 'EN12', '图集 id 清单（预加载用）'),
        ("  window.Engine = {", 'EN13', '导出 window.Engine'),
    ]),
    'js/main.js': ('启动引导 / 主界面场景 / 战斗调度', [
        ("  const $ = (s) => document.querySelector(s);", 'MN1', '启动与画布（尺寸适配/输入）'),
        ("  // ---------- 音频", 'MN2', '音频（BGM 音量调节）'),
        ("  // ---------- 加载 ----------", 'MN3', '素材加载'),
        ("  // ---------- 战斗观察模式", 'MN4', '战斗观察模式（?test=2）'),
        ("  // ---------- 自检模式", 'MN5', '自检模式（?test=1）'),
        ("  // ---------- 标题画面 ----------", 'MN6', '标题画面'),
        ("  // ---------- 主界面：", 'MN7', '主界面场景（松鼠动作 + HUD）'),
        ("  // ---------- 战斗调度 ----------", 'MN8', '战斗调度'),
        ("  window.Main = {", 'MN9', '导出 window.Main'),
    ]),
    'js/debug.js': ('开发调试开关面板', [
        ("  const STORE_KEY = 'ssdz_debug';", 'DBG1', '开关存取（localStorage 隔离）'),
        ("  // ---------- 开关表 ----------", 'DBG2', '开关表'),
        ("  // ---------- 一次性工具 ----------", 'DBG3', '一次性工具（重置/发放/遗忘）'),
        ("  // ---------- 面板 ----------", 'DBG4', '面板构建与渲染'),
        ("  window.Debug = {", 'DBG5', '导出 window.Debug'),
    ]),
    'js/classic-fusion.js': ('装备融合界面（三合一）', [
        ("  function open() {", 'FS1', '打开融合页与材料校验'),
        ("    function render(focus) {", 'FS2', '渲染（工作台/材料卡/分页）'),
        ("    function fuse() {", 'FS3', '融合执行与成功弹窗（含卖出）'),
    ]),
    'js/battle-drops.js': ('战斗掉落拾取（原版 FightProps 复刻）', [
        ("  const RULES = Object.freeze(", 'BD1', '规则与掉落池'),
        ("  function plan(random, kind) {", 'BD2', '掉落计划（按帧数摇号）'),
        ("  function create(options) {", 'BD3', '拾取动画与发放'),
    ]),
}

BANNER = """{ind}/* ============================================================
{ind} * 【{code}】{title}
{ind} * ============================================================ */
"""


def top_comment_end(lines):
    """返回文件头注释块的结束行号（0-based 的下一行）。支持多行 /* */ 与单行 /* */。"""
    if not lines or not lines[0].lstrip().startswith('/*'):
        return 0
    for i, ln in enumerate(lines):
        if '*/' in ln:
            return i + 1
    return 0


def process(rel, dir_title, sections, check_only):
    path = ROOT / rel
    text = path.read_text(encoding='utf-8')
    lines = text.split('\n')
    # 已处理过则跳过（幂等）：目录标记存在就不再插
    if ('【' + sections[0][1] + '】') in text:
        print('SKIP %s（已有横幅）' % rel)
        return False
    # 1) 校验锚点唯一并记录行号
    inserts = []  # (line_index, indent, code, title)
    for anchor, code, title in sections:
        hits = [i for i, ln in enumerate(lines) if anchor in ln]
        if len(hits) != 1:
            raise SystemExit('锚点不唯一（%d 处）: %s -> %r' % (len(hits), rel, anchor))
        i = hits[0]
        ind = re.match(r'\s*', lines[i]).group(0)
        inserts.append((i, ind, code, title))
    if check_only:
        print('OK   %s（%d 节）' % (rel, len(sections)))
        return True
    # 2) 自底向上插横幅，避免行号漂移
    for i, ind, code, title in sorted(inserts, key=lambda x: -x[0]):
        lines.insert(i, BANNER.format(ind=ind, code=code, title=title).rstrip('\n'))
    # 3) 文件头目录
    head_end = top_comment_end(lines)
    codes_per_row = 3
    cells = ['【%s】%s' % (code, title.split('（')[0].split('：')[0]) for _, _, code, title in inserts]
    rows = ['  ' + '  '.join(cells[j:j + codes_per_row]) for j in range(0, len(cells), codes_per_row)]
    directory = ['', '/* ------------------------------------------------------------',
                 ' * 目录：%s' % dir_title,
                 ' * Ctrl+F 搜节号（如「【%s】」）直达对应代码块。' % sections[0][1],
                 ' *'] + [' *' + r for r in rows] + [
                 ' * ------------------------------------------------------------ */']
    lines[head_end:head_end] = directory
    # 显式 newline=''：不做任何行尾翻译，仓库统一 LF（Windows 上默认会翻成 CRLF）。
    with open(path, 'w', encoding='utf-8', newline='') as fh:
        fh.write('\n'.join(lines))
    print('DONE %s（%d 节）' % (rel, len(sections)))
    return True


def main():
    check_only = '--check' in sys.argv
    for rel, (dir_title, sections) in CONFIG.items():
        process(rel, dir_title, sections, check_only)


if __name__ == '__main__':
    main()
