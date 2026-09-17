import type { CardDef, Effect, EncounterDef, EnemyDef } from '../engine/types';
import { STARTER_CARDS, REWARD_CARDS, STARTER_DECK } from './cards';
import { ENEMIES, ENCOUNTERS } from './enemies';

/**
 * 内容注册表与校验。
 *
 * 这里刻意**不提供会抛错的 `cardById`**。
 * 存档、回放、手改的开发状态都可能带进不存在的 id，一旦查询抛错，
 * 整个界面会白屏且看不出原因（这是常见做法里最贵的一个坑，防御逻辑会越堆越多）。
 * 所以查询一律返回 `undefined`，由调用方选择兜底；界面用 `cardOr()` 拿占位卡面。
 */

export const ALL_CARDS: CardDef[] = [...STARTER_CARDS, ...REWARD_CARDS];

const CARD_INDEX = new Map<string, CardDef>();
for (const c of ALL_CARDS) CARD_INDEX.set(c.id, c);

const ENEMY_INDEX = new Map<string, EnemyDef>();
for (const e of ENEMIES) ENEMY_INDEX.set(e.id, e);

const ENCOUNTER_INDEX = new Map<string, EncounterDef>();
for (const e of ENCOUNTERS) ENCOUNTER_INDEX.set(e.id, e);

/** 查不到返回 undefined，不抛错 */
export function findCard(id: string): CardDef | undefined {
  return CARD_INDEX.get(id);
}

/** 未知 id 的占位卡面。界面拿到它渲染一张「已不存在」的卡，而不是崩掉 */
export const UNKNOWN_CARD: CardDef = {
  id: '__unknown__',
  name: '未知刻印',
  kind: 'instant',
  cost: 0,
  target: 'none',
  text: '这张刻印已不在当前版本中',
  effects: []
};

/** 界面用的安全查询 */
export function cardOr(id: string): CardDef {
  return CARD_INDEX.get(id) ?? UNKNOWN_CARD;
}

export function findEnemy(id: string): EnemyDef | undefined {
  return ENEMY_INDEX.get(id);
}

export function findEncounter(id: string): EncounterDef | undefined {
  return ENCOUNTER_INDEX.get(id);
}

/** 起始牌组展开成 cardId 列表，每份复制一次。顺序即抽牌堆的初始顺序 */
export function starterDeckIds(): string[] {
  const out: string[] = [];
  for (const entry of STARTER_DECK) {
    for (let i = 0; i < entry.count; i++) out.push(entry.cardId);
  }
  return out;
}

// ==================== 内容校验 ====================

export interface ContentIssue {
  /** 出问题的位置，例 `card/overload` */
  where: string;
  msg: string;
}

/** 抽出文本里的全部整数（含负号） */
function numbersIn(s: string): number[] {
  return [...s.matchAll(/-?\d+/g)].map((m) => Number(m[0]));
}

/** 一个效果里所有对玩家可见的数值 */
function effectNumbers(e: Effect): number[] {
  switch (e.t) {
    case 'damage':
      return e.times === undefined ? [e.amount] : [e.amount, e.times];
    case 'block':
    case 'heal':
      return [e.amount];
    case 'draw':
      return [e.count];
    case 'energy':
      return [e.amount];
    case 'selfAv':
    case 'targetAv':
    case 'rush':
    case 'speed':
      return [e.amount];
    case 'cancel':
      return [e.av];
    case 'vulnerable':
    case 'weak':
      return [e.stacks];
  }
}

const CARD_KINDS = new Set(['instant', 'deferred', 'shift']);
const TARGETS = new Set(['enemy', 'self', 'none']);
const ENCOUNTER_KINDS = new Set(['normal', 'elite', 'boss']);

/**
 * 校验全部内容。返回问题清单，空数组表示通过。
 *
 * 由 tests/content.test.ts 断言为空，所以内容写错会直接让 CI 红，
 * 而不是等到玩到那张牌时才发现。加内容的人不需要记得来这里改什么 ——
 * 把新内容加进数据表，这个函数自动覆盖它。
 */
export function validateContent(): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const seenCardIds = new Set<string>();
  const seenEnemyIds = new Set<string>();
  const seenEncounterIds = new Set<string>();

  const checkText = (where: string, text: string, effects: Effect[], extra: number[]): void => {
    if (text.trim() === '') {
      issues.push({ where, msg: 'text 不能为空' });
      return;
    }
    const inText = new Set(numbersIn(text));
    for (const n of [...effects.flatMap(effectNumbers), ...extra]) {
      if (!inText.has(n)) {
        issues.push({
          where,
          msg: `effects 里的数值 ${n} 没有出现在 text「${text}」中 —— 卡面描述与实际效果不一致`
        });
      }
    }
  };

  for (const c of ALL_CARDS) {
    const where = `card/${c.id}`;
    if (seenCardIds.has(c.id)) issues.push({ where, msg: 'id 重复' });
    seenCardIds.add(c.id);

    if (c.name.trim() === '') issues.push({ where, msg: 'name 不能为空' });
    if (!Number.isInteger(c.cost) || c.cost < 0) issues.push({ where, msg: `cost 必须是非负整数，实际 ${c.cost}` });
    if (!CARD_KINDS.has(c.kind)) issues.push({ where, msg: `未知的 kind: ${c.kind}` });
    if (!TARGETS.has(c.target)) issues.push({ where, msg: `未知的 target: ${c.target}` });
    if (c.effects.length === 0) issues.push({ where, msg: 'effects 不能为空' });

    if (c.kind === 'deferred') {
      if (!Number.isInteger(c.delay) || (c.delay ?? 0) <= 0) {
        issues.push({ where, msg: '挂刻牌必须有正整数 delay' });
      }
    } else if (c.delay !== undefined) {
      issues.push({ where, msg: `非挂刻牌不应有 delay（kind=${c.kind}）` });
    }

    if (c.kind === 'shift') {
      const onlyTime = c.effects.every(
        (e) => e.t === 'selfAv' || e.t === 'targetAv' || e.t === 'cancel' || e.t === 'rush'
      );
      if (!onlyTime) issues.push({ where, msg: '校正牌只应操作时间轴，不应含伤害/格挡等效果' });
    }

    checkText(where, c.text, c.effects, c.delay === undefined ? [] : [c.delay]);
  }

  for (const entry of STARTER_DECK) {
    if (!CARD_INDEX.has(entry.cardId)) {
      issues.push({ where: `deck/${entry.cardId}`, msg: '起始牌组引用了不存在的刻印' });
    }
    if (!Number.isInteger(entry.count) || entry.count <= 0) {
      issues.push({ where: `deck/${entry.cardId}`, msg: `份数必须是正整数，实际 ${entry.count}` });
    }
  }

  for (const e of ENEMIES) {
    const where = `enemy/${e.id}`;
    if (seenEnemyIds.has(e.id)) issues.push({ where, msg: 'id 重复' });
    seenEnemyIds.add(e.id);

    if (e.name.trim() === '') issues.push({ where, msg: 'name 不能为空' });
    if (!Number.isInteger(e.hp) || e.hp <= 0) issues.push({ where, msg: `hp 必须是正整数，实际 ${e.hp}` });
    if (!Number.isInteger(e.speed) || e.speed <= 0) {
      issues.push({ where, msg: `speed 必须是正整数，实际 ${e.speed}` });
    }
    if (e.moves.length === 0) issues.push({ where, msg: 'moves 不能为空' });

    const seenMoveIds = new Set<string>();
    for (const m of e.moves) {
      const mWhere = `${where}/move/${m.id}`;
      if (seenMoveIds.has(m.id)) issues.push({ where: mWhere, msg: '同一敌人的招式 id 重复' });
      seenMoveIds.add(m.id);

      if (m.name.trim() === '') issues.push({ where: mWhere, msg: 'name 不能为空' });
      if (m.intent.trim() === '') issues.push({ where: mWhere, msg: 'intent 不能为空' });
      if (!Number.isInteger(m.av) || m.av <= 0) issues.push({ where: mWhere, msg: `av 必须是正整数，实际 ${m.av}` });
      if (m.effects.length === 0) issues.push({ where: mWhere, msg: 'effects 不能为空' });
      checkText(mWhere, m.text, m.effects, []);
    }
  }

  for (const e of ENCOUNTERS) {
    const where = `encounter/${e.id}`;
    if (seenEncounterIds.has(e.id)) issues.push({ where, msg: 'id 重复' });
    seenEncounterIds.add(e.id);

    if (!ENCOUNTER_KINDS.has(e.kind)) issues.push({ where, msg: `未知的 kind: ${e.kind}` });
    if (e.enemyIds.length === 0) issues.push({ where, msg: 'enemyIds 不能为空' });
    for (const id of e.enemyIds) {
      if (!ENEMY_INDEX.has(id)) issues.push({ where, msg: `引用了不存在的畸变体 ${id}` });
    }
  }

  return issues;
}
