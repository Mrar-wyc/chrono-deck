import { createRng } from '../rng';
import type { Rng } from '../rng';
import { avCost, moveInterval } from './types';
import type {
  ActionId,
  BattleEvent,
  BattleInput,
  BattleResult,
  BattleStep,
  CardInstance,
  CardUid,
  Effect,
  EnemyDef,
  PlayerView,
  TimelineEntry,
  UnitId,
  UnitState
} from './types';
import { createIdGen, orderedSnapshot, peekNext, removeEntry, shiftEntry } from './timeline';

/**
 * 战斗引擎。
 *
 * 分步驱动：玩家回合里界面反复调 playCard，玩家结束回合时调 endTurn，
 * 引擎才把时间轴往前推，一路上把挂刻引爆、敌人出招都算完，
 * 直到下一次轮到我方（或分出胜负）。
 *
 * 这样界面既能在玩家做决定时拿到最新局面，也不用自己维护任何规则 ——
 * 它只负责把每次调用返回的事件按顺序播出来。
 *
 * 确定性：唯一的不确定来源是构造时的种子，所有随机都从它派生。
 * 同一份输入 + 同一串操作，必定得到逐帧相同的事件序列。
 * 因此**没有任何模块级可变状态** —— 两场战斗同时跑也不会互相影响，
 * 这是机器人在同一进程里跑几百局的前提。
 */

/** 一次推进最多结算这么多条目。纯粹是防死循环的保险，正常战斗远达不到 */
const MAX_STEPS = 5000;

interface EnemyRuntime {
  unit: UnitState;
  def: EnemyDef;
  /** 轮转表里的下一招 */
  moveIdx: number;
}

interface State {
  rng: Rng;
  now: number;
  round: number;
  player: UnitState;
  enemies: EnemyRuntime[];
  energy: number;
  energyPerTurn: number;
  handSize: number;
  hand: CardInstance[];
  drawPile: CardInstance[];
  discardPile: CardInstance[];
  /** 已挂刻、尚未引爆的刻印，key 是刻印副本的 uid */
  inFlight: Map<CardUid, CardInstance>;
  /**
   * 挂刻引爆时打谁，在**挂的那一刻**就定下来，而不是引爆那一刻再选。
   * 否则玩家没法为「三回合后打那个家伙」做规划，挂刻就失去了预判的意义。
   */
  cardTargets: Map<CardUid, UnitId | undefined>;
  queue: TimelineEntry[];
  /** 本次调用产生、尚未被调用方取走的事件 */
  buffer: BattleEvent[];
  /** 从头到尾的全部事件，供回放与调试 */
  history: BattleEvent[];
  result: BattleResult | null;
  /** 玩家回合进行中（可以出牌） */
  playerActing: boolean;
  nextId: (tag: string) => ActionId;
}

export interface Battle {
  /** 当前局面。返回的是拷贝，改它不会影响战斗 */
  view(): PlayerView;
  /**
   * 取走尚未被消费的事件。
   *
   * 开局（时钟归零、第一回合开始、起手抽牌）也产生事件，它们在第一次操作之前
   * 就已经躺在缓冲里。界面挂载时先取一次把开场播出来；机器人对局把它并进
   * 事件流，这样「从头到尾的完整时间线」才真的完整。
   */
  pending(): BattleEvent[];
  /** 打出一张刻印。返回这段时间里发生的事件 */
  playCard(cardUid: CardUid, target?: UnitId): BattleStep;
  /** 结束玩家回合，推进时间轴直到下次轮到我方或战斗结束 */
  endTurn(): BattleStep;
  isOver(): boolean;
  outcome(): BattleResult | null;
  /** 到目前为止的全部事件 */
  history(): readonly BattleEvent[];
}

// ==================== 构造 ====================

/** 同名敌人加序号，让时序轴上的标签能区分「锈蚀体·甲」「锈蚀体·乙」 */
const ORDINALS = ['甲', '乙', '丙', '丁', '戊', '己'];

function labelEnemies(defs: readonly EnemyDef[]): string[] {
  const total = new Map<string, number>();
  for (const d of defs) total.set(d.name, (total.get(d.name) ?? 0) + 1);
  const seen = new Map<string, number>();
  return defs.map((d) => {
    if ((total.get(d.name) ?? 0) <= 1) return d.name;
    const n = seen.get(d.name) ?? 0;
    seen.set(d.name, n + 1);
    return `${d.name}·${ORDINALS[n] ?? String(n + 1)}`;
  });
}

function makeUnit(
  id: UnitId,
  name: string,
  side: 'ally' | 'foe',
  hp: number,
  speed: number
): UnitState {
  return {
    id,
    name,
    side,
    hp,
    maxHp: hp,
    block: 0,
    speed,
    alive: true,
    buffs: { vulnerable: 0, weak: 0 }
  };
}

/**
 * 战斗输入必须自洽。
 *
 * 这些值平时来自 `content/player.ts` 的冻结常量与内容表，看起来不会出错 ——
 * 但引擎是公开 API，测试与未来的单局流程都会直接构造 `BattleInput`。
 * 不合法的值不会报错，只会让引擎进入一个「没有敌人可打」「时钟走不动」
 * 或者「同一张牌被静默吞掉」的状态，排查起来远比在这里拦下来贵。
 */
function validateInput(input: BattleInput): void {
  const posInt = (value: number, what: string): void => {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${what} 必须是正整数，实际是 ${value}`);
    }
  };
  const nonNegInt = (value: number, what: string): void => {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`${what} 必须是非负整数，实际是 ${value}`);
    }
  };

  if (input.enemies.length === 0) {
    throw new Error('战斗至少需要一个敌人：检查遭遇配表是否正确引用，或 buildBattleInput 是否收到了合法遭遇 id');
  }
  if (input.deck.length === 0) {
    throw new Error('战斗至少需要一张刻印：检查牌组装配');
  }

  posInt(input.player.maxHp, '玩家稳定度上限');
  // 步频为 0 会让行动间隔退化成一万行动值，表现为「时间轴卡住不动」
  posInt(input.player.speed, '玩家步频');
  nonNegInt(input.player.energyPerTurn, '每回合时能');
  nonNegInt(input.player.handSize, '手牌上限');

  for (const def of input.enemies) {
    posInt(def.hp, `畸变体「${def.name}」的血量`);
    posInt(def.speed, `畸变体「${def.name}」的步频`);
    if (def.moves.length === 0) throw new Error(`畸变体「${def.name}」没有任何招式`);
  }

  const seenUid = new Set<string>();
  for (const card of input.deck) {
    // 重复的 uid 会让 inFlight / cardTargets 这两个以 uid 为键的表互相覆盖，
    // 结果是一张牌被静默吞掉：时能花了、什么都没发生、也不进弃牌堆
    if (seenUid.has(card.uid)) {
      throw new Error(`刻印副本 uid 重复：${card.uid}。每一张副本都必须有唯一 uid`);
    }
    seenUid.add(card.uid);

    if (card.def.kind === 'deferred') {
      const delay = card.def.delay;
      // delay <= 0 会把挂刻排在当前时刻或更早，让时钟倒流
      if (delay === undefined || !Number.isInteger(delay) || delay <= 0) {
        throw new Error(`挂刻「${card.def.name}」必须有正整数 delay，实际是 ${String(delay)}`);
      }
    }
  }
}

export function createBattle(input: BattleInput): Battle {
  validateInput(input);

  const names = labelEnemies(input.enemies);
  const state: State = {
    rng: createRng(input.seed),
    now: 0,
    round: 0,
    player: makeUnit('player', input.player.name, 'ally', input.player.maxHp, input.player.speed),
    enemies: input.enemies.map((def, i) => ({
      unit: makeUnit(`e${i}`, names[i]!, 'foe', def.hp, def.speed),
      def,
      moveIdx: 0
    })),
    energy: 0,
    energyPerTurn: input.player.energyPerTurn,
    handSize: input.player.handSize,
    hand: [],
    drawPile: [...input.deck],
    discardPile: [],
    inFlight: new Map(),
    cardTargets: new Map(),
    queue: [],
    buffer: [],
    history: [],
    result: null,
    playerActing: false,
    nextId: createIdGen('a')
  };

  /*
   * 起跑排轴。
   *
   * 玩家落在 0 行动值，**敌人落在自己的第一个间隔之后**，而不是一起从 0 起跑。
   * 两者差别很大：一起起跑时，两个敌人在开局那一刻各行动一次，快速的那个
   * 还会在同一回合里再动一次 —— 实测第一回合就挨 4 次攻击、70 点稳定度掉到 33，
   * 整局变成死亡螺旋，群战胜率从 43% 直接归零。
   *
   * 让玩家先手、敌人按各自步频错开进场，是先手权的常规处理，
   * 也让「谁先动」这件事在时序轴上是有信息量的。
   *
   * 起跑排轴是**初始化**而不是战局事件，所以不播报 ——
   * 界面直接用 view().timeline 把初始的轴铺出来即可。
   */
  schedulePlayerTurn(state, 0, true);
  for (const e of state.enemies) {
    const first = e.def.moves[0]!;
    scheduleEnemyTurn(state, e, moveInterval(first.av, e.unit.speed), true);
  }

  // 把玩家的第一回合开起来：抽起手、给时能。事件留在缓冲里，
  // 界面通过 pending() 取走，于是「从头到尾的完整时间线」从开局就是完整的
  advance(state);

  return makeBattle(state);
}

// ==================== 事件 ====================

function emit(state: State, ev: BattleEvent): void {
  state.buffer.push(ev);
  state.history.push(ev);
}

function drain(state: State): BattleEvent[] {
  const out = state.buffer;
  state.buffer = [];
  return out;
}

// ==================== 时序轴 ====================

/**
 * 排入玩家的行动机会。
 *
 * `at` 是显式传入的，不在这里算：开局那一次落在 0 行动值（大家一起起跑），
 * 之后每次都从当前时刻再等一个标准间隔。把这两件事混在一个函数里，
 * 首回合就会被排到一个间隔之后，玩家打开战斗时已经白等了 100 行动值。
 */
function schedulePlayerTurn(state: State, at: number, silent = false): void {
  const entry: TimelineEntry = {
    id: state.nextId('turn'),
    owner: state.player.id,
    side: 'ally',
    at,
    kind: 'turn',
    label: '我'
  };
  state.queue.push(entry);
  if (!silent) emit(state, { k: 'schedule', entry: { ...entry } });
}

/** 排入敌人的下一次行动，标签与意图就是它接下来要出的那一招。`at` 语义同上 */
function scheduleEnemyTurn(state: State, e: EnemyRuntime, at: number, silent = false): void {
  const move = e.def.moves[e.moveIdx % e.def.moves.length]!;
  const entry: TimelineEntry = {
    id: state.nextId('turn'),
    owner: e.unit.id,
    side: 'foe',
    at,
    kind: 'turn',
    label: `${e.unit.name} · ${move.intent}`,
    moveId: move.id
  };
  state.queue.push(entry);
  if (!silent) emit(state, { k: 'schedule', entry: { ...entry } });
}

function scheduleCard(state: State, card: CardInstance, target: UnitId | undefined, delay: number): void {
  const entry: TimelineEntry = {
    id: state.nextId('card'),
    owner: state.player.id,
    side: 'ally',
    at: state.now + delay,
    kind: 'card',
    label: card.def.name,
    cardUid: card.uid
  };
  state.queue.push(entry);
  state.inFlight.set(card.uid, card);
  state.cardTargets.set(card.uid, target);
  emit(state, { k: 'schedule', entry: { ...entry } });
}

/** 一个单位在轴上最近的行动机会 */
function nextTurnEntryFor(state: State, id: UnitId): TimelineEntry | undefined {
  let best: TimelineEntry | undefined;
  for (const e of state.queue) {
    if (e.kind !== 'turn' || e.owner !== id) continue;
    if (!best || e.at < best.at) best = e;
  }
  return best;
}

function earliestCardEntry(state: State): TimelineEntry | undefined {
  let best: TimelineEntry | undefined;
  for (const e of state.queue) {
    if (e.kind !== 'card') continue;
    if (!best || e.at < best.at) best = e;
  }
  return best;
}

/**
 * 时间轴操作的下限：任何条目都不能被挪到当前时刻或更早。
 *
 * 用 `now + 1` 而不是 `now`，是为了保证**每次结算都让时钟严格前进**。
 * 否则一个「招式 av 很小、selfAv 很大」的敌人会把下一次行动钳在当前时刻，
 * 于是它在同一个行动值上反复出手，时钟再不前进 —— 战斗彻底卡死。
 * `cancel` 从一开始就是这么处理的，这里把它统一成一条有名字的规则。
 */
function avFloor(state: State): number {
  return state.now + 1;
}

// ==================== 查询 ====================

function findUnit(state: State, id: UnitId): UnitState | undefined {
  if (id === state.player.id) return state.player;
  return state.enemies.find((e) => e.unit.id === id)?.unit;
}

function livingEnemies(state: State): UnitState[] {
  return state.enemies.filter((e) => e.unit.alive).map((e) => e.unit);
}

/** 某个单位是否还活着。轴上的条目只在该单位的归属者活着时才展示给玩家 */
function isAliveOwner(state: State, owner: UnitId): boolean {
  if (owner === state.player.id) return state.player.alive;
  return state.enemies.some((e) => e.unit.id === owner && e.unit.alive);
}

// ==================== 伤害 ====================

/**
 * 伤害公式的唯一实现。
 *
 * 顺序：虚弱先削减攻击方输出（×0.75），易伤再放大受击方承伤（×1.5），
 * 两者都是乘算、在格挡之前结算，最后格挡吸收。
 * 「先算增减伤再扣格挡」是刻意的：易伤让格挡更快被打穿，符合直觉。
 */
export function computeDamage(
  amount: number,
  attackerWeak: boolean,
  targetVulnerable: boolean
): number {
  let dmg = amount;
  if (attackerWeak) dmg *= 0.75;
  if (targetVulnerable) dmg *= 1.5;
  return Math.max(0, Math.round(dmg));
}

function dealDamage(
  state: State,
  src: UnitId | null,
  target: UnitState,
  amount: number
): void {
  if (!target.alive) return;
  const attacker = src ? findUnit(state, src) : undefined;
  const dmg = computeDamage(amount, (attacker?.buffs.weak ?? 0) > 0, target.buffs.vulnerable > 0);
  const absorbed = Math.min(target.block, dmg);
  target.block -= absorbed;
  const hpLoss = dmg - absorbed;
  target.hp = Math.max(0, target.hp - hpLoss);

  emit(state, { k: 'damage', src, dst: target.id, amount: dmg, blocked: absorbed });

  if (target.hp === 0) {
    target.alive = false;
    emit(state, { k: 'death', unit: target.id });
    checkEnd(state);
  }
}

// ==================== 抽牌与时能 ====================

/** 把弃牌堆洗回抽牌堆。这是引擎里唯一用到随机源的地方，所以牌序完全由种子决定 */
function reshuffle(state: State): void {
  if (state.discardPile.length === 0) return;
  state.drawPile = state.rng.shuffle(state.discardPile);
  state.discardPile = [];
}

function drawCards(state: State, count: number): void {
  const drawn: CardUid[] = [];
  for (let i = 0; i < count; i++) {
    if (state.drawPile.length === 0) reshuffle(state);
    const card = state.drawPile.shift();
    if (!card) break;
    state.hand.push(card);
    drawn.push(card.uid);
  }
  if (drawn.length > 0) emit(state, { k: 'draw', unit: state.player.id, cards: drawn });
}

function addEnergy(state: State, delta: number): void {
  state.energy = Math.max(0, state.energy + delta);
  emit(state, { k: 'energy', unit: state.player.id, value: state.energy, delta });
}

// ==================== 效果结算 ====================

/**
 * 结算一组效果。
 *
 * 视角换算只在这里发生一次：`damage` 打向对手，`block` / `heal` / `speed`
 * 作用于行动者自己，`selfAv` / `targetAv` / `cancel` 分别对着自己和对手。
 * 内容数据各按自己的视角书写即可，读敌人招式时不必在脑子里做翻转。
 */
function applyEffects(
  state: State,
  effects: readonly Effect[],
  actorId: UnitId,
  targetId: UnitId | undefined
): void {
  const actor = findUnit(state, actorId);
  if (!actor) return;

  for (const ef of effects) {
    if (state.result !== null) return;

    switch (ef.t) {
      case 'damage': {
        const times = Math.max(1, ef.times ?? 1);
        for (let i = 0; i < times; i++) {
          const t = pickFoe(state, actor, targetId);
          if (!t) return;
          dealDamage(state, actorId, t, ef.amount);
          if (state.result !== null) return;
        }
        break;
      }

      case 'block':
        actor.block += ef.amount;
        emit(state, { k: 'block', dst: actor.id, amount: ef.amount });
        break;

      case 'heal': {
        if (!actor.alive) break;
        const before = actor.hp;
        actor.hp = Math.min(actor.maxHp, actor.hp + ef.amount);
        if (actor.hp !== before) emit(state, { k: 'heal', dst: actor.id, amount: actor.hp - before });
        break;
      }

      case 'draw':
        if (actor.side === 'ally') drawCards(state, ef.count);
        break;

      case 'energy':
        if (actor.side === 'ally') addEnergy(state, ef.amount);
        break;

      case 'selfAv': {
        const entry = nextTurnEntryFor(state, actorId);
        const moved = entry && shiftEntry(state.queue, entry.id, ef.amount, avFloor(state));
        if (moved) emit(state, { k: 'shift', unit: actorId, from: moved.from, to: moved.to });
        break;
      }

      case 'targetAv': {
        const t = pickFoe(state, actor, targetId);
        if (!t) break;
        const entry = nextTurnEntryFor(state, t.id);
        const moved = entry && shiftEntry(state.queue, entry.id, ef.amount, avFloor(state));
        if (moved) emit(state, { k: 'shift', unit: t.id, from: moved.from, to: moved.to });
        break;
      }

      case 'cancel': {
        const t = pickFoe(state, actor, targetId);
        if (!t) break;
        const entry = nextTurnEntryFor(state, t.id);
        if (!entry) break;
        removeEntry(state.queue, entry.id);
        emit(state, { k: 'cancel', owner: t.id, entryId: entry.id });
        // 取消不等于消失：同一招被推后 av 之后重新排上，它仍然会出招，只是晚了
        const pushed: TimelineEntry = {
          ...entry,
          id: state.nextId('turn'),
          at: Math.max(avFloor(state), entry.at + ef.av)
        };
        state.queue.push(pushed);
        emit(state, { k: 'schedule', entry: { ...pushed } });
        break;
      }

      case 'rush': {
        // 把最靠前的那张挂刻拉回来。没有挂刻时什么都不发生（空放）
        const cardEntry = earliestCardEntry(state);
        if (!cardEntry) break;
        const moved = shiftEntry(state.queue, cardEntry.id, -ef.amount, avFloor(state));
        if (moved) emit(state, { k: 'shift', unit: cardEntry.owner, from: moved.from, to: moved.to });
        break;
      }

      case 'vulnerable':
      case 'weak': {
        const who = ef.who === 'self' ? actor : pickFoe(state, actor, targetId);
        if (!who || !who.alive) break;
        who.buffs[ef.t] += ef.stacks;
        emit(state, { k: 'buff', dst: who.id, buff: ef.t, stacks: ef.stacks });
        break;
      }

      case 'speed':
        actor.speed = Math.max(1, actor.speed + ef.amount);
        emit(state, { k: 'speed', unit: actorId, value: actor.speed, delta: ef.amount });
        break;
    }
  }
}

/**
 * 取这次效果要打的对象。
 *
 * 指定目标还活着就用它；已经阵亡就改打一个活着的对手 ——
 * 挂刻从挂上到引爆之间隔了一段时间，目标可能先死于别的伤害，
 * 让整张牌白费会很挫败，所以这里改判而非丢弃。
 */
function pickFoe(state: State, actor: UnitState, targetId: UnitId | undefined): UnitState | undefined {
  const preferred = targetId ? findUnit(state, targetId) : undefined;
  if (preferred?.alive) return preferred;

  const pool = actor.side === 'ally' ? livingEnemies(state) : state.player.alive ? [state.player] : [];
  if (pool.length === 0) return undefined;
  // 目标活着时不该有随机；只有「原目标已死」这条罕见路径才需要重选
  return preferred ? state.rng.pick(pool) : pool[0];
}

// ==================== 回合流程 ====================

function startPlayerTurn(state: State): void {
  state.playerActing = true;
  state.round += 1;
  state.player.block = 0;
  emit(state, { k: 'turnStart', unit: state.player.id, round: state.round });
  state.energy = 0;
  addEnergy(state, state.energyPerTurn);
  drawCards(state, state.handSize);
  // 一开始就把下一次行动机会排上轴，玩家才能看清「下一次什么时候轮到我」。
  // 步频之后的变化只影响再下一次 —— 当回合的行动节奏已经定了，这样更好理解
  schedulePlayerTurn(state, state.now + avCost(state.player.speed));
}

function endPlayerTurn(state: State): void {
  state.playerActing = false;
  if (state.hand.length > 0) {
    const uids = state.hand.map((c) => c.uid);
    state.discardPile.push(...state.hand);
    state.hand = [];
    emit(state, { k: 'discard', unit: state.player.id, cards: uids });
  }
  decayBuffs(state.player);
  emit(state, { k: 'turnEnd', unit: state.player.id });
}

function decayBuffs(unit: UnitState): void {
  if (unit.buffs.vulnerable > 0) unit.buffs.vulnerable -= 1;
  if (unit.buffs.weak > 0) unit.buffs.weak -= 1;
}

function runEnemyTurn(state: State, entry: TimelineEntry): void {
  const rt = state.enemies.find((e) => e.unit.id === entry.owner);
  if (!rt || !rt.unit.alive) return;
  const unit = rt.unit;
  unit.block = 0;
  emit(state, { k: 'turnStart', unit: unit.id, round: state.round });

  /*
   * **先把自己的下一次行动排上轴，再结算这一招。**
   *
   * 顺序很关键：`advance()` 在调用本函数之前就已经把当前条目从轴上摘掉了，
   * 如果等到结算完才排下一条，那么招式效果里的 `selfAv` 会找不到可以挪动的条目
   * 而**静默失效** —— 抢拍体的「加速 -30」与失序使的「倒拨 -40」就一直是空转的，
   * 而它们的招式轮转表还明明白白展示给玩家。
   *
   * 玩家回合用的是同一个顺序（`startPlayerTurn` 一开始就排下一次），
   * 所以这样改之后双方的时间轴操作才是对称的。
   *
   * 间隔取自接下来要出的那一招：这样轴上的标签与「它多久之后发生」是同一件事。
   */
  rt.moveIdx = (rt.moveIdx + 1) % rt.def.moves.length;
  const nextMove = rt.def.moves[rt.moveIdx]!;
  scheduleEnemyTurn(state, rt, state.now + moveInterval(nextMove.av, unit.speed));

  const move =
    rt.def.moves.find((m) => m.id === entry.moveId) ??
    rt.def.moves[(rt.moveIdx - 1 + rt.def.moves.length) % rt.def.moves.length]!;
  applyEffects(state, move.effects, unit.id, state.player.id);

  if (state.result !== null) return;
  decayBuffs(unit);
  emit(state, { k: 'turnEnd', unit: unit.id });
}

function resolveCardEntry(state: State, entry: TimelineEntry): void {
  // 调用方已经把这条从轴上摘掉了，这里只补一条「它引爆了」的事件
  emit(state, { k: 'resolve', entryId: entry.id });

  const uid = entry.cardUid;
  const card = uid ? state.inFlight.get(uid) : undefined;
  if (uid) {
    state.inFlight.delete(uid);
  }
  if (!card) return;

  const target = uid ? state.cardTargets.get(uid) : undefined;
  if (uid) state.cardTargets.delete(uid);

  applyEffects(state, card.def.effects, state.player.id, target);
  state.discardPile.push(card);
  // 播报一声，界面才知道这张牌从轴上飞进了归档。
  // 少了这条，「牌数守恒」就没法被界面或测试核对
  emit(state, { k: 'discard', unit: state.player.id, cards: [card.uid] });
}

function checkEnd(state: State): void {
  if (state.result !== null) return;
  if (!state.player.alive) {
    state.result = 'lose';
    state.playerActing = false;
    emit(state, { k: 'end', result: 'lose', rounds: state.round });
    return;
  }
  if (state.enemies.every((e) => !e.unit.alive)) {
    state.result = 'win';
    state.playerActing = false;
    emit(state, { k: 'end', result: 'win', rounds: state.round });
  }
}

/** 把时钟往前推，直到下一次轮到我方，或者分出胜负 */
function advance(state: State): void {
  let guard = 0;
  while (state.result === null && !state.playerActing) {
    /*
     * 触发上限时**必须抛错，不能静默 break**。
     *
     * 静默 break 会留下一个更糟的状态：`playerActing` 还是 false，结果也还是 null，
     * 于是界面看起来一切正常（手牌可以点、结束回合可点），但每次出牌都被
     * 「现在不是你的回合」弹回来，时钟永远停在那一格 —— 玩家完全看不出发生了什么。
     * 抛错则会被 main.ts 的渲染兜底接住，显示成可读的崩溃界面。
     */
    if (guard++ > MAX_STEPS) {
      throw new Error(
        `一次推进结算了超过 ${MAX_STEPS} 个条目仍未轮到玩家：时间轴可能陷入了循环。` +
          `请检查是否有招式的 av 与 selfAv 组合会让某个单位在同一行动值上反复出手`
      );
    }
    const next = peekNext(state.queue);
    if (!next) break;

    state.now = next.at;
    emit(state, { k: 'clock', at: state.now });

    if (next.kind === 'turn' && next.owner === state.player.id) {
      removeEntry(state.queue, next.id);
      startPlayerTurn(state);
      return;
    }

    removeEntry(state.queue, next.id);
    if (next.kind === 'card') resolveCardEntry(state, next);
    else if (next.kind === 'turn') runEnemyTurn(state, next);
    // aura 等其它类型的条目在后续里程碑接入
  }
}

// ==================== 对外接口 ====================

function makeBattle(state: State): Battle {
  return {
    view(): PlayerView {
      return {
        now: state.now,
        round: state.round,
        energy: state.energy,
        energyPerTurn: state.energyPerTurn,
        hand: [...state.hand],
        drawCount: state.drawPile.length,
        discardCount: state.discardPile.length,
        me: cloneUnit(state.player),
        enemies: state.enemies
          .filter((e) => e.unit.alive)
          .map((e) => ({
            ...cloneUnit(e.unit),
            moves: e.def.moves.map((m) => ({ intent: m.intent, av: m.av })),
            nextMoveIndex: e.moveIdx % e.def.moves.length
          })),
        /*
         * 轴上也只留活人的条目。
         *
         * 敌人阵亡时它在轴上的下一次行动**不会被摘掉** —— 它只会在时钟走到那一刻
         * 被 advance() 顺手弹出，然后 runEnemyTurn 因为目标已死而静默返回。
         * 如果那一击正好结束了战斗，时钟甚至不会再走，这条就永远留在队列里。
         * 不过滤的话，玩家会在一具尸体的位置看到它的下一步行动，
         * 而且是结算浮层（半透明）背后那一条擦不掉的残留。
         *
         * 过滤放在 view 而不是引擎队列上：队列保持「真实发生过什么」的完整记录，
         * view 才是玩家看到的那份投影。
         */
        timeline: orderedSnapshot(state.queue)
          .filter((e) => isAliveOwner(state, e.owner))
          .map((e) => ({ ...e }))
      };
    },

    pending(): BattleEvent[] {
      return drain(state);
    },

    playCard(cardUid: CardUid, target?: UnitId): BattleStep {
      if (state.result !== null) return { events: drain(state), result: state.result };
      if (!state.playerActing) {
        emit(state, { k: 'rejected', reason: '现在不是你的回合' });
        return { events: drain(state), result: null };
      }

      const idx = state.hand.findIndex((c) => c.uid === cardUid);
      if (idx < 0) {
        emit(state, { k: 'rejected', reason: '这张刻印不在手上' });
        return { events: drain(state), result: null };
      }
      const card = state.hand[idx]!;
      if (card.def.cost > state.energy) {
        emit(state, { k: 'rejected', reason: `时能不足，需要 ${card.def.cost}` });
        return { events: drain(state), result: null };
      }

      const effectiveTarget = autoTarget(state, card, target);

      state.hand.splice(idx, 1);
      addEnergy(state, -card.def.cost);
      emit(state, {
        k: 'play',
        unit: state.player.id,
        cardUid: card.uid,
        cardId: card.def.id,
        target: effectiveTarget
      });

      if (card.def.kind === 'deferred') {
        scheduleCard(state, card, effectiveTarget, card.def.delay ?? 0);
      } else {
        applyEffects(state, card.def.effects, state.player.id, effectiveTarget);
        state.discardPile.push(card);
      }

      return { events: drain(state), result: state.result };
    },

    endTurn(): BattleStep {
      if (state.result !== null) return { events: drain(state), result: state.result };
      if (state.playerActing) endPlayerTurn(state);
      advance(state);
      return { events: drain(state), result: state.result };
    },

    isOver(): boolean {
      return state.result !== null;
    },

    outcome(): BattleResult | null {
      return state.result;
    },

    history(): readonly BattleEvent[] {
      return state.history;
    }
  };
}

/**
 * 决定这张牌打谁。
 * - `self` 类永远打自己，界面传什么都会被忽略，免得「守刻打敌人」这种荒唐事发生
 * - `enemy` 类优先用界面选的目标，没给就自动选第一个活着的
 * - `none` 类（并轨这类）不需要目标
 */
function autoTarget(state: State, card: CardInstance, target?: UnitId): UnitId | undefined {
  if (card.def.target === 'none') return undefined;
  if (card.def.target === 'self') return state.player.id;
  const preferred = target ? findUnit(state, target) : undefined;
  if (preferred?.alive) return preferred.id;
  return livingEnemies(state)[0]?.id;
}

function cloneUnit(u: UnitState): UnitState {
  return { ...u, buffs: { ...u.buffs } };
}
