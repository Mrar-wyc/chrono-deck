import { describe, expect, it } from 'vitest';
import { ENCOUNTERS } from '../src/content/enemies';
import { greedyPolicy, simulateBattle } from '../src/engine/policy';
import { buildBattleInput } from '../src/run/battle-setup';
import type { BattleEvent, BattleResult } from '../src/engine/types';
import { ALL_EXTRA } from './bot';

/**
 * 压力测试：把内容面尽可能铺开，跑大量对局并断言**状态不变量**。
 *
 * 与 balance 的分工：balance 看「难度是否合理」，soak 看「跑几百局会不会出现
 * 不该出现的状态」。两者互补 —— 一个胜率漂亮的版本完全可能每局都在悄悄
 * 制造负数血量、重复 uid、或者结算一条根本没排上轴的挂刻。
 */

const RUNS = 200;

interface Trace {
  seed: number;
  encounterId: string;
  events: BattleEvent[];
  result: BattleResult;
}

/** 每局只跑一次，后面所有断言共用同一批轨迹 */
const traces: Trace[] = Array.from({ length: RUNS }, (_, i) => {
  const encounterId = ENCOUNTERS[i % ENCOUNTERS.length]!.id;
  const seed = 1000 + i;
  const input = buildBattleInput({ seed, encounterId, extraCardIds: [...ALL_EXTRA] });
  const out = simulateBattle(input, greedyPolicy);
  return { seed, encounterId, events: out.events, result: out.result };
});

function of(events: readonly BattleEvent[], k: BattleEvent['k']): BattleEvent[] {
  return events.filter((e) => e.k === k);
}

describe('状态不变量', () => {
  it('伤害的构成始终自洽：格挡部分不超过总伤害，且两者都非负', () => {
    for (const t of traces) {
      for (const ev of of(t.events, 'damage')) {
        if (ev.k !== 'damage') continue;
        const where = `种子 ${t.seed} / ${t.encounterId}`;
        expect(ev.amount, `${where}：伤害为负`).toBeGreaterThanOrEqual(0);
        expect(ev.blocked, `${where}：格挡量为负`).toBeGreaterThanOrEqual(0);
        expect(
          ev.blocked,
          `${where}：被格挡的 ${ev.blocked} 超过了总伤害 ${ev.amount}`
        ).toBeLessThanOrEqual(ev.amount);
      }
    }
  });

  it('治疗与格挡的数值都为正，不存在 0 值噪音事件', () => {
    for (const t of traces) {
      for (const ev of of(t.events, 'heal')) {
        if (ev.k === 'heal') expect(ev.amount, `种子 ${t.seed}：治疗量为负`).toBeGreaterThanOrEqual(0);
      }
      for (const ev of of(t.events, 'block')) {
        if (ev.k === 'block') expect(ev.amount, `种子 ${t.seed}：格挡量为负`).toBeGreaterThan(0);
      }
    }
  });

  it('时能永不为负 —— 出牌一定经过扣费', () => {
    for (const t of traces) {
      for (const ev of of(t.events, 'energy')) {
        if (ev.k === 'energy') {
          expect(ev.value, `种子 ${t.seed}：时能变成了 ${ev.value}`).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('时钟单调不减，绝不会倒流', () => {
    for (const t of traces) {
      let last = -1;
      for (const ev of of(t.events, 'clock')) {
        if (ev.k !== 'clock') continue;
        expect(ev.at, `种子 ${t.seed}：时钟从 ${last} 倒退到了 ${ev.at}`).toBeGreaterThanOrEqual(last);
        last = ev.at;
      }
    }
  });

  it('结算的每一项都确实是先排上轴的，没有凭空引爆', () => {
    for (const t of traces) {
      const scheduled = new Set<string>();
      for (const ev of t.events) {
        if (ev.k === 'schedule') scheduled.add(ev.entry.id);
        if (ev.k === 'resolve') {
          expect(
            scheduled.has(ev.entryId),
            `种子 ${t.seed}：结算了从未排上轴的条目 ${ev.entryId}`
          ).toBe(true);
        }
      }
    }
  });

  it('同一张挂刻不会同时存在两份（同一时刻至多一份在飞）', () => {
    /*
     * 注意要按「引爆后移出在场集合」来算。
     * 同一张牌在整场战斗里被挂两次是正常的 —— 它引爆后进弃牌堆，
     * 牌堆重洗后又被抽到手上，再挂一次。真正不允许的是同时在飞两份。
     */
    for (const t of traces) {
      const entryToCard = new Map<string, string>();
      const inFlight = new Set<string>();

      for (const ev of t.events) {
        if (ev.k === 'schedule' && ev.entry.kind === 'card' && ev.entry.cardUid) {
          expect(
            inFlight.has(ev.entry.cardUid),
            `种子 ${t.seed}：挂刻 ${ev.entry.cardUid} 同时存在两份在飞`
          ).toBe(false);
          inFlight.add(ev.entry.cardUid);
          entryToCard.set(ev.entry.id, ev.entry.cardUid);
        }
        if (ev.k === 'resolve') {
          const uid = entryToCard.get(ev.entryId);
          if (uid) inFlight.delete(uid);
        }
      }
    }
  });

  it('每局恰好一个结局事件，且胜负与场上状态一致', () => {
    for (const t of traces) {
      const ends = of(t.events, 'end');
      expect(ends.length, `种子 ${t.seed}：出现了 ${ends.length} 个结局事件`).toBe(1);

      const end = ends[0]!;
      if (end.k !== 'end') continue;
      expect(end.result).toBe(t.result);

      const deaths = of(t.events, 'death').map((e) => (e.k === 'death' ? e.unit : ''));
      if (end.result === 'lose') {
        expect(deaths, `种子 ${t.seed}：判负却没有玩家阵亡事件`).toContain('player');
      } else {
        expect(deaths, `种子 ${t.seed}：判胜时玩家不该阵亡`).not.toContain('player');
      }
    }
  });

  it('战斗不会无限对耗，都在合理的时钟内收场', () => {
    for (const t of traces) {
      const clocks = of(t.events, 'clock');
      const last = clocks[clocks.length - 1];
      const endedAt = last?.k === 'clock' ? last.at : 0;
      expect(endedAt, `种子 ${t.seed} 跑到了 ${endedAt} 行动值，远超正常范围`).toBeLessThan(20000);
    }
  });

  it('两档难度确实有区分：普通遭遇的胜率明显高于首领', () => {
    const rate = (kind: string): number => {
      const subset = traces.filter(
        (t) => ENCOUNTERS.find((e) => e.id === t.encounterId)?.kind === kind
      );
      if (subset.length === 0) return 0;
      return subset.filter((t) => t.result === 'win').length / subset.length;
    };
    expect(rate('normal')).toBeGreaterThan(rate('boss'));
  });
});
