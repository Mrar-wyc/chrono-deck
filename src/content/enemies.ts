import type { EnemyDef, EncounterDef } from '../engine/types';

/**
 * 畸变体（敌人）数据表。
 *
 * 数值约定：
 *   - 招式自带 `av` 是它在**标准步频**下的间隔；实际间隔 = av × 100 / 单位步频。
 *     所以「步频 130 的敌人用 av=100 的招式」实际只隔 77 AV，它会比你快。
 *   - 招式的 effects 从**敌人自己的视角**书写：`damage` 打向玩家，`block` 是敌人
 *     自己获得格挡，`targetAv` 正数是把**玩家**推后。这样读起来就是「这一招对
 *     它有什么好处」，不用在脑子里做视角翻转。
 *
 * 加一个敌人只需改这个文件。敌人行动的 AI 目前是固定轮转（按 moves 顺序循环），
 * 权重决策留到后续里程碑。
 */

/** 与 defineCard 同理：提供一个有补全、写错在编译期就报的入口 */
export function defineEnemy(def: EnemyDef): EnemyDef {
  return def;
}

export const ENEMIES: EnemyDef[] = [
  defineEnemy({
    id: 'lagging',
    name: '迟滞体',
    hp: 42,
    speed: 90,
    moves: [
      {
        id: 'swipe',
        name: '挥击',
        intent: '挥击 8',
        text: '造成 8 点伤害',
        av: 100,
        effects: [{ t: 'damage', amount: 8 }]
      },
      {
        id: 'brace',
        name: '蓄势',
        intent: '蓄势 6',
        text: '获得 6 点格挡',
        av: 60,
        effects: [{ t: 'block', amount: 6 }]
      }
    ],
    flavor: '它总是慢半拍，但从不缺席。'
  }),
  defineEnemy({
    id: 'rusher',
    name: '抢拍体',
    hp: 34,
    speed: 130,
    moves: [
      {
        id: 'rush',
        name: '抢拍',
        intent: '抢拍 6',
        text: '造成 6 点伤害',
        av: 100,
        effects: [{ t: 'damage', amount: 6 }]
      },
      {
        id: 'wind',
        name: '加速',
        intent: '加速',
        text: '自身行动值 -30',
        av: 50,
        effects: [{ t: 'selfAv', amount: -30 }]
      }
    ],
    flavor: '它把整条时间轴往自己那边拽。'
  }),
  defineEnemy({
    id: 'corroder',
    name: '锈蚀体',
    hp: 30,
    speed: 100,
    moves: [
      {
        id: 'etch',
        name: '蚀刻',
        intent: '蚀刻 5',
        text: '造成 5 点伤害，并使目标获得 2 层易伤',
        av: 100,
        effects: [
          { t: 'damage', amount: 5 },
          { t: 'vulnerable', stacks: 2 }
        ]
      },
      {
        id: 'creep',
        name: '蔓延',
        intent: '蔓延 4×2',
        text: '造成 4 点伤害，重复 2 次',
        av: 80,
        effects: [{ t: 'damage', amount: 4, times: 2 }]
      }
    ],
    flavor: '锈是从内部开始的。'
  }),
  defineEnemy({
    id: 'disjoiner',
    name: '失序使',
    hp: 90,
    speed: 100,
    moves: [
      {
        id: 'slam',
        name: '重击',
        intent: '重击 16',
        text: '造成 16 点伤害',
        av: 110,
        effects: [{ t: 'damage', amount: 16 }]
      },
      {
        id: 'disorder',
        name: '紊乱',
        intent: '紊乱 +25',
        text: '使目标行动值 +25',
        av: 80,
        effects: [{ t: 'targetAv', amount: 25 }]
      },
      {
        id: 'unwind',
        name: '倒拨',
        intent: '倒拨',
        text: '自身行动值 -40',
        av: 60,
        effects: [{ t: 'selfAv', amount: -40 }]
      }
    ],
    flavor: '它不是走得快，它是让别人的时间变慢。'
  })
];

/**
 * 遭遇组合：一场战斗里同时出现哪些畸变体。
 * M1 把这些接进时标地图的节点里。
 */
export const ENCOUNTERS: EncounterDef[] = [
  { id: 'e_lagging', name: '迟滞体', kind: 'normal', enemyIds: ['lagging'] },
  { id: 'e_rusher', name: '抢拍体', kind: 'normal', enemyIds: ['rusher'] },
  { id: 'e_corroder', name: '锈蚀体', kind: 'normal', enemyIds: ['corroder'] },
  { id: 'e_pair', name: '迟滞与抢拍', kind: 'normal', enemyIds: ['lagging', 'rusher'] },
  { id: 'e_elite', name: '锈蚀双生', kind: 'elite', enemyIds: ['corroder', 'corroder'] },
  { id: 'e_boss', name: '失序使', kind: 'boss', enemyIds: ['disjoiner'] }
];
