/**
 * effects의 적용 조건 `when`과 확률 발동 `chance` (03 §2). Foundry 비의존.
 * ctx: { self, target, attack: { kind, elements }, timeOfDay, allies }
 *  self/target은 전투 프로필 모양 { weaponType, dualWield, skills: [이름], hp, hpMax, row, acted, … }
 */
const arr = (v) => (Array.isArray(v) ? v : [v]);

/** 키 하나 판정. 모르는 키는 false(조용히 통과시키지 않는다) */
const CHECKS = {
  weaponType: (v, c) => arr(v).includes(c.self?.weaponType),
  dualWield: (v, c) => !!c.self?.dualWield === !!v,
  targetHasSkill: (v, c) => (c.target?.skills ?? []).includes(v),
  targetKO: (v, c) => !!c.target?.ko === !!v,
  targetNotActedThisTurn: (v, c) => !c.target?.acted === !!v,
  selfHpAtMostHalf: (v, c) => ((c.self?.hp ?? 0) * 2 <= (c.self?.hpMax ?? 0)) === !!v,
  selfRow: (v, c) => c.self?.row === v,
  element: (v, c) => arr(v).some((e) => (c.attack?.elements ?? []).includes(e)),
  attackKind: (v, c) => c.attack?.kind === v,
  timeOfDay: (v, c) => c.timeOfDay === v,
  // 사용하는 스킬의 분류(『백병』 등). 통상 공격은 분류 없음
  category: (v, c) => arr(v).includes(c.category),
  allyCountInRow: (v, c) => (c.allies ?? []).filter((a) => a.name === v.name && a.row === c.self?.row && !a.ko).length >= (v.gte ?? 1)
};

/** @returns {boolean} 조건이 없으면 true */
export function whenMatches(when, ctx = {}) {
  if (!when) return true;
  return Object.entries(when).every(([k, v]) => (CHECKS[k] ? CHECKS[k](v, ctx) : false));
}

/** 모르는 when 키(데이터 검사용) */
export const unknownWhenKeys = (when) => Object.keys(when ?? {}).filter((k) => !CHECKS[k]);
