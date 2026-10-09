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

/**
 * 경력표 D666: 3D6을 작은 순으로 늘어놓은 세 자리(예: 5·1·3 → "135")
 * @param {() => number} rng 1..6
 * @param {{roll: string, text: string}[]} entries
 */
export function rollCareer(rng, entries) {
  const dice = [rng(), rng(), rng()].sort((a, b) => a - b);
  const roll = dice.join("");
  return { dice, roll, entry: entries.find((e) => e.roll === roll) ?? null };
}

/**
 * 작성 검사(캐릭터 작성 §1~§8). 각 항목 { code, ok, level: "error"|"warn", detail? }
 * @param {object} p
 * @param {number[]} p.rolls 3D6×5 결과
 * @param {{str,tec,vit,agi,luc}} p.abilities 배정한 기본값
 * @param {string|null} p.mainClass
 * @param {string|null} p.subClass
 * @param {{name, sl, unique, common, classKey, maxSL, prereqs}[]} p.skills
 * @param {object[]} p.equipped 장비 중인 아이템(type, system)
 * @param {{main, sub}} p.classes 클래스 아이템의 system(weapons·armors)
 * @param {number} p.carried 소지 수
 * @param {number} p.capacity 소지 상한
 * @param {number} p.money
 * @param {number} [p.level]
 * @param {number} [p.bonus] GM 보너스 SL
 * @param {(item, classes) => {ok, reason?}} p.canEquip equipment.mjs canEquip
 * @param {object} p.skillRules { skillBudget, levelCap, prereqsMet } (skills.mjs)
 */
export function validateCreation(p) {
  const out = [];
  const add = (code, ok, level = "error", detail = "") => out.push({ code, ok: !!ok, level, detail });
  const { skillBudget, levelCap, prereqsMet } = p.skillRules;
  // 1 능력치: 굴린 값 5개를 하나씩
  const vals = ABILITIES.map((k) => Number(p.abilities?.[k]) || 0).sort((a, b) => a - b);
  const rolls = [...(p.rolls ?? [])].sort((a, b) => a - b);
  add("abilities", rolls.length === ABILITY_ROLL_COUNT && vals.every((v, i) => v === rolls[i]));
  // 2 메인 클래스
  add("mainClass", !!p.mainClass);
  // 4 스킬 SL
  const level = p.level ?? 1;
  const skills = (p.skills ?? []).filter((s) => (s.sl ?? 0) > 0);
  const budget = skillBudget({ level, skills, bonus: p.bonus ?? 0 });
  add("budgetOver", budget.left >= 0, "error", `${budget.spent}/${budget.total}`);
  add("budgetLeft", budget.left <= 0, "warn", `${budget.left}`);
  const slOf = (name) => Math.max(0, ...skills.filter((s) => s.name === name).map((s) => s.sl));
  const over = skills.filter((s) => !s.unique && s.sl > levelCap(level)).map((s) => s.name);
  add("levelCap", !over.length, "error", over.join(", "));
  const noPre = skills.filter((s) => !prereqsMet(s.prereqs, slOf)).map((s) => s.name);
  add("prereq", !noPre.length, "error", noPre.join(", "));
  const subOnly = skills.filter((s) => p.subClass && s.classKey === p.subClass && s.classKey !== p.mainClass && !s.common);
  const subBad = subOnly.filter((s) => s.maxSL?.sub == null || s.sl > s.maxSL.sub).map((s) => s.name);
  add("subMax", !subBad.length, "error", subBad.join(", "));
  const foreign = skills.filter((s) => !s.common && ![p.mainClass, p.subClass].includes(s.classKey)).map((s) => s.name);
  add("foreignSkill", !foreign.length, "error", foreign.join(", "));
  // 5 커먼 스킬: 선택(사용자 결정, 07 #162). 배운다면 1개 SL1까지(작성 시점)
  const commons = skills.filter((s) => s.common);
  add("common", commons.length <= 1 && commons.every((c) => c.sl === 1), "error", commons.map((s) => `${s.name} ${s.sl}`).join(", "));
  // ★ 고유 스킬: 서브가 없으면 있어야, 있으면 없어야
  const hasUnique = skills.some((s) => s.unique);
  add("unique", p.subClass ? !hasUnique : hasUnique, p.subClass ? "error" : "warn");
  // 6 장비
  const badEquip = (p.equipped ?? []).filter((i) => !p.canEquip(i, p.classes ?? {}).ok).map((i) => i.name);
  add("equip", !badEquip.length, "error", badEquip.join(", "));
  add("carry", (p.carried ?? 0) <= (p.capacity ?? Infinity), "error", `${p.carried}/${p.capacity}`);
  add("money", (p.money ?? 0) >= 0);
  return out;
}

/** 오류(level error)가 하나도 없으면 완료 가능 */
export const creationReady = (checks) => checks.every((c) => c.ok || c.level !== "error");
