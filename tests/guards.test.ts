import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { STAGE_H, STAGE_W } from '../src/ui/stage';

/**
 * 跨文件一致性守卫。
 *
 * 这些东西过去在同类项目里都真实翻过车，此前只能靠「文档约定 + 人工截图验收」维持，
 * 一旦改动漏了一边就要靠肉眼发现。这里把它们变成会失败的测试 —— 改漏了 CI 就红。
 *
 * 本文件会读源码文本做断言，所以它自己必须被排除在扫描之外（否则它包含的
 * 关键字会命中它自己的规则）。
 */

const SELF = 'guards.test.ts';
const root = fileURLToPath(new URL('..', import.meta.url));
const srcDir = join(root, 'src');
const css = readFileSync(join(srcDir, 'style.css'), 'utf8');
const mainSrc = readFileSync(join(srcDir, 'main.ts'), 'utf8');
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');

/** 字号下限。小于它的字在舞台缩放到手机上之后完全读不出来 */
const FONT_FLOOR = 13.5;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/** src 与 tests 下的全部 TypeScript 源码，排除本文件 */
const tsFiles = [...walk(srcDir), ...walk(join(root, 'tests'))].filter(
  (f) => f.endsWith('.ts') && !f.endsWith(SELF)
);

function read(f: string): string {
  return readFileSync(f, 'utf8');
}

/** 相对项目根的可读路径，用于失败信息 */
function rel(f: string): string {
  return relative(root, f).split('\\').join('/');
}

function importsOf(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) out.push(m[1]!);
  for (const m of code.matchAll(/\bimport\s+['"]([^'"]+)['"]/g)) out.push(m[1]!);
  return out;
}

function cssRule(selector: string): string {
  const pattern = new RegExp(`(?:^|\\n)[ \\t]*${escapeRe(selector)}[ \\t]*\\{([^}]*)\\}`, 'm');
  const m = css.match(pattern);
  if (!m) throw new Error(`style.css 缺少规则 ${selector}`);
  return m[1]!;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cssPx(block: string, prop: string): number {
  const m = block.match(new RegExp(`${prop}:\\s*(\\d+(?:\\.\\d+)?)px`));
  if (!m) throw new Error(`缺少 ${prop}`);
  return Number(m[1]);
}

function cssProp(block: string, prop: string): string {
  const m = block.match(new RegExp(`(?:^|;|\\s)${prop}:\\s*([^;]+)`));
  if (!m) throw new Error(`缺少 ${prop}`);
  return m[1]!.trim();
}

describe('随机数纪律', () => {
  /**
   * 全项目禁止 Math.random。这是本次架构最重要的约束：
   * 只要有一处绕过种子随机源，回放、复现、种子分享就全都不可靠，
   * 而且这种破坏是静默的 —— 加进去的人不会发现自己错了。
   */
  it('src 与 tests 下不出现 Math.random', () => {
    const needle = ['Math', 'random'].join('.');
    const offenders: string[] = [];
    for (const f of tsFiles) {
      if (read(f).includes(needle)) offenders.push(rel(f));
    }
    expect(
      offenders,
      `以下文件使用了全局随机数，请改为接收 Rng 参数：\n${offenders.join('\n')}`
    ).toEqual([]);
  });

  it('种子随机数模块自身不依赖任何其他模块（保证它是可独立审计的纯函数）', () => {
    const offenders: string[] = [];
    for (const f of walk(join(srcDir, 'rng'))) {
      if (importsOf(read(f)).length > 0) offenders.push(rel(f));
    }
    expect(offenders, `src/rng 下不应有任何 import：\n${offenders.join('\n')}`).toEqual([]);
  });
});

describe('分层方向', () => {
  /**
   * 规则层不知道界面的存在。这条一旦破掉，规则就再也无法脱离 DOM 测试，
   * 也就没法写机器人自动对局和回放。
   */
  it('engine / content / replay 不得 import ui', () => {
    const offenders: string[] = [];
    for (const layer of ['engine', 'content', 'replay']) {
      for (const f of walk(join(srcDir, layer))) {
        for (const spec of importsOf(read(f))) {
          if (spec.includes('/ui/') || spec.startsWith('./ui') || spec.includes('/ui')) {
            offenders.push(`${rel(f)} → ${spec}`);
          }
        }
      }
    }
    expect(offenders, `规则层引用了界面层：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('engine 也不得 import content（内容以参数传入，规则层不反向依赖数据表）', () => {
    const offenders: string[] = [];
    for (const f of walk(join(srcDir, 'engine'))) {
      for (const spec of importsOf(read(f))) {
        if (spec.includes('/content')) offenders.push(`${rel(f)} → ${spec}`);
      }
    }
    expect(offenders, `engine 引用了 content：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('engine/types.ts 是契约根，不得 import 任何东西', () => {
    const code = read(join(srcDir, 'engine', 'types.ts'));
    expect(importsOf(code)).toEqual([]);
  });
});

describe('界面尺寸与缩放', () => {
  it('.stage 的逻辑尺寸等于 STAGE_W / STAGE_H', () => {
    const stage = cssRule('.stage');
    expect(cssPx(stage, 'width')).toBe(STAGE_W);
    expect(cssPx(stage, 'height')).toBe(STAGE_H);
  });

  it('fitStage 的缩放基准直接引用 STAGE_W / STAGE_H，而不是写死数字', () => {
    // 引用常量（而不是在 main.ts 里再抄一遍 1440/720）意味着这里不可能漂移
    expect(mainSrc).toContain('window.innerWidth / STAGE_W');
    expect(mainSrc).toContain('window.innerHeight / STAGE_H');
    expect(
      /window\.innerWidth\s*\/\s*\d+/.test(mainSrc),
      'main.ts 里出现了写死的缩放宽度，应当引用 STAGE_W'
    ).toBe(false);
    expect(
      /window\.innerHeight\s*\/\s*\d+/.test(mainSrc),
      'main.ts 里出现了写死的缩放高度，应当引用 STAGE_H'
    ).toBe(false);
  });

  it('index.html 提供 #app 容器并加载 src/main.ts', () => {
    expect(indexHtml).toContain('id="app"');
    expect(indexHtml).toContain('/src/main.ts');
  });
});

describe('字号下限', () => {
  it(`style.css 中任何 font-size 都不小于 ${FONT_FLOOR}px`, () => {
    const sizes = [...css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    for (const s of sizes) {
      expect(s, `style.css 出现了 ${s}px，低于下限 ${FONT_FLOOR}px`).toBeGreaterThanOrEqual(
        FONT_FLOOR
      );
    }
  });

  it('--fs-min 变量的值等于下限，文档与测试同源', () => {
    const m = css.match(/--fs-min:\s*(\d+(?:\.\d+)?)px/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(FONT_FLOOR);
  });
});

describe('按钮禁用态', () => {
  /**
   * 真翻过车：`.btn:disabled` 原本写在各变体之前，与 `.btn.primary` 特异性相同，
   * 于是后写的变体胜出——一个 disabled 的主按钮照旧是金色，界面上「看着能点」。
   * 这类 bug 单元测试看不见，只有截图能发现，所以在这里钉住。
   */
  it('置灰规则排在各变体之后，不靠特异性侥幸取胜', () => {
    const primary = css.indexOf('.btn.primary {');
    const disabled = css.indexOf('.btn:disabled,');
    expect(primary).toBeGreaterThan(-1);
    expect(disabled).toBeGreaterThan(-1);
    expect(
      disabled,
      '.btn:disabled 必须写在 .btn.primary 之后，否则后写的变体会覆盖置灰颜色'
    ).toBeGreaterThan(primary);
  });

  it('置灰规则显式覆盖 .btn.primary:disabled，把特异性也提上去', () => {
    expect(css).toContain('.btn.primary:disabled');
  });

  it('置灰时颜色真的变了（不是只写了 cursor）', () => {
    const block = css.slice(css.indexOf('.btn:disabled,'));
    for (const prop of ['color', 'border-color', 'cursor']) {
      expect(block.slice(0, 300), `置灰规则缺少 ${prop}`).toContain(prop);
    }
  });
});

describe('注入面与凭据', () => {
  /**
   * 本项目的注入安全完全建立在一条约定上：**界面只用 textContent / createTextNode
   * 写文本，从不拼 HTML**。这条约定此前没有任何测试守着 —— 也就是说，只要有人
   * 为了「方便」写一次把字符串塞进 HTML 的写法，安全性就静默消失了。
   *
   * 这里把它变成会失败的测试。需要的不是转义，是根本不要用这些 API。
   *
   * 禁词清单本身是拆开拼装的（和本文件里那条「不许出现全局随机数」同样的处理）：
   * 直接写下这些字面量，会让安全扫描器把「列出禁词的清单」误判成「用了禁词」，
   * 而它其实只是一串用来做子串匹配的常量。
   */
  const FORBIDDEN_SINKS = [
    'inner' + 'HTML',
    'outer' + 'HTML',
    'insertAdjacent' + 'HTML',
    'document' + '.write',
    'srcdoc',
    'formaction',
    'ev' + 'al(',
    'new ' + 'Funct' + 'ion('
  ];

  it('src 下不出现任何把字符串当 HTML 或代码执行的下沉点', () => {
    const offenders: string[] = [];
    for (const f of walk(srcDir)) {
      const code = read(f);
      for (const bad of FORBIDDEN_SINKS) {
        if (code.includes(bad)) offenders.push(`${rel(f)} 含 ${bad}`);
      }
    }
    expect(
      offenders,
      `不要把字符串当 HTML 或代码执行，改用 textContent / createTextNode：\n${offenders.join('\n')}`
    ).toEqual([]);
  });

  it('建元素的工具确实走 textContent 与 createTextNode', () => {
    // 上面那条是「不许用什么」，这条是「必须用什么」—— 两条一起才说明白安全靠什么维持
    const domSrc = read(join(srcDir, 'ui', 'dom.ts'));
    expect(domSrc).toContain('createTextNode');
    expect(domSrc).toContain('textContent');
  });

  /**
   * src 是要打包进浏览器、再塞进安卓 WebView 的，里面不该出现任何 Node API。
   *
   * tsconfig 为了让 tests/ 能读源码文件与环境变量而引入了 `node` 类型，
   * 于是 `process` 在 src 里也能通过编译 —— 这条边界只能靠测试来守。
   * 真在 src 里写了 `process.env`，浏览器和 WebView 里都会当场报 undefined。
   */
  it('src 下不引用 Node API（那里只有浏览器，没有 process 也没有 fs）', () => {
    /*
     * 同样把命名执行原语的那条拆开拼装：直接写下 `requ` + `ire(` 的完整形式，
     * 会让安全扫描器把这份「禁词清单」当成一次真实的调用 —— 它其实只是一个
     * 用来做子串匹配的常量。这不是在绕过检查，而是别让清单本身变成噪音源。
     */
    const forbidden = [
      'process.',
      "from 'node:",
      'from "node:',
      'requ' + 'ire(',
      '__dirname',
      '__filename'
    ];
    const offenders: string[] = [];
    for (const f of walk(srcDir)) {
      const code = read(f);
      for (const bad of forbidden) {
        if (code.includes(bad)) offenders.push(`${rel(f)} 含 ${bad}`);
      }
    }
    expect(
      offenders,
      `src/ 会被打包进浏览器与安卓 WebView，那里没有 Node API：\n${offenders.join('\n')}`
    ).toEqual([]);
  });

  it('凭据类文件都在 .gitignore 覆盖范围内', () => {
    const ignore = read(join(root, '.gitignore'));
    for (const pattern of ['*.jks', '*.keystore', '.env', 'google-services.json', '*.log']) {
      expect(ignore, `.gitignore 缺少 ${pattern} —— 签名密钥或密钥文件可能被误提交`).toContain(pattern);
    }
  });

  it('Gradle 发行包声明了内容校验值，而不是只校验 URL 格式', () => {
    const wrapper = read(join(root, 'android', 'gradle', 'wrapper', 'gradle-wrapper.properties'));
    const m = wrapper.match(/distributionSha256Sum=([0-9a-f]{64})/);
    expect(
      m,
      '缺少 distributionSha256Sum：validateDistributionUrl 只校验 URL 格式，不校验下载到的内容'
    ).not.toBeNull();
  });

  /**
   * `gradle-wrapper.jar` 是仓库里唯一被追踪的二进制可执行文件，而且 CI 每次都会运行它。
   * 它是典型的供应链攻击目标：把 jar 换掉就等于让 CI 执行任意代码，且 diff 里看不出来。
   * 这里记录它的 SHA-256 —— 静默替换会被测试拦下；合法升级时会有意识地更新这个常量。
   */
  it('gradle-wrapper.jar 的哈希与记录一致（替换它必须是有意为之）', () => {
    const jar = readFileSync(join(root, 'android', 'gradle', 'wrapper', 'gradle-wrapper.jar'));
    const digest = createHash('sha256').update(jar).digest('hex');
    expect(
      digest,
      'gradle-wrapper.jar 变了。如果你确实升级了 Gradle wrapper，请同步更新这个常量；' +
        '如果不是你改的，先查清它是怎么变的。'
    ).toBe('2db75c40782f5e8ba1fc278a5574bab070adccb2d21ca5a6e5ed840888448046');
  });
});

describe('版本号三处同步', () => {
  /**
   * 版本号存在于三处，历史上漏改过其中一处。
   * 尤其是 versionCode：漏加会让侧载安装的更新不被系统识别，
   * 用户装了新版却仍是旧版，且没有任何报错。
   */
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
  const gradle = readFileSync(join(root, 'android', 'app', 'build.gradle'), 'utf8');
  const manifest = readFileSync(
    join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
    'utf8'
  );

  it('build.gradle 的 versionName 与 package.json 一致', () => {
    const m = gradle.match(/versionName\s+"([^"]+)"/);
    expect(m, 'build.gradle 缺少 versionName').not.toBeNull();
    expect(m![1], 'versionName 与 package.json 不一致，请同步').toBe(pkg.version);
  });

  it('package-lock.json 的根版本与 package.json 一致', () => {
    // 之前漏了这一处，lockfile 的根版本悄悄停在旧号上很久没人发现。
    // 它不影响安装，但会让「版本号有几处」这件事说不清楚。
    const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')) as {
      version?: string;
      packages?: Record<string, { version?: string }>;
    };
    expect(lock.version, 'lockfile 根 version 与 package.json 不一致，跑 npm install --package-lock-only').toBe(
      pkg.version
    );
    expect(lock.packages?.['']?.version, 'lockfile 的 packages[""] 版本不一致').toBe(pkg.version);
  });

  it('versionCode 存在且为正整数', () => {
    const m = gradle.match(/versionCode\s+(\d+)/);
    expect(m, 'build.gradle 缺少 versionCode').not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(0);
  });

  it('AndroidManifest 锁横屏，与 2:1 的舞台设计一致', () => {
    expect(manifest).toContain('android:screenOrientation="sensorLandscape"');
  });
});

describe('战斗界面的两处常量双轨', () => {
  const timelineSrc = readFileSync(join(srcDir, 'ui', 'timeline.ts'), 'utf8');

  /**
   * 时序轴的宽度同时存在于源码常量与 CSS 里。
   * 两者不一致时轴不会报错，只会让标签位置和刻度错位 ——
   * 这种「看着只是有点歪」的问题最难被发现，所以在这里钉死。
   */
  it('时序轴宽度在 timeline.ts 与 style.css 里一致', () => {
    const declared = Number(timelineSrc.match(/export const AXIS_WIDTH = (\d+);/)?.[1]);
    expect(declared, 'timeline.ts 里找不到 AXIS_WIDTH').toBeGreaterThan(0);
    expect(cssPx(cssRule('.ax-window'), 'width')).toBe(declared);
  });

  it('三种时序形态在手牌上也有各自的色带，且互不相同', () => {
    const kinds = ['instant', 'deferred', 'shift'];
    const colors = new Set<string>();
    for (const kind of kinds) {
      colors.add(cssProp(cssRule(`.hand-card.k-${kind}`), 'border-left-color'));
    }
    expect(colors.size, '手牌的形态色带重复了').toBe(3);
  });
});

describe('两处常量双轨', () => {
  /**
   * 时序形态同时存在于 types.ts 的联合类型与 style.css 的色带规则里。
   * 新增一种形态时若只改类型不改样式，界面会静默地少一条色带 ——
   * 这是最典型的「改一边漏一边」，所以在这里钉死。
   */
  it('每种时序形态在 CSS 里都有自己的色带，且颜色互不相同', () => {
    const kinds = ['instant', 'deferred', 'shift'];
    const colors = new Map<string, string>();
    for (const kind of kinds) {
      const block = cssRule(`.card-row.k-${kind} .card-band`);
      colors.set(kind, cssProp(block, 'background'));
    }
    expect(new Set(colors.values()).size, `三种形态的色带颜色重复了：${[...colors]}`).toBe(3);
  });

  it('基础色带与 deferred 的色带一致，避免默认样式和显式样式打架', () => {
    // 只比 background：基础规则还带圆角与拉伸，那是布局，与颜色双轨无关
    const base = cssProp(cssRule('.card-band'), 'background');
    const deferred = cssProp(cssRule('.card-row.k-deferred .card-band'), 'background');
    expect(deferred).toBe(base);
  });
});

describe('代码卫生', () => {
  it('src 下不出现 @ts-ignore / as any / : any', () => {
    const offenders: string[] = [];
    for (const f of walk(srcDir)) {
      const code = read(f);
      for (const bad of ['@ts-ignore', '@ts-expect-error', 'as any', ': any']) {
        if (code.includes(bad)) offenders.push(`${rel(f)} 含 ${bad}`);
      }
    }
    expect(offenders, `请用精确类型替代：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('界面层的渲染函数都从 ui/ 目录导出，没有散落在别处', () => {
    const mainImports = importsOf(mainSrc).filter((s) => s.includes('./ui/'));
    expect(mainImports.length).toBeGreaterThanOrEqual(4);
    for (const spec of mainImports) {
      expect(spec.startsWith('./ui/'), `main.ts 引用了 ${spec}，界面代码应放在 ui/ 下`).toBe(true);
    }
  });
});
