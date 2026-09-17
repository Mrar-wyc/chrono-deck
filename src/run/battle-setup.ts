import { PLAYER, cardOr, findEncounter, findEnemy, starterDeckIds } from '../content';
import { createRng, deriveSeed } from '../rng';
import type { BattleInput, CardInstance, EnemyDef, EncounterDef } from '../engine/types';

/**
 * 单场战斗的装配层。
 *
 * 它的职责是把「本局种子 + 遭遇 + 玩家选的刻印」翻译成引擎要的 `BattleInput`。
 * 界面与测试都从这里进入战斗，所以「一场战斗是怎么拼出来的」只有一处实现 ——
 * 否则测试里跑的和玩家实际打的会是两套东西。
 *
 * 所有随机都从本局种子派生，所以同一份种子 + 同一份选牌，永远打出同一场战斗。
 */

export interface BattleSetupOptions {
  /** 本局种子 */
  seed: number;
  /** 遭遇 id，见 content/enemies.ts 的 ENCOUNTERS */
  encounterId: string;
  /** 额外带上的奖励刻印。M1 由筹备界面勾选，M2 接进单局流程 */
  extraCardIds?: string[];
  /** 同一局里的第几场战斗。用它派生子种子，避免每场都洗出一样的牌序 */
  battleIndex?: number;
}

/** 从遭遇 id 取出敌人的定义。遭遇不存在或引用坏了时返回空数组，由调用方兜底 */
export function enemiesOfEncounter(encounterId: string): EnemyDef[] {
  const enc: EncounterDef | undefined = findEncounter(encounterId);
  if (!enc) return [];
  return enc.enemyIds.map((id) => findEnemy(id)).filter((e): e is EnemyDef => e !== undefined);
}

export function buildBattleInput(opts: BattleSetupOptions): BattleInput {
  const index = opts.battleIndex ?? 0;
  const root = createRng(opts.seed);

  // 牌序与战斗流程各用一条派生的随机流：改动其中一个不会影响另一个
  const deckRng = root.derive(`deck:${index}`);
  const combatSeed = deriveSeed(opts.seed, `combat:${index}`);

  const ids = [...starterDeckIds(), ...(opts.extraCardIds ?? [])];
  const deck: CardInstance[] = ids.map((id, i) => ({ uid: `c${i}`, def: cardOr(id) }));

  return {
    seed: combatSeed,
    player: PLAYER,
    enemies: enemiesOfEncounter(opts.encounterId),
    // 洗牌发生在这里而不是引擎里：引擎拿到的是已经定好顺序的抽牌堆
    deck: deckRng.shuffle(deck)
  };
}
