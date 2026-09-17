/**
 * 注入式种子随机数。
 *
 * 全项目禁止直接使用全局随机数（由 tests/guards.test.ts 读源码强制，连注释里的
 * 字面量都不放过）。任何需要随机的地方都必须接收一个 `Rng` 参数，而不是自己去取
 * 全局随机源。
 *
 * 这么做换来四件事，都是「长期迭代 + 开源」必需的：
 *   1. 可回放：同一种子 + 同一串操作 → 必定同一结果，回放与复现 bug 才有意义
 *   2. 可测：单测不再需要临时替换全局随机函数，精确数值断言随手可写
 *   3. 可分享：种子码可以像战报一样贴给别人，日后能做每日同种子挑战
 *   4. 平衡测量稳定：机器人对局的胜率不再有随机噪声，调数值时看得见真实变化
 */

/** 随机源接口 */
export interface Rng {
  /** [0, 1) 浮点 */
  next(): number;
  /** [0, n) 整数。n <= 0 时返回 0 */
  int(n: number): number;
  /** [min, max] 闭区间整数 */
  range(min: number, max: number): number;
  /** 以概率 p 返回 true */
  chance(p: number): boolean;
  /** 原地洗牌并返回同一数组（Fisher-Yates 降序） */
  shuffle<T>(arr: T[]): T[];
  /** 等概率取一个元素。空数组抛错——静默返回 undefined 会把错误推到很远的地方 */
  pick<T>(arr: readonly T[]): T;
  /** 按权重取索引。权重全为 0 时返回 0 */
  weighted(weights: readonly number[]): number;
  /** 当前内部状态。用于存档、回放定位、以及 derive/fork 的派生基点 */
  state(): number;
  /** 复制当前状态成一个独立随机源（做前瞻推演时不影响主线） */
  fork(): Rng;
  /**
   * 按标签派生一条独立随机流。
   *
   * 用途：地图生成、战斗、商店各用各的流，这样改动其中一个的消耗次数
   * 不会连锁改变其他部分的结果 —— 否则加一张牌就会让所有历史种子全变样。
   * 注意它只读取父流状态、不推进父流。
   */
  derive(label: string): Rng;
}

/**
 * 创建随机源。算法为 mulberry32：32 位状态、单文件、无依赖，
 * 分布对游戏用途足够好；不用于任何密码学场景。
 */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const step = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng: Rng = {
    next: step,
    int(n: number): number {
      if (!(n > 0)) return 0;
      return Math.floor(step() * n);
    },
    range(min: number, max: number): number {
      if (max < min) return min;
      return min + Math.floor(step() * (max - min + 1));
    },
    chance(p: number): boolean {
      return step() < p;
    },
    shuffle<T>(arr: T[]): T[] {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(step() * (i + 1));
        const tmp = arr[i]!;
        arr[i] = arr[j]!;
        arr[j] = tmp;
      }
      return arr;
    },
    pick<T>(arr: readonly T[]): T {
      if (arr.length === 0) throw new Error('Rng.pick: 空数组无元素可取');
      return arr[Math.floor(step() * arr.length)]!;
    },
    weighted(weights: readonly number[]): number {
      let total = 0;
      for (const w of weights) total += w > 0 ? w : 0;
      if (total <= 0) return 0;
      let r = step() * total;
      for (let i = 0; i < weights.length; i++) {
        const w = weights[i]! > 0 ? weights[i]! : 0;
        r -= w;
        if (r < 0) return i;
      }
      return weights.length - 1;
    },
    state(): number {
      return a >>> 0;
    },
    fork(): Rng {
      return createRng(a);
    },
    derive(label: string): Rng {
      return createRng(deriveSeed(a, label));
    }
  };
  return rng;
}

/**
 * 把任意文本折叠成 32 位种子（FNV-1a）。
 * 这样玩家可以用「一句中文」当种子，不必记十六进制。
 */
export function hashSeed(text: string): number {
  let hv = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hv ^= text.charCodeAt(i);
    hv = Math.imul(hv, 0x01000193);
  }
  return hv >>> 0;
}

/** 人类可读的种子码：8 位大写十六进制分两组，例 `7F2A-19C4` */
export function formatSeed(seed: number): string {
  const hex = (seed >>> 0).toString(16).toUpperCase().padStart(8, '0');
  return `${hex.slice(0, 4)}-${hex.slice(4)}`;
}

/**
 * 从一个种子派生出子种子。
 *
 * 同一份种子配不同标签得到互不相干的子种子，于是「本局的地图」「本局的牌序」
 * 「某一场战斗」各有各的随机流：改动其中一个的消耗次数，不会连锁改变其他部分。
 * 没有这一层的话，加一张牌就会让所有历史种子全变样，种子分享也就失去了意义。
 */
export function deriveSeed(seed: number, label: string): number {
  return hashSeed(`${seed >>> 0}:${label}`);
}

/**
 * 解析玩家输入的种子。接受 `7F2A-19C4` 形式，也接受任意文本（按文本折叠）。
 * 空串返回 null，由调用方决定用什么兜底。
 */
export function parseSeed(text: string): number | null {
  const raw = text.trim();
  if (raw === '') return null;
  const hex = raw.replace(/[\s-]/g, '');
  if (/^[0-9a-fA-F]{8}$/.test(hex)) return parseInt(hex, 16) >>> 0;
  return hashSeed(raw);
}

/**
 * 产生一个新种子。
 *
 * 这是全项目**唯一**允许非确定性的地方——它本身就是「创造一个还没有的世界」。
 * 刻意不借用全局随机函数：那样等于给确定性开了个后门，守卫测试也就失去意义。
 */
let seedCounter = 0;
export function newSeed(): number {
  seedCounter = (seedCounter + 1) >>> 0;
  const t = Date.now() >>> 0;
  const p =
    typeof performance !== 'undefined' ? Math.floor(performance.now() * 1000) >>> 0 : 0;
  return hashSeed(`${t}:${p}:${seedCounter}`);
}
