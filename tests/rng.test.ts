import { describe, expect, it } from 'vitest';
import { createRng, formatSeed, hashSeed, newSeed, parseSeed } from '../src/rng';

describe('种子随机数', () => {
  it('同一种子产生完全相同的序列', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    const sa = Array.from({ length: 200 }, () => a.next());
    const sb = Array.from({ length: 200 }, () => b.next());
    expect(sa).toEqual(sb);
  });

  it('不同种子产生不同的序列', () => {
    const a = createRng(1);
    const b = createRng(2);
    const sa = Array.from({ length: 50 }, () => a.next());
    const sb = Array.from({ length: 50 }, () => b.next());
    expect(sa).not.toEqual(sb);
  });

  it('算法快照：动 mulberry32 等于让所有历史种子失效，必须是有意为之', () => {
    const r = createRng(12345);
    const out = Array.from({ length: 6 }, () => r.next());
    expect(out).toEqual([
      0.9797282677609473, 0.3067522644996643, 0.484205421525985, 0.817934412509203,
      0.5094283693470061, 0.34747186047025025
    ]);
    expect(r.state()).toBe(2399472631);
  });

  it('next() 落在 [0,1)，且两端都不会越界', () => {
    const r = createRng(777);
    for (let i = 0; i < 20000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int(n) 覆盖 [0,n) 且分布均匀', () => {
    const r = createRng(2024);
    const N = 6;
    const draws = 60000;
    const bucket = new Array<number>(N).fill(0);
    for (let i = 0; i < draws; i++) {
      const v = r.int(N);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(N);
      bucket[v]!++;
    }
    const expected = draws / N;
    for (const [face, count] of bucket.entries()) {
      expect(Math.abs(count - expected) / expected, `第 ${face} 面偏离过大`).toBeLessThan(0.05);
    }
  });

  it('int(n) 对非正数安全返回 0，不产生 NaN', () => {
    const r = createRng(5);
    expect(r.int(0)).toBe(0);
    expect(r.int(-3)).toBe(0);
  });

  it('range 是闭区间', () => {
    const r = createRng(99);
    const seen = new Set<number>();
    for (let i = 0; i < 3000; i++) {
      const v = r.range(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6, 7]);
  });

  it('range 在 max < min 时返回 min，而不是空区间循环', () => {
    const r = createRng(1);
    expect(r.range(5, 2)).toBe(5);
  });

  it('chance(p) 频率贴近 p', () => {
    const r = createRng(31337);
    const draws = 40000;
    let hits = 0;
    for (let i = 0; i < draws; i++) if (r.chance(0.25)) hits++;
    expect(Math.abs(hits / draws - 0.25)).toBeLessThan(0.02);
  });

  it('pick 空数组抛错而不是返回 undefined', () => {
    const r = createRng(3);
    expect(() => r.pick([])).toThrow(/空数组/);
  });

  it('weighted 按权重比例分配', () => {
    const r = createRng(4242);
    const weights = [1, 2, 3];
    const draws = 60000;
    const bucket = new Array<number>(3).fill(0);
    for (let i = 0; i < draws; i++) bucket[r.weighted(weights)]!++;
    const ratio = bucket.map((c) => c / draws);
    expect(Math.abs(ratio[0]! - 1 / 6)).toBeLessThan(0.02);
    expect(Math.abs(ratio[1]! - 2 / 6)).toBeLessThan(0.02);
    expect(Math.abs(ratio[2]! - 3 / 6)).toBeLessThan(0.02);
  });

  it('weighted 在全零权重时返回 0，不除零', () => {
    const r = createRng(6);
    expect(r.weighted([0, 0, 0])).toBe(0);
  });

  it('shuffle 保持元素集合不变，且确实打乱了顺序', () => {
    const r = createRng(808);
    const src = Array.from({ length: 20 }, (_, i) => i);
    const out = r.shuffle([...src]);
    expect([...out].sort((a, b) => a - b)).toEqual(src);
    expect(out).not.toEqual(src);
  });

  it('shuffle 自身可复现，且原地修改传入数组', () => {
    const arr = Array.from({ length: 30 }, (_, i) => i);
    const a = createRng(55).shuffle(arr);
    const b = createRng(55).shuffle(Array.from({ length: 30 }, (_, i) => i));
    expect(a).toEqual(b);
    expect(arr).toEqual(b);
  });

  it('fork 复制状态且与原流互不干扰', () => {
    const r = createRng(1234);
    r.next();
    r.next();
    const f = r.fork();
    expect(f.state()).toBe(r.state());

    // 消耗副本不应影响原流：原流的第一个值必须与未分叉时一致
    for (let i = 0; i < 50; i++) f.next();
    const reference = createRng(1234);
    reference.next();
    reference.next();
    expect(r.next()).toBe(reference.next());
  });

  it('derive 稳定、不推进父流、且不同标签给出不同流', () => {
    const r = createRng(20240917);
    const stateBefore = r.state();
    const map1 = r.derive('map');
    const map2 = r.derive('map');
    const shop = r.derive('shop');

    expect(r.state()).toBe(stateBefore);
    expect(Array.from({ length: 20 }, () => map1.next())).toEqual(
      Array.from({ length: 20 }, () => map2.next())
    );
    const shopVals = Array.from({ length: 20 }, () => shop.next());
    const mapVals = Array.from({ length: 20 }, () => r.derive('map').next());
    expect(shopVals).not.toEqual(mapVals);
  });

  it('derive 的独立性：改动一条流的消耗次数不影响另一条', () => {
    const base = createRng(999);
    const a1 = base.derive('combat');
    for (let i = 0; i < 7; i++) a1.next();
    const shop1 = Array.from({ length: 10 }, () => base.derive('shop').next());

    const base2 = createRng(999);
    const shop2 = Array.from({ length: 10 }, () => base2.derive('shop').next());
    expect(shop2).toEqual(shop1);
  });
});

describe('种子码', () => {
  it('hashSeed 是固定的 FNV-1a', () => {
    expect(hashSeed('授时局')).toBe(777158249);
    expect(hashSeed('chrono-deck')).toBe(390936564);
    expect(hashSeed('')).toBe(2166136261);
  });

  it('formatSeed 输出 8 位大写十六进制分两组', () => {
    expect(formatSeed(0x7f2a19c4)).toBe('7F2A-19C4');
    expect(formatSeed(0)).toBe('0000-0000');
    expect(formatSeed(0xffffffff)).toBe('FFFF-FFFF');
  });

  it('formatSeed 与 parseSeed 往返一致', () => {
    for (const seed of [0, 1, 12345, 0x7f2a19c4, 0xffffffff]) {
      expect(parseSeed(formatSeed(seed))).toBe(seed);
    }
  });

  it('parseSeed 接受带分隔符与大小写混写的形式', () => {
    expect(parseSeed('7f2a-19c4')).toBe(0x7f2a19c4);
    expect(parseSeed(' 7F2A19 C4 ')).toBe(0x7f2a19c4);
  });

  it('parseSeed 把任意文本折叠成种子，空串返回 null', () => {
    expect(parseSeed('')).toBeNull();
    expect(parseSeed('   ')).toBeNull();
    expect(parseSeed('授时局')).toBe(hashSeed('授时局'));
    expect(parseSeed('随便一句话也能当种子')).toBe(hashSeed('随便一句话也能当种子'));
  });

  it('newSeed 连续调用互不相同', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 50; i++) seen.add(newSeed());
    expect(seen.size).toBe(50);
  });
});
