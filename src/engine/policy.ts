import { createBattle } from './combat';
import type {
  BattleEvent,
  BattleInput,
  BattleOutput,
  BattlePolicy,
  CardInstance,
  Effect,
  PlayerAction,
  PlayerView
} from './types';

/**
 * 机器人策略与无头对局。
 *
 * 引擎本身是分步驱动的（界面要让玩家在回合中间做决定），但测试需要一行代码
 * 跑完一整场。这里用一个策略把分步接口包成整场对局，回放也走同一条路 ——
 * 只要换一个策略即可：机器人自己决策，回放则照着录下来的动作表出牌。
 */

/** 一场无头对局最多推进这么多步，防止策略写错时测试挂死 */
const MAX_ACTIONS = 4000;

/**
 * 打一场完整的战斗。
 *
 * 返回的事件流是**从头到尾的完整时间线**，可以逐帧回放；
 * 这也是「同种子同操作得到同一结果」这条保证的兑现处。
 */
export function simulateBattle(input: BattleInput, policy: BattlePolicy): BattleOutput {
  const battle = createBattle(input);
  // 开局事件（时钟归零、第一回合、起手抽牌）也要算进完整时间线，
  // 否则「从头到尾的事件流」会缺开头，回放对不上
  const events: BattleEvent[] = battle.pending();

  let guard = 0;
  while (!battle.isOver()) {
    if (guard++ > MAX_ACTIONS) {
      throw new Error(`对局没有在 ${MAX_ACTIONS} 步内结束，策略可能存在死循环`);
    }
    const action = policy(battle.view());
    const step = action.t === 'play' ? battle.playCard(action.cardUid, action.target) : battle.endTurn();
    events.push(...step.events);

    // 策略给出的动作被引擎拒绝时必须强制结束回合，
    // 否则一个总是出同一张牌的坏策略会让循环空转
    if (step.events.some((e) => e.k === 'rejected')) {
      const forced = battle.endTurn();
      events.push(...forced.events);
    }
  }

  return {
    result: battle.outcome() ?? 'lose',
    rounds: battle.view().round,
    events,
    playerHp: battle.view().me.hp
  };
}

/** 把一串录好的动作当成策略。回放与复现 bug 用这个 */
export function scriptedPolicy(actions: readonly PlayerAction[]): BattlePolicy {
  let cursor = 0;
  return (): PlayerAction => {
    const next = actions[cursor++];
    return next ?? { t: 'endTurn' };
  };
}

// ==================== 参考机器人 ====================

/** 一张刻印的粗估值。只看效果，不管局面 —— 局面差异留给调用方乘系数 */
function rawValue(card: CardInstance): number {
  let v = 0;
  for (const ef of card.def.effects) v += effectValue(ef);
  return v;
}

function effectValue(ef: Effect): number {
  switch (ef.t) {
    case 'damage':
      return ef.amount * (ef.times ?? 1) * 1.2;
    case 'block':
      return ef.amount;
    case 'heal':
      return ef.amount * 1.2;
    case 'draw':
      return ef.count * 4;
    case 'energy':
      return ef.amount * 5;
    case 'vulnerable':
      return ef.stacks * 5;
    case 'weak':
      return ef.stacks * 4;
    case 'speed':
      return ef.amount * 3;
    // 校正类不产生数值，价值全在局面判断上，这里给一个中等偏低的常数
    case 'selfAv':
    case 'targetAv':
    case 'cancel':
    case 'rush':
      return 6;
  }
}

/**
 * 参考机器人：贪心。
 *
 * 不是要打得好，而是要**稳定地把机制跑到**：血少时优先防守，其余时候优先
 * 打伤害，挂刻给一点额外权重好让延时机制真的被用上。平衡回归靠它给出
 * 可比较的胜率，所以它必须简单到不会自己引入变量。
 */
export function greedyPolicy(view: PlayerView): PlayerAction {
  const playable = view.hand.filter((c) => c.def.cost <= view.energy);
  if (playable.length === 0) return { t: 'endTurn' };

  const hpRatio = view.me.maxHp > 0 ? view.me.hp / view.me.maxHp : 1;
  const defensive = hpRatio < 0.45;

  // 优先打残血的那个：不清场就会一直被消耗
  const target = [...view.enemies].sort((a, b) => a.hp - b.hp)[0]?.id;

  let best: CardInstance | undefined;
  let bestScore = -1;
  for (const card of playable) {
    let score = rawValue(card);
    if (defensive) {
      const hasBlock = card.def.effects.some((e) => e.t === 'block' || e.t === 'heal');
      score *= hasBlock ? 1.9 : 0.7;
    }
    if (card.def.kind === 'deferred') score *= 1.25;
    if (card.def.kind === 'shift') score *= 0.8;
    score /= Math.max(1, card.def.cost);

    // 严格大于：同分时保留先遇到的那张，避免手牌顺序影响决策导致结果难以复现
    if (score > bestScore) {
      bestScore = score;
      best = card;
    }
  }

  if (!best) return { t: 'endTurn' };
  return { t: 'play', cardUid: best.uid, target };
}
