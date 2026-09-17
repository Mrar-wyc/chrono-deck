import { describe, expect, it } from 'vitest';
import { hashState, stableStringify } from '../src/replay/hash';
import { createRng } from '../src/rng';

describe('稳定序列化', () => {
  it('对象键的书写顺序不影响结果', () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
  });

  it('数组顺序会影响结果', () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it('值为 undefined 的字段被跳过，因此不影响哈希', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
  });

  it('null 与 undefined 是不同的东西', () => {
    expect(stableStringify(null)).not.toBe(stableStringify(undefined));
  });

  it('null 与 false 不会被混为一谈', () => {
    expect(stableStringify({ a: null })).not.toBe(stableStringify({ a: false }));
  });

  it('嵌套结构的稳定性逐层成立', () => {
    const x = { list: [{ b: 1, a: 2 }, { d: [1, { z: 0, y: 1 }] }] };
    const y = { list: [{ a: 2, b: 1 }, { d: [1, { y: 1, z: 0 }] }] };
    expect(stableStringify(x)).toBe(stableStringify(y));
  });

  it('非有限数字不会塌缩成同一个字符串', () => {
    const s = new Set([stableStringify(NaN), stableStringify(Infinity), stableStringify(-Infinity)]);
    expect(s.size).toBe(3);
    expect(new Set([stableStringify(NaN), stableStringify(0), stableStringify(1)]).size).toBe(3);
  });

  it('字符串与数字不会互相混淆', () => {
    expect(stableStringify({ a: '1' })).not.toBe(stableStringify({ a: 1 }));
  });
});

describe('状态哈希', () => {
  it('输出 8 位大写十六进制', () => {
    expect(hashState({ a: 1 })).toMatch(/^[0-9A-F]{8}$/);
  });

  it('语义相同的状态得到同一哈希', () => {
    expect(hashState({ a: 1, b: [1, 2] })).toBe(hashState({ b: [1, 2], a: 1 }));
  });

  it('任一字段变化都会改变哈希', () => {
    expect(hashState({ hp: 70 })).not.toBe(hashState({ hp: 71 }));
  });

  /**
   * 这条是回放体系的地基。这里先用一段模拟流程证明种子→哈希这条链路是通的；
   * 「同种子 + 同操作序列跑完一场真实战斗，事件流逐条相同」的断言在
   * tests/engine.test.ts 的「录下动作再照着放一遍」里。
   */
  it('同一种子走同一段流程 → 同一哈希；换种子 → 换哈希', () => {
    const run = (seed: number): string => {
      const rng = createRng(seed);
      // 各子系统用各自派生的随机流，互不干扰
      const map = rng.derive('map');
      const deck = rng.derive('deck');
      const state = {
        seed,
        nodes: Array.from({ length: 6 }, () => map.int(3)),
        deck: deck.shuffle([
          'calibrate',
          'ward',
          'hasten',
          'lag',
          'frost_strike',
          'confluence'
        ]),
        hp: 70 + rng.int(10)
      };
      return hashState(state);
    };

    expect(run(12345)).toBe(run(12345));
    expect(run(12345)).not.toBe(run(12346));
  });

  it('取出更多随机数后哈希随之改变，说明状态确实被推进了', () => {
    const a = createRng(2024);
    const before = hashState({ v: a.state() });
    a.next();
    expect(hashState({ v: a.state() })).not.toBe(before);
  });
});
