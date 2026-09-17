import { cardOr } from '../content';
import { REWARD_CARDS, STARTER_DECK } from '../content/cards';
import { formatSeed, newSeed, parseSeed } from '../rng';
import { cardRow } from './card-view';
import type { AppCtx } from './ctx';
import { h, toast } from './dom';

/**
 * 筹备界面。
 *
 * M0 阶段它的职责是把种子系统跑通并可见：生成、显示、复制、手输、重掷。
 * 时序轴战斗在 M1 接上，入口按钮先置灰并说明原因，不做假的可用状态。
 */
export function renderSetup(root: HTMLElement, ctx: AppCtx): void {
  const seedInput = h('input', {
    class: 'seed-input',
    type: 'text',
    placeholder: '输入种子码，或任意一句话',
    value: '',
    maxlength: '40'
  }) as HTMLInputElement;

  const applySeed = (): void => {
    const parsed = parseSeed(seedInput.value);
    if (parsed === null) {
      toast('种子不能为空');
      return;
    }
    ctx.setSeed(parsed);
    toast(`已切换到 ${formatSeed(parsed)}`);
  };

  /** 复制失败（无剪贴板权限、非安全上下文）时退化成把种子码显示出来让玩家手抄 */
  const copySeed = (): void => {
    const code = formatSeed(ctx.seed);
    const clip = navigator.clipboard;
    if (!clip) {
      toast(code);
      return;
    }
    clip
      .writeText(code)
      .then(() => toast('种子码已复制'))
      .catch(() => toast(code));
  };

  const starterTotal = STARTER_DECK.reduce((n, e) => n + e.count, 0);
  const deckRows = STARTER_DECK.map((e) => cardRow(cardOr(e.cardId), e.count));
  const rewardRows = REWARD_CARDS.map((c) => cardRow(c));

  root.append(
    h(
      'div',
      { class: 'setup' },
      h(
        'div',
        { class: 'setup-head' },
        h('h2', { class: 'setup-title' }, '筹备'),
        h(
          'div',
          { class: 'btn-row' },
          h('button', { class: 'btn ghost', onclick: () => ctx.go('menu') }, '返回')
        )
      ),
      h(
        'div',
        { class: 'setup-body' },
        h(
          'div',
          { class: 'setup-col left' },
          h(
            'div',
            { class: 'panel' },
            h('p', { class: 'panel-label' }, '本次时序种子'),
            h('p', { class: 'seed-code' }, formatSeed(ctx.seed)),
            h(
              'div',
              { class: 'btn-row' },
              h(
                'button',
                {
                  class: 'btn ghost',
                  onclick: () => ctx.setSeed(newSeed())
                },
                '重掷种子'
              ),
              h(
                'button',
                {
                  class: 'btn ghost',
                  onclick: copySeed
                },
                '复制'
              )
            )
          ),
          h(
            'div',
            { class: 'panel' },
            h('p', { class: 'panel-label' }, '使用指定种子'),
            seedInput,
            h('button', { class: 'btn', onclick: applySeed }, '使用这个种子')
          ),
          h(
            'div',
            { class: 'panel' },
            h(
              'p',
              { class: 'hint' },
              '同一个种子 + 同一串操作，必定得到完全相同的结果。' +
                '把种子码发给别人，就能让对方遇到一模一样的时序。' +
                '发现异常时也请附上种子码，那是最短的复现路径。'
            )
          )
        ),
        h(
          'div',
          { class: 'setup-col right' },
          h(
            'div',
            { class: 'panel deck-panel' },
            /*
             * 两段卡表放进同一个滚动容器。
             * 分成两个各自滚动会在有限高度里互相挤，出现两条滚动条且都只露出半行，
             * 既看不出每段有多少内容，也读不出完整的一行卡面。
             */
            h(
              'div',
              { class: 'deck-list' },
              h(
                'p',
                { class: 'panel-label' },
                '起始刻印',
                h('span', { class: 'deck-count' }, `　共 ${starterTotal} 张`)
              ),
              deckRows,
              h(
                'p',
                { class: 'panel-label section-gap' },
                '可获得刻印',
                h('span', { class: 'deck-count' }, `　共 ${REWARD_CARDS.length} 种`)
              ),
              rewardRows
            )
          ),
          h(
            'div',
            { class: 'btn-row' },
            h('button', { class: 'btn primary', disabled: true }, '进入时标'),
            h('span', { class: 'hint' }, '时序轴战斗将在 M1 里程碑接入')
          )
        )
      )
    )
  );
}
