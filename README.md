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

> **当前状态：M0 骨架已完成。** 时序轴战斗在 M1 里程碑接入，界面上那个「进入时标」按钮暂时是置灰的——不做假的可用状态。筹备界面已经可以生成、复制、手输种子码，并浏览全部刻印数据。

## 这是什么

一个原创设定的卡牌构筑游戏，核心机制是**时序轴**：卡牌不即时生效，而是排进一条公开的时间轴，在若干行动值之后引爆。策略因此从「这回合打哪几张牌」变成「未来几个时间点上排什么」。

### 三种刻印

| 形态 | 行为 | 代价 |
|---|---|---|
| **即时** | 立即结算，熟悉的手感 | 数值最低 |
| **挂刻** | 排进时序轴，延迟若干行动值后引爆 | 要赌那时候局势还在 |
| **校正** | 只操作时间轴，不造成任何伤害 | 不解决当下问题 |

挂刻牌的费用—数值比明显高于即时刻印（霜击 1 费打 14，即时的校准 1 费只打 6），这个差距就是玩家愿意承担延迟的全部理由。

### 为什么它是道可算的题

时序轴对所有人可见，包括敌人下一步落在第几行动值。你在 60 行动值后引爆的刻印，能不能赶在敌人下一次行动（比如 100 行动值）之前落地——赶得上就是你先打，赶不上就是你先挨打。玩家可以用校正牌改变这个排序：把自己的行动提前、把敌人推后、取消它已经排入轴的行动，或者把挂出去的刻印拉回来立刻引爆。

基准：步频 100 的单位行动一次占 100 行动值。

## 安装与运行

需要 Node.js 20 以上。

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

产物在 `android/app/build/outputs/apk/debug/app-debug.apk`。也可以直接下 [Releases](https://github.com/Mrar-wyc/chrono-deck/releases) 里的 APK，或从 Actions 的构建产物里取。

## 项目结构

导入方向严格单向：`content → engine → run → ui`，规则层不知道界面的存在。

```
src/
  rng/        种子随机数。全项目禁止使用全局随机源，由守卫测试强制
  engine/     纯规则层：类型契约、时序调度、效果结算、敌人 AI
  content/    数据表：刻印、畸变体、遭遇。长期迭代基本只动这里
  run/        单局状态机：时标地图、奖励、商店、存档
  replay/     动作日志、回放执行器、状态哈希
  ui/         界面：舞台缩放、各屏幕、卡面渲染
tests/        单元测试 + 跨文件守卫 + 界面冒烟
```

## 两个关键设计决定

**种子随机数是一等公民。** 所有随机都通过注入的 `Rng` 走，源码里一处全局随机源都没有（`tests/guards.test.ts` 会读源码强制，连注释里的字面量都不放过）。换来的是：同一种子 + 同一串操作必定同一结果，所以可以回放、可以复现 bug、可以贴种子码给别人，机器人对局的平衡测量也不带随机噪声。日后要做「每日同种子挑战」不需要改架构。

**内容 id 查询不抛错。** 存档或回放里出现已删除的 id 时返回 `undefined`，界面用占位卡面顶上，而不是让整个界面白屏。同类项目里为此堆积的防御代码通常比功能代码还多，不如从第一天就不制造这个需求。

## 参与贡献

加一张刻印只需要改 `src/content/cards.ts` 一个文件——引擎、界面、存档都不用动。详见 [CONTRIBUTING.md](CONTRIBUTING.md) 与 [卡牌设计指南](docs/卡牌设计指南.md)。

## 许可

[MIT](LICENSE)。世界观、卡牌文本与代码同属本项目原创。
