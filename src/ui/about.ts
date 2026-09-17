import { BASE_AV, BASE_SPEED } from '../engine/types';
import type { AppCtx } from './ctx';
import { h } from './dom';

const REPO_URL = 'https://github.com/Mrar-wyc/chrono-deck';

export function renderAbout(root: HTMLElement, ctx: AppCtx): void {
  root.append(
    h(
      'div',
      { class: 'about' },
      h('h2', { class: 'about-title' }, '关于本作'),
      h(
        'div',
        { class: 'about-body' },
        h('p', { class: 'about-p' }, '《授时局》是一个原创设定的时序卡牌 Roguelike。'),
        h('h3', { class: 'about-h' }, '核心机制：时序轴'),
        h(
          'p',
          { class: 'about-p' },
          '刻印分三种形态。即时刻印立刻结算，是熟悉的手感；' +
            '挂刻刻印不立刻结算，而是排进一条公开的时序轴，若干行动值之后自行引爆，' +
            '同样的费用能打出明显更高的数值，代价是你要赌那时候局势还在；' +
            '校正刻印不造成任何伤害，只操作时间轴——把自己的行动提前、把敌人的推后、' +
            '取消它已经排入轴的行动，或者把已经挂出去的刻印拉回来立刻引爆。'
        ),
        h(
          'p',
          { class: 'about-p' },
          '时序轴对所有人可见，包括敌人下一步落在第几行动值。' +
            '所以这是一道有确定答案的排序题：你在 60 行动值后引爆的刻印，' +
            '能不能赶在敌人下一次行动（比如 100 行动值）之前落地？' +
            '赶得上就是你先打，赶不上就是你先挨打。' +
            `基准是「步频 ${BASE_SPEED} 的单位行动一次占 ${BASE_AV} 行动值」。`
        ),
        h('h3', { class: 'about-h' }, '技术'),
        h(
          'p',
          { class: 'about-p' },
          'Vite + TypeScript，不打包任何第三方前端库，也没有前端框架。' +
            '战斗规则是纯函数并自带种子随机数，因此可以回放、可以复现，' +
            '也让机器人对局的平衡测量不带随机噪声。'
        ),
        h('h3', { class: 'about-h' }, '源码'),
        h(
          'p',
          { class: 'about-p' },
          h(
            'a',
            { class: 'about-link', href: REPO_URL, target: '_blank', rel: 'noreferrer' },
            REPO_URL
          )
        )
      ),
      h(
        'div',
        { class: 'btn-row' },
        h('button', { class: 'btn', onclick: () => ctx.go('menu') }, '返回标题')
      )
    )
  );
}
