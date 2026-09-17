import { h } from './dom';
import type { AppCtx } from './ctx';

/**
 * 渲染出错时的界面。
 *
 * 与常见的「出错了就悄悄退回标题并清掉进度」不同，这里把错误原文和调用栈
 * 直接显示在界面上、并**保留玩家数据**。理由很实际：白屏且控制台没有线索，
 * 是排查成本最高的一种失败；而删掉别人的进度换一个干净的菜单，
 * 是在用一个更大的问题（数据丢失）去掩盖一个更小的问题（一次渲染失败）。
 */
export function renderCrash(root: HTMLElement, message: string, ctx: AppCtx): void {
  root.append(
    h(
      'div',
      { class: 'crash' },
      h('h2', { class: 'crash-title' }, '界面渲染失败'),
      h(
        'p',
        { class: 'hint' },
        '你的进度没有被清除。请把下面的信息连同种子码一起反馈，那是最短的复现路径。'
      ),
      h('pre', { class: 'crash-msg' }, message),
      h(
        'div',
        { class: 'btn-row' },
        h('button', { class: 'btn', onclick: () => ctx.go('menu') }, '返回标题')
      )
    )
  );
}
