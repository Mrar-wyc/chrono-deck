/** 界面层共用的上下文。只暴露界面该知道的东西 */
export type Screen = 'menu' | 'setup' | 'battle' | 'about' | 'crash';

export interface AppCtx {
  /** 本局时序种子 */
  seed: number;
  setSeed(seed: number): void;
  go(screen: Screen): void;
  /** 重绘当前界面 */
  refresh(): void;
  /**
   * 用当前筹备设置进入一场战斗。
   * 装配（洗牌、遭遇敌人、带哪些刻印）由 run/battle-setup 负责，
   * 界面只把玩家的选择传下去。
   */
  startBattle(): void;
}

/** 筹备界面的选择项。放在这里让 main.ts 与 setup.ts 共用一份定义 */
export interface RunSetup {
  encounterId: string;
  /** 额外带上的奖励刻印 id */
  picked: string[];
}
