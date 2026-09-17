/**
 * 引擎的类型契约。
 *
 * 这是**整个项目最重要的一份文件**：engine 只负责算出「发生了什么」，产出
 * `BattleEvent[]`；ui 只负责把事件按顺序播出来。两边都只依赖这里的类型，
 * 互不 import。规则改动不需要动界面，界面改版不需要动规则。
 *
 * 单位：行动值（AV）以「标准速度单位行动一次 = 100 AV」为基准。
 * 用 100 而不是 10000 是为了让玩家在时序轴上直接读得懂数字。
 *
 * 本文件自身不 import 任何模块（由 tests/guards.test.ts 断言），它是依赖图的根。
 */

// ==================== 时序基准 ====================

/** 标准速度单位两次行动之间推进的行动值 */
export const BASE_AV = 100;
/** 步频基准值：步频 100 即标准速度 */
export const BASE_SPEED = 100;

/** 由步频算一次标准行动要等多少行动值。步频翻倍则行动间隔减半 */
export function avCost(speed: number): number {
  return moveInterval(BASE_AV, speed);
}

/**
 * 一个具体行动的实际间隔。
 *
 * 招式自带 `av` 是它在标准步频下的固有消耗，再按单位步频缩放：
 * 步频 130 的单位用 av=100 的招式，实际只隔 77 AV。
 * 这样「招式快慢」与「单位快慢」是两个独立可调的旋钮。
 */
export function moveInterval(moveAv: number, speed: number): number {
  return Math.max(1, Math.round((moveAv * BASE_SPEED) / Math.max(1, speed)));
}

// ==================== 标识 ====================

export type UnitId = string;
/** 一张具体刻印在某场战斗内的唯一 id（同一张卡可有多份副本） */
export type CardUid = string;
/** 一个已排入时序轴的待结算项的 id */
export type ActionId = string;

export type Side = 'ally' | 'foe';
export type DamageKind = 'attack' | 'dot' | 'pure';

// ==================== 效果与内容 ====================

/**
 * 效果原子。刻印与敌人行动共用同一套词汇表。
 *
 * 视角约定（很重要，读敌人招式时不必在脑子里做翻转）：
 *   - 由敌人行动发起时，`damage` 打向玩家，`block` 是敌人自己获得格挡
 *   - `selfAv` 作用于行动者自己，`targetAv` 作用于对方，正数 = 更晚。
 *     双方都按「对自己有利的方向」书写：自己用负数提前，对对方用正数推后
 */
export type Effect =
  /** 造成伤害。times 用于多段（并流那种） */
  | { t: 'damage'; amount: number; times?: number }
  | { t: 'block'; amount: number }
  | { t: 'heal'; amount: number }
  | { t: 'draw'; count: number }
  /** 回复时能 */
  | { t: 'energy'; amount: number }
  /** 自身行动值变化。负数 = 提前行动 */
  | { t: 'selfAv'; amount: number }
  /** 对方行动值变化。正数 = 推后 */
  | { t: 'targetAv'; amount: number }
  /** 取消对方已排入时序轴的一项行动，并把它推后 av */
  | { t: 'cancel'; av: number }
  /** 把一个已挂刻印提前 amount AV 结算 */
  | { t: 'rush'; amount: number }
  /**
   * 易伤：受到伤害 +50%。
   * `who` 缺省为 `target`（施加给受击方，即绝大多数情况的用法）；
   * 写 `self` 则表示「代价型」效果——例如过载打完自己也会变脆。
   */
  | { t: 'vulnerable'; stacks: number; who?: 'target' | 'self' }
  /** 虚弱：造成伤害 -25%。`who` 语义同上 */
  | { t: 'weak'; stacks: number; who?: 'target' | 'self' }
  /** 本场战斗中行动者步频永久变化 */
  | { t: 'speed'; amount: number };

/** 刻印的三种时序形态。这是本作与常规卡牌游戏的分野 */
export type CardKind =
  /** 即时：立即结算，熟悉的手感，保证反馈不延迟 */
  | 'instant'
  /** 挂刻：排入时序轴，delay AV 后自行引爆，可能在敌方回合之间落地 */
  | 'deferred'
  /** 校正：立即结算，但只操作时间轴，不产生伤害或格挡 */
  | 'shift';

export type TargetKind = 'enemy' | 'self' | 'none';

export interface CardDef {
  id: string;
  name: string;
  kind: CardKind;
  /** 时能消耗 */
  cost: number;
  target: TargetKind;
  /** 挂刻专用：排入时序轴后多少 AV 结算 */
  delay?: number;
  /** 给玩家看的效果描述。界面只读 text，引擎只读 effects，两者必须一致（由测试断言） */
  text: string;
  /** 结构化效果，引擎唯一依据 */
  effects: Effect[];
  /** 升级后的覆盖项（后续里程碑接入） */
  upgraded?: Partial<Pick<CardDef, 'text' | 'effects' | 'cost' | 'delay'>>;
  flavor?: string;
}

export interface EnemyMoveDef {
  id: string;
  name: string;
  /** 时序轴与敌人头顶显示的短标签，例「挥击 8」 */
  intent: string;
  /** 完整描述，例「造成 8 点伤害」。与 intent 一样必须与 effects 的数值一致（由测试断言） */
  text: string;
  /** 这一招本身要占用的行动值：出招后隔多久才轮到它下一次行动 */
  av: number;
  effects: Effect[];
}

export interface EnemyDef {
  id: string;
  name: string;
  hp: number;
  speed: number;
  /** 行动轮转表，按顺序循环。M1 只做固定轮转，权重 AI 留到后续里程碑 */
  moves: EnemyMoveDef[];
  flavor?: string;
}

export type EncounterKind = 'normal' | 'elite' | 'boss';

/** 一场战斗里同时出现哪些畸变体 */
export interface EncounterDef {
  id: string;
  name: string;
  kind: EncounterKind;
  /** 按站位顺序排列的 EnemyDef.id */
  enemyIds: string[];
}

/** 玩家在战斗中的配置。玩家单位不像敌人那样有招式表，改为出牌 */
export interface PlayerSetup {
  name: string;
  maxHp: number;
  speed: number;
  /** 每回合获得的时能 */
  energyPerTurn: number;
  /** 手牌上限（每回合抽到这个数） */
  handSize: number;
}

/**
 * 一张具体的刻印副本。
 *
 * 引擎直接持有卡面，而不是拿一个 id 回头去查数据表 ——
 * 这样规则层不需要认识 content 层，也就能在完全不加载内容的情况下测引擎。
 */
export interface CardInstance {
  uid: CardUid;
  def: CardDef;
}

// ==================== 运行时状态 ====================

export interface BuffState {
  /** 易伤层数 */
  vulnerable: number;
  /** 虚弱层数 */
  weak: number;
}

export interface UnitState {
  id: UnitId;
  name: string;
  side: Side;
  hp: number;
  maxHp: number;
  block: number;
  /** 步频 */
  speed: number;
  /** 下一次行动落在哪个行动值上 */
  nextAt: number;
  alive: boolean;
  buffs: BuffState;
}

/**
 * 时序轴上的一条记录：谁在哪个行动值上要做什么。
 *
 * 只有三种：单位的行动机会、挂刻的引爆、以及后续里程碑要加的光环。
 * 敌人的行动机会同时也是它的出招 —— 招式的意图标签就写在条目的 label 上，
 * 所以玩家在轴上看到「畸变甲 · 挥击 8」就知道那一刻会发生什么。
 */
export type TimelineKind = 'turn' | 'card' | 'aura';

export interface TimelineEntry {
  id: ActionId;
  owner: UnitId;
  /** 归属阵营。调度器靠它实现「同为行动机会时玩家先手」，界面用不到 */
  side: Side;
  /** 结算时刻（行动值） */
  at: number;
  kind: TimelineKind;
  /** 轴上显示的短标签，例「我」「畸变甲 · 挥击 8」「霜击」 */
  label: string;
  /** kind === 'card' 时指向具体的刻印副本 */
  cardUid?: CardUid;
  /** kind === 'turn' 且 owner 是敌人时，指向 EnemyMoveDef.id */
  moveId?: string;
}

/**
 * 同一行动值上的结算顺序（越小越先）。玩家先于敌人。
 *
 * 这是本作最重要的一条规则，也是「校正」类牌存在的全部理由：
 * 把敌人的行动推后到与你的挂刻同一时刻，挂刻会赶在它前面引爆；
 * 把自己提前到与敌人同一时刻，意味着你先手。
 * 规则一旦漂移，所有卡牌的相对价值都会变，所以它被写进测试。
 */
export const TIMELINE_PRIORITY: Readonly<Record<TimelineKind, number>> = Object.freeze({
  card: 0,
  turn: 1,
  aura: 2
});

// ==================== 事件流（engine → ui 的唯一契约） ====================

/**
 * 战斗过程中发生的一切都被表述成事件。
 * 渲染器就是个事件回放器：按顺序取事件、播动画、改界面，仅此而已。
 */
export type BattleEvent =
  /** 时钟推进到某个行动值。时序轴据此推进指针 */
  | { k: 'clock'; at: number }
  /** 一个单位开始行动 */
  | { k: 'turnStart'; unit: UnitId; round: number }
  /** 抽牌 */
  | { k: 'draw'; unit: UnitId; cards: CardUid[] }
  /** 时能变化。delta 用于界面播增减动画 */
  | { k: 'energy'; unit: UnitId; value: number; delta: number }
  /** 打出一张刻印 */
  | { k: 'play'; unit: UnitId; cardUid: CardUid; cardId: string; target?: UnitId }
  /** 一件内容被排入时序轴 */
  | { k: 'schedule'; entry: TimelineEntry }
  /** 轴上的一项结算了 */
  | { k: 'resolve'; entryId: ActionId }
  /** 出牌被拒。引擎侧也要拦，不能只靠界面把按钮置灰 */
  | { k: 'rejected'; reason: string }
  /** 步频变化。delta 用于界面播增减 */
  | { k: 'speed'; unit: UnitId; value: number; delta: number }
  /** 造成伤害。blocked 为被格挡吸收掉的部分，便于界面显示「格挡 5 / 掉血 3」 */
  | { k: 'damage'; src: UnitId | null; dst: UnitId; amount: number; blocked: number; kind: DamageKind }
  | { k: 'heal'; dst: UnitId; amount: number }
  | { k: 'block'; dst: UnitId; amount: number }
  | { k: 'buff'; dst: UnitId; buff: keyof BuffState; stacks: number }
  /** 行动值被移动。from/to 让界面能画出「这一格挪到了那里」 */
  | { k: 'shift'; unit: UnitId; from: number; to: number }
  /** 已排入轴的一项被取消 */
  | { k: 'cancel'; owner: UnitId; entryId: ActionId }
  /** 弃牌 */
  | { k: 'discard'; unit: UnitId; cards: CardUid[] }
  | { k: 'death'; unit: UnitId }
  /** 一个单位结束行动 */
  | { k: 'turnEnd'; unit: UnitId }
  | { k: 'end'; result: BattleResult; rounds: number };

export type BattleResult = 'win' | 'lose';

/** 一场战斗的全部输入。引擎接收它、深拷一份自己改，绝不动传进来的对象 */
export interface BattleInput {
  /** 本场战斗的随机源种子（由上层从本局种子派生，保证可回放） */
  seed: number;
  player: PlayerSetup;
  enemies: EnemyDef[];
  /** 初始抽牌堆，顺序即起手顺序（由上层用种子洗好） */
  deck: CardInstance[];
}

// ==================== 决策接口 ====================

/** 玩家可以做的事 */
export type PlayerAction =
  | { t: 'play'; cardUid: CardUid; target?: UnitId }
  | { t: 'endTurn' };

/**
 * 敌人对玩家可见的样子。
 *
 * 除了状态，还把它的**招式轮转表**一并交出来 —— 敌人的出招顺序是完全确定的，
 * 而本作的设计目标就是「时序是一道可解的排序题」。把轮转表藏起来会让玩家
 * 只能凭猜，那与核心机制矛盾。
 */
export interface EnemyView extends UnitState {
  moves: { id: string; name: string; intent: string; av: number }[];
  /** 下一招在轮转表里的下标 */
  nextMoveIndex: number;
}

/**
 * 交给决策方的只读投影。
 *
 * 刻意不暴露引擎内部对象：策略拿到的是一份拷贝，改它不会影响战斗。
 * 机器人、回放、以及日后可能的 AI 都从这里取信息。
 */
export interface PlayerView {
  now: number;
  round: number;
  energy: number;
  energyPerTurn: number;
  hand: CardInstance[];
  drawCount: number;
  discardCount: number;
  /** 玩家自己的状态快照 */
  me: UnitState;
  enemies: EnemyView[];
  /** 时序轴快照，按结算顺序排列 */
  timeline: TimelineEntry[];
}

/** 机器人 / 回放 / 未来 AI 的统一入口：看当前局面，给出下一步 */
export type BattlePolicy = (view: PlayerView) => PlayerAction;

// ==================== 战斗步骤 ====================

/** 一次操作之后返回的东西：这段时间里发生的事 + 是否已分出胜负 */
export interface BattleStep {
  events: BattleEvent[];
  result: BattleResult | null;
}

export interface BattleOutput {
  result: BattleResult;
  rounds: number;
  events: BattleEvent[];
  playerHp: number;
}

// ==================== 冻结空值 ====================

export const EMPTY_BUFFS: Readonly<BuffState> = Object.freeze({ vulnerable: 0, weak: 0 });
