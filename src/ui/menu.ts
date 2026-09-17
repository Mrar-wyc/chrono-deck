import { h } from './dom';
import type { AppCtx } from './ctx';

export function renderMenu(root: HTMLElement, ctx: AppCtx): void {
  root.append(
    h(
      'div',
      { class: 'menu' },
      h('h1', { class: 'menu-title' }, '授时局'),
      h('p', { class: 'menu-sub' }, '时序卡牌 · Roguelike'),
      h(
        'p',
        { class: 'menu-tagline' },
        '刻印不会立刻生效。它们排进一条公开的时序轴，在若干行动值之后自行引爆。' +
          '你看到的不是手牌，而是一份已经写好、还能改的未来。'
      ),
      h(
        'div',
        { class: 'menu-actions' },
        h('button', { class: 'btn primary', onclick: () => ctx.go('setup') }, '开始授时'),
        h('button', { class: 'btn ghost', onclick: () => ctx.go('about') }, '关于本作')
      )
    ),
    h('div', { class: 'menu-version' }, `v${__APP_VERSION__}`)
  );
}
