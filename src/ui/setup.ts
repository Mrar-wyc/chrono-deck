import { cardOr } from '../content';
import { REWARD_CARDS, STARTER_DECK } from '../content/cards';
import { ENCOUNTERS } from '../content/enemies';
import type { EncounterKind } from '../engine/types';
import { formatSeed, newSeed, parseSeed } from '../rng';
import { cardRow } from './card-view';
import type { AppCtx, RunSetup } from './ctx';
import { h, toast } from './dom';

/**
 * 筹备界面。
 *
 * 它的职责是给出一场战斗的全部输入：种子、遭遇、额外带的刻印。
 * 这三种选择合起来就决定了一场完全可复现的战斗，所以这里同时也是
 * 「分享一个局面」的界面 —— 种子码 + 遭遇名 + 选牌，别人就能打出同一局。
 *
 * M1 阶段进入的是单场战斗；M2 会把它接进完整的一局（多场战斗 + 奖励 + 商店）。
 */

const KIND_LABEL: Record<EncounterKind, string> = {
  normal: '普通',
  elite: '精英',
  boss: '首领'
};

/** 最多能额外带几张奖励刻印。留出上限才有「带什么」这个取舍 */
const MAX_PICK = 8;

export function renderSetup(root: HTMLElement, ctx: AppCtx, setup: RunSetup): void {
  const rerender = (): void => ctx.refresh();

  // ---------- 种子 ----------

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

  // ---------- 遭遇 ----------

  const encounterRow = h(
    'div',
    { class: 'enc-row' },
    ...ENCOUNTERS.map((enc) =>
      h(
        'button',
        {
          class: `enc-btn${enc.id === setup.encounterId ? ' on' : ''}`,
          'data-encounter': enc.id,
          onclick: () => {
            setup.encounterId = enc.id;
            rerender();
          }
        },
        enc.name,
        h('span', { class: 'enc-kind' }, `${KIND_LABEL[enc.kind]} · ${enc.enemyIds.length} 敌`)
      )
    )
  );

  // ---------- 选牌 ----------

  const picked = new Set(setup.picked);
  const togglePick = (id: string): void => {
    if (picked.has(id)) {
      picked.delete(id);
    } else if (picked.size >= MAX_PICK) {
      toast(`最多额外带 ${MAX_PICK} 张刻印`);
      return;
    } else {
      picked.add(id);
    }
    setup.picked = [...picked];
    rerender();
  };

  const starterTotal = STARTER_DECK.reduce((n, e) => n + e.count, 0);
  const starterRows = STARTER_DECK.map((e) => cardRow(cardOr(e.cardId), e.count));
  const rewardRows = REWARD_CARDS.map((c) => {
    const row = cardRow(c);
    const on = picked.has(c.id);
    row.classList.add('pickable');
    if (on) row.classList.add('picked');
    row.append(h('span', { class: 'pick-mark' }, on ? '已加入' : '点击加入'));
    row.setAttribute('data-card', c.id);
    row.addEventListener('click', () => togglePick(c.id));
    return row;
  });

  const deckSize = starterTotal + picked.size;

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
                { class: 'btn ghost', onclick: () => ctx.setSeed(newSeed()) },
                '重掷种子'
              ),
              h('button', { class: 'btn ghost', onclick: copySeed }, '复制')
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
            { class: 'panel' },
            h('p', { class: 'panel-label' }, '选择遭遇'),
            encounterRow
          ),
          h(
            'div',
            { class: 'panel deck-panel' },
            /*
             * 两段卡表放进同一个滚动容器。
             * 分成两个各自滚动会在有限高度里互相挤，出现两条滚动条且都只露出半行。
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
              starterRows,
              h(
                'p',
                { class: 'panel-label section-gap' },
                '可额外携带',
                h(
                  'span',
                  { class: 'deck-count' },
                  `　已选 ${picked.size}/${MAX_PICK}　点击整行加入或移除`
                )
              ),
              rewardRows
            )
          ),
          h(
            'div',
            { class: 'btn-row' },
            h(
              'button',
              { class: 'btn primary', onclick: () => ctx.startBattle() },
              '进入时标'
            ),
            h(
              'span',
              { class: 'deck-note' },
              '牌组 ',
              h('strong', {}, String(deckSize)),
              ' 张　遭遇 ',
              h('strong', {}, ENCOUNTERS.find((e) => e.id === setup.encounterId)?.name ?? '?')
            )
          )
        )
      )
    )
  );
}
