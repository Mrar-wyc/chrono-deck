/**
 * 舞台逻辑尺寸。
 *
 * CSS `.stage` 的宽高与 main.ts 里 fitStage 的缩放基准都必须等于这两个值；
 * tests/guards.test.ts 会读 CSS 源码逐条断言，改一边漏另一边直接测试失败。
 */
export const STAGE_W = 1440;
export const STAGE_H = 720;
