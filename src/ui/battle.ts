import { cardOr } from '../content';
import { createBattle } from '../engine/combat';
import type { Battle } from '../engine/combat';
import { moveInterval } from '../engine/types';
import type {
  BattleEvent,
  BattleInput,
  BattleResult,
  CardInstance,
  PlayerAction,
  UnitId
} from '../engine/types';
import { kindLabel } from './card-view';
import { h, toast } from './dom';
import { AXIS_WIDTH, renderAxis, renderAxisLegend } from './timeline';

/**
 * 战斗界面。
 *
 * 按 M0 定下的规矩：**持久化 DOM，只改变化的部分**，动画用 Web Animations API 串。
 * 卡牌游戏有大量转场（抽牌、出牌、伤害数字、时序轴推进），每次整块重建会把动画
 * 打断得干干净净，所以这里分成四块各管各的：
 *
 *   .battle-axis  时序轴 —— 每次同步整块重建（没有长动画，重建最省心）
 *   .battle-body  敌我状态 —— 每次同步重建
 *   .battle-hand  手牌 —— 每次同步重建
 *   .battle-fx    飘字与震动 —— **只增不减**，同步时绝不清空，否则动画会被抹掉
 *
 * 引擎与界面的分工：引擎只管算出事件，界面只负责把事件按顺序播出来。
 * 这里没有任何一处规则判断，规则全在 engine 里。
 */

/** 各事件的基础停留时长（毫秒，还会被倍速除） */
const DELAYS: Record<BattleEvent['k'], number> = {
  clock: 90,
  turnStart: 150,
  draw: 110,
  energy: 90,
  play: 170,
  schedule: 150,
  resolve: 240,
  rejected: 140,
  speed: 140,
  damage: 250,
  heal: 200,
  block: 130,
  buff: 140,
  shift: 230,
  cancel: 230,
  discard: 80,
  death: 340,
  turnEnd: 110,
  end: 320
};

/** 可以选的播放倍速 */
const SPEEDS = [1, 2, 4] as const;

export interface BattleDoneInfo {
  result: BattleResult;
  rounds: number;
  hp: number;
  maxHp: number;
  /** 全部事件，日后回放与战报可以直接用 */
  events: readonly BattleEvent[];
}

export interface BattleCtx {
  /** 玩家看完结算、点了返回之后调用 */
  onDone(info: BattleDoneInfo): void;
  /** 战斗界面挂载时的种子码，用于在标题上显示、方便贴 bug 反馈 */
  seedLabel: string;
}

export interface BattleController {
  root: HTMLElement;
  /** 播完开场事件。调用方 await 它之后玩家才能操作 */
  start(): Promise<void>;
}

export function createBattleScreen(input: BattleInput, ctx: BattleCtx): BattleController {
  const battle: Battle = createBattle(input);

  let speed = 2;
  let skipping = false;
  let busy = true;
  let selected: string | null = null;
  let finished = false;
  let note = '时序已就绪。';

  // ==================== DOM 骨架 ====================

  const axisHost = h('div', { class: 'battle-axis' });
  const sideHost = h('div', { class: 'battle-side' });
  const fieldHost = h('div', { class: 'battle-field' });
  const handHost = h('div', { class: 'hand-cards' });
  const actHost = h('div', { class: 'battle-actions' });
  const fxHost = h('div', { class: 'battle-fx' });
  const noteHost = h('div', { class: 'battle-note' });
  const resultHost = h('div', { class: 'battle-result hide' });

  const speedButtons = SPEEDS.map((s) =>
    h(
      'button',
      {
        class: `btn ghost sp${s === speed ? ' on' : ''}`,
        onclick: () => {
          speed = s;
          for (const b of speedButtons) b.classList.toggle('on', Number(b.dataset.sp) === speed);
          toast(`播放速度 ${s}×`);
        }
      },
      `${s}×`
    )
  );
  speedButtons.forEach((b) => b.setAttribute('data-sp', b.textContent ?? ''));

  const skipBtn = h(
    'button',
    {
      class: 'btn ghost',
      onclick: () => {
        // 跳过只影响「还要等多久」，不会漏掉任何事件：剩下的照样逐条应用，只是不等待
        skipping = true;
        toast('已跳过动画');
      }
    },
    '跳过'
  );

  const root = h(
    'div',
    { class: 'battle' },
    h(
      'div',
      { class: 'battle-head' },
      h('span', { class: 'battle-title' }, `时序 · ${ctx.seedLabel}`),
      renderAxisLegend(),
      h('div', { class: 'battle-speed' }, ...speedButtons, skipBtn)
    ),
    axisHost,
    h('div', { class: 'battle-body' }, sideHost, fieldHost),
    h('div', { class: 'battle-hand' }, handHost, actHost),
    noteHost,
    fxHost,
    resultHost
  );

  // ==================== 同步界面 ====================

  function sync(): void {
    const view = battle.view();
    const axisWidth = axisHost.clientWidth || AXIS_WIDTH;
    renderAxis(axisHost, view.timeline, view.now, axisWidth);
    renderSide(view);
    renderField(view);
    renderHand(view);
    noteHost.textContent = note;
  }

  function renderSide(view: ReturnType<Battle['view']>): void {
    const me = view.me;
    const hpRatio = me.maxHp === 0 ? 0 : me.hp / me.maxHp;

    // 已挂出但还没引爆的刻印。玩家需要看到自己的安排，而不是靠记忆
    const inFlight = view.timeline
      .filter((e) => e.kind === 'card')
      .sort((a, b) => a.at - b.at);

    sideHost.replaceChildren(
      h(
        'div',
        { class: 'side-block', 'data-unit': me.id },
        h('div', { class: 'side-name' }, me.name),
        h(
          'div',
          { class: 'stat-bar' },
          h('div', {
            class: `stat-fill${hpRatio < 0.3 ? ' low' : ''}`,
            style: { width: `${Math.max(0, hpRatio * 100)}%` }
          })
        ),
        h(
          'div',
          { class: 'side-line' },
          h('span', { class: 'stat-num' }, `${me.hp}/${me.maxHp}`),
          me.block > 0 ? h('span', { class: 'badge block' }, `格挡 ${me.block}`) : null,
          me.buffs.vulnerable > 0 ? h('span', { class: 'badge bad' }, `易伤 ${me.buffs.vulnerable}`) : null,
          me.buffs.weak > 0 ? h('span', { class: 'badge bad' }, `虚弱 ${me.buffs.weak}`) : null
        ),
        h(
          'div',
          { class: 'side-line dim' },
          h('span', {}, `时能 ${view.energy}/${view.energyPerTurn}`),
          h('span', {}, `步频 ${me.speed}`)
        ),
        h(
          'div',
          { class: 'side-line dim' },
          h('span', {}, `抽牌 ${view.drawCount}`),
          h('span', {}, `弃牌 ${view.discardCount}`)
        ),
        h(
          'div',
          { class: 'panel-sub' },
          h('div', { class: 'panel-sub-title' }, `已挂刻印　${inFlight.length}`),
          inFlight.length === 0
            ? h('div', { class: 'panel-sub-empty' }, '还没有挂出刻印')
            : h(
                'div',
                { class: 'pending-list' },
                ...inFlight.map((e) =>
                  h(
                    'div',
                    { class: 'pending-row' },
                    h('span', { class: 'pending-av' }, `@${e.at}`),
                    h('span', { class: 'pending-name' }, e.label)
                  )
                )
              )
        )
      )
    );
  }

  /** 敌人下一次要出的招 —— 直接从时序轴上取，不在别处再拼一遍信息 */
  function intentOf(unitId: UnitId, view: ReturnType<Battle['view']>): string {
    const entry = view.timeline
      .filter((e) => e.owner === unitId && e.kind === 'turn')
      .sort((a, b) => a.at - b.at)[0];
    if (!entry) return '—';
    return `${entry.label}　@${entry.at}`;
  }

  function renderField(view: ReturnType<Battle['view']>): void {
    const targeting = selected !== null;
    fieldHost.replaceChildren(
      ...view.enemies.map((foe) => {
        const hpRatio = foe.maxHp === 0 ? 0 : foe.hp / foe.maxHp;
        return h(
          'div',
          {
            class: `foe-card${targeting ? ' targetable' : ''}`,
            'data-unit': foe.id,
            onclick: targeting ? () => void playSelected(foe.id) : undefined
          },
          h('div', { class: 'foe-name' }, foe.name),
          h(
            'div',
            { class: 'stat-bar' },
            h('div', {
              class: `stat-fill foe${hpRatio < 0.3 ? ' low' : ''}`,
              style: { width: `${Math.max(0, hpRatio * 100)}%` }
            })
          ),
          h(
            'div',
            { class: 'side-line' },
            h('span', { class: 'stat-num' }, `${foe.hp}/${foe.maxHp}`),
            foe.block > 0 ? h('span', { class: 'badge block' }, `格挡 ${foe.block}`) : null,
            foe.buffs.vulnerable > 0 ? h('span', { class: 'badge bad' }, `易伤 ${foe.buffs.vulnerable}`) : null,
            foe.buffs.weak > 0 ? h('span', { class: 'badge bad' }, `虚弱 ${foe.buffs.weak}`) : null
          ),
          /*
           * 招式轮转表。敌人的出招顺序完全确定，把这个交给玩家看，
           * 「时序是一道可解的排序题」才成立 —— 藏起来就只剩猜了。
           *
           * 只渲染 intent 不再重复渲染 name：每一招的 intent 本来就以名字开头
           * （「重击 24」「蔓延 6×2」），两个都放会读成「重击　重击 24」。
           * 间隔显示的是**按这个敌人的步频换算后**的实际值，而不是招式表里的
           * 固有消耗 —— 后者对步频 130 的敌人会低估它出手的频率。
           */
          h(
            'div',
            { class: 'panel-sub' },
            h('div', { class: 'panel-sub-title' }, '招式轮转'),
            h(
              'div',
              { class: 'move-list' },
              ...foe.moves.map((m, i) =>
                h(
                  'div',
                  { class: `move-row${i === foe.nextMoveIndex ? ' next' : ''}` },
                  h('span', { class: 'move-intent' }, m.intent),
                  h('span', { class: 'move-av' }, `隔 ${moveInterval(m.av, foe.speed)}`)
                )
              )
            )
          ),
          h('div', { class: 'foe-intent' }, `下一步　${intentOf(foe.id, view)}`)
        );
      })
    );
  }

  function renderHand(view: ReturnType<Battle['view']>): void {
    handHost.replaceChildren(...view.hand.map((card) => handCardEl(card, view.energy)));
    actHost.replaceChildren(
      selected !== null
        ? h('span', { class: 'hint targeting' }, '选择一个目标 · 再次点击刻印取消')
        : h(
            'button',
            {
              class: 'btn primary',
              disabled: busy || finished,
              onclick: () => void endTurn()
            },
            '结束回合'
          )
    );
  }

  function handCardEl(card: CardInstance, energy: number): HTMLElement {
    const def = cardOr(card.def.id);
    const affordable = card.def.cost <= energy;
    const usable = affordable && !busy && !finished;
    const isSel = selected === card.uid;

    return h(
      'div',
      {
        class: `hand-card k-${def.kind}${usable ? '' : ' off'}${isSel ? ' sel' : ''}`,
        'data-card': card.uid,
        onclick: usable ? () => onCardClick(card) : undefined
      },
      h(
        'div',
        { class: 'hc-head' },
        h('span', { class: 'hc-cost' }, String(def.cost)),
        h('span', { class: 'hc-name' }, def.name)
      ),
      h('div', { class: 'hc-kind' }, kindLabel(def)),
      h('div', { class: 'hc-text' }, def.text)
    );
  }

  // ==================== 操作 ====================

  function onCardClick(card: CardInstance): void {
    if (busy || finished) return;
    if (selected === card.uid) {
      selected = null;
      sync();
      return;
    }
    if (card.def.target === 'enemy') {
      // 需要目标：进入选择状态，等玩家点一个敌人
      const enemies = battle.view().enemies;
      if (enemies.length === 1) {
        void playSelected(enemies[0]!.id, card.uid);
        return;
      }
      selected = card.uid;
      sync();
      return;
    }
    void playSelected(undefined, card.uid);
  }

  async function playSelected(target?: UnitId, cardUid?: string): Promise<void> {
    const uid = cardUid ?? selected;
    if (!uid) return;
    selected = null;
    const action: PlayerAction = target ? { t: 'play', cardUid: uid, target } : { t: 'play', cardUid: uid };
    await run(action);
  }

  async function endTurn(): Promise<void> {
    if (busy || finished) return;
    selected = null;
    await run({ t: 'endTurn' });
  }

  async function run(action: PlayerAction): Promise<void> {
    busy = true;
    sync();
    const step =
      action.t === 'play' ? battle.playCard(action.cardUid, action.target) : battle.endTurn();
    await playEvents(step.events);
    busy = false;
    sync();
    if (step.result) showResult(step.result);
  }

  // ==================== 事件回放 ====================

  async function playEvents(events: readonly BattleEvent[]): Promise<void> {
    for (const ev of events) {
      applyEvent(ev);
      // 每条事件后都同步一次：界面是状态的投影，逐条同步才能让玩家看清每一步
      sync();
      // 跳过状态下等待直接归零，但事件仍然逐条应用 —— 跳过的是动画，不是过程
      await wait(DELAYS[ev.k] / speed);
    }
    skipping = false;
  }

  function applyEvent(ev: BattleEvent): void {
    const v = battle.view();
    switch (ev.k) {
      case 'clock':
        note = `时钟推进到 ${ev.at} 行动值`;
        break;
      case 'turnStart':
        note = ev.unit === v.me.id ? `第 ${ev.round} 回合 · 轮到我方` : `${unitName(ev.unit)} 开始行动`;
        break;
      case 'play': {
        const def = cardOr(ev.cardId);
        note = `打出「${def.name}」`;
        break;
      }
      case 'resolve':
        note = '一张挂刻引爆了';
        break;
      case 'schedule':
        note =
          ev.entry.kind === 'card'
            ? `挂刻「${ev.entry.label}」排在 ${ev.entry.at} 行动值`
            : `${ev.entry.label} 排在 ${ev.entry.at} 行动值`;
        break;
      case 'damage': {
        const who = ev.dst === v.me.id ? '你' : unitName(ev.dst);
        const blockText = ev.blocked > 0 ? `（格挡吸收 ${ev.blocked}）` : '';
        note = `${who} 受到 ${ev.amount} 点伤害${blockText}`;
        floatOn(ev.dst, `-${ev.amount - ev.blocked}`, 'dmg');
        if (ev.blocked > 0) floatOn(ev.dst, `挡 ${ev.blocked}`, 'blk', 26);
        shake(ev.dst);
        break;
      }
      case 'heal':
        note = `${unitName(ev.dst)} 回复 ${ev.amount} 点稳定度`;
        floatOn(ev.dst, `+${ev.amount}`, 'heal');
        break;
      case 'block':
        note = `${unitName(ev.dst)} 获得 ${ev.amount} 点格挡`;
        floatOn(ev.dst, `+${ev.amount} 格挡`, 'blk');
        break;
      case 'buff':
        note = `${unitName(ev.dst)} 获得 ${ev.stacks} 层${ev.buff === 'vulnerable' ? '易伤' : '虚弱'}`;
        floatOn(ev.dst, ev.buff === 'vulnerable' ? '易伤' : '虚弱', 'bad');
        break;
      case 'shift':
        note = `${unitName(ev.unit)} 的行动值 ${ev.from} → ${ev.to}`;
        break;
      case 'cancel':
        note = `取消了 ${unitName(ev.owner)} 的行动`;
        break;
      case 'death':
        note = `${unitName(ev.unit)} 崩解了`;
        break;
      case 'speed':
        note = `${unitName(ev.unit)} 步频变为 ${ev.value}`;
        break;
      case 'rejected':
        note = `无法出牌：${ev.reason}`;
        break;
      case 'discard':
        note = ev.cards.length > 1 ? `弃掉 ${ev.cards.length} 张手牌` : note;
        break;
      case 'end':
        note = ev.result === 'win' ? '时序已修复。' : '你的稳定度归零。';
        break;
      default:
        break;
    }
  }

  function unitName(id: UnitId): string {
    const v = battle.view();
    if (id === v.me.id) return '你';
    return v.enemies.find((e) => e.id === id)?.name ?? '畸变体';
  }

  function wait(ms: number): Promise<void> {
    if (skipping || ms <= 0) return Promise.resolve();
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  // ==================== 覆盖层动效 ====================

  /**
   * 播一段动画。
   *
   * jsdom 不实现 Web Animations API，界面冒烟测试跑在 jsdom 里 ——
   * 直接调 el.animate 会让整条测试路径抛错，而那是我们最想保住的一条路径。
   * 所以这里统一包一层：没有动画能力就跳过动效，功能照常。
   */
  function animate(
    el: HTMLElement,
    frames: Keyframe[],
    options: KeyframeAnimationOptions,
    onDone?: () => void
  ): void {
    if (typeof el.animate !== 'function') {
      onDone?.();
      return;
    }
    const anim = el.animate(frames, options);
    anim.finished.then(() => onDone?.()).catch(() => onDone?.());
  }

  /** 找到某个单位当前的界面位置（相对根节点），拿不到就退回中央 */
  function anchorOf(unitId: UnitId): { x: number; y: number } {
    const el = root.querySelector<HTMLElement>(`[data-unit="${unitId}"]`);
    const base = root.getBoundingClientRect();
    if (!el) return { x: base.width / 2, y: base.height / 2 };
    const r = el.getBoundingClientRect();
    return { x: r.left - base.left + r.width / 2, y: r.top - base.top };
  }

  /**
   * 飘字。挂在 .battle-fx 上 —— 这一层同步时绝不清空，
   * 否则动画会在下一帧被抹掉，玩家什么都看不到。
   */
  function floatOn(unitId: UnitId, text: string, cls: string, dy = 0): void {
    const spot = anchorOf(unitId);
    const el = h(
      'div',
      { class: `fx-float ${cls}`, style: { left: `${spot.x}px`, top: `${spot.y + dy}px` } },
      text
    );
    fxHost.append(el);
    animate(
      el,
      [
        { transform: 'translate(-50%, 0) scale(0.9)', opacity: 0 },
        { transform: 'translate(-50%, -16px) scale(1.15)', opacity: 1, offset: 0.25 },
        { transform: 'translate(-50%, -52px) scale(1)', opacity: 0 }
      ],
      { duration: 800 / Math.max(1, speed), easing: 'ease-out' },
      () => el.remove()
    );
  }

  function shake(unitId: UnitId): void {
    const el = root.querySelector<HTMLElement>(`[data-unit="${unitId}"]`);
    if (!el) return;
    animate(
      el,
      [
        { transform: 'translateX(0)' },
        { transform: 'translateX(-6px)' },
        { transform: 'translateX(5px)' },
        { transform: 'translateX(0)' }
      ],
      { duration: 220 / Math.max(1, speed) }
    );
  }

  // ==================== 结算 ====================

  function showResult(result: BattleResult): void {
    finished = true;
    busy = false;
    selected = null;
    const v = battle.view();
    resultHost.classList.remove('hide');
    resultHost.replaceChildren(
      h(
        'div',
        { class: `result-card ${result}` },
        h('h3', { class: 'result-title' }, result === 'win' ? '时序已修复' : '时序崩坏'),
        h(
          'p',
          { class: 'result-line' },
          `回合 ${v.round}　稳定度 ${v.me.hp}/${v.me.maxHp}　终局 ${v.now} 行动值`
        ),
        h(
          'p',
          { class: 'hint' },
          result === 'win'
            ? '这场战斗的完整过程可以回放（M3 接入），种子码已显示在标题上。'
            : '同一种子 + 同一串操作必定重演这一局。若要反馈问题，请附上标题里的种子码。'
        ),
        h(
          'button',
          {
            class: 'btn primary',
            onclick: () => ctx.onDone({ result, rounds: v.round, hp: v.me.hp, maxHp: v.me.maxHp, events: battle.history() })
          },
          '返回筹备'
        )
      )
    );
    sync();
  }

  // ==================== 启动 ====================

  async function start(): Promise<void> {
    // 开场事件（时钟归零、第一回合、起手抽牌）在第一次操作之前就已经躺在缓冲里
    await playEvents(battle.pending());
    busy = false;
    note = '轮到你行动。';
    sync();
  }

  return { root, start };
}
