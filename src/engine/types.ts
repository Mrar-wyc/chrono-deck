/**
 * 引擎的类型契约。
 *
 * 这是**整个项目最重要的一份文件**：engine 只负责算出「发生了什么」，产出
 * `BattleEvent[]`；ui 只负责把事件按顺序播出来。两边都只依赖这里的类型，
 * 互不 import。规则改动不需要动界面，界面改版不需要动规则。
 *
 * 单位：行动值（AV）以「标准速度单位行动一次 = 100 AV」为基准。
 * 用 100 而不是 10000 是为了让玩家在时序轴上直接读得懂数字。
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
 * 由敌人行动发起时：`damage` 打向玩家，`block` 是敌人自己获得格挡。
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
  /**
   * 目标行动值变化。正数 = 推后。
   * 这一项与 selfAv 在设定里叫「校正」：只动时间轴，不产生伤害
   */
  | { t: 'targetAv'; amount: number }
  /** 取消目标已排入时序轴的一项行动，并把它推后 av */
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
  /** 本场战斗中步频永久变化 */
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
  /** 升级后的覆盖项（M1 之后接入） */
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
  /** 行动轮转表，按顺序循环。M0 只做固定轮转，权重 AI 留到后续里程碑 */
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

// ==================== 运行时状态 ====================

export interface BuffState {
  /** 易伤层数，回合结束递减 */
  vulnerable: number;
  /** 虚弱层数，回合结束递减 */
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

/** 时序轴上的一项待结算内容：敌人行动、挂刻引爆、场上光环 */
export interface TimelineEntry {
  id: ActionId;
  owner: UnitId;
  /** 结算时刻（行动值） */
  at: number;
  kind: 'enemyMove' | 'card' | 'aura';
  /** 轴上显示的短标签，例「畸变A · 挥击」「霜击」 */
  label: string;
  /** kind === 'card' 时指向具体的刻印副本 */
  cardUid?: CardUid;
  /** kind === 'enemyMove' 时指向 EnemyMoveDef.id */
  moveId?: string;
}

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
  /** 时能变化 */
  | { k: 'energy'; unit: UnitId; value: number; delta: number }
  /** 打出一张刻印 */
  | { k: 'play'; unit: UnitId; cardUid: CardUid; cardId: string; target?: UnitId }
  /** 一件内容被排入时序轴 */
  | { k: 'schedule'; entry: TimelineEntry }
  /** 轴上的一项结算了 */
  | { k: 'resolve'; entryId: ActionId }
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
  /** 本场战斗的随机源（由上层从种子派生，保证可回放） */
  seed: number;
  player: UnitState;
  enemies: UnitState[];
  /** 初始牌组（抽牌堆顺序已洗好） */
  deck: CardUid[];
  /** cardUid → cardId 的映射，引擎据此查卡面 */
  cardIndex: Record<CardUid, string>;
  handSize: number;
  energyPerTurn: number;
}

export interface BattleOutput {
  result: BattleResult;
  rounds: number;
  events: BattleEvent[];
  /** 终局状态快照，供结算界面读取 */
  playerHp: number;
  /** 终局状态哈希，回放校验用 */
  hash: string;
}

// ==================== 冻结空值 ====================

export const EMPTY_BUFFS: Readonly<BuffState> = Object.freeze({ vulnerable: 0, weak: 0 });
