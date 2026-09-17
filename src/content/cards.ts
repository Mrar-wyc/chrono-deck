import type { CardDef } from '../engine/types';

/**
 * 刻印（卡牌）数据表。
 *
 * 加一张牌只需要改这个文件 —— 引擎、界面、存档都不需要动（接线点清单见
 * CONTRIBUTING.md）。写卡时请遵守下面两条约定，否则内容校验会失败：
 *
 *   1. `text` 里出现的数值必须与 `effects` 完全对应。
 *      这个「文本与结构化效果一致」的约束由 tests/content.test.ts 断言，
 *      因为不一致时卡面写 8 实际打 14，是卡牌游戏最伤玩家信任的一类 bug。
 *   2. 数值用 ASCII 连字符写 `-15`，不要用排版减号 `−15`，便于测试解析。
 *
 * 文本写法约定（保证可读性与可解析性一致）：
 *   伤害 `造成 N 点伤害` · 格挡 `获得 N 点格挡` · 挂刻 `N AV 后，…`
 *   抽牌 `抽 N 张牌` · 易伤 `使目标获得 N 层易伤` · 虚弱 `使目标获得 N 层虚弱`
 */

/**
 * 标识函数。它什么都不做，存在的意义是让写卡的人拿到补全与编译期检查：
 * 少写一个字段、把 `kind` 拼错、把 `effects` 写成字符串，`tsc` 立刻报错，
 * 而不是等到运行时界面白屏。
 */
export function defineCard(def: CardDef): CardDef {
  return def;
}

// ==================== 起始牌组 ====================

/** 授时官的起始刻印。10 张，比例刻意保守，让新手先靠即时牌站稳 */
export const STARTER_CARDS: CardDef[] = [
  defineCard({
    id: 'calibrate',
    name: '校准',
    kind: 'instant',
    cost: 1,
    target: 'enemy',
    text: '造成 6 点伤害',
    effects: [{ t: 'damage', amount: 6 }],
    flavor: '对表。差之一刻，谬以千里。'
  }),
  defineCard({
    id: 'ward',
    name: '守刻',
    kind: 'instant',
    cost: 1,
    target: 'self',
    text: '获得 5 点格挡',
    effects: [{ t: 'block', amount: 5 }],
    flavor: '刻度不动，则外力无从侵入。'
  }),
  defineCard({
    id: 'hasten',
    name: '提前一刻',
    kind: 'shift',
    cost: 0,
    target: 'self',
    text: '自身行动值 -15',
    effects: [{ t: 'selfAv', amount: -15 }],
    flavor: '早一刻动手，胜过晚一刻补救。'
  }),
  defineCard({
    id: 'lag',
    name: '迟滞',
    kind: 'shift',
    cost: 0,
    target: 'enemy',
    text: '使目标行动值 +20',
    effects: [{ t: 'targetAv', amount: 20 }],
    flavor: '拖住它，就拖住了它的下一次。'
  })
];

/** 起始牌组构成：cardId → 份数。合计 10 张 */
export const STARTER_DECK: { cardId: string; count: number }[] = [
  { cardId: 'calibrate', count: 4 },
  { cardId: 'ward', count: 4 },
  { cardId: 'hasten', count: 1 },
  { cardId: 'lag', count: 1 }
];

// ==================== 奖励刻印 ====================

/**
 * 战斗后三选一的候选池。
 *
 * 注意挂刻牌与即时牌的费用—数值比：霜击费 1 打 14，而即时的校准费 1 只打 6。
 * 这个差距是刻意的，它就是玩家愿意承担「赌未来」这件事的全部理由；
 * 调整时请一起看 tests/balance.test.ts 的胜率区间。
 *
 * 延迟量级同样重要：标准单位每 100 行动值行动一次，所以延迟必须与一次行动
 * 可比拟（60 起步），否则「挂刻」在实战里几乎等于立即生效，机制就白设计了。
 * 这条由 tests/content.test.ts 断言。
 */
export const REWARD_CARDS: CardDef[] = [
  defineCard({
    id: 'frost_strike',
    name: '霜击',
    kind: 'deferred',
    cost: 1,
    target: 'enemy',
    delay: 60,
    text: '60 AV 后，造成 14 点伤害',
    effects: [{ t: 'damage', amount: 14 }],
    flavor: '迟到的霜，落在最不该落的地方。'
  }),
  defineCard({
    id: 'confluence',
    name: '并流',
    kind: 'deferred',
    cost: 2,
    target: 'enemy',
    delay: 60,
    text: '60 AV 后，造成 8 点伤害，重复 2 次',
    effects: [{ t: 'damage', amount: 8, times: 2 }],
    flavor: '两条支流汇合之处，力道是加倍的。'
  }),
  defineCard({
    id: 'overload',
    name: '过载',
    kind: 'deferred',
    cost: 3,
    target: 'enemy',
    delay: 120,
    text: '120 AV 后，造成 30 点伤害，并使自身获得 3 层易伤',
    effects: [
      { t: 'damage', amount: 30 },
      { t: 'vulnerable', stacks: 3, who: 'self' }
    ],
    flavor: '把发条上到断，钟自然会响得最响。'
  }),
  defineCard({
    id: 'anchor',
    name: '锚定',
    kind: 'instant',
    cost: 1,
    target: 'none',
    text: '使一个已挂刻印提前 25 AV 结算',
    effects: [{ t: 'rush', amount: 25 }],
    flavor: '把它拉回来，拉到就是现在。'
  }),
  defineCard({
    id: 'interrupt',
    name: '打断',
    kind: 'instant',
    cost: 1,
    target: 'enemy',
    text: '取消目标已排入时序轴的行动，并推后 25 AV',
    effects: [{ t: 'cancel', av: 25 }],
    flavor: '在它举手之前，把那一刻抹掉。'
  }),
  defineCard({
    id: 'timekeep',
    name: '授时',
    kind: 'instant',
    cost: 2,
    target: 'self',
    text: '本场战斗中步频 +2',
    effects: [{ t: 'speed', amount: 2 }],
    flavor: '你的节拍，从此由你自己规定。'
  }),
  defineCard({
    id: 'timeslot',
    name: '时隙',
    kind: 'instant',
    cost: 0,
    target: 'self',
    text: '抽 1 张牌',
    effects: [{ t: 'draw', count: 1 }],
    flavor: '缝隙里也塞得下一件事。'
  }),
  defineCard({
    id: 'plumbline',
    name: '准绳',
    kind: 'instant',
    cost: 1,
    target: 'enemy',
    text: '造成 5 点伤害，并使目标获得 2 层易伤',
    effects: [
      { t: 'damage', amount: 5 },
      { t: 'vulnerable', stacks: 2 }
    ],
    flavor: '先把标准立好，再谈修正。'
  }),
  defineCard({
    id: 'blunt',
    name: '钝化',
    kind: 'instant',
    cost: 1,
    target: 'enemy',
    text: '使目标获得 2 层虚弱',
    effects: [{ t: 'weak', stacks: 2 }],
    flavor: '齿轮里塞进一粒沙，转得动却使不上力。'
  })
];
