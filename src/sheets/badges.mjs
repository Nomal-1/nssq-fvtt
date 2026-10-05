/**
 * 제련 배지: 효과 데이터(engine refinementBadge)를 아이콘·짧은 글로 바꾼다.
 */
import { MAX_REFINEMENTS, refinementBadge } from "../engine/equipment.mjs";
import tables from "../generated/tables.mjs";

const ELEMENT_ICON = { fire: "fa-fire", ice: "fa-snowflake", volt: "fa-bolt", slash: "fa-cut", strike: "fa-hammer", pierce: "fa-location-arrow" };
const SUB_ICON = {
  physHit: "fa-crosshairs", elemHit: "fa-crosshairs", physAtk: "fa-fist-raised", elemAtk: "fa-magic",
  defense: "fa-shield-alt", evasion: "fa-running", speed: "fa-wind", hpMax: "fa-heart", tpMax: "fa-star"
};
const ABILITY_SHORT = { str: "STR", tec: "TEC", vit: "VIT", agi: "AGI", luc: "LUC" };
const sign = (v) => (v === null || v === undefined ? "" : v > 0 ? `+${v}` : `${v}`);

/** 제련 하나 → { icon, text, title, cls } */
export function badgeFor(refinement) {
  const b = refinementBadge(refinement);
  const el = (k) => game.i18n.localize(`NSSQ.Resist.${k}`);
  switch (b.kind) {
    case "imbue":
      return { icon: ELEMENT_ICON[b.key] ?? "fa-magic", text: el(b.key), cls: `imbue ${b.key}`, title: refinement.name };
    case "resist":
      return { icon: ELEMENT_ICON[b.key] ?? "fa-shield-alt", text: `${el(b.key)}${game.i18n.localize("NSSQ.Badge.resist")}${sign(b.value)}`, cls: `resist ${b.key}`, title: refinement.name };
    case "ability":
      return { icon: "fa-arrow-up", text: `${ABILITY_SHORT[b.key] ?? b.key}${sign(b.value)}`, cls: "ability", title: refinement.name };
    case "sub":
      return { icon: SUB_ICON[b.key] ?? "fa-plus", text: `${game.i18n.localize(`NSSQ.Inventory.${b.key}`)}${sign(b.value)}`, cls: "sub", title: refinement.name };
    default:
      return { icon: "fa-question", text: refinement.name, cls: "other", title: refinement.name };
  }
}

/** 무기·방어구의 제련 배지와 남은 빈칸(○) */
export function refinementBadges(item) {
  if (item.type !== "weapon" && item.type !== "armor") return null;
  const refs = (item.system.refinements ?? []).map((k) => tables.refinements.find((r) => r.key === k)).filter(Boolean);
  return {
    badges: refs.map(badgeFor),
    empty: Array.from({ length: Math.max(0, MAX_REFINEMENTS - refs.length) }, (_, i) => i)
  };
}
