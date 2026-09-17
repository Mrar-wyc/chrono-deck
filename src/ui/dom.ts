/**
 * 极简 DOM 构建工具。全项目不用框架、不用 JSX、不做虚拟 DOM diff，
 * 界面由 renderXxx(root, ctx) 函数一次性搭出来。
 */

export type Child = Node | string | number | null | undefined | false;
export type Attrs = Record<string, unknown>;

/**
 * 递归展平子节点。
 * 必须递归而不是 flat()：深层嵌套（嵌套列表、条件分支）在展平层数不足时
 * 会被当成文本塞进去，得到一个 `[object Object]` 或一串逗号，且不报错。
 */
function flatten(children: (Child | Child[])[]): Child[] {
  const out: Child[] = [];
  const walk = (cs: (Child | Child[])[]): void => {
    for (const c of cs) {
      if (Array.isArray(c)) walk(c);
      else out.push(c);
    }
  };
  walk(children);
  return out;
}

/**
 * 建元素。
 * - `class` 走 className
 * - `text` 走 textContent（比把字符串塞进子节点更明确）
 * - `style` 接对象，用于数据驱动的颜色/宽度
 * - `on*` 接事件监听
 * - `null` / `undefined` / `false` 一律跳过，方便写 `cond && h(...)`
 */
export function h<T extends HTMLElement = HTMLElement>(
  tag: string,
  attrs: Attrs = {},
  ...children: (Child | Child[])[]
): T {
  const el = document.createElement(tag) as T;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v as object);
    else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2), v as EventListener);
    } else el.setAttribute(k, String(v));
  }
  for (const c of flatten(children)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

let toastTimer: number | undefined;

/** 短暂提示。全项目只有这一个，重复调用会重置计时而不是叠出多个 */
export function toast(msg: string): void {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast' });
    document.body.append(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  if (toastTimer !== undefined) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    document.getElementById('toast')?.classList.remove('show');
  }, 1800);
}
