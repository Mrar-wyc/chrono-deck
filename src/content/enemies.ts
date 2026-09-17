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
 * 难度是靠 tests/balance.test.ts 实测出来的，不是猜的。调数值请连带跑一次那个
 * 测试看胜率，并读 docs/卡牌设计指南.md 的数值预算。
 *
 * 一个已经踩过的坑：**纯操作时间轴的招式会让难度塌掉**。失序使原本只有一招带
 * 伤害，实测胜率 98%，比精英还容易打。敌人的「操作时间轴」必须是伤害之外的
 * 附加手段，不能取代伤害本身。
 */

/** 与 defineCard 同理：提供一个有补全、写错在编译期就报的入口 */
export function defineEnemy(def: EnemyDef): EnemyDef {
  return def;
}

export const ENEMIES: EnemyDef[] = [
  defineEnemy({
    id: 'debris',
    name: '碎屑体',
    hp: 46,
    speed: 110,
    moves: [
      {
        id: 'peck',
        name: '啄击',
        intent: '啄击 12',
        text: '造成 12 点伤害',
        av: 90,
        effects: [{ t: 'damage', amount: 12 }]
      },
      {
        id: 'scatter',
        name: '散落',
        intent: '散落 7·3',
        text: '造成 7 点伤害，并获得 3 点格挡',
        av: 70,
        effects: [
          { t: 'damage', amount: 7 },
          { t: 'block', amount: 3 }
        ]
      }
    ],
    flavor: '大失序掉下来的渣，扎人却不好抓。'
  }),
  defineEnemy({
    id: 'lagging',
    name: '迟滞体',
    hp: 95,
    speed: 90,
    moves: [
      {
        id: 'swipe',
        name: '挥击',
        intent: '挥击 21',
        text: '造成 21 点伤害',
        av: 100,
        effects: [{ t: 'damage', amount: 21 }]
      },
      {
        // 蓄势原本是纯格挡，于是它以 90 的步频打得又慢又不痛，单只成了必胜局。
        // 让它边守边反，单只普通怪才构成真正的威胁
        id: 'brace',
        name: '蓄势',
        intent: '蓄势 6·7',
        text: '获得 6 点格挡，并造成 7 点伤害',
        av: 60,
        effects: [
          { t: 'block', amount: 6 },
          { t: 'damage', amount: 7 }
        ]
      }
    ],
    flavor: '它总是慢半拍，但从不缺席。'
  }),
  defineEnemy({
    id: 'rusher',
    name: '抢拍体',
    hp: 74,
    speed: 130,
    moves: [
      {
        id: 'rush',
        name: '抢拍',
        intent: '抢拍 19',
        text: '造成 19 点伤害',
        av: 100,
        effects: [{ t: 'damage', amount: 19 }]
      },
      {
        id: 'wind',
        name: '加速',
        intent: '加速 · 9',
        text: '自身行动值 -30，并造成 9 点伤害',
        av: 50,
        effects: [
          { t: 'selfAv', amount: -30 },
          { t: 'damage', amount: 9 }
        ]
      }
    ],
    flavor: '它把整条时间轴往自己那边拽。'
  }),
  defineEnemy({
    id: 'corroder',
    name: '锈蚀体',
    hp: 62,
    speed: 100,
    moves: [
      {
        /*
         * 它原本施加易伤，但那个设计是错的：每两回合刷新一次、每回合只衰减一层，
         * 等于整场战斗永久 ×1.5。有它在场的双怪组合伤害直接翻倍，
         * 实测精英胜率从 40% 掉到 0%，而调低数值只会让单只变成必胜局。
         *
         * 改成推后玩家的行动值：既保留「越打越不利」的压力，又是**加法**不是乘法，
         * 不会让别的敌人一起变强。而且它逼玩家去用校正牌，正好呼应核心机制。
         * 易伤因此保留为玩家的手段（准绳、缀霜），不再由敌人施加。
         */
        id: 'etch',
        name: '蚀刻',
        intent: '蚀刻 18 · +15',
        text: '造成 18 点伤害，并使目标行动值 +15',
        av: 100,
        effects: [
          { t: 'damage', amount: 18 },
          { t: 'targetAv', amount: 15 }
        ]
      },
      {
        id: 'creep',
        name: '蔓延',
        intent: '蔓延 9×2',
        text: '造成 9 点伤害，重复 2 次',
        av: 80,
        effects: [{ t: 'damage', amount: 9, times: 2 }]
      }
    ],
    flavor: '锈一旦吃进齿轮，转得越用力，掉得越快。'
  }),
  defineEnemy({
    id: 'disjoiner',
    name: '失序使',
    /*
     * 血量从 150 提到 180，伤害反而回落到初始值。
     * 加伤害的版本实测胜率从 80% 一步跌到 0% —— 首领战是「抢在积累伤害之前
     * 打死它」的赛跑，加伤害会直接跨过那个阈值。拉长战斗则让压力平摊到更多回合，
     * 同时给玩家的格挡留出发挥作用的空间，曲线才有中间档。
     */
    hp: 195,
    speed: 100,
    moves: [
      {
        id: 'slam',
        name: '重击',
        intent: '重击 24',
        text: '造成 24 点伤害',
        av: 110,
        effects: [{ t: 'damage', amount: 24 }]
      },
      {
        // 首领的三招都带伤害。它的招牌是操作时间轴，但那必须是伤害之外的附加
        // 手段，不能取代伤害 —— 否则玩家几乎不会输，首领战就成了走过场
        id: 'disorder',
        name: '紊乱',
        intent: '紊乱 +25 · 12',
        text: '使目标行动值 +25，并造成 12 点伤害',
        av: 80,
        effects: [
          { t: 'targetAv', amount: 25 },
          { t: 'damage', amount: 12 }
        ]
      },
      {
        id: 'unwind',
        name: '倒拨',
        intent: '倒拨 · 8',
        text: '自身行动值 -40，并造成 8 点伤害',
        av: 60,
        effects: [
          { t: 'selfAv', amount: -40 },
          { t: 'damage', amount: 8 }
        ]
      }
    ],
    flavor: '它不是走得快，它是让别人的时间变慢。'
  })
];

/**
 * 遭遇组合：一场战斗里同时出现哪些畸变体。
 *
 * 单只、双弱、双强、首领四档 —— 双怪那一档刻意用「强 + 弱」而不是「双强」：
 * 玩家的每回合格挡是有限的定额，两只满编怪一回合打出的量直接越过他能承受的
 * 上限，胜率会从 100% 一步跌到 0%，没有中间档可言。
 */
export const ENCOUNTERS: EncounterDef[] = [
  { id: 'e_debris', name: '碎屑体', kind: 'normal', enemyIds: ['debris'] },
  { id: 'e_lagging', name: '迟滞体', kind: 'normal', enemyIds: ['lagging'] },
  { id: 'e_rusher', name: '抢拍体', kind: 'normal', enemyIds: ['rusher'] },
  { id: 'e_corroder', name: '锈蚀体', kind: 'normal', enemyIds: ['corroder'] },
  { id: 'e_pair', name: '碎屑双生', kind: 'normal', enemyIds: ['debris', 'debris'] },
  { id: 'e_elite', name: '锈蚀与碎屑', kind: 'elite', enemyIds: ['corroder', 'debris'] },
  { id: 'e_boss', name: '失序使', kind: 'boss', enemyIds: ['disjoiner'] }
];
