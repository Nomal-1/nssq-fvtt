/**
 * 상태 이상·봉인 (01 §3.7~3.9). Foundry 비의존 순수 함수.
 * 저장 모양: { id, depth, source, sourceSuppAtk } — depth는 심도(석화·스턴은 null)
 */
import { evaluateCheck, contestWinner } from "./check.mjs";

/**
 * kind: ailment(상태 이상) / bind(봉인)
 * depth: 심도를 기록하는가(석화·스턴 false)
 * noAction: 모든 행동 불가 / evasionZero: 【회피】 0 / roll: 개막 1D6 판정(1~3이면 행동 불가·혼란 행동)
 */
export const CONDITIONS = {
  petrify: { kind: "ailment", depth: false, noAction: true, evasionZero: true },
  curse: { kind: "ailment", depth: true },
  poison: { kind: "ailment", depth: true },
  sleep: { kind: "ailment", depth: true, noAction: true, evasionZero: true },
  confuse: { kind: "ailment", depth: true, roll: "confuse" },
  paralyze: { kind: "ailment", depth: true, roll: "disable" },
  fear: { kind: "ailment", depth: true, roll: "disable" },
  blind: { kind: "ailment", depth: true },
  stun: { kind: "ailment", depth: false, noAction: true, evasionZero: true, separate: true },
  bindHead: { kind: "bind", depth: true },
  bindArm: { kind: "bind", depth: true },
  bindLeg: { kind: "bind", depth: true, evasionZero: true }
};
export const CONDITION_IDS = Object.keys(CONDITIONS);

/** 〈참〉〈괴〉〈돌〉: [수면]이면 −1로 취급(07 #3) */
const SLEEP_RESISTS = ["slash", "strike", "pierce"];

export const hasCondition = (list, id) => (list ?? []).some((c) => c.id === id);

/** [석화] 중이면 탐색 스킬을 쓸 수 없고 필드 판정은 실패(07 #164). system 데이터가 있는 아무 객체 */
export const isPetrified = (actor) => hasCondition(actor?.system?.conditions, "petrify");

/**
 * 상태 이상·봉인 부여.
 * - 같은 것이 이미 있으면 심도가 더 높을 때만 갱신(07 #5)
 * - 서로 다른 상태 이상·봉인은 함께 걸린다(07 #35, 사용자 결정 2026-10-10)
 * @returns {{list: object[], result: "added"|"updated"|"ignored"}}
 */
export function addCondition(list, { id, depth = null, source = "", sourceSuppAtk = 0 }) {
  const def = CONDITIONS[id];
  if (!def) return { list: [...(list ?? [])], result: "ignored" };
  const entry = { id, depth: def.depth ? Math.max(0, Number(depth) || 0) : null, source, sourceSuppAtk: Number(sourceSuppAtk) || 0 };
  const cur = list ?? [];
  const i = cur.findIndex((c) => c.id === id);
  if (i < 0) return { list: [...cur, entry], result: "added" };
  if (!def.depth || (entry.depth ?? 0) <= (cur[i].depth ?? 0)) return { list: [...cur], result: "ignored" };
  return { list: cur.map((c, j) => (j === i ? entry : c)), result: "updated" };
}

export const removeCondition = (list, id) => (list ?? []).filter((c) => c.id !== id);

/**
 * 상태 이상·봉인에 의한 보정
 * @param {object[]} list
 * @param {{disabled?: boolean}} [turn] 이번 턴 [마비]·[공포] 판정 실패(회피 0)
 * @returns {{add: object, zero: string[], resistSet: object, noAction: boolean}}
 */
export function conditionMods(list, { disabled = false } = {}) {
  const add = {};
  const zero = new Set();
  const resistSet = {};
  let noAction = false;
  const plus = (k, v) => { add[k] = (add[k] ?? 0) + v; };
  for (const c of list ?? []) {
    const def = CONDITIONS[c.id];
    if (!def) continue;
    if (def.noAction) noAction = true;
    if (def.evasionZero) zero.add("evasion");
    if (c.id === "blind") { plus("physHit", -3); plus("elemHit", -3); plus("evasion", -3); }
    if (c.id === "bindHead") { plus("physHit", -2); plus("elemHit", -2); }
    if (c.id === "bindArm") plus("physAtk", -4);
    if (c.id === "sleep") for (const r of SLEEP_RESISTS) resistSet[r] = -1;
  }
  if (disabled) { zero.add("evasion"); noAction = true; }
  return { add, zero: [...zero], resistSet, noAction };
}

/**
 * 고정 목표값 부여: 2D6 + 【억제 방어】 ≥ 목표값이면 막는다. 실패하면 심도 = 목표값
 * @returns {{check: object, resisted: boolean, depth: number|null}}
 */
export function resistCheck({ dice, suppDef = 0, target }) {
  const check = evaluateCheck({ dice, modifier: suppDef, target });
  return { check, resisted: !!check.success, depth: check.success ? null : Number(target) || 0 };
}

/**
 * 대결 판정 부여: 공격자 【억제 공격】 vs 대상 【억제 방어】. 공격자가 이기면 부여, 심도 = 공격자 달성값(07 #6)
 */
export function contestInflict({ atkDice, suppAtk = 0, defDice, suppDef = 0 }) {
  const atk = evaluateCheck({ dice: atkDice, modifier: suppAtk });
  const def = evaluateCheck({ dice: defDice, modifier: suppDef });
  const won = contestWinner(atk, def) === "active";
  return { atk, def, resisted: !won, depth: won ? atk.total : null };
}

/**
 * 반드시 거는 부여(저항 없음): 심도만 【억제 공격】 판정 달성값으로(07 #61, 《임팩트 애로》 자신 [마비])
 */
export function forcedInflict({ atkDice, suppAtk = 0 }) {
  const atk = evaluateCheck({ dice: atkDice, modifier: suppAtk });
  return { atk, resisted: false, depth: atk.total };
}

/** 개막 1D6 판정(혼란·마비·공포): 1~3이면 실패 */
export const openingRollFails = (die) => die >= 1 && die <= 3;
