/**
 * 희소종 (01 §3.14): 【HP】 2~3배, 내성 0→1·1→2, GM 재량으로 【물리 명중】【속성 명중】【회피】 +1, 【물리 공격】【속성 공격】【방어】 +2까지.
 */

/**
 * @param {{hp: {value, max}, stats: object, resist: object}} enemy 에너미 system
 * @param {{multiplier?: 2|3, boost?: boolean}} [opts]
 * @returns {object} 바꿀 값 { hp, stats, resist }
 */
export function rareTransform(enemy, { multiplier = 2, boost = false } = {}) {
  const max = enemy.hp.max * multiplier;
  const resist = Object.fromEntries(Object.entries(enemy.resist).map(([k, v]) => [k, v === 0 ? 1 : v === 1 ? 2 : v]));
  const stats = { ...enemy.stats };
  if (boost) {
    for (const k of ["physHit", "elemHit", "evasion"]) stats[k] += 1;
    for (const k of ["physAtk", "elemAtk", "defense"]) stats[k] += 2;
  }
  return { hp: { value: max, max }, stats, resist };
}

/** 같은 데이터인가(중복 정리용): 이름·이미지·system이 모두 같을 때만 */
export function sameEnemyData(a, b) {
  return a.name === b.name && a.img === b.img && JSON.stringify(sortKeys(a.system)) === JSON.stringify(sortKeys(b.system));
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}
