---
name: chrono-deck-dev
description: 开发《授时局》(chrono-deck) 时加载。涵盖技术栈约定、分层方向、种子随机数纪律、内容扩展接线点、测试分层与发布流程。
---

# 授时局 开发指南

原创设定的时序卡牌 Roguelike。**在动手改任何代码前先读完本文件**，这里的约定大多有守卫测试兜底，破了会直接 CI 红。

## 技术栈

Vite 7 + TypeScript 5.8（strict）+ Vitest 3 + jsdom + Capacitor 7。
**零运行时依赖**：没有前端框架、没有 Tailwind、没有 ESLint、没有状态管理库。
这不是省事，是开源友好——贡献者 clone 完 `npm install` 就能跑，不需要理解任何框架。

## 命令

```bash
npm run typecheck && npm test && npm run build   # 完整质量门，CI 跑的就是这三条
npm run dev                                      # http://localhost:5173
npx vite --port 5174 --strictPort                # 截图自查用
npx vitest run tests/balance.test.ts             # 看实测胜率
DIAG=1 DIAG_ENCOUNTER=e_elite DIAG_SEED=7 npx vitest run tests/diag.test.ts   # 逐回合数字
npm run build && npx cap sync android            # 出 APK 前两步
cd android && ./gradlew assembleDebug
git tag v0.2.0 && git push origin v0.2.0         # 发 Release
```

## 八条铁律

1. **不许出现全局随机数。** 任何需要随机的地方接收 `Rng` 参数。全项目扫描，注释里的字面量也不放过。破坏它是静默的，而且会让回放、复现、种子分享、平衡测量同时失效。
2. **规则层不许碰界面。** `src/engine`、`src/content`、`src/replay` 不得 import `src/ui`。`src/engine/types.ts` 是契约根，它自己不得 import 任何东西。
3. **同一行动值的结算顺序是「挂刻 → 玩家 → 敌人」。** 由 `TIMELINE_PRIORITY` 与「同为行动机会时玩家先手」共同定义。这是全局最重要的规则，也是校正类牌存在的全部理由；它一旦漂移，所有卡牌的相对价值都会变。`tests/engine.test.ts` 钉死了它。
4. **内容查询不抛错。** 用 `findCard()` / `cardOr()`，未知 id 返回 `undefined` 或占位卡面，不要写会 throw 的 `xxxById`。
5. **内容加进数据表就自动被校验。** 加刻印改 `src/content/cards.ts`，加敌人改 `src/content/enemies.ts`。`text` 里的数值必须与 `effects` 严格对应。
6. **界面字号不得小于 13.5px。** 舞台缩放到手机上后更小的字读不出来。守卫测试扫 `style.css` 全部 `font-size`。
7. **界面出错保留玩家数据。** 显示可读错误（`src/ui/crash.ts`），不要改成静默退回菜单并清进度。
8. **动了数值就必须跑平衡回归。** 胜率是唯一的判据，手感不是。汇总数字看不出问题出在哪一段，所以要配合 `DIAG=1` 逐回合看。

## 分层与导入方向

```
content → engine → run → ui
```

`src/engine/types.ts` 里的 `BattleEvent` 是引擎与界面的**唯一接口**：引擎产出事件数组，界面按顺序播放。规则改动不动界面，界面改版不动规则。

## 战斗引擎的形态

引擎是**分步驱动**的，不是「一次算完整场」——后者没法让玩家在回合中间做决定：

```ts
const battle = createBattle(input);
battle.pending();                                  // 开场事件
battle.playCard(uid, target) → { events, result }
battle.endTurn()              → { events, result }
```

机器人/回放用 `simulateBattle(input, policy)` 包起来跑一整场；回放只需录下动作序列（`tests/engine.test.ts` 里有一条断言就在验证「录下来照着放，事件流逐条相同」）。

`PlayerView.enemies` 是 `EnemyView`，含**招式轮转表**。敌人的出招顺序完全确定，把它交给玩家看是本作的设计前提 —— 时序得是一道可解的题，不能是靠猜的。

## 关键约定

- **舞台**：固定逻辑尺寸 1440×720，`fitStage` 等比缩放到窗口。界面不写响应式。任何尺寸常量引用 `src/ui/stage.ts`，不要在别处抄数字
- **时序轴**：`timeline.ts` 的 `layoutChips` 是纯函数，同一时刻的条目自动分行避让。轴宽 `AXIS_WIDTH` 必须与 `.ax-window` 的 CSS 一致（守卫测试断言）
- **战斗界面持久化 DOM**：`.battle-axis` / `.battle-body` / `.battle-hand` 每次同步重建，但 `.battle-fx`（飘字与震动）**只增不减** —— 清空它会把动画在下一帧抹掉
- **动效统一走 `animate()` 包装**：jsdom 不实现 Web Animations API，而界面冒烟测试跑在 jsdom 里，直接调 `el.animate` 会让整条测试路径抛错
- **卡面**：纯文字信息块，靠色带 + 文字标签区分形态。新增形态时 `types.ts` 的联合类型、`.card-row.k-<kind>` 与 `.hand-card.k-<kind>` 三处必须同时改
- **行动值**：步频 100 的单位行动一次占 100 行动值。`moveInterval(moveAv, speed)` 把招式固有消耗按步频缩放**

## 测试分层

| 文件 | 覆盖 |
|---|---|
| `rng.test.ts` | 可复现、分布、子流独立、种子码往返、算法快照 |
| `content.test.ts` | 内容校验、设计不变式（挂刻性价比、延迟量级）、查询不抛错 |
| `engine.test.ts` | 时序排序与同刻优先序、挂刻引爆时点与目标锁定、校正四种效果、伤害公式、抽牌循环、终局、确定性、动作回放 |
| `timeline.test.ts` | 时序轴布局：比例定位、窗口自适应、同行不重叠、同时刻分行 |
| `replay.test.ts` | 稳定序列化、状态哈希、种子→哈希链路 |
| `balance.test.ts` | 分档胜率区间、难度排序、精英与首领必须有真实败率 |
| `soak.test.ts` | 200 局不变量：伤害自洽、时能非负、时钟单调、结算必先排轴、挂刻不重复在飞、恰一个结局 |
| `guards.test.ts` | 零全局随机源、分层方向、舞台尺寸、字号下限、形态色带与轴宽双轨、版本号三处同步 |
| `ui-smoke.test.ts` | jsdom 真实点击：标题→筹备→选遭遇→选牌→进战斗→出牌→打到结算→返回 |
| `diag.test.ts` | 单局逐回合诊断（默认安静，`DIAG=1` 才打印） |

## 加内容的接线点

- **加一张刻印**：只改 `src/content/cards.ts`，加进 `REWARD_CARDS`。数值预算见 `docs/卡牌设计指南.md`
- **加一个畸变体**：改 `src/content/enemies.ts`。招式数值从敌人自己的视角书写（`damage` 打向玩家，`block` 是它自己获得格挡）。**先读设计指南里的三条实测教训**：纯操作时间轴的招式会让难度塌掉、永久易伤是乘算放大器会崩掉群战、双怪不能是双强
- **加一种时序形态 / 新资源 / 新节点类型**：会牵动 `engine/types.ts` 的契约，先开 issue 讨论

## 发布

版本号三处必须同步：`package.json`、`android/app/build.gradle` 的 `versionName` 与 `versionCode`、git tag。
`versionCode` 漏加会导致侧载更新不被识别（已踩过的坑）。

提交信息用中文，`feat`/`fix`/`test`/`docs`/`chore` 开头，一个提交只做一件事。不要 `git add -A`，不强推 `main`。

## 更详细的文档

- `docs/开发进度.md` —— 里程碑、关键设计决定及其理由、测试分层、版本号约定
- `docs/卡牌设计指南.md` —— 数值预算、命名与文本约定
- `CONTRIBUTING.md` —— 面向外部贡献者的入口
