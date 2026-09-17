import { describe, expect, it } from 'vitest';
import {
  ALL_CARDS,
  PLAYER,
  UNKNOWN_CARD,
  cardOr,
  findCard,
  findEnemy,
  findEncounter,
  starterDeckIds,
  validateContent
} from '../src/content';
import { REWARD_CARDS, STARTER_CARDS, STARTER_DECK } from '../src/content/cards';
import { ENCOUNTERS, ENEMIES } from '../src/content/enemies';
import type { CardDef, Effect } from '../src/engine/types';
import { BASE_AV, BASE_SPEED, avCost, moveInterval } from '../src/engine/types';

// ==================== 数值抽取 ====================

function sumOf(c: CardDef, pick: (e: Effect) => number): number {
  let sum = 0;
  for (const e of c.effects) sum += pick(e);
  return sum;
}

/** 一张刻印的总伤害（多段按次数累加） */
function damageTotal(c: CardDef): number {
  return sumOf(c, (e) => (e.t === 'damage' ? e.amount * (e.times ?? 1) : 0));
}

function blockTotal(c: CardDef): number {
  return sumOf(c, (e) => (e.t === 'block' ? e.amount : 0));
}

/**
 * 每点时能的产出。
 *
 * 0 费牌返回 undefined 并被排除在性价比比较之外：它的比值是无穷大，
 * 会把「即时刻印的上限」顶成 Infinity，让整条不变式失去意义。
 * 0 费牌的代价是卡位与抽牌，拿它跟付费牌比能量效率本身就是错的口径。
 */
function perEnergy(card: CardDef, total: number): number | undefined {
  if (card.cost <= 0 || total <= 0) return undefined;
  return total / card.cost;
}

function ceilingOf(cards: CardDef[], total: (c: CardDef) => number): number {
  const values = cards
    .map((c) => perEnergy(c, total(c)))
    .filter((v): v is number => v !== undefined);
  expect(values.length, '参与比较的牌不该为空').toBeGreaterThan(0);
  return Math.max(...values);
}

const PAY = (c: CardDef): boolean => c.cost > 0;

// ==================== 内容校验 ====================

describe('内容校验', () => {
  it('全部内容通过校验（失败时逐条打印问题）', () => {
    const issues = validateContent();
    const report = issues.map((i) => `${i.where}: ${i.msg}`).join('\n');
    expect(issues, `内容校验未通过：\n${report}`).toEqual([]);
  });

  it('刻印 id 全局唯一（起始表与奖励池之间也不许重名）', () => {
    const ids = ALL_CARDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('刻印总数不低于 30，三种形态各有足够的选择面', () => {
    /*
     * 这里刻意用「不少于」而不是「恰好」。
     *
     * 精确计数不提供任何保护 —— 加一张牌本来就不该让测试变红，
     * 它只否定了项目对外的承诺：加一张刻印只改一个文件。
     * 真正的守线是各形态的下限（下面三条）与内容校验，
     * 它们能在「卡池被掏空」时报警，而不会拦住正常的扩池。
     */
    expect(ALL_CARDS.length).toBeGreaterThanOrEqual(30);
    const byKind = (k: CardDef['kind']): number => ALL_CARDS.filter((c) => c.kind === k).length;
    expect(byKind('instant')).toBeGreaterThanOrEqual(9);
    expect(byKind('deferred')).toBeGreaterThanOrEqual(8);
    expect(byKind('shift')).toBeGreaterThanOrEqual(6);
  });

  it('起始牌组展开后数量正确且每张都能查到', () => {
    const ids = starterDeckIds();
    const total = STARTER_DECK.reduce((n, e) => n + e.count, 0);
    expect(ids.length).toBe(total);
    expect(total).toBe(10);
    for (const id of ids) expect(findCard(id), `起始牌组引用 ${id} 查不到`).toBeDefined();
  });

  it('起始牌组三种形态都有覆盖 —— 第一场战斗就该看到核心机制', () => {
    const kinds = new Set(starterDeckIds().map((id) => cardOr(id).kind));
    expect([...kinds].sort()).toEqual(['deferred', 'instant', 'shift']);
  });

  it('起始刻印都来自起始表，奖励刻印不混入起始牌组', () => {
    const starterIds = new Set(STARTER_CARDS.map((c) => c.id));
    const rewardIds = new Set(REWARD_CARDS.map((c) => c.id));
    for (const entry of STARTER_DECK) {
      expect(starterIds.has(entry.cardId), `${entry.cardId} 不在起始表里`).toBe(true);
      expect(rewardIds.has(entry.cardId), `${entry.cardId} 不该出现在起始牌组`).toBe(false);
    }
  });

  it('刻印文本一律用 ASCII 连字符，不用排版减号（否则内容校验解析不了）', () => {
    for (const c of ALL_CARDS) {
      expect(c.text.includes('\u2212'), `${c.id} 的 text 用了排版减号 U+2212`).toBe(false);
    }
  });
});

// ==================== 核心设计不变式 ====================

describe('核心设计不变式', () => {
  /**
   * 挂刻牌的报酬必须兑现。玩家愿意承担「赌未来」的唯一理由就是同样的时能
   * 能打出更高的数值；如果哪次调数值把这个关系调没了，机制就变成了纯粹的惩罚。
   */
  it('付费挂刻牌的伤害/时能严格高于付费即时刻印的上限', () => {
    const instantMax = ceilingOf(
      ALL_CARDS.filter((c) => c.kind === 'instant' && PAY(c) && damageTotal(c) > 0),
      damageTotal
    );
    const deferred = ALL_CARDS.filter((c) => c.kind === 'deferred' && PAY(c) && damageTotal(c) > 0);
    expect(deferred.length).toBeGreaterThan(0);

    for (const c of deferred) {
      const v = perEnergy(c, damageTotal(c))!;
      expect(
        v,
        `${c.name} 的伤害/时能是 ${v}，没有超过即时刻印上限 ${instantMax} —— 没人会用它`
      ).toBeGreaterThan(instantMax);
    }
  });

  it('付费挂刻牌的格挡/时能严格高于付费即时刻印的上限', () => {
    const instantMax = ceilingOf(
      ALL_CARDS.filter((c) => c.kind === 'instant' && PAY(c) && blockTotal(c) > 0),
      blockTotal
    );
    const deferred = ALL_CARDS.filter((c) => c.kind === 'deferred' && PAY(c) && blockTotal(c) > 0);
    expect(deferred.length, '挂刻里应当有延迟格挡这类牌').toBeGreaterThan(0);

    for (const c of deferred) {
      expect(
        perEnergy(c, blockTotal(c))!,
        `${c.name} 的格挡/时能没有超过即时刻印上限 ${instantMax}`
      ).toBeGreaterThan(instantMax);
    }
  });

  it('0 费牌确实存在，并且被明确排除在性价比比较之外', () => {
    // 记下这个排除是有意的：0 费牌的代价是卡位与抽牌，不是时能
    const free = ALL_CARDS.filter((c) => c.cost === 0);
    expect(free.length).toBeGreaterThan(0);
    for (const c of free) {
      expect(perEnergy(c, damageTotal(c) + blockTotal(c))).toBeUndefined();
    }
  });

  it('挂刻牌的延迟必须与一次标准行动可比拟', () => {
    /*
     * 理论上挂刻牌只要「延迟 > 0」就成立，但那样延迟 5 的牌在实战里几乎等于
     * 立即生效 —— 玩家看不到排序问题，机制就退化成了一个装饰。要求延迟至少
     * 达到半次标准行动，才能保证「它会不会赶在敌人之前落地」是个真问题。
     */
    const floor = BASE_AV / 2;
    for (const c of ALL_CARDS.filter((x) => x.kind === 'deferred')) {
      expect(
        c.delay!,
        `${c.name} 的延迟只有 ${c.delay}，低于半次标准行动 ${floor} —— 挂刻就没意义了`
      ).toBeGreaterThanOrEqual(floor);
    }
  });

  it('全场最大单次伤害来自挂刻牌', () => {
    // 想打出大数字就必须接受延迟，这是机制的价格标签
    const biggest = (cards: CardDef[]): number => {
      let max = 0;
      for (const c of cards) {
        for (const e of c.effects) {
          if (e.t === 'damage') max = Math.max(max, e.amount);
        }
      }
      return max;
    };
    const deferredBest = biggest(ALL_CARDS.filter((c) => c.kind === 'deferred'));
    const instantBest = biggest(ALL_CARDS.filter((c) => c.kind === 'instant'));
    expect(deferredBest).toBeGreaterThan(instantBest);
  });

  it('校正牌不含任何伤害或格挡效果', () => {
    const allowed = new Set(['selfAv', 'targetAv', 'cancel', 'rush', 'speed']);
    for (const c of ALL_CARDS.filter((x) => x.kind === 'shift')) {
      for (const e of c.effects) {
        expect(allowed.has(e.t), `${c.name} 是校正牌，却带了 ${e.t} 效果`).toBe(true);
      }
    }
  });

  it('每个费用档都有牌可出，否则某个回合只能空过', () => {
    const costs = new Set(ALL_CARDS.map((c) => c.cost));
    for (let cost = 0; cost <= PLAYER.energyPerTurn; cost++) {
      expect(costs.has(cost), `没有任何 ${cost} 费的刻印`).toBe(true);
    }
  });
});

// ==================== 查询接口绝不抛错 ====================

describe('查询接口绝不抛错', () => {
  it('findCard 对未知 id 返回 undefined', () => {
    expect(findCard('__不存在__')).toBeUndefined();
    expect(findCard('')).toBeUndefined();
  });

  it('cardOr 对未知 id 返回占位卡面（存档脏数据不该把界面打成白屏）', () => {
    expect(cardOr('__不存在__')).toBe(UNKNOWN_CARD);
    expect(UNKNOWN_CARD.name.length).toBeGreaterThan(0);
    expect(cardOr('calibrate').name).toBe('校准');
  });

  it('findEnemy / findEncounter 对未知 id 返回 undefined', () => {
    expect(findEnemy('__不存在__')).toBeUndefined();
    expect(findEncounter('__不存在__')).toBeUndefined();
  });

  it('占位卡面自身也能通过文本与效果的一致性检查', () => {
    expect(UNKNOWN_CARD.effects).toEqual([]);
    expect(UNKNOWN_CARD.text.length).toBeGreaterThan(0);
  });
});

// ==================== 畸变体与遭遇 ====================

describe('畸变体与遭遇', () => {
  it('普通 / 精英 / 首领三档遭遇都存在', () => {
    const kinds = new Set(ENCOUNTERS.map((e) => e.kind));
    expect([...kinds].sort()).toEqual(['boss', 'elite', 'normal']);
  });

  it('每个敌人的招式不少于 2 个，否则轮转退化成固定重复', () => {
    for (const e of ENEMIES) {
      expect(e.moves.length, `${e.name} 只有 ${e.moves.length} 个招式`).toBeGreaterThanOrEqual(2);
    }
  });

  it('敌人之间速度有差异，时序轴的先后关系才有意义', () => {
    const speeds = new Set(ENEMIES.map((e) => e.speed));
    expect(speeds.size).toBeGreaterThan(1);
  });
});

// ==================== 时序数值换算 ====================

describe('时序数值换算', () => {
  it(`步频 ${BASE_SPEED} 的单位行动一次正好占 ${BASE_AV} 行动值`, () => {
    expect(avCost(BASE_SPEED)).toBe(BASE_AV);
  });

  it('步频翻倍 → 行动间隔减半；步频减半 → 间隔翻倍', () => {
    expect(avCost(200)).toBe(50);
    expect(avCost(50)).toBe(200);
  });

  it('招式的固有消耗按步频缩放', () => {
    // 步频 130 的单位用 av=100 的招式，实际只隔 77 行动值，会比标准单位更快
    expect(moveInterval(100, 130)).toBe(77);
    expect(moveInterval(100, 100)).toBe(100);
    expect(moveInterval(100, 90)).toBe(111);
  });

  it('极端输入不会产生 0 或负数间隔（会导致死循环）', () => {
    expect(moveInterval(0, 100)).toBe(1);
    expect(moveInterval(100, 0)).toBeGreaterThan(0);
    expect(avCost(0)).toBeGreaterThan(0);
    expect(avCost(1)).toBeGreaterThan(0);
  });
});
