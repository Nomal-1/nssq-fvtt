/**
 * 장비·인벤토리·쇼핑·제련 (01 §7). Foundry 비의존.
 * 아이템은 { type, system } 형태의 평범한 객체로 받는다(Foundry Item도 그대로 넘길 수 있다).
 */
import { evaluate } from "./expr.mjs";

export const SLOTS = ["weapon", "armor", "other"];
export const SHIELD = "방패";
export const MAX_RANK = 15;
export const MAX_REFINEMENTS = 2;
const PHYSICAL_TYPES = ["weapon", "armor", "accessory", "consumable", "tool", "material"];

const ev = (f, vars) => evaluate(f ?? 0, vars);

/* ---------------- 성능 ---------------- */

/**
 * 무기 성능. 주먹은 R 대신 Lv. 《주먹 마스터리》가 있으면 대체 식(physAtkAlt).
 * @param {object} table 무기 종류 표 행 (generated/tables.mjs)
 */
export function weaponStats(table, { rank = 1, level = 1, hasAltSkill = false } = {}) {
  const vars = { R: rank, LV: level };
  const physAtk = hasAltSkill && table.physAtkAlt ? table.physAtkAlt.formula : table.physAtk;
  return {
    physHit: ev(table.physHit, vars),
    elemHit: ev(table.elemHit, vars),
    physAtk: ev(physAtk, vars),
    elemAtk: ev(table.elemAtk, vars),
    speed: ev(table.speed, vars),
    price: ev(table.price, vars),
    category: table.category,
    range: table.range
  };
}

export function armorStats(table, { rank = 1 } = {}) {
  const vars = { R: rank };
  return {
    defense: ev(table.defense, vars),
    evasion: ev(table.evasion, vars),
    speed: ev(table.speed, vars),
    price: ev(table.price, vars)
  };
}

/* ---------------- 슬롯·장비 가능 ---------------- */

/** 아이템이 들어갈 수 있는 슬롯. 무기는 무기·기타(서브웨펀), 방패·장식은 기타, 갑옷은 갑옷 */
export function slotsFor(item) {
  switch (item.type) {
    case "weapon": return ["weapon", "other"];
    case "armor": return item.system.armorType === SHIELD ? ["other"] : ["armor"];
    case "accessory": return ["other"];
    default: return [];
  }
}

/**
 * 장비 가능 판정 (01 §7): 무기·방패는 메인 또는 서브 클래스, 갑옷은 메인 클래스.
 * @param {object} item
 * @param {{main: {weapons, armors}|null, sub: {weapons, armors}|null}} classes 클래스 아이템의 system
 * @returns {{ok: boolean, reason?: string}}
 */
export function canEquip(item, { main, sub }) {
  if (!slotsFor(item).length) return { ok: false, reason: "notEquippable" };
  if (item.type === "accessory") return { ok: true };
  if (!main) return { ok: false, reason: "noClass" };
  const both = [main, sub].filter(Boolean);
  if (item.type === "weapon") {
    return both.some((c) => c.weapons?.includes(item.system.weaponType)) ? { ok: true } : { ok: false, reason: "weaponNotAllowed" };
  }
  if (item.system.armorType === SHIELD) {
    return both.some((c) => c.armors?.includes(SHIELD)) ? { ok: true } : { ok: false, reason: "shieldNotAllowed" };
  }
  return main.armors?.includes(item.system.armorType) ? { ok: true } : { ok: false, reason: "armorNotAllowed" };
}

/**
 * 장비할 때 비워야 할 아이템: 같은 슬롯에 이미 있는 것
 * @param {object[]} items 캐릭터의 모든 아이템(id, type, system.equipped, system.slot)
 */
export function slotOccupant(items, slot) {
  return items.find((i) => i.system?.equipped && equippedSlot(i) === slot) ?? null;
}

/** 장비 중인 아이템의 슬롯 */
export function equippedSlot(item) {
  if (!item.system?.equipped) return null;
  if (item.type === "weapon") return item.system.slot === "other" ? "other" : "weapon";
  return slotsFor(item)[0] ?? null;
}

/* ---------------- 소지 수 ---------------- */

const flagOf = (item, flag) => (item.system?.effects ?? []).find((e) => e.type === "flag" && e.flag === flag)?.value;

/** 소지 수: 장비 중이 아닌 물건의 수량 합. 『백팩』처럼 noCarryCount 플래그가 있으면 세지 않는다 */
export function carriedCount(items) {
  return items
    .filter((i) => PHYSICAL_TYPES.includes(i.type) && !i.system?.equipped && !flagOf(i, "noCarryCount"))
    .reduce((n, i) => n + Math.max(0, i.system?.quantity ?? 1), 0);
}

/** ownLimit 플래그(백팩 1개)를 넘는지 */
export function exceedsOwnLimit(items, candidate) {
  const limit = flagOf(candidate, "ownLimit");
  if (!limit) return false;
  const owned = items.filter((i) => i.system?.key && i.system.key === candidate.system?.key)
    .reduce((n, i) => n + (i.system?.quantity ?? 1), 0);
  return owned + (candidate.system?.quantity ?? 1) > limit;
}

/* ---------------- 가격 ---------------- */

/** 구입 가격. 무기·방어구는 종류 표의 R식, 그 외는 아이템 가격 */
export function buyPrice(item, tables, { level = 1 } = {}) {
  if (item.type === "weapon") return weaponStats(tables.weapons[item.system.weaponType] ?? {}, { rank: item.system.rank, level }).price;
  if (item.type === "armor") return armorStats(tables.armors[item.system.armorType] ?? {}, { rank: item.system.rank }).price;
  if (item.type === "material") return 0;
  return Number(item.system?.price) || 0;
}

/** 매각 가격: 구입 가격의 50%(버림). 소재는 (R의 제곱)×50G. 제련비는 포함하지 않는다(07 #22) */
export function sellPrice(item, tables, opts = {}) {
  if (item.type === "material") return (item.system.rank ** 2) * 50;
  return Math.floor(buyPrice(item, tables, opts) / 2);
}

/* ---------------- 소재 ---------------- */

/** 무기·방어구 구입·제련에 쓸 수 있는 소재: 대응 소재 종류이고 R이 장비 R 이상 */
export function equipmentMaterialCandidates(items, table, rank) {
  const types = table?.materials ?? [];
  return items.filter((i) => i.type === "material" && types.includes(i.system.materialType) && i.system.rank >= rank && (i.system.quantity ?? 1) > 0);
}

/** 아이템(소모품) 구입에 필요한 소재 [{type, rank}] 각각에 맞는 후보: 같은 종류, R 이상(07 #23) */
export function itemMaterialCandidates(items, requirement) {
  return items.filter((i) => i.type === "material" && i.system.materialType === requirement.type && i.system.rank >= requirement.rank && (i.system.quantity ?? 1) > 0);
}

/* ---------------- 제련 ---------------- */

/**
 * 제련 가능 여부: 무기·방어구, 2개까지, 같은 효과 중복 금지, 종류(무기/방어구)가 맞을 것
 * @param {object} item 무기·방어구
 * @param {{key, kinds}} refinement
 */
export function canRefine(item, refinement) {
  if (item.type !== "weapon" && item.type !== "armor") return { ok: false, reason: "notRefinable" };
  const current = item.system.refinements ?? [];
  if (current.length >= MAX_REFINEMENTS) return { ok: false, reason: "refineFull" };
  if (current.includes(refinement.key)) return { ok: false, reason: "refineDuplicate" };
  if (!refinement.kinds.includes(item.type)) return { ok: false, reason: "refineKind" };
  return { ok: true };
}

export function refinePrice(refinement, rank) {
  return evaluate(refinement.price, { R: rank });
}

/* ---------------- 보정 합산 ---------------- */

/**
 * 장비에서 나오는 보정을 모은다.
 * - 무기 슬롯의 무기: 명중·공격·속도, 제련
 * - 갑옷 슬롯의 갑옷, 기타 슬롯의 방패: 방어·회피·속도, 제련
 * - 기타 슬롯의 장식: 효과
 * - 기타 슬롯의 서브웨펀: 교체용이라 성능·제련을 더하지 않는다(07 #21)
 * - 소지만 해도 되는 기타 아이템(백팩 등)의 modifier
 * @returns {{ weapon: object|null, armorDefense: number, mods: Record<string, number>, flags: Record<string, any>, sources: object[] }}
 */
export function collectEquipment(items, tables, { level = 1, skillNames = [] } = {}) {
  const mods = {};
  const flags = {};
  const add = (path, v) => { mods[path] = (mods[path] ?? 0) + v; };
  const applyEffects = (effects, vars) => {
    for (const e of effects ?? []) {
      if (e.type === "modifier") add(e.path, evaluate(e.value, vars));
      else if (e.type === "flag") flags[e.flag] = e.value;
    }
  };
  const refinementsOf = (item) => (item.system.refinements ?? [])
    .map((k) => tables.refinements.find((r) => r.key === k)).filter(Boolean);

  let weapon = null;
  let armorDefense = 0;
  for (const item of items) {
    const slot = equippedSlot(item);
    if (item.type === "tool" && !item.system?.equipped) applyEffects(item.system.effects, {});
    if (!slot) continue;
    if (item.type === "weapon" && slot === "weapon") {
      const table = tables.weapons[item.system.weaponType];
      if (!table) continue;
      const altSkill = table.physAtkAlt?.requires;
      const s = weaponStats(table, { rank: item.system.rank, level, hasAltSkill: !!altSkill && skillNames.includes(altSkill) });
      weapon = { ...s, item, element: item.system.element || table.element };
      add("physHit", s.physHit);
      add("elemHit", s.elemHit);
      add("speed", s.speed);
      for (const r of refinementsOf(item)) applyEffects(r.effects, { R: item.system.rank });
    } else if (item.type === "armor") {
      const s = armorStats(tables.armors[item.system.armorType] ?? {}, { rank: item.system.rank });
      armorDefense += s.defense;
      add("evasion", s.evasion);
      add("speed", s.speed);
      for (const r of refinementsOf(item)) applyEffects(r.effects, { R: item.system.rank });
    } else if (item.type === "accessory") {
      applyEffects(item.system.effects, {});
    }
  }
  // 제련 속성 부여: 기본 속성과의 관계(교체/복합)는 전투 단계에서 정한다(07 #24)
  if (weapon && flags.weaponElement) weapon.imbue = flags.weaponElement;
  return { weapon, armorDefense, mods, flags };
}
