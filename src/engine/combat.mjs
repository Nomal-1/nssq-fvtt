/**
 * 전투 코어 (01 §3.2~3.5, §3.13). Foundry 비의존 순수 함수.
 * 주사위 눈은 호출자가 굴려서 넘기거나, rng(() => 1..6)를 주입한다.
 */
import { evaluateCheck } from "./check.mjs";

export const SIDE_ORDER = { pc: 0, ally: 1, enemy: 2 };
export const PHASES = ["opening", "main", "end"];
export const CRIT_EXTRA_DICE = 4;

/* ---------------- 행동 순서 ---------------- */

/**
 * 이니셔티브 값: 【속도】를 기본으로, 최속 +1000 / 후발 −1000, 같은 【속도】면 PC → 아군 NPC → 에너미.
 * Foundry의 기본 정렬(이니셔티브 내림차순)을 그대로 쓸 수 있도록 한 숫자로 만든다.
 */
export function initiativeValue({ speed = 0, side = "enemy", timing = "normal" }) {
  const base = timing === "first" ? 1000 : timing === "last" ? -1000 : 0;
  const tie = (2 - (SIDE_ORDER[side] ?? 2)) / 10; // pc 0.2, ally 0.1, enemy 0
  return base + Math.max(0, speed) + tie;
}

/** [{id, speed, side, timing}] → id 순서 */
export function turnOrder(list) {
  return list
    .map((c, i) => ({ ...c, i, init: initiativeValue(c) }))
    .sort((a, b) => b.init - a.init || a.i - b.i)
    .map((c) => c.id);
}

/* ---------------- 사거리 ---------------- */

/** 「근」은 자신이 전위이고 대상도 (상대 진영) 전위일 때만. 「원」·「-」은 위치 무관 */
export function inRange(range, attackerRow, targetRow) {
  if (range !== "근") return true;
  return attackerRow === "front" && targetRow === "front";
}

/* ---------------- 내성·대미지 ---------------- */

export const PHYSICAL_ELEMENTS = ["slash", "strike", "pierce"];

/**
 * 적용 내성: 공격 속성의 내성, 복합 속성이면 최저, 무속성은 0
 * @param {Record<string, number>} resist
 * @param {string[]} elements 비어 있거나 "none"만 있으면 무속성
 */
export function effectiveResist(resist, elements) {
  const els = (elements ?? []).filter((e) => e && e !== "none");
  if (!els.length) return 0;
  return Math.min(...els.map((e) => resist?.[e] ?? 0));
}

/**
 * 대미지 다이스 수. 물리 = 【물리 공격】 − 대상 【방어】, 속성 = 【속성 공격】. + 스킬 보정.
 * 0 이하면 0(07 #1)
 */
export function damageDiceCount({ kind = "physical", physAtk = 0, elemAtk = 0, defense = 0, diceMod = 0 }) {
  const n = (kind === "physical" ? physAtk - defense : elemAtk) + diceMod;
  return Math.max(0, n);
}

/**
 * 대미지 판정: 내성보다 큰 눈의 개수 = 실대미지. 6의 개수 − 1의 개수 ≥ 기준이면 크리티컬
 * @param {number[]} dice
 * @param {number} resist
 * @param {{critUp?: boolean}} [opts] 『크리티컬 업』이면 기준 1
 */
export function judgeDamage(dice, resist, { critUp = false } = {}) {
  const sixes = dice.filter((d) => d === 6).length;
  const ones = dice.filter((d) => d === 1).length;
  return {
    dice,
    hits: dice.filter((d) => d > resist).length,
    sixes,
    ones,
    crit: sixes - ones >= (critUp ? 1 : 2)
  };
}

/** 대미지 절반(방어 전념 등): 버림 */
export const halve = (n) => Math.floor(n / 2);

/**
 * 공격 롤 한 번(대상 1체).
 * @param {object} a
 * @param {{hit: number, physAtk: number, elemAtk: number, elements: string[], critUp?: boolean}} a.attacker
 * @param {{evasion: number, defense: number, resist: object, guarding?: boolean}} a.target
 * @param {"physical"|"elemental"} [a.kind]
 * @param {number} [a.hitMod] 명중 보정
 * @param {number} [a.diceMod] 대미지 다이스 보정
 * @param {(n: number) => number[]|Promise<number[]>} [a.rollDice] n개의 D6. Foundry에서는 Roll, 테스트에서는 고정값
 * @param {() => number} [a.rng] rollDice 대신 1개씩 굴리는 함수
 * @returns {Promise<object>}
 */
export async function resolveAttack({ attacker, target, kind = "physical", hitMod = 0, diceMod = 0, rollDice, rng }) {
  const roll = rollDice ?? ((n) => Array.from({ length: n }, () => rng()));
  const hd = await roll(2);
  const hit = evaluateCheck({ dice: hd, modifier: attacker.hit + hitMod, target: target.evasion });
  const result = { kind, hitCheck: hit, hit: !!hit.success, fpGain: hit.fpGain };
  if (!result.hit) return result;

  const resist = effectiveResist(target.resist, attacker.elements);
  const count = damageDiceCount({ kind, physAtk: attacker.physAtk, elemAtk: attacker.elemAtk, defense: target.defense, diceMod });
  const first = judgeDamage(count ? await roll(count) : [], resist, { critUp: attacker.critUp });
  // 크리티컬: 4다이스 추가. 추가분으로 크리티컬을 다시 판정하지 않는다(07 #2)
  const extra = first.crit ? { ...judgeDamage(await roll(CRIT_EXTRA_DICE), resist), crit: false } : null;
  const raw = first.hits + (extra?.hits ?? 0);
  return {
    ...result,
    resist,
    diceCount: count,
    damage: first,
    critExtra: extra,
    crit: first.crit,
    rawDamage: raw,
    guarded: !!target.guarding,
    finalDamage: target.guarding ? halve(raw) : raw
  };
}

/** 다회·범위 공격: 명중 판정의 1로 얻는 【FP】는 주행동 1회당 처음 판정 하나만 */
export function fpFromHitChecks(results) {
  return results.length ? results[0].fpGain ?? 0 : 0;
}

/* ---------------- 전투 불능·열 교대 ---------------- */

export const isKO = (hp) => hp <= 0;

/**
 * 전위가 전원 전투 불능이면 그 진영 전원의 열을 바꾼다.
 * @param {{id, row: "front"|"back", ko: boolean}[]} units 한 진영
 * @returns {{id, row}[]} 바꿀 것(없으면 빈 배열)
 */
export function rowSwap(units) {
  const front = units.filter((u) => u.row === "front");
  const back = units.filter((u) => u.row === "back");
  // 전열에 살아 있는 전투원이 없고(비어 있어도) 후열에 살아 있는 전투원이 있으면 교대
  if (front.some((u) => !u.ko) || !back.some((u) => !u.ko)) return [];
  return units.map((u) => ({ id: u.id, row: u.row === "front" ? "back" : "front" }));
}

/**
 * 식별(01 §3.1): 【TEC】 판정 달성값 ≥ 에너미 【희소도】면 성공. 희소종은 【희소도】+2 이상이어야 간파
 * @returns {{identified: boolean, rareRevealed: boolean}}
 */
export function identifyResult(value, { rarity = 0, isRare = false } = {}) {
  // 비어 있으면 아직 굴리지 않은 것
  const v = value === "" || value === null || value === undefined ? NaN : Number(value);
  if (!Number.isFinite(v)) return { identified: false, rareRevealed: false };
  return { identified: v >= rarity, rareRevealed: !!isRare && v >= rarity + 2 };
}

/** 식별 실패한 에너미의 내성은 최소 3으로 취급(약점이 드러나지 않는다) */
export function unidentifiedResist(resist) {
  return Object.fromEntries(Object.entries(resist ?? {}).map(([k, v]) => [k, Math.max(3, Number(v) || 0)]));
}

/** 목록에서 하나를 같은 확률로(비어 있으면 null) */
export function pickRandom(list, rng = Math.random) {
  return list.length ? list[Math.min(list.length - 1, Math.floor(rng() * list.length))] : null;
}

/** 진영 전멸: 전원 전투 불능 또는 [석화] */
export function sideDefeated(units) {
  return units.length > 0 && units.every((u) => u.ko || u.petrified);
}

/** PC 배치 제한: 전위·후위 각 3명까지 */
export const PC_ROW_LIMIT = 3;
export function rowFull(units, row) {
  return units.filter((u) => u.row === row).length >= PC_ROW_LIMIT;
}

/* ---------------- 도주 ---------------- */

/**
 * 도주 판정: 참가자 전원 【회피】 판정, 도주 측 최고 > 추격 측 최고면 성공(동점 실패).
 * [다리] 봉인 캐릭터는 참가하지 않는다(호출자가 빼고 넘긴다).
 */
export function escapeSucceeds(fleeTotals, chaseTotals) {
  if (!fleeTotals.length) return false;
  if (!chaseTotals.length) return true;
  return Math.max(...fleeTotals) > Math.max(...chaseTotals);
}
