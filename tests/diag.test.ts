import { describe, expect, it } from 'vitest';
import { cardOr } from '../src/content';
import { ENCOUNTERS } from '../src/content/enemies';
import { createBattle } from '../src/engine/combat';
import { greedyPolicy } from '../src/engine/policy';
import { buildBattleInput } from '../src/run/battle-setup';
import { ALL_EXTRA } from './bot';

/**
 * 单局逐回合诊断。
 *
 * 平衡测试给的是汇总数字（胜率、平均回合），它能告诉你「有没有问题」，
 * 但告诉不了你「问题出在哪一段」。改数值时跑这个，把一整场按回合打出来，
 * 人眼看得见是哪一回合崩掉的、玩家的格挡够不够、挂刻有没有真的在引爆。
 *
 * 输出默认只打到控制台，不断言任何平衡结论 —— 它是个观察工具，不是测试。
 */

/**
 * 环境变量必须先校验再使用。
 *
 * 它以前是直接流进引擎的：`Number("abc")` 会静默变成种子 0，写错遭遇名会静默
 * 变成「零敌人」的一场空仗 —— 而空敌人列表在引擎里会被判为胜利，于是诊断工具
 * 会打印一份「一步就赢」的假战报。校验之后这两种写法都会当场报错并列出合法值。
 */
function requireEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(`${name}=${raw} 不是整数。请传一个整数种子，例如 ${name}=7`);
  }
  return n;
}

function requireEnvEncounter(name: string, fallback: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  if (!ENCOUNTERS.some((e) => e.id === raw)) {
    const valid = ENCOUNTERS.map((e) => e.id).join(', ');
    throw new Error(`${name}=${raw} 不是合法遭遇 id。可用的有：${valid}`);
  }
  return raw;
}

const SEED = requireEnvInt('DIAG_SEED', 7);
const ENCOUNTER = requireEnvEncounter('DIAG_ENCOUNTER', 'e_elite');

describe('单局诊断', () => {
  it(`打印 ${ENCOUNTER} / 种子 ${SEED} 的逐回合数字`, () => {
    const input = buildBattleInput({ seed: SEED, encounterId: ENCOUNTER, extraCardIds: [...ALL_EXTRA] });
    const battle = createBattle(input);

    const lines: string[] = [];
    const row = (tag: string, note: string): void => {
      const v = battle.view();
      const foes = v.enemies.map((e) => `${e.name} ${e.hp}/${e.maxHp}${e.block ? `(+${e.block})` : ''}`).join('  ');
      const me = v.me;
      lines.push(
        `${tag.padEnd(4, '　')} AV${String(v.now).padStart(4)}  ` +
          `我 ${String(me.hp).padStart(3)}/${me.maxHp}${me.block ? `(+${me.block})` : '    '}  ` +
          `时能${v.energy}  手${v.hand.length} 抽${v.drawCount} 弃${v.discardCount}  ` +
          `| ${foes}  | ${note}`
      );
    };

    battle.pending();
    row('开局', `牌组 ${input.deck.length} 张 · ${input.enemies.map((e) => e.name).join(' + ')}`);

    let guard = 0;
    while (!battle.isOver() && guard++ < 500) {
      const action = greedyPolicy(battle.view());
      if (action.t === 'play') {
        const card = battle.view().hand.find((c) => c.uid === action.cardUid);
        const step = battle.playCard(action.cardUid, action.target);
        const hits = step.events
          .filter((e) => e.k === 'damage')
          .map((e) => (e.k === 'damage' ? `${e.dst} -${e.amount - e.blocked}${e.blocked ? `(挡${e.blocked})` : ''}` : ''))
          .join(' ');
        const kind = card ? cardOr(card.def.id).kind : '?';
        row('出牌', `${card?.def.name ?? '?'} [${kind}] 费${card?.def.cost ?? '?'}  →  ${hits || '无伤害'}`);
      } else {
        const before = battle.view();
        const step = battle.endTurn();
        const turns = step.events.filter((e) => e.k === 'turnStart').length;
        const resolves = step.events.filter((e) => e.k === 'resolve').length;
        row(
          '回合',
          `结束回合 → ${turns} 次行动机会、${resolves} 张挂刻引爆、时钟推进 ${battle.view().now - before.now} AV`
        );
      }
    }

    const v = battle.view();
    lines.push(
      `\n结果：${battle.outcome() === 'win' ? '胜' : '负'}　回合 ${v.round}　终局 AV ${v.now}　` +
        `我 ${v.me.hp}/${v.me.maxHp}　剩余敌人 ${v.enemies.length}`
    );
    // 默认安静：只在需要人工看数字时（DIAG=1）才打印，
    // 否则每次全量跑测试都会被几十行诊断输出刷屏
    if (process.env.DIAG) {
      console.log(`\n[diag] ${ENCOUNTER} / 种子 ${SEED}\n` + lines.join('\n'));
    }

    expect(battle.isOver(), '诊断用的对局也必须能打完').toBe(true);
  });
});
