# 参与贡献

感谢愿意帮忙。这个项目对贡献的设计目标是：**加内容的人不需要读懂引擎**。

## 快速开始

```bash
npm install
npm run dev
```

提交前请确保质量门通过——CI 跑的就是这三条：

```bash
npm run typecheck && npm test && npm run build
```

## 最欢迎的贡献：加内容

### 加一张刻印

只需要改 `src/content/cards.ts` 一个文件，把它加进 `REWARD_CARDS` 数组：

```ts
defineCard({
  id: 'my_card',            // 全局唯一，小写下划线
  name: '我的刻印',
  kind: 'deferred',         // instant | deferred | shift
  cost: 2,
  target: 'enemy',          // enemy | self | none
  delay: 60,                // 仅 deferred 需要
  text: '60 AV 后，造成 10 点伤害',   // 数值必须与 effects 完全对应
  effects: [{ t: 'damage', amount: 10 }],
  flavor: '一句风味文本'
})
```

`defineCard()` 什么都不做，它的价值是给你补全和编译期检查：字段漏写、`kind` 拼错、`effects` 写成字符串，`tsc` 立刻报错。

写完直接 `npm test`。内容校验会自动覆盖新卡，不需要你去改校验代码。它会检查：

- id 全局唯一
- `text` 里出现的数值与 `effects` 严格对应（**这条最重要**——卡面写 8 实际打 14 是最伤玩家信任的一类 bug）
- 挂刻牌必须有正整数 `delay`，且不低于半次标准行动（50 行动值），否则「挂刻」在实战里等于立即生效
- 校正牌不得含伤害或格挡效果
- 数值用 ASCII 连字符 `-15`，不用排版减号 `−15`（否则解析不了文本）

数值手感上的要求见 [卡牌设计指南](docs/卡牌设计指南.md)。

### 加一个畸变体

改 `src/content/enemies.ts`，加进 `ENEMIES`，然后可选地在 `ENCOUNTERS` 里组一个遭遇。

注意招式的数值从**敌人自己的视角**书写：`damage` 打向玩家，`block` 是敌人自己获得格挡，`targetAv` 正数是把玩家推后。这样读起来就是「这一招对它有什么好处」，不用在脑子里做视角翻转。

## 改引擎或界面

### 三条绝对不能破的规则

**1. 不许出现全局随机数。** 任何需要随机的地方都必须接收 `Rng` 参数。`tests/guards.test.ts` 会扫描源码，连注释里的字面量都不放过。这不是洁癖：只要有一处绕过种子随机源，回放、复现、种子分享就全都不可靠，而且这种破坏是静默的。

**2. 规则层不许碰界面。** `src/engine`、`src/content`、`src/replay` 不得 import `src/ui`。破掉这条，规则就无法脱离 DOM 测试，机器人自动对局和回放也就写不出来了。

**3. 同一行动值的结算顺序是「挂刻 → 玩家 → 敌人」。** 这条规则在 `engine/types.ts` 的 `TIMELINE_PRIORITY` 里，由 `tests/engine.test.ts` 钉死。它是全局最重要的设计——校正类牌存在的全部理由就是改变这个排序，一旦漂移，所有卡牌的相对价值都会变。

### 界面约定

- 舞台是固定逻辑尺寸 1440×720，由 `fitStage` 等比缩放到窗口。界面代码不需要写响应式
- **字号不得小于 13.5px**。舞台会缩放到手机上，小于这个值的字在真机上读不出来。守卫测试会扫 `style.css` 里所有 `font-size`
- 卡面是纯文字信息块，靠色带 + 文字标签区分时序形态，不引入装饰图形
- 战斗界面是**持久化 DOM**：`.battle-axis` / `.battle-body` / `.battle-hand` 每次同步重建，但 `.battle-fx`（飘字与震动）**只增不减** —— 清空它会把动画在下一帧抹掉
- 所有动效走 `battle.ts` 里的 `animate()` 包装：jsdom 不实现 Web Animations API，而界面冒烟测试跑在 jsdom 里
- 界面出错时保留玩家数据并显示可读错误（见 `src/ui/crash.ts` 的注释），不要改成「静默退回菜单」

### 动了数值就必须跑平衡回归

```bash
npx vitest run tests/balance.test.ts                              # 胜率是否落在分档区间
DIAG=1 DIAG_ENCOUNTER=e_elite npx vitest run tests/diag.test.ts   # 逐回合看问题出在哪一段
```

胜率是唯一的判据，手感不是。汇总数字只告诉你「有没有问题」，看不出「问题出在哪一段」——加伤害与加血量的效果可能完全不同，实测中首领加伤害让胜率从 80% 一步跌到 0%，改成加血量才拿到 45%。

三条已经踩过的坑写在 [卡牌设计指南](docs/卡牌设计指南.md) 的畸变体部分，加新敌人前请先读。

### 改完请跑

```bash
npm run typecheck && npm test
```

如果你改了界面，除了跑测试，还请用浏览器实际走一遍并截图自查——单元测试覆盖不了视觉与手感。`npx vite --port 5174 --strictPort` 起一个自查用的服务器。

## 凭据与签名

**这个仓库里不应出现任何凭据。** 以下几类文件已经被 `.gitignore` 挡住，请不要用 `git add -f` 绕过：

| 文件 | 为什么不能提交 |
|---|---|
| `*.jks` / `*.keystore` / `*.p12` / `*.pfx` / `*.pem` / `*.key` | 签名私钥。拿到它就能冒名发布这个应用的更新 |
| `.env` / `.env.*` | 环境变量里的密钥。要写示例请用 `.env.example`，只放键名不放值 |
| `android/app/google-services.json` | 含 Firebase API key；`app/build.gradle` 会在它存在时自动应用 Google Services 插件 |
| `android/local.properties` | 本机 SDK 路径，与本机绑定 |
| `*.log` | 日志常带路径与 token |

自检一条命令就够：

```bash
git status --porcelain          # 提交前看一眼有没有意外混进来的文件
git check-ignore -v <文件>       # 确认某个文件确实被忽略了
```

### 发布签名（目前还没有）

现在 CI 只构建 **debug** APK，用 Android 的默认调试密钥签名，不需要任何凭据 —— 这是刻意的：仓库里不存在任何密钥，也就没有密钥可泄露。

正式发布要换 release 签名时，密钥**不进仓库**，走 CI 的 encrypted secrets：

1. 本地生成密钥库，**存在仓库之外**（例如 `~/.android-keys/`），并单独备份 —— 丢了就再也无法给已发布的包发更新
2. `android/app/build.gradle` 里的 `signingConfigs.release` 从环境变量读密码，而不是写在文件里
3. 密码放进 GitHub 的 Actions secrets（`Settings → Secrets and variables → Actions`），在 workflow 里用 `${{ secrets.XXX }}` 引用
4. 这一步请连带读一遍 `.github/workflows/android-build.yml` 里的权限声明：只有需要写仓库的操作才给 `contents: write`

### 依赖

依赖只从 npm registry 安装，`package-lock.json` 必须提交（CI 用的是 `npm ci`，靠它做完整性校验）。

**不要引入 git 地址或 tarball 地址的依赖**：npm 只对 registry 来源的包跳过 `prepare` 脚本，换成 git 依赖就会让第三方代码在 `npm ci` 时执行。

## 提交

- 一个提交只做一件事
- 提交信息用中文，`feat` / `fix` / `test` / `docs` / `chore` 开头
- 不要 `git add -A`，只加你确实改动的路径
- 不要强推 `main`

## 不确定怎么改？

开一个 issue 描述你想要的效果，比直接提一个大 PR 更容易对上。特别是想加新机制（新的时序形态、新资源、新地图节点类型）时——那会牵动类型契约，先聊一下能省掉大量返工。
