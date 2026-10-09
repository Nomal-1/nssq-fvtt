/**
 * 탐색: 캠프·트랩(던전 탐색 룰, 단계 9-C). Foundry 비의존.
 * - 캠프: 최소 6시간, (경과 시간) + (Lv)만큼 【HP】·【TP】 회복([전투 불능]에서도), 식료품 1개 소모.
 *   습격: 위험도(3~6, 텐트 −1)를 정했으면 2D6 ≤ 위험도면 기습 전투, 회복 없음
 *   《캠프 마스터》 campHeal +SL, 《회복 요리》·《일품 요리》 HP·TP 2배, 《약효 요리》 상태 이상 회복(조리기구 세트 필요)
 * - 트랩: 【HP】 대미지 던전 레벨×3, 【TP】 대미지 던전 레벨×2(랜덤 던전: 1D6 1~3 HP, 4~6 TP)
 */

/** 캠프 습격 판정. danger 0이면 하지 않음 */
export function campAmbush(dice, danger) {
  if (!(danger > 0)) return { rolled: false, ambush: false, total: null };
  const total = dice.reduce((n, d) => n + d, 0);
  return { rolled: true, ambush: total <= danger, total };
}

/**
 * 한 사람의 캠프 회복
 * @param {{ hours: number, level: number, campHeal?: number, cookHp?: boolean, cookTp?: boolean }} p
 * @returns {{ hp: number, tp: number }}
 */
export function campRecovery({ hours, level, campHeal = 0, cookHp = false, cookTp = false }) {
  const base = Math.max(0, Number(hours) || 0) + (Number(level) || 0) + (Number(campHeal) || 0);
  return { hp: base * (cookHp ? 2 : 1), tp: base * (cookTp ? 2 : 1) };
}

/** 트랩 대미지 */
export function trapDamage(level, kind) {
  const lv = Math.max(0, Number(level) || 0);
  return kind === "tp" ? { tp: lv * 2, hp: 0 } : { hp: lv * 3, tp: 0 };
}
