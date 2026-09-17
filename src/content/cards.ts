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
 *   伤害 `造成 N 点伤害` · 格挡 `获得 N 点格挡` · 回复 `回复 N 点稳定度`
 *   挂刻 `N AV 后，…` · 抽牌 `抽 N 张牌` · 时能 `获得 N 点时能`
 *   易伤 `使目标获得 N 层易伤` / `并使自身获得 N 层易伤` · 虚弱 `使目标获得 N 层虚弱`
 *   自身提前 `自身行动值 -N` · 推后目标 `使目标行动值 +N` · 步频 `本场战斗中步频 +N`
 *
 * 数值预算与设计意图见 docs/卡牌设计指南.md。
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

/**
 * 授时官的起始刻印。
 *
 * 刻意混入了一张挂刻（延爆）和两张校正（提前一刻、迟滞），
 * 因为这三张牌各自代表一种时序形态 —— 玩家在第一场战斗里就该看到
 * 「牌可以不立刻生效」这件事，而不是等拿到第一张奖励刻印才知道。
 */
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
    id: 'measure',
    name: '测准',
    kind: 'instant',
    cost: 0,
    target: 'enemy',
    text: '造成 4 点伤害',
    effects: [{ t: 'damage', amount: 4 }],
    flavor: '不费力气，只费一刻。'
  }),
  defineCard({
    id: 'lateburst',
    name: '延爆',
    kind: 'deferred',
    cost: 0,
    target: 'enemy',
    delay: 60,
    text: '60 AV 后，造成 10 点伤害',
    effects: [{ t: 'damage', amount: 10 }],
    flavor: '现在不做的事，也要有人做。'
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

/** 起始牌组构成：cardId → 份数。合计 10 张，三种形态各有覆盖 */
export const STARTER_DECK: { cardId: string; count: number }[] = [
  { cardId: 'calibrate', count: 3 },
  { cardId: 'ward', count: 3 },
  { cardId: 'measure', count: 1 },
  { cardId: 'lateburst', count: 1 },
  { cardId: 'hasten', count: 1 },
  { cardId: 'lag', count: 1 }
];

// ==================== 奖励刻印 ====================

/**
 * 战斗后三选一的候选池。
 *
 * 挂刻牌的报酬必须兑现：同样的时能能打出明显更高的数值，延迟才有理由被接受。
 * 这个关系由 tests/content.test.ts 强制（付费挂刻牌的伤害/时能要严格高于
 * 全部付费即时刻印的上限），所以调整数值时不要只看单张牌。
 *
 * 延迟量级同样重要：标准单位每 100 行动值行动一次，所以延迟从 60 起步，
 * 否则「挂刻」在实战里几乎等于立即生效，机制就白设计了。
 */
export const REWARD_CARDS: CardDef[] = [
  // ---------- 即时：玩家的安全网与数值基准线 ----------
  defineCard({
    id: 'preset',
    name: '预置',
    kind: 'instant',
    cost: 0,
    target: 'self',
    text: '获得 3 点格挡',
    effects: [{ t: 'block', amount: 3 }],
    flavor: '提前一步护住要害。'
  }),
  defineCard({
    id: 'review',
    name: '复核',
    kind: 'instant',
    cost: 2,
    target: 'enemy',
    text: '造成 14 点伤害',
    effects: [{ t: 'damage', amount: 14 }],
    flavor: '第二次核对，通常更不留情。'
  }),
  defineCard({
    id: 'bulwark',
    name: '盾墙',
    kind: 'instant',
    cost: 2,
    target: 'self',
    text: '获得 14 点格挡',
    effects: [{ t: 'block', amount: 14 }],
    flavor: '把刻度排成一堵墙。'
  }),
  defineCard({
    id: 'strip',
    name: '拆解',
    kind: 'instant',
    cost: 1,
    target: 'enemy',
    text: '造成 7 点伤害，并使目标获得 1 层虚弱',
    effects: [
      { t: 'damage', amount: 7 },
      { t: 'weak', stacks: 1 }
    ],
    flavor: '拆掉一个齿轮，整台机器都使不上力。'
  }),
  defineCard({
    id: 'overwind',
    name: '催发',
    kind: 'instant',
    cost: 0,
    target: 'self',
    text: '获得 1 点时能，并使自身获得 3 层易伤',
    effects: [
      { t: 'energy', amount: 1 },
      { t: 'vulnerable', stacks: 3, who: 'self' }
    ],
    flavor: '把弦再拧紧一圈——听得见它响，也听得见它裂。'
  }),
  defineCard({
    id: 'adjust',
    name: '校时',
    kind: 'instant',
    cost: 1,
    target: 'self',
    text: '回复 6 点稳定度',
    effects: [{ t: 'heal', amount: 6 }],
    flavor: '把走乱的指针拨回原位。'
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

  // ---------- 挂刻：延迟换数值 ----------
  defineCard({
    id: 'frost_strike',
    name: '霜击',
    kind: 'deferred',
    cost: 1,
    target: 'enemy',
    delay: 60,
    text: '60 AV 后，造成 12 点伤害',
    effects: [{ t: 'damage', amount: 12 }],
    flavor: '迟到的霜，落在最不该落的地方。'
  }),
  defineCard({
    id: 'accrue',
    name: '积时',
    kind: 'deferred',
    cost: 1,
    target: 'self',
    delay: 60,
    text: '60 AV 后，获得 12 点格挡',
    effects: [{ t: 'block', amount: 12 }],
    flavor: '存下的时间，到点才取出来用。'
  }),
  defineCard({
    id: 'slack',
    name: '缓流',
    kind: 'deferred',
    cost: 1,
    target: 'self',
    delay: 60,
    text: '60 AV 后，抽 2 张牌',
    effects: [{ t: 'draw', count: 2 }],
    flavor: '水慢下来，才看得见底下有什么。'
  }),
  defineCard({
    id: 'confluence',
    name: '并流',
    kind: 'deferred',
    cost: 2,
    target: 'enemy',
    delay: 90,
    text: '90 AV 后，造成 14 点伤害，重复 2 次',
    effects: [{ t: 'damage', amount: 14, times: 2 }],
    flavor: '两条支流汇合之处，力道是加倍的。'
  }),
  defineCard({
    id: 'rime',
    name: '缀霜',
    kind: 'deferred',
    cost: 2,
    target: 'enemy',
    delay: 90,
    text: '90 AV 后，造成 18 点伤害，并使目标获得 2 层易伤',
    effects: [
      { t: 'damage', amount: 18 },
      { t: 'vulnerable', stacks: 2 }
    ],
    flavor: '霜先挂上，脆弱随后就到。'
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
    id: 'echo',
    name: '回响',
    kind: 'deferred',
    cost: 2,
    target: 'enemy',
    delay: 120,
    text: '120 AV 后，造成 12 点伤害，重复 3 次',
    effects: [{ t: 'damage', amount: 12, times: 3 }],
    flavor: '喊出去的东西，总要回来三次。'
  }),
  defineCard({
    id: 'charge',
    name: '蓄爆',
    kind: 'deferred',
    cost: 4,
    target: 'enemy',
    delay: 150,
    text: '150 AV 后，造成 68 点伤害',
    effects: [{ t: 'damage', amount: 68 }],
    flavor: '最安静的那段时间，是在攒。'
  }),

  // ---------- 校正：只操作时间轴，不解决当下 ----------
  defineCard({
    id: 'anchor',
    name: '锚定',
    kind: 'shift',
    cost: 0,
    target: 'none',
    text: '使一个已挂刻印提前 25 AV 结算',
    effects: [{ t: 'rush', amount: 25 }],
    flavor: '把它拉回来，拉到就是现在。'
  }),
  defineCard({
    id: 'merge',
    name: '并轨',
    kind: 'shift',
    cost: 2,
    target: 'none',
    text: '使一个已挂刻印提前 60 AV 结算',
    effects: [{ t: 'rush', amount: 60 }],
    flavor: '两条线并成一条，就不必再等。'
  }),
  defineCard({
    id: 'interrupt',
    name: '打断',
    kind: 'shift',
    cost: 1,
    target: 'enemy',
    text: '取消目标已排入时序轴的行动，并推后 25 AV',
    effects: [{ t: 'cancel', av: 25 }],
    flavor: '在它举手之前，把那一刻抹掉。'
  }),
  defineCard({
    id: 'sever',
    name: '截断',
    kind: 'shift',
    cost: 2,
    target: 'enemy',
    text: '取消目标已排入时序轴的行动，并推后 60 AV',
    effects: [{ t: 'cancel', av: 60 }],
    flavor: '一刀下去，那一段就不存在了。'
  }),
  defineCard({
    id: 'fastforward',
    name: '快进',
    kind: 'shift',
    cost: 1,
    target: 'self',
    text: '自身行动值 -40',
    effects: [{ t: 'selfAv', amount: -40 }],
    flavor: '把中间那段直接省掉。'
  }),
  defineCard({
    id: 'freeze',
    name: '定格',
    kind: 'shift',
    cost: 2,
    target: 'enemy',
    text: '使目标行动值 +60',
    effects: [{ t: 'targetAv', amount: 60 }],
    flavor: '它还在动，只是动得很慢。'
  }),
  defineCard({
    id: 'timekeep',
    name: '授时',
    kind: 'shift',
    cost: 2,
    target: 'self',
    text: '本场战斗中步频 +2',
    effects: [{ t: 'speed', amount: 2 }],
    flavor: '你的节拍，从此由你自己规定。'
  })
];
