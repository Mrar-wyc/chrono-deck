import type { TimelineEntry } from '../engine/types';
import { h } from './dom';

/**
 * 时序轴渲染。
 *
 * 这是战斗界面最重要的元素：整条轴公开可见，包括敌人下一步落在第几行动值。
 * 玩家要能一眼看出「我的霜击会不会赶在这家伙之前落地」—— 这是本作全部策略的所在。
 *
 * 布局算在一个纯函数里（layoutChips），与 DOM 无关，因此可以单独测。
 * 轴的重建代价很低，所以每次同步直接整块重建；只有飘字与震动走覆盖层（见 battle.ts）。
 */

/** 轴上的刻度间隔（行动值） */
const TICK_STEP = 50;
/** 最少显示多长的窗口。太短则刚过去的事件会显得跳动剧烈 */
const MIN_SPAN = 150;
/** 最长窗口。再长标签就挤成一片了 */
const MAX_SPAN = 700;
/** 窗口右端留出的余量：让最远的那个条目不至于贴着边缘 */
const SPAN_MARGIN = 60;
/** 一个标签占的横向像素（估算，见 estimateLabelWidth） */
const CHIP_HEIGHT = 26;
const CHIP_GAP = 6;

export interface ChipLayout {
  entry: TimelineEntry;
  /** 左边缘像素位置 */
  x: number;
  width: number;
  /** 第几行（0 起）。同一时刻的多个条目会叠到不同行，避免互相遮挡 */
  lane: number;
}

/** 中日韩字符按全宽算，其余按半宽算。用来估算标签需要多宽 */
export function estimateLabelWidth(label: string): number {
  let w = 0;
  for (const ch of label) {
    w += /[\u1100-\u115f\u2e80-\ua4cf\ua960-\ua97f\uac00-\ud7ff\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/.test(ch)
      ? 15
      : 8.2;
  }
  return Math.round(w) + 22;
}

/**
 * 选窗口长度。
 *
 * 固定跨度要么把整条轴压扁（敌人分散时挤成一团），要么让右边空掉三分之二
 * （条目都集中在近处时）。所以按接下来几个条目自适应：既保证有个最小可读区间，
 * 又不为了显示一个遥远的条目把比例尺拉垮。
 */
export function pickSpan(entries: readonly TimelineEntry[], now: number, upcoming = 6): number {
  const future = entries
    .filter((e) => e.at >= now)
    .sort((a, b) => a.at - b.at)
    .slice(0, upcoming);
  const furthest = future.length === 0 ? now : future[future.length - 1]!.at;
  return Math.min(MAX_SPAN, Math.max(MIN_SPAN, furthest - now + SPAN_MARGIN));
}

/**
 * 把轴上的条目摆到像素位置上。
 *
 * 同一时刻挤着多个条目是常态（挂刻与敌人恰好在同一行动值引爆，正是本作的核心局面），
 * 所以必须分行：按时间顺序贪心地把每个标签放进第一个放得下的行里。
 */
export function layoutChips(
  entries: readonly TimelineEntry[],
  now: number,
  span: number,
  width: number
): ChipLayout[] {
  const visible = entries
    .filter((e) => e.at >= now && e.at <= now + span)
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));

  const laneEnds: number[] = [];
  const out: ChipLayout[] = [];

  for (const entry of visible) {
    const width0 = estimateLabelWidth(entry.label);
    const raw = ((entry.at - now) / span) * width;
    const x = Math.max(0, Math.min(width - width0, raw));

    let lane = laneEnds.findIndex((end) => x >= end + CHIP_GAP);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = x + width0;

    out.push({ entry, x, width: width0, lane });
  }

  return out;
}

/** 战斗界面里时序轴的可视宽度。必须与 style.css 的 .ax-window 宽度一致，由守卫测试断言 */
export const AXIS_WIDTH = 1376;

export function laneCount(chips: readonly ChipLayout[]): number {
  return chips.reduce((n, c) => Math.max(n, c.lane + 1), 1);
}

function chipClass(entry: TimelineEntry): string {
  if (entry.kind === 'card') return 'ax-chip k-card';
  return entry.side === 'ally' ? 'ax-chip k-turn side-ally' : 'ax-chip k-turn side-foe';
}

/**
 * 画出整条轴。返回实际用的跨度，供调用方知道当前比例尺。
 *
 * `now` 指针固定在左边缘：轴表达的是「从现在往后的安排」，
 * 把过去也画出来只会挤掉真正需要判断的那部分。
 */
export function renderAxis(
  host: HTMLElement,
  entries: readonly TimelineEntry[],
  now: number,
  width: number,
  highlightId?: string
): number {
  const span = pickSpan(entries, now);
  const chips = layoutChips(entries, now, span, width);
  const lanes = laneCount(chips);
  const height = lanes * (CHIP_HEIGHT + 6) + 26;

  host.replaceChildren();

  const win = h('div', { class: 'ax-window', style: { height: `${height}px` } });

  // 刻度：每 TICK_STEP 行动值一条，标出相对当前的偏移
  for (let t = 0; t <= span; t += TICK_STEP) {
    const x = (t / span) * width;
    const major = t === 0;
    win.append(
      h('div', { class: `ax-tick${major ? ' major' : ''}`, style: { left: `${x}px` } }),
      h(
        'div',
        { class: `ax-tick-label${major ? ' major' : ''}`, style: { left: `${x}px` } },
        major ? '现在' : `+${t}`
      )
    );
  }

  for (const chip of chips) {
    const top = chip.lane * (CHIP_HEIGHT + 6) + 22;
    win.append(
      h(
        'div',
        {
          class: `${chipClass(chip.entry)}${chip.entry.id === highlightId ? ' flash' : ''}`,
          'data-entry': chip.entry.id,
          style: { left: `${chip.x}px`, width: `${chip.width}px`, top: `${top}px` },
          title: `${chip.entry.label} · ${chip.entry.at} AV`
        },
        h('span', { class: 'ax-chip-av' }, String(chip.entry.at)),
        h('span', { class: 'ax-chip-label' }, chip.entry.label)
      )
    );
  }

  host.append(win);
  return span;
}

/** 轴的图例。三种颜色各自代表什么，第一次进场必须能看懂 */
export function renderAxisLegend(): HTMLElement {
  return h(
    'div',
    { class: 'ax-legend' },
    h('span', { class: 'ax-legend-item' }, h('i', { class: 'dot k-turn side-ally' }), '我'),
    h('span', { class: 'ax-legend-item' }, h('i', { class: 'dot k-turn side-foe' }), '畸变体'),
    h('span', { class: 'ax-legend-item' }, h('i', { class: 'dot k-card' }), '已挂刻印')
  );
}
