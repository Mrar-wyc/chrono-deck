import { REWARD_CARDS } from '../src/content/cards';
import { greedyPolicy, simulateBattle } from '../src/engine/policy';
import { buildBattleInput } from '../src/run/battle-setup';

/**
 * 共享机器人对局工具。
 *
 * 它把「本局种子 + 遭遇 + 带哪些刻印」跑成一场完整战斗，供平衡回归、
 * soak 不变量、以及人工诊断三处复用。三处必须走同一条路径 —— 否则
 * 「测试里跑通的」和「玩家实际打的」会悄悄变成两套东西。
 */

/** 平衡回归用的固定牌组：起始 10 张之外再带这 5 张，让各局之间可比 */
export const BOT_EXTRA: string[] = ['frost_strike', 'accrue', 'review', 'plumbline', 'confluence'];

/** soak 用的满配牌组：奖励池每张各一份，把内容面尽可能铺开 */
export const ALL_EXTRA: string[] = REWARD_CARDS.map((c) => c.id);

export interface BotBattle {
  seed: number;
  encounterId: string;
  win: boolean;
  rounds: number;
  /** 战斗结束时的稳定度 */
  hp: number;
  /** 时间轴推进到哪一格结束 */
  endedAt: number;
  actions: number;
}

export function playBattle(
  seed: number,
  encounterId: string,
  extra: readonly string[] = BOT_EXTRA,
  battleIndex = 0
): BotBattle {
  const input = buildBattleInput({ seed, encounterId, extraCardIds: [...extra], battleIndex });
  if (input.enemies.length === 0) throw new Error(`遭遇 ${encounterId} 没有敌人`);

  const out = simulateBattle(input, greedyPolicy);
  const lastClock = [...out.events].reverse().find((e) => e.k === 'clock');

  return {
    seed,
    encounterId,
    win: out.result === 'win',
    rounds: out.rounds,
    hp: out.playerHp,
    endedAt: lastClock?.k === 'clock' ? lastClock.at : 0,
    actions: out.events.filter((e) => e.k === 'play').length
  };
}

/** 跑若干局，返回胜率与其它汇总数字 */
export interface BatchResult {
  runs: number;
  wins: number;
  winRate: number;
  avgRounds: number;
  avgHpOnWin: number;
  avgEndedAt: number;
  /** 每局平均出牌数，用来判断机器人是不是在手牌打光后干等 */
  avgActions: number;
  losses: BotBattle[];
}

export function runBatch(
  seeds: readonly number[],
  encounterId: string,
  extra: readonly string[] = BOT_EXTRA
): BatchResult {
  const battles = seeds.map((s) => playBattle(s, encounterId, extra));
  const wins = battles.filter((b) => b.win);
  const avg = (xs: readonly number[]): number =>
    xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

  return {
    runs: battles.length,
    wins: wins.length,
    winRate: battles.length === 0 ? 0 : wins.length / battles.length,
    avgRounds: avg(battles.map((b) => b.rounds)),
    avgHpOnWin: avg(wins.map((b) => b.hp)),
    avgEndedAt: avg(battles.map((b) => b.endedAt)),
    avgActions: avg(battles.map((b) => b.actions)),
    losses: battles.filter((b) => !b.win)
  };
}

/** 连续的种子列表，让各次运行的样本一致 */
export function seeds(n: number, from = 1): number[] {
  return Array.from({ length: n }, (_, i) => from + i);
}
