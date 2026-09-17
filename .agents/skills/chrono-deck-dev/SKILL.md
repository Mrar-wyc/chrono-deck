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
npm run build && npx cap sync android            # 出 APK 前两步
cd android && ./gradlew assembleDebug
git tag v0.1.0 && git push origin v0.1.0         # 发 Release
```

## 六条铁律

1. **不许出现全局随机数。** 任何需要随机的地方接收 `Rng` 参数。全项目扫描，注释里的字面量也不放过。破坏它是静默的，而且会让回放、复现、种子分享、平衡测量同时失效。
2. **规则层不许碰界面。** `src/engine`、`src/content`、`src/replay` 不得 import `src/ui`。`src/engine/types.ts` 是契约根，它自己不得 import 任何东西。
3. **内容查询不抛错。** 用 `findCard()` / `cardOr()`，未知 id 返回 `undefined` 或占位卡面，不要写会 throw 的 `xxxById`。
4. **内容加进数据表就自动被校验。** 加刻印改 `src/content/cards.ts`，加敌人改 `src/content/enemies.ts`，不需要去改编校验代码。`text` 里的数值必须与 `effects` 严格对应。
5. **界面字号不得小于 13.5px。** 舞台缩放到手机上后更小的字读不出来。守卫测试扫 `style.css` 全部 `font-size`。
6. **界面出错保留玩家数据。** 显示可读错误（`src/ui/crash.ts`），不要改成静默退回菜单并清进度。

## 分层与导入方向

```
content → engine → run → ui
```

`src/engine/types.ts` 里的 `BattleEvent` 是引擎与界面的**唯一接口**：引擎产出事件数组，界面按顺序播放。规则改动不动界面，界面改版不动规则。

## 关键约定

- **舞台**：固定逻辑尺寸 1440×720，`fitStage` 等比缩放到窗口。界面不写响应式。任何尺寸常量引用 `src/ui/stage.ts`，不要在别处抄数字
- **卡面**：纯文字信息块，靠左侧色带 + 文字标签区分时序形态，不引入装饰图形。新增时序形态时，`types.ts` 的联合类型与 `style.css` 的 `.card-row.k-<kind> .card-band` 必须同时改
- **战斗界面**：持久化 DOM + Web Animations API 串事件（`await animation.finished`）。静态界面才允许整块重建
- **行动值**：步频 100 的单位行动一次占 100 行动值。`moveInterval(moveAv, speed)` 把招式固有消耗按步频缩放
- **存档**：`localStorage`，版本化 key，加载时白名单过滤 id

## 测试分层

| 文件 | 覆盖 |
|---|---|
| `rng.test.ts` | 可复现、分布、子流独立、种子码往返、算法快照 |
| `content.test.ts` | 内容校验、设计不变式（挂刻性价比、延迟量级）、查询不抛错 |
| `replay.test.ts` | 稳定序列化、状态哈希、种子→哈希链路 |
| `guards.test.ts` | 零全局随机源、分层方向、舞台尺寸、字号下限、形态色带双轨 |
| `ui-smoke.test.ts` | jsdom 真实点击。断言必须同时检查「目标界面出现」与「没有掉进崩溃界面」 |

## 加内容的接线点

- **加一张刻印**：只改 `src/content/cards.ts`，加进 `REWARD_CARDS`。数值预算见 `docs/卡牌设计指南.md`
- **加一个畸变体**：改 `src/content/enemies.ts`。招式数值从敌人自己的视角书写（`damage` 打向玩家，`block` 是它自己获得格挡）
- **加一种时序形态 / 新资源 / 新节点类型**：会牵动 `engine/types.ts` 的契约，先开 issue 讨论

## 发布

版本号三处必须同步：`package.json`、`android/app/build.gradle` 的 `versionName` 与 `versionCode`、git tag。
`versionCode` 漏加会导致侧载更新不被识别（已踩过的坑）。

提交信息用中文，`feat`/`fix`/`test`/`docs`/`chore` 开头，一个提交只做一件事。不要 `git add -A`，不强推 `main`。

## 更详细的文档

- `docs/开发进度.md` —— 里程碑、关键设计决定及其理由、测试分层、版本号约定
- `docs/卡牌设计指南.md` —— 数值预算、命名与文本约定
- `CONTRIBUTING.md` —— 面向外部贡献者的入口
