import { describe, expect, it } from 'vitest';
import { estimateLabelWidth, laneCount, layoutChips, pickSpan } from '../src/ui/timeline';
import type { TimelineEntry } from '../src/engine/types';

/**
 * 时序轴的布局逻辑测试。
 *
 * 布局刻意做成了纯函数（输入条目与尺寸，输出像素位置），所以这里不需要浏览器
 * 就能验证「同一时刻的条目会不会叠在一起」「窗口外的条目会不会画出来」这类
 * 只有肉眼才能发现的问题 —— 而肉眼看的是截图，那条路径很慢。
 */

let seq = 0;
function entry(at: number, label: string, kind: TimelineEntry['kind'] = 'turn'): TimelineEntry {
  seq += 1;
  return { id: `e${seq}`, owner: 'player', side: 'ally', at, kind, label };
}

const NOW = 0;
const SPAN = 200;
const WIDTH = 1000;

describe('标签宽度估算', () => {
  it('中日韩字符按全宽算，拉丁字符按半宽算', () => {
    expect(estimateLabelWidth('刻印')).toBeGreaterThan(estimateLabelWidth('ab'));
  });

  it('长度相同的中文标签比英文宽', () => {
    expect(estimateLabelWidth('畸变甲 · 挥击')).toBeGreaterThan(estimateLabelWidth('aaaaaa'));
  });

  it('宽度随内容增长，不会退化成常数', () => {
    expect(estimateLabelWidth('短')).toBeLessThan(estimateLabelWidth('长很多的名字'));
  });
});

describe('窗口跨度', () => {
  it('没有条目时取最小跨度，不会退化成 0', () => {
    expect(pickSpan([], NOW)).toBe(150);
  });

  it('按最远的那个条目自适应，保证它落在窗口内', () => {
    const span = pickSpan([entry(500, '远')], NOW);
    expect(span).toBeGreaterThan(500);
    expect(span).toBeLessThanOrEqual(700);
  });

  it('条目都集中在近处时收紧窗口，否则轴右侧会空掉一大半', () => {
    // 100 行动值处的条目：窗口不该还撑在 240 那种保守值上
    expect(pickSpan([entry(100, '近')], NOW)).toBeLessThan(200);
  });

  it('遥远条目也不会把跨度拉到超过上限，否则轴会被压扁', () => {
    expect(pickSpan([entry(99999, '极远')], NOW)).toBe(700);
  });

  it('只考虑最近的若干条，不被一堆远期条目撑开', () => {
    const many = Array.from({ length: 40 }, (_, i) => entry(100 + i * 500, `条目${i}`));
    expect(pickSpan(many, NOW)).toBeLessThanOrEqual(700);
  });

  it('已经过去的条目不影响跨度', () => {
    expect(pickSpan([entry(-50, '过去')], NOW)).toBe(150);
  });
});

describe('条目摆放', () => {
  it('位置与行动值成正比', () => {
    const chips = layoutChips([entry(100, 'x')], NOW, SPAN, WIDTH);
    expect(chips.length).toBe(1);
    // 100 / 200 * 1000 = 500
    expect(chips[0]!.x).toBe(500);
  });

  it('不会画出已经过去的条目', () => {
    expect(layoutChips([entry(-1, '过去')], NOW, SPAN, WIDTH).length).toBe(0);
  });

  it('不会画出超出窗口的条目', () => {
    expect(layoutChips([entry(SPAN + 1, '太远')], NOW, SPAN, WIDTH).length).toBe(0);
  });

  it('窗口两端的边界条目都会被画出来', () => {
    const chips = layoutChips([entry(NOW, '起点'), entry(NOW + SPAN, '终点')], NOW, SPAN, WIDTH);
    expect(chips.length).toBe(2);
  });

  it('右端条目会被往左收，保证整块标签留在窗口内', () => {
    const chips = layoutChips([entry(NOW + SPAN, '贴右边缘的一个比较长的标签')], NOW, SPAN, WIDTH);
    const c = chips[0]!;
    expect(c.x + c.width).toBeLessThanOrEqual(WIDTH);
    expect(c.x).toBeGreaterThanOrEqual(0);
  });

  it('同一时刻的多个条目分到不同行，不会互相遮挡', () => {
    // 这正是本作的核心局面：挂刻与敌人恰好在同一行动值引爆
    const chips = layoutChips(
      [entry(100, '霜击', 'card'), entry(100, '畸变甲 · 挥击 21'), entry(100, '我')],
      NOW,
      SPAN,
      WIDTH
    );
    expect(chips.length).toBe(3);
    const lanes = new Set(chips.map((c) => c.lane));
    expect(lanes.size, '三条同时刻的标签必须有各自的行').toBe(3);
  });

  it('时刻拉开距离的条目可以共用一行，不浪费纵向空间', () => {
    const chips = layoutChips([entry(10, '近'), entry(190, '远')], NOW, SPAN, WIDTH);
    expect(laneCount(chips), '相距很远的两条应当并排在同一行').toBe(1);
  });

  it('同一行内的标签左右不重叠', () => {
    const chips = layoutChips(
      [entry(0, '甲'), entry(5, '乙'), entry(10, '丙'), entry(15, '丁')],
      NOW,
      SPAN,
      WIDTH
    );
    const byLane = new Map<number, { x: number; width: number }[]>();
    for (const c of chips) {
      const list = byLane.get(c.lane) ?? [];
      list.push(c);
      byLane.set(c.lane, list);
    }
    for (const [lane, list] of byLane) {
      list.sort((a, b) => a.x - b.x);
      for (let i = 1; i < list.length; i++) {
        expect(
          list[i]!.x,
          `第 ${lane} 行里第 ${i} 个标签与前一个重叠了`
        ).toBeGreaterThanOrEqual(list[i - 1]!.x + list[i - 1]!.width);
      }
    }
  });

  it('输出顺序与时刻顺序一致，界面自上而下读得到先后', () => {
    const chips = layoutChips([entry(150, '丙'), entry(10, '甲'), entry(80, '乙')], NOW, SPAN, WIDTH);
    expect(chips.map((c) => c.entry.label)).toEqual(['甲', '乙', '丙']);
  });

  it('行数上限可预期：极端挤压下不会无限长高', () => {
    const chips = layoutChips(
      Array.from({ length: 12 }, () => entry(100, '极长的标签名字在这里')),
      NOW,
      SPAN,
      WIDTH
    );
    // 同一时刻最多挤到 12 行，但每行确实只放了一条
    expect(laneCount(chips)).toBe(12);
  });
});
