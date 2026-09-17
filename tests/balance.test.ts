import { describe, expect, it } from 'vitest';
import { ENCOUNTERS } from '../src/content/enemies';
import { BOT_EXTRA, runBatch, seeds } from './bot';

/**
 * 平衡回归。
 *
 * 它不追求「胜率好看」，而是**给出一组稳定可比较的数字**。数值一旦被改动，
 * 这里的胜率就会动，于是改动的影响是可测量的，而不是靠手感猜。
 *
 * 种子固定（1..N），所以同一个版本跑出来的数字完全可复现 ——
 * 这正是种子随机数带来的好处：这里没有「多次运行结果不一样」的噪声。
 * 调用 runBatch 会打出真实数字到控制台，调数值时就照着它调。
 */
const RUNS = 40;

/**
 * 分档按「遭遇类型 + 敌人数量」自动归类，而不是写死 id：
 * 加新遭遇时不用回头改测试。
 *
 * 区间是设计意图的表述，不是拟合出来的数字：
 *   - 单只普通怪是教学局，允许接近必胜（杀戮尖塔的第一场也是几乎不可能输）
 *   - 双弱怪可以输，但正常情况下该赢
 *   - 精英与首领必须有真实的败率，否则难度分档就没有意义
 * 区间留得很宽，因为它的职责是拦住「一改就把难度改崩」，而不是规定难度该是多少。
 */
interface Tier {
  label: string;
  pick: (kind: string, enemies: number) => boolean;
  lo: number;
  hi: number;
}

const TIERS: Tier[] = [
  { label: '单只普通怪（教学局）', pick: (k, n) => k === 'normal' && n === 1, lo: 0.8, hi: 1.0 },
  { label: '群战普通怪', pick: (k, n) => k === 'normal' && n >= 2, lo: 0.55, hi: 1.0 },
  { label: '精英', pick: (k) => k === 'elite', lo: 0.2, hi: 0.75 },
  /*
   * 首领的下沿比其他档低，而且这里是刻意的：它允许很难，但不允许成为必输局。
   * 上沿 0.6 同样有意义 —— 首领若是必胜，难度分档就只是个标签。
   *
   * 另外要记住机器人胜率是**人类表现的下界**：它只按牌面价值贪心出牌，
   * 从不利用时序轴做规划，而规划正是这个游戏的全部。所以机器人打 15% 的首领，
   * 一个会算时间轴的玩家胜率会明显更高。
   */
  { label: '首领', pick: (k) => k === 'boss', lo: 0.08, hi: 0.6 }
];

function tierOf(enc: (typeof ENCOUNTERS)[number]): Tier | undefined {
  return TIERS.find((t) => t.pick(enc.kind, enc.enemyIds.length));
}

describe('平衡回归', () => {
  for (const tier of TIERS) {
    const encounters = ENCOUNTERS.filter((e) => tierOf(e) === tier);
    if (encounters.length === 0) continue;

    it(`${tier.label}：胜率落在 ${tier.lo * 100}% – ${tier.hi * 100}%`, () => {
      const lines: string[] = [];
      for (const enc of encounters) {
        const r = runBatch(seeds(RUNS), enc.id, BOT_EXTRA);
        lines.push(
          `${enc.name.padEnd(10, '　')} 胜率 ${(r.winRate * 100).toFixed(0).padStart(3)}%  ` +
            `${r.avgRounds.toFixed(1)} 回合  终局 AV ${r.avgEndedAt.toFixed(0).padStart(4)}  ` +
            `出牌 ${r.avgActions.toFixed(1)} 张  残血 ${r.avgHpOnWin.toFixed(0)}`
        );
        expect(
          r.winRate,
          `${enc.name} 的胜率是 ${(r.winRate * 100).toFixed(0)}%，超出 ${tier.lo * 100}%–${tier.hi * 100}%。\n` +
            `调数值前请先读 docs/卡牌设计指南.md 的数值预算。当前全部实测：\n${lines.join('\n')}`
        ).toBeGreaterThanOrEqual(tier.lo);
        expect(r.winRate).toBeLessThanOrEqual(tier.hi);
      }
    });
  }

  it('打印全部遭遇的实测数字', () => {
    const lines: string[] = [];
    for (const enc of ENCOUNTERS) {
      const r = runBatch(seeds(RUNS), enc.id, BOT_EXTRA);
      lines.push(
        `${enc.name.padEnd(10, '　')} ${enc.kind.padEnd(6)} ${String(enc.enemyIds.length)}敌  ` +
          `胜率 ${(r.winRate * 100).toFixed(0).padStart(3)}%  ` +
          `${r.avgRounds.toFixed(1)} 回合  终局 AV ${r.avgEndedAt.toFixed(0)}  ` +
          `残血 ${r.avgHpOnWin.toFixed(0)}`
      );
    }
    console.log(
      `\n[balance] 机器人固定牌组 ${10 + BOT_EXTRA.length} 张，每档 ${RUNS} 局\n` + lines.join('\n')
    );
    expect(lines.length).toBe(ENCOUNTERS.length);
  });

  it('难度排序：普通群战 > 精英 > 首领', () => {
    const rate = (pick: (e: (typeof ENCOUNTERS)[number]) => boolean): number => {
      const encs = ENCOUNTERS.filter(pick);
      if (encs.length === 0) return 0;
      return (
        encs.reduce((sum, e) => sum + runBatch(seeds(RUNS), e.id, BOT_EXTRA).winRate, 0) / encs.length
      );
    };
    const group = rate((e) => e.kind === 'normal' && e.enemyIds.length >= 2);
    const elite = rate((e) => e.kind === 'elite');
    const boss = rate((e) => e.kind === 'boss');

    expect(group, '群战普通怪应当比精英好打').toBeGreaterThan(elite);
    expect(elite, '精英应当比首领好打').toBeGreaterThan(boss);
  });

  it('精英与首领必须有真实的败率', () => {
    /*
     * 刻意不要求普通遭遇也能输：单只弱怪是教学局，允许接近必胜 ——
     * 杀戮尖塔的第一场同样几乎不可能输。但精英与首领如果也是必胜，
     * 难度分档就只是个标签，玩家也不会感到任何压力。
     */
    for (const enc of ENCOUNTERS.filter((e) => e.kind !== 'normal')) {
      const r = runBatch(seeds(RUNS), enc.id, BOT_EXTRA);
      expect(r.winRate, `${enc.name} 是必胜局，难度分档形同虚设`).toBeLessThan(1);
      expect(r.winRate, `${enc.name} 是必输局，玩家做什么都没用`).toBeGreaterThan(0);
    }
  });

  it('普通遭遇对新手足够友好', () => {
    for (const enc of ENCOUNTERS.filter((e) => e.kind === 'normal')) {
      const r = runBatch(seeds(RUNS), enc.id, BOT_EXTRA);
      expect(r.winRate, `${enc.name} 的胜率只有 ${(r.winRate * 100).toFixed(0)}%，会劝退新手`).toBeGreaterThanOrEqual(
        0.5
      );
    }
  });
});
