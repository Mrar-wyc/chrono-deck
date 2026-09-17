// @vitest-environment jsdom
// @vitest-environment-options {"html":"<!DOCTYPE html><html><body><div id=\"app\"></div></body></html>","url":"http://localhost:3000/?debug"}
import { describe, expect, it, vi } from 'vitest';
import { REWARD_CARDS, STARTER_DECK } from '../src/content/cards';
import '../src/main';

/**
 * 界面冒烟：真实点击走一遍。
 *
 * 之所以要「点」而不是直接调渲染函数，是因为要覆盖事件绑定、界面重绘、
 * 以及 main.ts 里那条渲染失败兜底路径。断言里必须同时检查「目标界面出现了」
 * 和「没有掉进崩溃界面」—— 只检查前者的话，一个渲染异常也可能让某条分支
 * 看起来像成功导航。
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

describe('界面冒烟', () => {
  it('启动后停在标题界面，并显示版本号', () => {
    expect(document.querySelector('.menu')).not.toBeNull();
    expect(document.querySelector('.menu-title')?.textContent).toBe('授时局');
    // 版本号由 vite 的 define 从 package.json 注入
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
    // 挂刻牌必须把延迟写在卡面上，那是它最重要的信息
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

    // 用一句话当种子也要能work —— 这是玩家最容易理解的使用方式
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
    // jsdom 不提供 navigator.clipboard，正好覆盖这条降级路径
    const before = seedCode();
    clickText('复制');
    expect(document.getElementById('toast')?.textContent).toBe(before);
    expectNoCrash();
  });

  it('时序轴战斗的入口是置灰的，不做假的可用状态', () => {
    const enter = buttonByText('进入时标');
    expect(enter.disabled).toBe(true);
    expect(text()).toContain('M1');
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
