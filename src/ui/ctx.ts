/** 界面层共用的上下文。只暴露界面该知道的东西 */
export type Screen = 'menu' | 'setup' | 'about' | 'crash';

export interface AppCtx {
  /** 本局时序种子 */
  seed: number;
  setSeed(seed: number): void;
  go(screen: Screen): void;
  /** 重绘当前界面 */
  refresh(): void;
}
