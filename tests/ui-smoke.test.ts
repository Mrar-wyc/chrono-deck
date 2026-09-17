// @vitest-environment jsdom
// @vitest-environment-options {"html":"<!DOCTYPE html><html><body><div id=\"app\"></div></body></html>","url":"http://localhost:3000/?debug"}
import { describe, expect, it, vi } from 'vitest';
import { REWARD_CARDS, STARTER_DECK } from '../src/content/cards';
import { renderAxis } from '../src/ui/timeline';
import '../src/main';

/**
 * 界面冒烟：真实点击走一遍。
 *
 * 之所以要「点」而不是直接调渲染函数，是因为要覆盖事件绑定、界面重绘、
 * 异步的事件回放、以及 main.ts 里那条渲染失败兜底路径。
 *
 * 断言里必须同时检查「目标界面出现了」和「没有掉进崩溃界面」——
 * 只检查前者的话，一个渲染异常也可能让某条分支看起来像成功导航。
 */

function stage(): HTMLElement {
  const el = document.querySelector('.stage');
  if (!el) throw new Error('.stage 不存在');
  return el as HTMLElement;
}

function buttons(): HTMLButtonElement[] {
  return [...document.querySelectorAll('button')] as HTMLButtonElement[];
}

function buttonByText(text: string): HTMLButtonElement {
  const found = buttons().find((b) => (b.textContent ?? '').includes(text));
  if (!found) {
    const have = buttons()
      .map((b) => (b.textContent ?? '').trim())
      .join(' | ');
    throw new Error(`找不到按钮「${text}」，当前按钮有：${have}`);
  }
  return found;
}

function clickText(text: string): void {
  buttonByText(text).click();
}

function seedCode(): string {
  const el = document.querySelector('.seed-code');
  if (!el) throw new Error('.seed-code 不存在');
  return (el.textContent ?? '').trim();
}

function text(): string {
  return stage().textContent ?? '';
}

function expectNoCrash(): void {
  const crash = document.querySelector('.crash');
  if (crash) {
    throw new Error(`掉进了崩溃界面：\n${(crash.textContent ?? '').slice(0, 500)}`);
  }
}

/** 轮询等待某个条件成立。战斗界面的回放是异步的，断言前必须等它走完 */
async function waitFor(cond: () => boolean, label: string, timeoutMs = 6000): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    if (cond()) return;
    if (Date.now() - t0 > timeoutMs) throw new Error(`等待超时：${label}`);
    await new Promise((r) => setTimeout(r, 15));
  }
}

/** 战斗界面是否已经回到「等玩家操作」的状态（结束后会换成结算浮层） */
function interactive(): boolean {
  const btn = document.querySelector<HTMLButtonElement>('.battle-actions button');
  return !!btn && !btn.disabled;
}

/**
 * 点「跳过」把等待归零，否则一场战斗要跑十几秒。
 *
 * 注意它只在回放进行中有效（这是刻意的：播放之外点击不再 latch 给下一次），
 * 所以必须在触发动作**之后**立刻点。
 */
function skipAnimation(): void {
  const skip = buttons().find((b) => (b.textContent ?? "").includes("跳过"));
  skip?.click();
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function resultShown(): boolean {
  return document.querySelector('.battle-result:not(.hide)') !== null;
}

/**
 * 打出手上第一张打得出的牌。
 *
 * 需要选择目标的牌会先进入选择状态（此时「结束回合」按钮被换成提示文字），
 * 所以点完牌之后要立刻看看有没有 `.targetable` 的敌人可以点 ——
 * 少了这一步，测试会一直等一个永远不会出现的按钮。
 */
function playFirstCard(): boolean {
  const playable = [...document.querySelectorAll<HTMLElement>('.hand-card:not(.off)')];
  if (playable.length === 0) return false;
  playable[0]!.click();
  const target = document.querySelector<HTMLElement>('.foe-card.targetable');
  if (target) target.click();
  return true;
}

describe('界面冒烟', () => {
  it('启动后停在标题界面，并显示版本号', () => {
    expect(document.querySelector('.menu')).not.toBeNull();
    expect(document.querySelector('.menu-title')?.textContent).toBe('授时局');
    expect(document.querySelector('.menu-version')?.textContent).toMatch(/^v\d+\.\d+\.\d+$/);
    expectNoCrash();
  });

  it('点「开始授时」进入筹备界面，并给出一个可读的种子码', () => {
    clickText('开始授时');
    expect(document.querySelector('.setup')).not.toBeNull();
    expect(seedCode()).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
    expectNoCrash();
  });

  it('筹备界面列出了起始牌组与全部可获得刻印', () => {
    const rows = document.querySelectorAll('.card-row');
    const expected = STARTER_DECK.length + REWARD_CARDS.length;
    expect(rows.length, `渲染了 ${rows.length} 张卡面，期望 ${expected}`).toBe(expected);

    const starterTotal = STARTER_DECK.reduce((n, e) => n + e.count, 0);
    expect(text()).toContain(`共 ${starterTotal} 张`);
  });

  it('卡面把时序形态写成了可读文字，而不是只靠颜色区分', () => {
    const worst = Math.max(...REWARD_CARDS.filter((c) => c.kind === 'deferred').map((c) => c.delay!));
    expect(text()).toContain(`挂刻 ${worst} AV`);
    expect(text()).toContain('即时');
    expect(text()).toContain('校正');
  });

  it('重掷会换一个种子码', () => {
    const before = seedCode();
    clickText('重掷种子');
    expect(seedCode()).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(seedCode()).not.toBe(before);
    expectNoCrash();
  });

  it('可以手输指定种子，且接受任意文本', () => {
    const input = document.querySelector('.seed-input') as HTMLInputElement | null;
    expect(input).not.toBeNull();

    input!.value = '7F2A-19C4';
    clickText('使用这个种子');
    expect(seedCode()).toBe('7F2A-19C4');

    const input2 = document.querySelector('.seed-input') as HTMLInputElement;
    input2.value = '授时局';
    clickText('使用这个种子');
    expect(seedCode()).toBe('2E52-7E69');
    expectNoCrash();
  });

  it('空种子给出提示而不是崩溃或静默失败', () => {
    const input = document.querySelector('.seed-input') as HTMLInputElement;
    input.value = '   ';
    clickText('使用这个种子');
    expect(document.getElementById('toast')?.textContent).toBe('种子不能为空');
    expectNoCrash();
  });

  it('没有剪贴板权限时复制按钮退化成显示种子码，而不是抛错', () => {
    const before = seedCode();
    clickText('复制');
    expect(document.getElementById('toast')?.textContent).toBe(before);
    expectNoCrash();
  });

  it('可以切换遭遇，并看到每个遭遇的档位与敌人数量', () => {
    const before = text();
    document.querySelector<HTMLButtonElement>('[data-encounter="e_pair"]')!.click();

    // 点完会整屏重绘，必须重新查询：攥着旧引用断言是查不出问题的
    const pair = document.querySelector<HTMLButtonElement>('[data-encounter="e_pair"]');
    expect(pair, '找不到双怪遭遇的按钮').not.toBeNull();
    expect(pair!.classList.contains('on'), '被选中的遭遇应当高亮').toBe(true);
    expect(text()).not.toBe(before);
    expect(text()).toContain('碎屑双生');
    expectNoCrash();
  });

  it('点奖励刻印能把它加进牌组，再点一次移除', () => {
    document.querySelector<HTMLElement>('[data-card="charge"]')!.click();

    const pickedRow = document.querySelector<HTMLElement>('[data-card="charge"]');
    expect(pickedRow!.classList.contains('picked'), '加入之后这一行应当被标出').toBe(true);
    expect(text()).toContain('已选 1/8');

    pickedRow!.click();
    expect(text()).toContain('已选 0/8');
    expectNoCrash();
  });

  it('「进入时标」是可用状态，并能真的进入战斗', async () => {
    const enter = buttonByText('进入时标');
    expect(enter.disabled).toBe(false);

    // 带一张挂刻进去，好让时序轴上有东西可看
    document.querySelector<HTMLElement>('[data-card="frost_strike"]')!.click();
    clickText('进入时标');

    expect(document.querySelector('.battle'), '没有进入战斗界面').not.toBeNull();
    expectNoCrash();
  });

  it('战斗界面把时序轴、敌我状态、手牌都铺了出来', async () => {
    await waitFor(interactive, '战斗进入可操作状态');
    skipAnimation();

    // 时序轴：敌方与我方的条目都该在上面
    const chips = [...document.querySelectorAll('.ax-chip')];
    expect(chips.length, '时序轴上一个条目都没有').toBeGreaterThan(0);
    const legend = document.querySelector('.ax-legend');
    expect(legend?.textContent).toContain('畸变体');
    expect(legend?.textContent).toContain('已挂刻印');

    // 敌方：名字、意图、稳定度
    const foes = [...document.querySelectorAll('.foe-card')];
    expect(foes.length).toBeGreaterThan(0);
    expect(foes[0]!.textContent).toContain('下一步');

    // 我方：稳定度与牌堆数字
    const side = document.querySelector('.battle-side')?.textContent ?? '';
    expect(side).toContain('授时官');
    expect(side).toContain('时能');
    expect(side).toContain('抽牌');

    // 手牌：起手 5 张
    expect(document.querySelectorAll('.hand-card').length).toBe(5);
    expectNoCrash();
  });

  it('倍速按钮的高亮会跟着切换', async () => {
    /*
     * 守一个真实翻过的车：data-sp 原本是事后从 textContent（"1×"）里取的，
     * 而 Number("1×") 是 NaN —— 于是高亮比较恒为假，点任何倍速都会把
     * 三个按钮的高亮全清掉，玩家看不出当前是几倍速。
     * 这三个按钮属于持久化的外壳，不随战斗重绘，所以可以持有引用。
     */
    const sp = [...document.querySelectorAll<HTMLElement>('.battle-speed .sp')];
    expect(sp.length, '应当有三个倍速按钮').toBe(3);
    const lit = (): (string | undefined)[] =>
      sp.filter((b) => b.classList.contains('on')).map((b) => b.dataset.sp);

    expect(lit(), '默认应当是 2× 高亮').toEqual(['2']);

    sp.find((b) => b.dataset.sp === '4')!.click();
    expect(lit(), '点 4× 之后只应有 4× 高亮').toEqual(['4']);

    sp.find((b) => b.dataset.sp === '1')!.click();
    expect(lit(), '点 1× 之后只应有 1× 高亮').toEqual(['1']);

    // 换回 2×，免得影响后面测试的节奏
    sp.find((b) => b.dataset.sp === '2')!.click();
    expect(lit()).toEqual(['2']);
    expectNoCrash();
  });

  it('出牌会扣时能、并让敌人掉血或自己变强', async () => {
    const energyBefore = Number(
      (document.querySelector('.battle-side')?.textContent ?? '').match(/时能 (\d+)/)?.[1] ?? '-1'
    );
    const foeHpBefore = document.querySelector('.foe-card .stat-num')?.textContent ?? '';

    expect(playFirstCard(), '起手应当有打得出的牌').toBe(true);
    skipAnimation();
    await waitFor(interactive, '出牌后回到可操作状态');

    const energyAfter = Number(
      (document.querySelector('.battle-side')?.textContent ?? '').match(/时能 (\d+)/)?.[1] ?? '-1'
    );
    const foeHpAfter = document.querySelector('.foe-card .stat-num')?.textContent ?? '';
    expect(
      energyAfter < energyBefore || foeHpAfter !== foeHpBefore,
      '出牌之后时能和敌人血量都没变'
    ).toBe(true);
    expectNoCrash();
  });

  it('结束回合会推进时序，敌人随后行动', async () => {
    const before = text();
    clickText('结束回合');
    skipAnimation();
    await waitFor(interactive, '推进一个回合后回到可操作状态');

    expect(text()).not.toBe(before);
    expect(document.querySelectorAll('.hand-card').length).toBeGreaterThan(0);
    expectNoCrash();
  });

  it('一直打到分出胜负，能看到结算浮层', async () => {
    /*
     * 这个循环刻意**只用轮询**，不套 waitFor：回放中「结束回合」按钮不存在、
     * 也不会出现可点的目标，所以它自然就在等；而一旦战斗结束，任何等待都会
     * 走到超时才返回 —— 那会把一个几秒的用例拖成几十秒。
     */
    for (let i = 0; i < 400 && !resultShown(); i++) {
      const target = document.querySelector<HTMLElement>('.foe-card.targetable');
      if (target) {
        target.click();
        skipAnimation(); // 只在回放中生效，所以必须在动作之后点
      } else if (interactive()) {
        // 有牌就出，没牌就过回合。策略固定，所以这一局的走法完全可复现
        if (playFirstCard()) skipAnimation();
        else {
          clickText('结束回合');
          skipAnimation();
        }
      }
      await sleep(8);
    }

    const result = document.querySelector('.battle-result:not(.hide)');
    expect(result, '打了 400 步还没分出胜负').not.toBeNull();
    expect(result!.textContent).toMatch(/时序已修复|时序崩坏/);
    expect(result!.textContent).toContain('种子');
    expectNoCrash();
  }, 30000);

  it('从结算能回到筹备界面，之前的选择还在', () => {
    clickText('返回筹备');
    expect(document.querySelector('.setup')).not.toBeNull();
    expect(document.querySelector('[data-encounter="e_pair"]')?.classList.contains('on')).toBe(true);
    expect(text()).toContain('已选 1/8');
    expectNoCrash();
  });

  it('可以从筹备界面进关于页，再回到标题', () => {
    clickText('返回');
    expect(document.querySelector('.menu')).not.toBeNull();

    clickText('关于本作');
    expect(document.querySelector('.about')).not.toBeNull();
    expect(text()).toContain('github.com/Mrar-wyc/chrono-deck');
    expect(text()).toContain('时序轴');

    clickText('返回标题');
    expect(document.querySelector('.menu')).not.toBeNull();
    expectNoCrash();
  });

  it('全程没有出现过崩溃界面', () => {
    expect(document.querySelector('.crash')).toBeNull();
  });

  /**
   * 真翻过车：Vite 的 HMR 会重新执行 main.ts，而 DOM 不会被重置，
   * 于是 #app 里叠出第二个 .stage。querySelector('.stage') 拿到的是第一个
   * （拿不到新闭包里的 fitStage），页面整体显示为空白且没有任何报错。
   * 这条断言要求 main.ts 可以安全地重复执行。
   */
  it('时序轴画到行数上限时会多出一条汇总块', () => {
    /*
     * 纯函数那条路径在 tests/timeline.test.ts 里测过了，但「算得对」不等于「画得出来」——
     * 汇总块是一段新的 DOM，这里直接调渲染函数确认它真的出现，并且轴的高度守在预算内。
     */
    const host = document.createElement('div');
    document.body.append(host);
    const entries = Array.from({ length: 12 }, (_, i) => ({
      id: `t${i}`,
      owner: 'player',
      side: 'ally' as const,
      at: 100,
      kind: 'turn' as const,
      label: '同刻标签'
    }));
    renderAxis(host, entries, 0, 1200);

    const chips = host.querySelectorAll('.ax-chip');
    const lanes = new Set([...chips].map((c) => (c as HTMLElement).style.top)).size;
    expect(lanes, '行数必须被压在上限内').toBeLessThanOrEqual(5);
    expect(host.querySelector('.ax-chip.k-more')?.textContent, '超出的条目应当合并成汇总块').toMatch(
      /另有 \d+ 项/
    );
    expect(host.querySelector('.ax-window')!.getBoundingClientRect().height >= 0).toBe(true);
    host.remove();
  });

  it('main.ts 重复执行不会叠出第二个舞台', async () => {
    expect(document.querySelectorAll('.stage').length).toBe(1);

    vi.resetModules();
    await import('../src/main');

    expect(
      document.querySelectorAll('.stage').length,
      '#app 里出现了多个 .stage —— main.ts 不是幂等的，HMR 之后会白屏'
    ).toBe(1);
    expect(document.getElementById('app')?.children.length).toBe(1);
    expect(document.querySelector('.menu')).not.toBeNull();
    expectNoCrash();
  });
});
