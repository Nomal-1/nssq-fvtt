/**
 * 일반 행위 판정·대항 판정 (01 §2). Foundry 비의존 순수 함수.
 * 주사위 눈은 호출자가 굴려서 넘긴다(Foundry에서는 Roll, 테스트에서는 고정 배열).
 */

/** rng: () => 1..6. 테스트·대체용 */
export function rollDice(n, rng) {
  return Array.from({ length: Math.max(0, n) }, () => rng());
}

/** 기본 선택: 가장 높은 2개(같은 눈이면 앞의 것) */
export function defaultSelection(dice) {
  return dice
    .map((v, i) => ({ v, i }))
    .sort((a, b) => b.v - a.v || a.i - b.i)
    .slice(0, 2)
    .map((x) => x.i)
    .sort((a, b) => a - b);
}

/**
 * 판정 상태 → 결과
 * @param {object} s
 * @param {number[]} s.dice       굴린 모든 눈 (2 + 추가 개수)
 * @param {number[]} [s.selected] 사용할 2개의 인덱스. 없으면 높은 2개
 * @param {number} [s.modifier]   능력치 보너스 + 수정치
 * @param {number|null} [s.target] 목표값. 없으면 성공 여부를 정하지 않는다
 * @param {number} [s.added]      【FP】로 추가한 주사위 수
 * @param {boolean} [s.rerolled]  【FP】로 다시 굴렸는가
 */
export function evaluateCheck({ dice, selected, modifier = 0, target = null, added = 0, rerolled = false }) {
  const sel = selected?.length === 2 ? selected : defaultSelection(dice);
  const used = sel.map((i) => dice[i]);
  const sum = used[0] + used[1];
  const total = sum + modifier;
  // 07 #4: 주사위를 늘린 판정의 절대 성공·실패는 고른 2개 기준
  const absSuccess = used.every((v) => v === 6);
  const absFailure = used.every((v) => v === 1);
  let success = null;
  if (absFailure) success = false;
  else if (absSuccess) success = true;
  else if (target !== null && target !== undefined) success = total >= target;
  // 1 하나당 【FP】+1. 주사위를 늘렸거나 다시 굴린 판정에서는 얻지 않는다
  const fpGain = added === 0 && !rerolled ? dice.filter((v) => v === 1).length : 0;
  return { selected: sel, used, sum, total, absSuccess, absFailure, success, fpGain };
}

/**
 * 대항 판정 승자. 동점이면 수동 측. 양쪽 절대 성공이면 수동 측(01 §2).
 * @param {{total, absSuccess, absFailure}} active
 * @param {{total, absSuccess, absFailure}} passive
 * @returns {"active"|"passive"}
 */
export function contestWinner(active, passive) {
  if (passive.absSuccess) return "passive";
  if (active.absSuccess) return "active";
  // 07 #19: 양쪽 절대 실패면 동점과 같이 수동 측
  if (active.absFailure) return "passive";
  if (passive.absFailure) return "active";
  return passive.total >= active.total ? "passive" : "active";
}

export const REROLL_COST = 1; // OPEN-QUESTION #18

/**
 * 다시 굴리기 가능 여부. 이 판정의 1로 얻은 【FP】(fpGained)는 다시 굴리면 회수되므로
 * 그것을 뺀 【FP】로 비용을 낼 수 있어야 한다.
 */
export function canReroll(state, fp, cost = REROLL_COST) {
  return !state.rerolled && fp - (state.fpGained ?? 0) >= cost;
}

/** 다시 굴릴 때의 【FP】 변화: 비용 + 이 판정에서 얻었던 【FP】 회수 (+ 다시 굴린 뒤 획득, 원문상 항상 0) */
export function rerollFPDelta(state, newGain = 0, cost = REROLL_COST) {
  return -cost - (state.fpGained ?? 0) + newGain;
}

export function canAddDice(fp, n = 1) {
  return n >= 1 && fp >= n;
}
