import { describe, expect, it } from 'vitest';
import { computeDamage, createBattle as rawCreateBattle } from '../src/engine/combat';
import { greedyPolicy, scriptedPolicy, simulateBattle } from '../src/engine/policy';
import { compareEntries } from '../src/engine/timeline';
import type {
  BattleEvent,
  BattleInput,
  CardDef,
  CardInstance,
  EnemyDef,
  EnemyMoveDef,
  PlayerAction,
  TimelineEntry
} from '../src/engine/types';

/**
 * 引擎规则测试。
 *
 * 这里用的都是**临时构造的刻印与敌人**，不是内容表里的真货：
 * 规则是否正确与数值是否合适是两件事，混在一起会让调平衡时一堆测试变红，
 * 于是没人敢调平衡。真实内容的整体表现放在 balance / soak 里测。
 */

// ==================== 测试夹具 ====================

let uidSeq = 0;
function inst(def: CardDef): CardInstance {
  uidSeq += 1;
  return { uid: `u${uidSeq}`, def };
}

function def(partial: Partial<CardDef> & Pick<CardDef, 'id' | 'effects'>): CardDef {
  return {
    name: partial.id,
    kind: 'instant',
    cost: 1,
    target: 'enemy',
    text: '',
    ...partial
  } as CardDef;
}

/** 6 点伤害，1 费 */
const HIT = def({ id: 'hit', name: '击', effects: [{ t: 'damage', amount: 6 }] });
/** 5 点格挡，1 费，自指 */
const GUARD = def({ id: 'guard', name: '守', target: 'self', effects: [{ t: 'block', amount: 5 }] });
/** 挂刻：延迟 D 后造成 N 伤害 */
function delayed(id: string, amount: number, delay: number, cost = 1): CardDef {
  return def({ id, name: id, kind: 'deferred', cost, delay, effects: [{ t: 'damage', amount }] });
}

const SWIPE: EnemyMoveDef = {
  id: 'swipe',
  name: '挥击',
  intent: '挥击 8',
  text: '造成 8 点伤害',
  av: 100,
  effects: [{ t: 'damage', amount: 8 }]
};
const BRACE: EnemyMoveDef = {
  id: 'brace',
  name: '蓄势',
  intent: '蓄势 5',
  text: '获得 5 点格挡',
  av: 100,
  effects: [{ t: 'block', amount: 5 }]
};

/** 只有一招、且带自身行动值提前的敌人，用来验证 selfAv 真的生效 */
const HASTE_ONLY: EnemyMoveDef = {
  id: 'haste',
  name: '加速',
  intent: '加速',
  text: '自身行动值 -30',
  av: 100,
  effects: [{ t: 'selfAv', amount: -30 }]
};

function foe(hp = 100, speed = 100, name = '木桩'): EnemyDef {
  return { id: `dummy_${name}`, name, hp, speed, moves: [SWIPE, BRACE] };
}

const PLAYER = { name: '测', maxHp: 70, speed: 100, energyPerTurn: 3, handSize: 5 };

function input(deck: CardInstance[], enemies: EnemyDef[], seed = 1): BattleInput {
  return {
    seed,
    player: PLAYER,
    enemies,
    /*
     * 按位置重编 uid。
     * 否则 uid 会带上「这个进程里造过多少张牌」的全局计数，两副内容完全相同的
     * 牌组会拿到不同的 uid —— 而 uid 会出现在事件流里，
     * 「同种子同操作 → 逐条相同的事件流」这类断言就会被无关的计数差打败。
     */
    deck: deck.map((c, i) => ({ uid: `c${i}`, def: c.def }))
  };
}

/** 手牌里第一张指定 id 的刻印 */
function handCard(battle: { view: () => { hand: CardInstance[] } }, id: string): CardInstance {
  const c = battle.view().hand.find((x) => x.def.id === id);
  if (!c) throw new Error(`手上没有 ${id}，现有：${battle.view().hand.map((x) => x.def.id).join(',')}`);
  return c;
}

/** 造一副全是同一张牌的牌组 */
function buildDeck(n: number, d: CardDef): CardInstance[] {
  return Array.from({ length: n }, () => inst(d));
}

/**
 * 建一场战斗，并把开局事件先取走。
 *
 * 开局（时钟归零、第一回合开始、起手抽牌）也是事件，它们躺在缓冲里等着被取。
 * 测试几乎都只关心「玩家操作之后发生了什么」，所以这里统一先清一遍 ——
 * 否则每条断言都得自己减掉开场那几条。
 */
function createBattle(i: BattleInput) {
  const battle = rawCreateBattle(i);
  battle.pending();
  return battle;
}

function kinds(events: readonly BattleEvent[]): string[] {
  return events.map((e) => e.k);
}

/** 某类事件出现的下标，用于断言「谁先谁后」 */
function indexOfEvent(
  events: readonly BattleEvent[],
  match: (e: BattleEvent) => boolean
): number {
  return events.findIndex(match);
}

// ==================== 时序排序 ====================

describe('时序排序', () => {
  it('所有人从 0 行动值起跑，同为行动机会时玩家先手', () => {
    const battle = createBattle(input([inst(HIT)], [foe()]));
    const view = battle.view();
    // 玩家先手：开局直接进入玩家回合，敌人还没动
    expect(view.now).toBe(0);
    expect(view.round).toBe(1);
    expect(view.me.hp).toBe(70);
    expect(battle.isOver()).toBe(false);
  });

  it('步频高的敌人在你第二次行动之前就动过手', () => {
    // 敌人步频 130 → 它第一次行动排在 77，早于玩家的第二次行动（100）；
    // 出招后按同一节奏再排，下一次落在 154
    const battle = createBattle(input([inst(HIT)], [foe(100, 130)]));
    const step = battle.endTurn();

    expect(battle.view().now, '玩家第二次行动落在 100').toBe(100);
    expect(
      step.events.filter((e) => e.k === 'turnStart' && e.unit === 'e0').length,
      '步频 130 的敌人在玩家两次行动之间插进来一次'
    ).toBe(1);
    expect(
      battle.view().timeline.filter((e) => e.owner === 'e0')[0]!.at,
      '它的下一次落在 154'
    ).toBe(154);
  });

  it('步频低的敌人会被玩家连打两次才轮到它', () => {
    // 敌人步频 90 → 第一次行动排在 111，晚于玩家的第二次行动（100）
    const battle = createBattle(input([inst(HIT)], [foe(100, 90)]));
    const step = battle.endTurn();

    expect(battle.view().now, '玩家已经轮到了第二次').toBe(100);
    expect(
      step.events.filter((e) => e.k === 'turnStart' && e.unit === 'e0').length,
      '敌人一次都还没动'
    ).toBe(0);
    expect(
      battle.view().timeline.filter((e) => e.owner === 'e0')[0]!.at,
      '敌人的第一次行动要等到 111'
    ).toBe(111);
  });

  /**
   * 本作最重要的一条规则：同一行动值上，挂刻 → 玩家 → 敌人。
   *
   * 构造得刚好：玩家与敌人步频都是 100、敌人招式也是 av 100，
   * 于是玩家在 0 行动值挂一张延迟 100 的刻印之后，
   * **100 行动值上同时出现三件事**：挂刻引爆、玩家第二次行动、敌人第一次行动。
   * 正确的顺序是挂刻先炸、玩家接着行动，而敌人还排在后面没动。
   */
  it('同一行动值上：挂刻先引爆，然后玩家，最后才轮到敌人', () => {
    const battle = createBattle(input([inst(delayed('bomb', 20, 100)), inst(HIT)], [foe()]));

    battle.playCard(handCard(battle, 'bomb').uid);
    const step = battle.endTurn();

    // 推进到 100，并且已经轮到我方
    const view = battle.view();
    expect(view.now).toBe(100);
    expect(view.round).toBe(2);

    // 挂刻在玩家的第二次行动**之前**引爆
    const resolveAt = indexOfEvent(step.events, (e) => e.k === 'resolve');
    const playerTurnAt = indexOfEvent(step.events, (e) => e.k === 'turnStart' && e.unit === 'player');
    expect(resolveAt, '挂刻没有引爆').toBeGreaterThanOrEqual(0);
    expect(playerTurnAt, '玩家没有进入第二回合').toBeGreaterThanOrEqual(0);
    expect(resolveAt, '挂刻应当在玩家行动之前引爆').toBeLessThan(playerTurnAt);

    // 敌人同样排在 100 行动值上，但排在玩家之后 —— 所以它此刻还没出手
    expect(
      view.timeline.filter((e) => e.owner === 'e0' && e.at === 100).length,
      '敌人应当也排在 100 行动值上'
    ).toBe(1);
    expect(view.me.hp, '玩家的先手让它挡在了敌人前面，一点血都没掉').toBe(70);
  });

  it('排序规则本身：先比时刻，再比同刻优先级，同为行动机会时玩家先手', () => {
    const e = (partial: Partial<TimelineEntry>): TimelineEntry => ({
      id: 'x',
      owner: 'player',
      side: 'ally',
      at: 0,
      kind: 'turn',
      label: '',
      ...partial
    });

    expect(compareEntries(e({ at: 10 }), e({ at: 20 }))).toBeLessThan(0);
    // 挂刻先于行动机会
    expect(compareEntries(e({ kind: 'card' }), e({ kind: 'turn' }))).toBeLessThan(0);
    // 同为行动机会时玩家先手
    expect(compareEntries(e({ side: 'ally' }), e({ side: 'foe' }))).toBeLessThan(0);
    expect(compareEntries(e({ side: 'foe' }), e({ side: 'ally' }))).toBeGreaterThan(0);
    // 完全相同时返回 0，交给稳定排序保持入队顺序
    expect(compareEntries(e({}), e({}))).toBe(0);
  });
});

// ==================== 挂刻 ====================

describe('挂刻', () => {
  it('挂刻不立刻结算，而是在延迟之后引爆', () => {
    const battle = createBattle(input([inst(delayed('bomb', 20, 60))], [foe()]));
    const enemyHp = battle.view().enemies[0]!.hp;

    const played = battle.playCard(handCard(battle, 'bomb').uid);
    expect(kinds(played.events)).toContain('schedule');
    expect(kinds(played.events), '挂刻不该立刻造成伤害').not.toContain('damage');
    expect(battle.view().enemies[0]!.hp).toBe(enemyHp);

    const entry = battle.view().timeline.find((e) => e.kind === 'card');
    expect(entry?.at).toBe(60);
    expect(entry?.label).toBe('bomb');

    // 推进到 60 才引爆
    battle.endTurn();
    expect(battle.view().enemies[0]!.hp).toBeLessThan(enemyHp);
  });

  it('挂刻的目标在挂上的一刻就锁定，不会因为后来改了目标而漂移', () => {
    const battle = createBattle(input([inst(delayed('bomb', 20, 100))], [foe(100, 100, '甲'), foe(100, 100, '乙')]));
    const targetId = battle.view().enemies[1]!.id;
    battle.playCard(handCard(battle, 'bomb').uid, targetId);
    battle.endTurn();

    // 引爆后，受伤的应该是当初选的那个，另一个分毫无损
    const before = { a: battle.view().enemies[0]!.hp, b: battle.view().enemies[1]!.hp };
    expect(before.b, '被指定的目标吃了伤害').toBeLessThan(100);
    expect(before.a, '没被指定的目标不该掉血').toBe(100);
  });

  it('目标在引爆前已阵亡时改打别的敌人，不白费一张牌', () => {
    // 木桩甲只有 1 血，会被即时的击打死；挂刻仍然要落在一个活着的敌人身上
    const battle = createBattle(input([inst(HIT), inst(delayed('bomb', 20, 100))], [foe(1, 100, '甲'), foe(100, 100, '乙')]));
    const fragile = battle.view().enemies.find((e) => e.hp === 1)!;
    battle.playCard(handCard(battle, 'bomb').uid, fragile.id);
    battle.playCard(handCard(battle, 'hit').uid, fragile.id);
    expect(battle.view().enemies.length, '甲应当已阵亡').toBe(1);

    const survivorHp = battle.view().enemies[0]!.hp;
    battle.endTurn();
    expect(battle.view().enemies[0]!.hp, '挂刻应改打活着的那个').toBeLessThan(survivorHp);
  });

  it('引爆后进入弃牌堆，不会凭空消失', () => {
    const battle = createBattle(input([inst(delayed('bomb', 20, 60)), inst(HIT)], [foe()]));
    const bomb = handCard(battle, 'bomb');
    expect(battle.view().discardCount).toBe(0);

    battle.playCard(bomb.uid);
    expect(battle.view().discardCount, '在飞期间不占弃牌堆').toBe(0);

    const step = battle.endTurn();
    const discarded = step.events
      .filter((e) => e.k === 'discard')
      .flatMap((e) => (e.k === 'discard' ? e.cards : []));
    expect(discarded, '引爆之后应当有一声归档播报').toContain(bomb.uid);
  });
});

describe('敌我状态与轴的可见性', () => {
  it('敌人的「自身行动值提前」真的会生效', () => {
    /*
     * 这条守的是一个真实翻过的车：`advance()` 在调用 runEnemyTurn 之前就把敌人
     * 当前的行动条目从轴上摘掉了，而原来要到结算完这一招才排下一条 ——
     * 于是效果里的 selfAv 调 nextTurnEntryFor(自己) 什么都找不到，**静默失效**。
     * 抢拍体的「加速 -30」与失序使的「倒拨 -40」因此从未生效过，
     * 而它们的招式轮转表还明明白白展示给玩家。
     *
     * 算术：敌人步频 100、招式 av 100 → 出手后把下一次排在 200，再被提前 30 到 170。
     * 这里断言 shift 事件本身，而不是轴上的最终值 —— 后者会被后续连锁影响，
     * 而 shift 事件的 from/to 直接就是这个机制有没有跑起来的证据。
     */
    const hasteFoe: EnemyDef = {
      id: 'haste_foe',
      name: '抢拍体',
      hp: 300,
      speed: 100,
      moves: [HASTE_ONLY]
    };
    const battle = createBattle(input(buildDeck(8, HIT), [hasteFoe]));

    // 第一次结束回合只是走到玩家第二回合（双方同在 100，玩家先手），敌人还没出手
    battle.endTurn();
    const step = battle.endTurn();

    expect(
      step.events.some((e) => e.k === 'turnStart' && e.unit === 'e0'),
      '这一步里敌人应当出手了'
    ).toBe(true);

    const shifted = step.events.find((e) => e.k === 'shift' && e.unit === 'e0');
    expect(shifted, 'selfAv 完全没有产生 shift 事件 —— 它又空转了').toBeDefined();
    if (shifted?.k === 'shift') {
      expect(shifted.from, '出手后下一次本应排在 200').toBe(200);
      expect(shifted.to, '提前 30 之后应当是 170').toBe(170);
    }
  });

  it('阵亡的敌人不会在时序轴上留下幽灵条目', () => {
    /*
     * 敌人阵亡时它在轴上的下一次行动不会被摘掉 —— 只会在时钟走到那一刻被顺手弹出，
     * 而如果那一击正好结束了战斗，时钟甚至不会再走，这条就永远留着。
     * 玩家会在一具尸体的位置看到它的下一步行动。
     */
    const battle = createBattle(
      input([inst(def({ id: 'nuke', cost: 0, effects: [{ t: 'damage', amount: 999 }] })), inst(HIT)], [
        foe(50, 100, '甲'),
        foe(50, 100, '乙')
      ])
    );
    const doomed = battle.view().enemies[0]!.id;
    const survivor = battle.view().enemies[1]!.id;

    battle.playCard(handCard(battle, 'nuke').uid, doomed);

    const timeline = battle.view().timeline;
    expect(
      timeline.some((e) => e.owner === doomed),
      '阵亡敌人的行动条目不该出现在玩家看到的轴上'
    ).toBe(false);
    expect(
      timeline.some((e) => e.owner === survivor),
      '活着的敌人应当仍然留在轴上'
    ).toBe(true);
    expect(
      timeline.some((e) => e.owner === 'player'),
      '自己的条目当然不受影响'
    ).toBe(true);
  });

  it('阵亡之后轴的过滤对后续事件同样成立', () => {
    // 再走一步，确认不是只在击杀的那一帧对
    const battle = createBattle(
      input(buildDeck(8, HIT), [foe(1, 100, '甲'), foe(200, 100, '乙')])
    );
    const doomed = battle.view().enemies[0]!.id;
    battle.playCard(handCard(battle, 'hit').uid, doomed);
    expect(battle.view().enemies.length).toBe(1);
    battle.endTurn();

    expect(
      battle.view().timeline.some((e) => e.owner === doomed),
      '推进一个回合后，尸体的条目又冒出来了'
    ).toBe(false);
  });

  it('招式 av 很小而 selfAv 很大的敌人也不会把时钟卡住', () => {
    /*
     * 极端构造：间隔只有 10，却每次都把自己提前 999。
     *
     * 修复前：时间轴操作的下限是「当前时刻」，于是它的下一次行动被钳在 now，
     * 到了 now 又钳回 now —— 在同一个行动值上反复出手，advance() 空转到
     * MAX_STEPS 才 break，时钟冻住、playerActing 为 false，玩家再怎么点都被
     * 「现在不是你的回合」弹回来，整局死锁。
     *
     * 断言对准两件事：时钟真的走了很远（而不是冻在某一格），以及玩家仍然能行动。
     */
    const twitchy: EnemyDef = {
      id: 'twitchy',
      name: '抽动体',
      // 血量给到打不完，这样十二个回合都会跑满 —— 否则玩家三个回合就把它打死，
      // 时钟自然停在 200，断言就测不到「持续前进」这件事
      hp: 5000,
      speed: 100,
      moves: [
        {
          id: 'twitch',
          name: '抽动',
          intent: '抽动',
          text: '自身行动值 -999',
          av: 10,
          effects: [{ t: 'selfAv', amount: -999 }]
        }
      ]
    };
    const battle = createBattle(input(buildDeck(20, HIT), [twitchy]));

    for (let i = 0; i < 12 && !battle.isOver(); i++) {
      for (const card of [...battle.view().hand]) {
        if (card.def.cost <= battle.view().energy) battle.playCard(card.uid);
      }
      battle.endTurn();
    }

    // 玩家每回合推进 100 行动值，12 个回合就是 1200。
    // 修复前它会被钳在第一个行动值上，advance() 空转到 MAX_STEPS 才 break，
    // 时钟冻住、玩家再也点不动（playCard 一律回「现在不是你的回合」）
    expect(battle.view().now, '时钟必须持续前进，而不是冻在某一格').toBeGreaterThan(1000);
    if (!battle.isOver()) {
      expect(
        battle.view().energy,
        '玩家被锁死了：玩家的回合没能开起来（energy 只在回合开始时发放）'
      ).toBeGreaterThan(0);
    }
  });

  it('两个敌人同时在场时，轴上两边都有条目', () => {
    // 反向确认：过滤只对死人生效，不会把活着的敌人一起滤掉
    const battle = createBattle(input(buildDeck(6, HIT), [foe(80, 100, '甲'), foe(80, 100, '乙')]));
    const owners = new Set(battle.view().timeline.map((e) => e.owner));
    expect(owners.has('e0')).toBe(true);
    expect(owners.has('e1')).toBe(true);
    expect(owners.has('player')).toBe(true);
  });
});

// ==================== 校正 ====================

describe('校正', () => {
  it('提前类校正减少自身行动值', () => {
    const haste = def({ id: 'haste', kind: 'shift', cost: 0, target: 'self', effects: [{ t: 'selfAv', amount: -30 }] });
    const battle = createBattle(input([inst(haste), inst(HIT)], [foe()]));
    // 第一次行动在 0，下一次本应排在 100
    expect(battle.view().timeline.filter((e) => e.owner === 'player')[0]!.at).toBe(100);
    battle.playCard(handCard(battle, 'haste').uid);
    // 提前 30 之后落在 70
    expect(battle.view().timeline.filter((e) => e.owner === 'player')[0]!.at).toBe(70);
  });

  it('推后类校正把目标的行动往后挪', () => {
    const lag = def({ id: 'lag', kind: 'shift', cost: 0, target: 'enemy', effects: [{ t: 'targetAv', amount: 40 }] });
    const battle = createBattle(input([inst(lag), inst(HIT)], [foe()]));
    const before = battle.view().timeline.filter((e) => e.owner === 'e0')[0]!.at;
    battle.playCard(handCard(battle, 'lag').uid, 'e0');
    const after = battle.view().timeline.filter((e) => e.owner === 'e0')[0]!.at;
    expect(after).toBe(before + 40);
  });

  it('打断取消目标已排入轴的行动，并把同一招推后重排', () => {
    const cut = def({ id: 'cut', kind: 'shift', cost: 0, target: 'enemy', effects: [{ t: 'cancel', av: 50 }] });
    const battle = createBattle(input([inst(cut), inst(HIT)], [foe()]));
    const before = battle.view().timeline.filter((e) => e.owner === 'e0')[0]!;
    const step = battle.playCard(handCard(battle, 'cut').uid, 'e0');

    const cancelled = step.events.find((e) => e.k === 'cancel');
    expect(cancelled, '应当有取消事件').toBeDefined();
    if (cancelled?.k === 'cancel') expect(cancelled.entryId).toBe(before.id);

    const after = battle.view().timeline.filter((e) => e.owner === 'e0')[0]!;
    expect(after.at, '同一招被推后 50 行动值').toBe(before.at + 50);
    expect(after.moveId, '推后的还是同一招').toBe(before.moveId);
  });

  it('并轨把最靠前的挂刻拉回来，让它在更早的行动值引爆', () => {
    const pull = def({ id: 'pull', kind: 'shift', cost: 0, target: 'none', effects: [{ t: 'rush', amount: 40 }] });
    const battle = createBattle(input([inst(pull), inst(delayed('bomb', 20, 100)), inst(HIT)], [foe()]));

    battle.playCard(handCard(battle, 'bomb').uid);
    const scheduled = battle.view().timeline.find((e) => e.kind === 'card')!;
    expect(scheduled.at).toBe(100);

    battle.playCard(handCard(battle, 'pull').uid);
    const pulled = battle.view().timeline.find((e) => e.kind === 'card')!;
    expect(pulled.at).toBe(60);
    expect(pulled.id, '是同一张挂刻，不是重挂了一张').toBe(scheduled.id);
  });

  it('没有挂刻时并轨空放，不报错也不产生伤害', () => {
    const pull = def({ id: 'pull', kind: 'shift', cost: 0, target: 'none', effects: [{ t: 'rush', amount: 40 }] });
    const battle = createBattle(input([inst(pull), inst(HIT)], [foe()]));
    const hp = battle.view().enemies[0]!.hp;
    const step = battle.playCard(handCard(battle, 'pull').uid);
    expect(kinds(step.events)).not.toContain('damage');
    expect(battle.view().enemies[0]!.hp).toBe(hp);
  });

  it('行动值不会被推到已经发生的过去', () => {
    // 提前量大于剩余等待时间时，最多提到当前时刻，不会变成负数时刻
    const huge = def({ id: 'huge', kind: 'shift', cost: 0, target: 'self', effects: [{ t: 'selfAv', amount: -9999 }] });
    const battle = createBattle(input([inst(huge), inst(HIT)], [foe()]));
    battle.playCard(handCard(battle, 'huge').uid);
    const at = battle.view().timeline.filter((e) => e.owner === 'player')[0]!.at;
    expect(at).toBeGreaterThanOrEqual(0);
  });
});

// ==================== 伤害公式 ====================

describe('伤害公式', () => {
  it('无增减伤时原样返回', () => {
    expect(computeDamage(10, false, false)).toBe(10);
  });

  it('虚弱让攻击方输出降到 75%', () => {
    expect(computeDamage(10, true, false)).toBe(8); // 7.5 四舍五入
    expect(computeDamage(6, true, false)).toBe(5); // 4.5 四舍五入
  });

  it('易伤让受击方承伤升到 150%', () => {
    expect(computeDamage(10, false, true)).toBe(15);
  });

  it('虚弱与易伤同时存在时两者相乘', () => {
    expect(computeDamage(10, true, true)).toBe(11); // 10 * 0.75 * 1.5 = 11.25
  });

  it('格挡先被扣完，剩下的才进血量', () => {
    /*
     * 开局玩家先手、敌人排在 100 行动值，所以要让敌人的攻击落地就得先过一个回合。
     * 牌组给满 12 张守刻，保证第二回合手上一定是 5 张守刻（不靠洗牌运气）。
     */
    const battle = createBattle(input(buildDeck(12, GUARD), [foe()]));
    battle.endTurn(); // 第 1 回合直接过

    battle.playCard(handCard(battle, 'guard').uid);
    battle.playCard(handCard(battle, 'guard').uid);
    battle.playCard(handCard(battle, 'guard').uid);
    expect(battle.view().me.block).toBe(15);

    const step = battle.endTurn();
    const hit = step.events.find((e) => e.k === 'damage' && e.dst === 'player');
    expect(hit, '敌人应当在 100 行动值打过来').toBeDefined();
    if (hit?.k === 'damage') {
      expect(hit.amount).toBe(8);
      expect(hit.blocked).toBe(8);
    }
    expect(battle.view().me.hp, '15 点格挡挡住 8 点，一点血都不掉').toBe(70);
  });

  it('格挡不够时差额打进血量', () => {
    const battle = createBattle(input(buildDeck(12, GUARD), [foe()]));
    battle.endTurn(); // 第 1 回合直接过

    battle.playCard(handCard(battle, 'guard').uid); // 只有 5 点格挡
    expect(battle.view().me.block).toBe(5);

    const step = battle.endTurn();
    const hit = step.events.find((e) => e.k === 'damage' && e.dst === 'player');
    expect(hit).toBeDefined();
    if (hit?.k === 'damage') {
      expect(hit.blocked, '5 点格挡全被吃掉').toBe(5);
      expect(hit.amount).toBe(8);
    }
    expect(battle.view().me.hp, '8 伤害只挡下 5，掉 3').toBe(67);
  });

  it('易伤让格挡更快被打穿', () => {
    const vuln = def({
      id: 'vuln',
      cost: 0,
      target: 'self',
      effects: [{ t: 'vulnerable', stacks: 2, who: 'self' }]
    });
    // 牌的摆放要保证第二回合手上一定有加强版：第一回合会抽走前 5 张并全部弃掉，
    // 所以第 9 张（vuln）正好落在第二回合的起手里，且不需要靠洗牌运气
    const battle = createBattle(
      input([...buildDeck(8, GUARD), inst(vuln), ...buildDeck(4, GUARD)], [foe()])
    );
    battle.endTurn(); // 第 1 回合直接过

    battle.playCard(handCard(battle, 'vuln').uid);
    battle.playCard(handCard(battle, 'guard').uid);
    battle.playCard(handCard(battle, 'guard').uid);
    battle.playCard(handCard(battle, 'guard').uid);
    // 8 点伤害被易伤放大到 12，15 点格挡仍然够用
    battle.endTurn();
    expect(battle.view().me.hp).toBe(70);
    expect(battle.view().me.buffs.vulnerable, '回合结束时递减一层').toBe(1);
  });
});

// ==================== 时能与手牌 ====================

describe('时能与手牌', () => {
  it('时能不足时出牌被拒，且不扣时能', () => {
    const pricey = def({ id: 'pricey', cost: 9, effects: [{ t: 'damage', amount: 50 }] });
    const battle = createBattle(input([inst(pricey), inst(HIT)], [foe()]));
    const step = battle.playCard(handCard(battle, 'pricey').uid);
    const rejected = step.events.find((e) => e.k === 'rejected');
    expect(rejected).toBeDefined();
    expect(battle.view().energy, '被拒不该扣时能').toBe(3);
    expect(battle.view().enemies[0]!.hp, '被拒不该造成伤害').toBe(100);
  });

  it('出牌扣除对应时能', () => {
    const battle = createBattle(input([inst(HIT)], [foe()]));
    expect(battle.view().energy).toBe(3);
    battle.playCard(handCard(battle, 'hit').uid);
    expect(battle.view().energy).toBe(2);
  });

  it('回合开始抽满手牌，回合结束弃掉整手', () => {
    const deck = Array.from({ length: 10 }, () => inst(HIT));
    const battle = createBattle(input(deck, [foe()]));
    expect(battle.view().hand.length).toBe(5);
    battle.endTurn();
    // 新回合又是一手 5 张
    expect(battle.view().hand.length).toBe(5);
    expect(battle.view().discardCount, '上一手 5 张进了弃牌堆').toBe(5);
  });

  it('手牌上限受牌组大小限制，抽不出来就是抽不出来', () => {
    // 3 张牌、手牌上限 5：第一回合只能拿到 3 张。多抽是不存在的
    const battle = createBattle(input(buildDeck(3, HIT), [foe()]));
    expect(battle.view().hand.length).toBe(3);
    expect(battle.view().drawCount).toBe(0);
  });

  it('抽牌堆抽空后会把弃牌堆洗回来', () => {
    // 4 张牌、手牌上限 4：第二回合必须靠重洗才能继续抽
    const battle = createBattle(input(buildDeck(4, HIT), [foe()]));
    expect(battle.view().hand.length).toBe(4);
    expect(battle.view().drawCount).toBe(0);

    battle.endTurn();
    expect(battle.view().hand.length, '重洗之后又抽满了一手').toBe(4);
    expect(battle.view().discardCount, '洗回来的牌不在弃牌堆里了').toBe(0);
    expect(battle.view().drawCount).toBe(0);
  });

  it('不在自己回合时出牌被拒', () => {
    const battle = createBattle(input([inst(HIT)], [foe()]));
    battle.playCard(handCard(battle, 'hit').uid);
    const uid = battle.view().hand[0]?.uid;
    if (uid) {
      const step = battle.playCard(uid);
      expect(kinds(step.events)).not.toContain('play');
    }
  });

  it('手上的牌打光了就只能结束回合', () => {
    const battle = createBattle(input([inst(HIT)], [foe()]));
    for (const c of [...battle.view().hand]) {
      if (c.def.cost <= battle.view().energy) battle.playCard(c.uid);
    }
    const step = battle.endTurn();
    expect(kinds(step.events)).toContain('turnEnd');
  });
});

// ==================== 终局 ====================

describe('终局', () => {
  it('敌人全灭判定为胜利', () => {
    const battle = createBattle(input([inst(def({ id: 'nuke', cost: 0, effects: [{ t: 'damage', amount: 999 }] }))], [foe()]));
    const step = battle.playCard(handCard(battle, 'nuke').uid);
    expect(step.result).toBe('win');
    expect(battle.isOver()).toBe(true);
    const end = step.events.find((e) => e.k === 'end');
    expect(end).toBeDefined();
    if (end?.k === 'end') expect(end.result).toBe('win');
  });

  it('玩家稳定度归零判定为失败', () => {
    const weakPlayer = { ...PLAYER, maxHp: 1 };
    const battle = createBattle({ ...input(buildDeck(6, HIT), [foe()]), player: weakPlayer });
    battle.endTurn(); // 第 1 回合过掉，敌人排在 100 行动值
    const step = battle.endTurn(); // 敌人此时打过来，1 点稳定度扛不住
    expect(step.result).toBe('lose');
    expect(battle.isOver()).toBe(true);
  });

  it('终局之后再操作是空操作，事件流不再增长', () => {
    const battle = createBattle(input([inst(def({ id: 'nuke', cost: 0, effects: [{ t: 'damage', amount: 999 }] })), inst(HIT)], [foe()]));
    battle.playCard(handCard(battle, 'nuke').uid);
    const after = battle.history().length;
    const step = battle.endTurn();
    expect(step.events.length).toBe(0);
    expect(battle.history().length).toBe(after);
  });

  it('战斗必定在有限步内结束（不会无限对耗）', () => {
    const out = simulateBattle(input(buildDeck(20, HIT), [foe(200, 100)]), greedyPolicy);
    expect(['win', 'lose']).toContain(out.result);
    expect(out.events.some((e) => e.k === 'end')).toBe(true);
  });
});

// ==================== 输入校验 ====================

describe('战斗输入校验', () => {
  /*
   * 这些值平时来自 content/player.ts 的冻结常量与内容表，看起来不会出错 ——
   * 但引擎是公开 API，测试与未来的单局流程都会直接构造 BattleInput。
   * 不合法的值不会报错，只会让引擎进入一个「时钟走不动」「同一张牌被静默吞掉」
   * 的状态，排查成本远高于在这里拦下来。
   */
  const deck = (): CardInstance[] => buildDeck(4, HIT);
  const raw = (over: Partial<BattleInput> = {}): BattleInput => ({
    seed: 1,
    player: PLAYER,
    enemies: [foe()],
    deck: deck(),
    ...over
  });

  it('合法的输入不抛错', () => {
    expect(() => createBattle(raw())).not.toThrow();
  });

  it('拒绝零敌人（否则空数组的 every 恒真，一开局就被判胜）', () => {
    expect(() => createBattle(raw({ enemies: [] }))).toThrow(/至少需要一个敌人/);
  });

  it('拒绝空牌组', () => {
    expect(() => createBattle(raw({ deck: [] }))).toThrow(/至少需要一张刻印/);
  });

  it('拒绝非正的步频（会让行动间隔退化成一万行动值，表现为时间轴卡住）', () => {
    expect(() => createBattle(raw({ player: { ...PLAYER, speed: 0 } }))).toThrow(/步频/);
    expect(() => createBattle(raw({ player: { ...PLAYER, speed: -10 } }))).toThrow(/步频/);
    expect(() => createBattle(raw({ player: { ...PLAYER, speed: 1.5 } }))).toThrow(/步频/);
  });

  it('拒绝非正的稳定度上限与手牌/时能的下限', () => {
    expect(() => createBattle(raw({ player: { ...PLAYER, maxHp: 0 } }))).toThrow(/稳定度上限/);
    expect(() => createBattle(raw({ player: { ...PLAYER, handSize: -1 } }))).toThrow(/手牌上限/);
    expect(() => createBattle(raw({ player: { ...PLAYER, energyPerTurn: -1 } }))).toThrow(/每回合时能/);
  });

  it('拒绝敌人身上不合法的数值', () => {
    expect(() => createBattle(raw({ enemies: [{ ...foe(), hp: 0 }] }))).toThrow(/血量/);
    expect(() => createBattle(raw({ enemies: [{ ...foe(), speed: 0 }] }))).toThrow(/步频/);
    expect(() => createBattle(raw({ enemies: [{ ...foe(), moves: [] }] }))).toThrow(/没有任何招式/);
  });

  it('拒绝重复的刻印 uid（会让一张牌被静默吞掉：时能花了，什么都没发生）', () => {
    // 注意要绕过 input() 的 uid 归一化，直接构造
    expect(() =>
      createBattle(raw({ deck: [{ uid: 'same', def: HIT }, { uid: 'same', def: HIT }] }))
    ).toThrow(/uid 重复/);
  });

  it('拒绝挂刻牌缺失或非正的 delay（会让时钟倒流）', () => {
    const noDelay = def({ id: 'bad', kind: 'deferred', effects: [{ t: 'damage', amount: 20 }] });
    expect(() => createBattle(raw({ deck: [{ uid: 'a', def: noDelay }] }))).toThrow(/delay/);

    const zeroDelay = def({ id: 'bad2', kind: 'deferred', delay: 0, effects: [{ t: 'damage', amount: 20 }] });
    expect(() => createBattle(raw({ deck: [{ uid: 'a', def: zeroDelay }] }))).toThrow(/delay/);

    const negativeDelay = def({ id: 'bad3', kind: 'deferred', delay: -5, effects: [{ t: 'damage', amount: 20 }] });
    expect(() => createBattle(raw({ deck: [{ uid: 'a', def: negativeDelay }] }))).toThrow(/delay/);
  });
});

// ==================== 确定性 ====================

describe('确定性', () => {
  it('同种子 + 同操作序列 → 逐条相同的事件流', () => {
    // 注意必须走 input()：它负责把 uid 按位置归一化，
    // 直接在字面量里塞 buildDeck 的产物会让两次运行的 uid 不同，比对必然失败
    const make = (): BattleInput => input(buildDeck(12, HIT), [foe()], 4242);
    const a = simulateBattle(make(), greedyPolicy);
    const b = simulateBattle(make(), greedyPolicy);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(a.result).toBe(b.result);
  });

  it('换一个种子就可能得到不同过程（洗牌流不同）', () => {
    const a = simulateBattle(input(buildDeck(12, HIT), [foe()], 1), greedyPolicy);
    const b = simulateBattle(input(buildDeck(12, HIT), [foe()], 999), greedyPolicy);
    // 牌组的随机性只体现在弃牌堆重洗的顺序上，这里只要求流程不崩、结果合法
    expect(['win', 'lose']).toContain(a.result);
    expect(['win', 'lose']).toContain(b.result);
  });

  it('两场战斗同时进行也不会互相串状态', () => {
    const mk = (): BattleInput => input(buildDeck(12, HIT), [foe()], 7);
    const a = createBattle(mk());
    const b = createBattle(mk());
    // 交叉操作：a 出牌、b 出牌、a 结束回合……
    a.playCard(a.view().hand[0]!.uid);
    b.playCard(b.view().hand[0]!.uid);
    a.endTurn();
    b.endTurn();
    expect(JSON.stringify(a.history())).toBe(JSON.stringify(b.history()));
  });

  it('录下动作再照着放一遍，得到完全一样的战斗', () => {
    const mk = (): BattleInput => input(buildDeck(14, HIT), [foe(120)], 31337);

    // 第一遍：边打边把动作记下来
    const actions: PlayerAction[] = [];
    const probe = createBattle(mk());
    probe.pending();
    while (!probe.isOver()) {
      const action = greedyPolicy(probe.view());
      actions.push(action);
      if (action.t === 'play') probe.playCard(action.cardUid, action.target);
      else probe.endTurn();
    }

    // 第二遍：照着动作表放
    const replayed = simulateBattle(mk(), scriptedPolicy(actions));
    expect(JSON.stringify(replayed.events)).toBe(JSON.stringify(probe.history()));
  });
});
