import './style.css';
import { ENCOUNTERS } from './content/enemies';
import { formatSeed, newSeed } from './rng';
import { buildBattleInput } from './run/battle-setup';
import { renderAbout } from './ui/about';
import { createBattleScreen } from './ui/battle';
import type { BattleController } from './ui/battle';
import { renderCrash } from './ui/crash';
import type { AppCtx, RunSetup, Screen } from './ui/ctx';
import { h } from './ui/dom';
import { renderMenu } from './ui/menu';
import { renderSetup } from './ui/setup';
import { STAGE_H, STAGE_W } from './ui/stage';

const app = document.getElementById('app');
if (!app) throw new Error('index.html 缺少 #app 容器');

/*
 * 先清空 #app 再建舞台：本模块必须可以重复执行。
 * Vite 的 HMR 会在改动被 import 的模块时重新执行本模块，此时 DOM 并不会被重置；
 * 如果直接 append，就会叠出第二个 .stage —— 而 querySelector('.stage') 拿到的是
 * 第一个（拿不到新闭包里的缩放），于是整个页面显示为空白，且没有任何报错。
 */
app.replaceChildren();
const stage = h('div', { class: 'stage' });
app.append(stage);

let screen: Screen = 'menu';
let seed = newSeed();

/**
 * 筹备界面的选择。它是「进入时标」时构造 BattleInput 的全部依据，
 * 所以和种子一样属于本局的输入 —— 三者合起来决定一场完全可复现的战斗。
 */
const setup: RunSetup = {
  encounterId: ENCOUNTERS[0]!.id,
  picked: []
};

/**
 * 战斗界面是**持久 DOM**：它一旦挂载就不再被清空重建，
 * 整块的渲染由它自己同步（见 ui/battle.ts 的说明）。
 * 所以这里要记住当前那一个控制器，切屏时再丢掉。
 */
let battleController: BattleController | null = null;

/** 把舞台等比缩放到窗口内。舞台是固定逻辑尺寸，界面代码不需要写响应式 */
function fitStage(): void {
  const scale = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
  stage.style.transform = `translate(-50%, -50%) scale(${scale})`;

  // 舞台是 2:1 横向设计，竖屏下等比缩放会小到读不出字，直接提示横屏
  const needHint = window.innerHeight > window.innerWidth * 1.05;
  const existing = document.getElementById('rotate-hint');
  if (needHint && !existing) {
    document.body.append(h('div', { id: 'rotate-hint' }, '请横屏游玩'));
  } else if (!needHint && existing) {
    existing.remove();
  }
}

const ctx: AppCtx = {
  get seed(): number {
    return seed;
  },
  setSeed(next: number): void {
    seed = next;
    ctx.refresh();
  },
  go(next: Screen): void {
    if (next !== 'battle') battleController = null;
    screen = next;
    ctx.refresh();
  },
  refresh(): void {
    render();
  },
  startBattle(): void {
    const input = buildBattleInput({
      seed,
      encounterId: setup.encounterId,
      extraCardIds: setup.picked
    });
    if (input.enemies.length === 0) {
      // 遭遇引用坏了就说清楚，不要进到一场没有敌人的战斗里
      screen = 'crash';
      stage.replaceChildren();
      renderCrash(stage, `遭遇 ${setup.encounterId} 没有任何敌人，请检查 content/enemies.ts`, ctx);
      return;
    }

    battleController = createBattleScreen(input, {
      seedLabel: formatSeed(seed),
      onDone: () => {
        battleController = null;
        screen = 'setup';
        ctx.refresh();
      }
    });
    screen = 'battle';
    ctx.refresh();
  }
};

function render(): void {
  // 战斗界面自己管自己：不重建，只让它继续同步
  if (screen === 'battle' && battleController) {
    if (!stage.contains(battleController.root)) {
      stage.replaceChildren(battleController.root);
      void battleController.start();
    }
    return;
  }

  stage.replaceChildren();
  try {
    switch (screen) {
      case 'menu':
        renderMenu(stage, ctx);
        break;
      case 'setup':
        renderSetup(stage, ctx, setup);
        break;
      case 'about':
        renderAbout(stage, ctx);
        break;
      case 'crash':
        renderCrash(stage, '（此处本应有一条错误信息）', ctx);
        break;
      case 'battle':
        // 没有控制器却停在 battle：退回筹备，别把玩家卡在空屏上
        screen = 'setup';
        renderSetup(stage, ctx, setup);
        break;
    }
  } catch (err) {
    // 渲染失败时保留玩家数据并显示可读的错误，见 ui/crash.ts 的说明
    const msg = err instanceof Error ? `${err.message}\n\n${err.stack ?? ''}` : String(err);
    console.error('[render] 界面渲染失败', err);
    screen = 'crash';
    battleController = null;
    stage.replaceChildren();
    renderCrash(stage, msg, ctx);
  }
}

window.addEventListener('resize', fitStage);
window.addEventListener('orientationchange', fitStage);

// ?debug 时把内部状态挂到 window，方便在控制台里检查
if (new URLSearchParams(location.search).has('debug')) {
  (window as unknown as Record<string, unknown>).__chrono = {
    get seed(): number {
      return seed;
    },
    get screen(): Screen {
      return screen;
    },
    get setup(): RunSetup {
      return setup;
    },
    go: (s: Screen) => ctx.go(s)
  };
}

fitStage();
render();
