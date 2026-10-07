/**
 * 수동(리액션) 스킬 (01 §3.5, 07 #51). Foundry 비의존.
 * - activeEvade: 능동 회피 = 대항 판정. 대상 2D6 + 능력치 보너스 + 보정 vs 공격자 명중 달성값, 동점이면 회피(수동 측 승리)
 * - nullify: 《완전 방어》 — 그 공격의 대미지 0, 추가 효과(상태 이상 부여 등) 무효
 */
import { contestWinner, evaluateCheck } from "../check.mjs";
import { evaluate } from "../expr.mjs";

/** 이 공격(kind: physical|elemental)에 쓸 수 있는 반응 효과 */
export function reactionEffect(effects, kind) {
  return (effects ?? []).find((e) => (e.type === "activeEvade" && (!e.vs || e.vs === kind)) || e.type === "nullify") ?? null;
}

/**
 * 능동 회피
 * @param {object} p
 * @param {number[]} p.dice 대상의 2D6
 * @param {number} p.abilityBonus 지정 능력치의 보너스
 * @param {string|number} [p.bonus] 달성값 보정 수식(SL 사용)
 * @param {number} [p.sl]
 * @param {{total: number, absSuccess?: boolean, absFailure?: boolean}} p.attack 공격자의 명중 판정
 */
export function activeEvade({ dice, abilityBonus = 0, bonus = 0, sl = 1, attack }) {
  const mod = (Number(abilityBonus) || 0) + evaluate(bonus, { SL: sl });
  const check = evaluateCheck({ dice, modifier: mod });
  const evaded = contestWinner({ total: attack.total, absSuccess: !!attack.absSuccess, absFailure: !!attack.absFailure }, check) === "passive";
  return { check, evaded, mod };
}
