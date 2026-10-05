/**
 * 캐릭터 작성: 능력치 굴리기·배정, 초기 소지금 (01 §1.1, 캐릭터 작성 §1·§6). Foundry 비의존.
 */
import { ABILITIES } from "./derive.mjs";

export const ABILITY_ROLL_COUNT = 5;

/** rng: () => 1..6. 3D6을 5번 → [{ dice:[a,b,c], total }] */
export function rollAbilityScores(rng) {
  return Array.from({ length: ABILITY_ROLL_COUNT }, () => {
    const dice = [rng(), rng(), rng()];
    return { dice, total: dice[0] + dice[1] + dice[2] };
  });
}

/** 순서대로: 1번째 값 → 【STR】, 2번째 → 【TEC】 … (슬롯 인덱스 배열) */
export function orderedAssignment() {
  return ABILITIES.map((_, i) => i);
}

/** 랜덤 배치: Fisher-Yates. rand: () => [0, 1) */
export function randomAssignment(rand) {
  const slots = orderedAssignment();
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  return slots;
}

/** 배정이 유효한가: 능력치마다 슬롯 하나, 모든 슬롯을 정확히 한 번(값 이동 금지) */
export function isValidAssignment(slots) {
  return slots.length === ABILITIES.length
    && slots.every((s) => Number.isInteger(s) && s >= 0 && s < ABILITY_ROLL_COUNT)
    && new Set(slots).size === slots.length;
}

/** 슬롯 배정 → { str, tec, vit, agi, luc } */
export function applyAssignment(totals, slots) {
  if (!isValidAssignment(slots)) throw new Error("invalid assignment");
  return Object.fromEntries(ABILITIES.map((k, i) => [k, totals[slots[i]]]));
}

/** 초기 소지금 = (100 − 3D6×5회 합계) × 10G */
export function initialMoney(totals) {
  return (100 - totals.reduce((a, b) => a + b, 0)) * 10;
}
