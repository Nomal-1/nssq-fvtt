/**
 * 전투에 쓰는 값을 액터 종류와 관계없이 한 모양으로 모은다.
 */
import { RESISTS } from "../engine/derive.mjs";

/** 진영: 에너미 → enemy, 「동료 NPC」 캐릭터 → ally, 그 밖의 캐릭터 → pc */
export function sideOf(actor) {
  if (!actor) return "enemy";
  if (actor.type === "enemy") return "enemy";
  if (actor.type === "character" && actor.system.npc) return "ally";
  if (actor.type === "token") return "ally";
  return "pc";
}

/** 같은 편인가(PC와 동료 NPC는 같은 편) */
export const friendly = (a, b) => (sideOf(a) === "enemy") === (sideOf(b) === "enemy");

/**
 * @param {Actor} actor
 * @param {Combatant} [combatant] 방어 전념 등 전투 중 상태
 */
export function combatProfile(actor, combatant = null) {
  const s = actor.system;
  const guarding = !!combatant?.getFlag("nssq", "guarding");
  const base = {
    actor, side: sideOf(actor), name: combatant?.name ?? actor.name,
    row: s.row ?? "front",
    hp: s.hp?.value ?? 0, hpMax: s.hp?.max ?? 0,
    guarding,
    ko: (s.hp?.value ?? 0) <= 0
  };
  if (actor.type === "character") {
    const w = s.equipment?.weapon;
    const elements = [w?.element, w?.imbue].filter(Boolean);
    return {
      ...base,
      speed: s.sub.speed,
      physHit: s.sub.physHit, elemHit: s.sub.elemHit, evasion: s.sub.evasion,
      physAtk: s.sub.physAtk, elemAtk: s.sub.elemAtk, defense: s.sub.defense,
      suppAtk: s.sub.suppAtk, suppDef: s.sub.suppDef,
      resist: s.resistTotal ?? s.resist,
      elements: elements.length ? elements : ["strike"],
      weaponName: w?.item?.name ?? (w?.unarmed ? game.i18n.format("NSSQ.Combat.unarmed", { type: w.weaponType }) : ""),
      range: w?.range ?? "근"
    };
  }
  if (actor.type === "enemy") {
    const st = s.stats;
    return {
      ...base,
      speed: Math.max(0, st.speed),
      physHit: st.physHit, elemHit: st.elemHit, evasion: st.evasion,
      physAtk: st.physAtk, elemAtk: st.elemAtk, defense: st.defense,
      suppAtk: st.suppAtk, suppDef: st.suppDef,
      resist: Object.fromEntries(RESISTS.map((k) => [k, s.resist[k]])),
      elements: s.attackElements?.length ? s.attackElements : ["none"],
      weaponName: "",
      // 에너미 통상 공격의 사거리는 데이터에 없다(07 #25)
      range: "근"
    };
  }
  // 토큰: 공격은 단계 8
  return { ...base, speed: 0, physHit: 0, elemHit: 0, evasion: 0, physAtk: 0, elemAtk: 0, defense: 0, suppAtk: 0, suppDef: 0, resist: {}, elements: ["none"], range: "-" };
}
