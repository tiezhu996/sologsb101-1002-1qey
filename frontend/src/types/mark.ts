/** 人工标记（可疑组串星标）：主键即组串 id，与组串同生命周期 */
export interface StringMark {
  /** 被标记的组串 id */
  stringId: string;
  /** 标记时间，用于稳定排序与留档 */
  markedAt: string;
}
