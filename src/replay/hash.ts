/**
 * 稳定序列化与状态哈希。
 *
 * 用途：回放校验（同种子 + 同操作 → 同一哈希）、bug 报告里贴状态指纹、
 * soak 测试断言不变量。对象键必须按字典序输出，否则键顺序一变哈希就漂。
 */

/** 对象键按字典序、数组保序的确定性序列化 */
export function stableStringify(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  const t = typeof v;
  if (t === 'number') return Number.isFinite(v as number) ? String(v) : `#${String(v)}`;
  if (t === 'boolean' || t === 'bigint') return String(v);
  if (t === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (t === 'object') {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const k of keys) {
      const val = obj[k];
      if (val === undefined) continue;
      parts.push(`${JSON.stringify(k)}:${stableStringify(val)}`);
    }
    return `{${parts.join(',')}}`;
  }
  return JSON.stringify(String(v));
}

/** FNV-1a 32 位，输出 8 位大写十六进制 */
export function hashState(v: unknown): string {
  const s = typeof v === 'string' ? v : stableStringify(v);
  let hv = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hv ^= s.charCodeAt(i);
    hv = Math.imul(hv, 0x01000193);
  }
  return (hv >>> 0).toString(16).toUpperCase().padStart(8, '0');
}
