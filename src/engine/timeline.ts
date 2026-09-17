import { TIMELINE_PRIORITY } from './types';
import type { ActionId, TimelineEntry } from './types';

/**
 * 时序轴调度器。
 *
 * 时序轴就是一条按行动值排序的待结算队列，里面只有三种东西：
 * 单位的行动机会、挂刻的引爆、以及后续里程碑要加的光环。
 *
 * 这里的函数都是纯的：只动传进来的数组，不碰任何全局状态。
 * 「谁先谁后」的全部规则集中在 compareEntries 一个地方，改排序规则只需要改它。
 */

/**
 * 结算顺序：先比时刻，再比同刻优先级，最后同为行动机会时玩家先手。
 *
 * 返回 0 时交给 Array.sort —— 它是稳定排序（ES2019 起由规范保证），
 * 所以同一时刻、同一优先级的条目会保持入队顺序，结果依然可复现。
 */
export function compareEntries(a: TimelineEntry, b: TimelineEntry): number {
  if (a.at !== b.at) return a.at - b.at;

  const pa = TIMELINE_PRIORITY[a.kind];
  const pb = TIMELINE_PRIORITY[b.kind];
  if (pa !== pb) return pa - pb;

  if (a.kind === 'turn' && b.kind === 'turn' && a.side !== b.side) {
    return a.side === 'ally' ? -1 : 1;
  }

  return 0;
}

/** 原地排序并返回同一数组 */
export function sortTimeline(entries: TimelineEntry[]): TimelineEntry[] {
  return entries.sort(compareEntries);
}

/** 下一个要结算的条目。队列为空时返回 undefined */
export function peekNext(entries: readonly TimelineEntry[]): TimelineEntry | undefined {
  let best: TimelineEntry | undefined;
  for (const e of entries) {
    if (!best || compareEntries(e, best) < 0) best = e;
  }
  return best;
}

export function findEntry(
  entries: readonly TimelineEntry[],
  id: ActionId
): TimelineEntry | undefined {
  return entries.find((e) => e.id === id);
}

/** 移除一项并返回它。找不到返回 undefined（不抛错：取消一张已被别人引爆的挂刻是合法操作） */
export function removeEntry(entries: TimelineEntry[], id: ActionId): TimelineEntry | undefined {
  const i = entries.findIndex((e) => e.id === id);
  if (i < 0) return undefined;
  return entries.splice(i, 1)[0];
}

/**
 * 把一个条目的时刻挪动 delta（负数 = 提前）。
 *
 * 时刻被钳制在 `floor` 之上：任何东西都不该被推到「已经发生的过去」，
 * 否则它会在同一次推进里被立刻结算，玩家看到的是一张刚挂上的牌瞬间引爆。
 * 返回移动前后的时刻，供界面画出「这一格挪到了那里」。
 */
export function shiftEntry(
  entries: TimelineEntry[],
  id: ActionId,
  delta: number,
  floor: number
): { from: number; to: number } | null {
  const entry = entries.find((e) => e.id === id);
  if (!entry) return null;
  const from = entry.at;
  entry.at = Math.max(floor, entry.at + delta);
  return { from, to: entry.at };
}

/** 按当前规则排出结算顺序的副本，供界面与策略读取 */
export function orderedSnapshot(entries: readonly TimelineEntry[]): TimelineEntry[] {
  return [...entries].sort(compareEntries);
}

/** 某个单位在轴上还有没有待结算的条目 */
export function hasEntriesFor(entries: readonly TimelineEntry[], owner: string): boolean {
  return entries.some((e) => e.owner === owner);
}

/** 轴上属于某个单位的全部条目（按结算顺序） */
export function entriesFor(entries: readonly TimelineEntry[], owner: string): TimelineEntry[] {
  return orderedSnapshot(entries.filter((e) => e.owner === owner));
}

/**
 * 单调递增的 id 生成器。
 *
 * 不复用、不随机，所以同一次战斗里每个 id 都是确定的 ——
 * 这是回放能逐帧对齐的前提。
 */
export function createIdGen(prefix: string): (tag: string) => ActionId {
  let seq = 0;
  return (tag: string): ActionId => `${prefix}${++seq}_${tag}`;
}
