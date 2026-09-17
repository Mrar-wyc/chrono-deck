import type { PlayerSetup } from '../engine/types';

/**
 * 授时官（玩家）的战斗配置。
 *
 * 步频 100 是标准速度：每 100 行动值行动一次，敌人也都围绕这个基准设计
 * （步频 130 的抢拍体会比你快，90 的迟滞体会比你慢）。
 *
 * 时能 3 意味着起手牌组（10 张、平均 0.6 费）每回合大约能出 2-3 张 ——
 * 刚好够「即时牌站住 + 留一张给挂刻」的取舍成立。
 */
export const PLAYER: PlayerSetup = {
  name: '授时官',
  maxHp: 70,
  speed: 100,
  energyPerTurn: 3,
  handSize: 5
};
