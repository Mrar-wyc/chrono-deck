<div align="center">

# 授时局 · Chrono Deck

**时序卡牌 Roguelike**

刻印不会立刻生效。它们排进一条公开的时序轴，在若干行动值之后自行引爆。

[![CI](https://github.com/Mrar-wyc/chrono-deck/actions/workflows/ci.yml/badge.svg)](https://github.com/Mrar-wyc/chrono-deck/actions/workflows/ci.yml)
[![Android Build](https://github.com/Mrar-wyc/chrono-deck/actions/workflows/android-build.yml/badge.svg)](https://github.com/Mrar-wyc/chrono-deck/actions/workflows/android-build.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-c9a227.svg)](LICENSE)

[在线试玩](https://mrar-wyc.github.io/chrono-deck/) · [English](README.en.md) · [开发进度](docs/开发进度.md) · [如何贡献](CONTRIBUTING.md)

</div>

---

> **当前状态：M1 战斗核心已完成 —— 可以真的打一场了。** 时序调度器、事件流引擎、时序轴界面、30 张刻印、7 种遭遇都已就绪，筹备界面可选遭遇与配牌后进入战斗，直到分出胜负。单局流程（地图、奖励、商店、存档）在 M2 接入。

## 这是什么

一个原创设定的卡牌构筑游戏，核心机制是**时序轴**：卡牌不即时生效，而是排进一条公开的时间轴，在若干行动值之后引爆。策略因此从「这回合打哪几张牌」变成「未来几个时间点上排什么」。

### 三种刻印

| 形态 | 行为 | 代价 |
|---|---|---|
| **即时** | 立即结算，熟悉的手感 | 数值最低 |
| **挂刻** | 排进时序轴，延迟若干行动值后引爆 | 要赌那时候局势还在 |
| **校正** | 只操作时间轴，不造成任何伤害 | 不解决当下问题 |

挂刻牌的费用—数值比明显高于即时刻印（霜击 1 费打 12，即时的校准 1 费只打 6），这个差距就是玩家愿意承担延迟的全部理由。

### 为什么它是道可算的题

时序轴对所有人可见，包括敌人下一步落在第几行动值、以及它接下来两到三轮会出什么招（招式轮转表就在敌人卡上）。你在 60 行动值后引爆的刻印，能不能赶在敌人下一次行动（比如 110 行动值）之前落地——赶得上就是你先打，赶不上就是你先挨打。

玩家可以用校正牌改变这个排序：把自己的行动提前、把敌人推后、取消它已经排入轴的行动，或者把挂出去的刻印拉回来立刻引爆。**同一行动值上的结算顺序是「挂刻 → 玩家 → 敌人」**，所以「刚好卡在敌人前面」是可计算、可复现的。

基准：步频 100 的单位行动一次占 100 行动值。

### 实测难度曲线

机器人固定牌组每档 40 局的胜率（`tests/balance.test.ts`）。机器人只按牌面价值贪心出牌、从不做时序规划，所以这些数字是**人类表现的下界**——一个会算时间轴的玩家胜率会更高。

| 档位 | 遭遇 | 胜率 |
|---|---|---|
| 单只普通怪（教学局） | 碎屑体 / 迟滞体 / 抢拍体 / 锈蚀体 | 98% – 100% |
| 群战普通怪 | 碎屑双生 | 100%（4.3 回合的消耗战） |
| 精英 | 锈蚀与碎屑 | 40% |
| 首领 | 失序使 | 23% |

## 安装与运行

需要 Node.js 22.12 以上（`vitest` 5 的引擎要求；Node 20 下 `npm test` 会直接失败）。

```bash
npm install
npm run dev        # http://localhost:5173
```

质量门（CI 跑的就是这三条）：

```bash
npm run typecheck && npm test && npm run build
```

### 安卓

```bash
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
```

产物在 `android/app/build/outputs/apk/debug/app-debug.apk`。也可以从 [Releases](https://github.com/Mrar-wyc/chrono-deck/releases) 或 Actions 的构建产物里取 APK —— Releases 里还没有东西，因为尚未打过 `v*` tag（发 Release 的那条流水线只在推 tag 时触发）。

## 项目结构

导入方向严格单向：`content → engine → run → ui`，规则层不知道界面的存在。

```
src/
  rng/        种子随机数。禁止 Math.random，由守卫测试强制
  engine/     纯规则层：类型契约、时序调度、效果结算、机器人策略
  content/    数据表：刻印、畸变体、遭遇。长期迭代基本只动这里
  run/        单场战斗的装配（种子洗牌 → BattleInput）；M2 接进完整单局
  replay/     状态哈希与稳定序列化
  ui/         界面：舞台缩放、时序轴、战斗界面、各屏幕
tests/        引擎规则 + 时序轴布局 + 平衡回归 + soak + 界面冒烟 + 跨文件守卫
```

## 三个关键设计决定

**种子随机数是一等公民。** 所有随机都通过注入的 `Rng` 走。守卫测试会扫源码禁止 `Math.random`，连注释里的字面量都不放过；唯一的非确定来源是 `newSeed()`（它本身就是「创造一个还没有的世界」，用的是时间戳而不是随机数，代码里写明了为什么）。换来的是：同一种子 + 同一串操作必定同一结果，所以可以回放、可以复现 bug、可以贴种子码给别人，机器人对局的平衡测量也不带随机噪声。测试里有一条断言是「录下动作再照着放一遍，得到逐条相同的事件流」。

**内容 id 查询不抛错。** 存档或回放里出现已删除的 id 时返回 `undefined`，界面用占位卡面顶上，而不是让整个界面白屏。同类项目里为此堆积的防御代码通常比功能代码还多，不如从第一天就不制造这个需求。

**引擎分步驱动，界面只播事件。** 引擎产出 `BattleEvent[]`，界面按顺序播出来 —— 规则改动不动界面，界面改版不动规则。数值调试因此可以完全无头进行：机器人跑几百局给出可比较的胜率，`DIAG=1` 则把一整场逐回合打出来给人眼判断。

## 参与贡献

加一张刻印只需要改 `src/content/cards.ts` 一个文件——引擎、界面、存档都不用动。详见 [CONTRIBUTING.md](CONTRIBUTING.md) 与 [卡牌设计指南](docs/卡牌设计指南.md)（后者也包含畸变体的数值速查与三条来自实测的教训）。

## 许可

[MIT](LICENSE)。世界观、卡牌文本与代码同属本项目原创。
