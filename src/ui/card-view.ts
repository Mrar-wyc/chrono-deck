import type { CardDef } from '../engine/types';
import { h } from './dom';

/**
 * 刻印卡面。
 *
 * 刻意做成纯文字信息块：没有插画、没有头像、没有装饰图形。
 * 三种时序形态靠**左侧色带 + 文字标签**区分，而不是靠图标 ——
 * 玩法信息（几费、即时还是挂刻、挂刻几 AV）全部可直接读出。
 */

const KIND_LABEL: Record<CardDef['kind'], string> = {
  instant: '即时',
  deferred: '挂刻',
  shift: '校正'
};

/** 时序形态标签。挂刻牌必须带上延迟，那是它最重要的信息 */
export function kindLabel(card: CardDef): string {
  if (card.kind === 'deferred') return `挂刻 ${card.delay ?? '?'} AV`;
  return KIND_LABEL[card.kind];
}

export function cardRow(card: CardDef, count = 1): HTMLElement {
  return h(
    'div',
    { class: `card-row k-${card.kind}` },
    h('div', { class: 'card-band' }),
    h(
      'div',
      { class: 'card-cost' },
      String(card.cost),
      h('span', { class: 'card-cost-unit' }, '时能')
    ),
    h(
      'div',
      { class: 'card-main' },
      h(
        'div',
        { class: 'card-head' },
        h('span', { class: 'card-name' }, card.name),
        h('span', { class: 'card-kind' }, kindLabel(card)),
        count > 1 ? h('span', { class: 'card-count' }, `×${count}`) : null
      ),
      h('div', { class: 'card-text' }, card.text),
      card.flavor ? h('div', { class: 'card-flavor' }, card.flavor) : null
    )
  );
}
