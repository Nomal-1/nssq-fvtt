/**
 * 능력치 보너스·부능력치 계산 (01 §1.2). Foundry 비의존 순수 함수.
 * 장비·스킬·효과 보정은 이후 단계에서 mods로 합산한다.
 */

export const ABILITIES = ["str", "tec", "vit", "agi", "luc"];
export const RESISTS = ["slash", "strike", "pierce", "fire", "ice", "volt"];
export const SUB_STATS = ["physHit", "elemHit", "evasion", "physAtk", "elemAtk", "defense", "suppAtk", "suppDef", "speed"];

/** 능력치 출처: 굴림 · 클래스(보정×Lv) · 성장(경험점 10의 배수) · 장비 · 일시 */
export const ABILITY_SOURCES = ["base", "class", "growth", "equip", "temp"];

/**
 * 능력치를 출처별로 나눠 합계를 낸다.
 * 클래스 보정은 작성 시 1회 + 레벨업마다 1회이므로 보정 × Lv(세션 결과와 성장).
 * @param {object} p
 * @param {{[k]: {base, growth, temp}}} p.abilities 저장값
 * @param {{[k]: number}} [p.classBonus] 메인 클래스의 능력치 보정
 * @param {number} [p.level]
 * @param {{[k]: number}} [p.equip] 장비(장식·제련) 보정
 * @returns {{[k]: {base, class, growth, equip, temp, total}}}
 */
export function abilityBreakdown({ abilities, classBonus = {}, level = 1, equip = {} }) {
  const n = (v) => Number(v) || 0;
  return Object.fromEntries(ABILITIES.map((k) => {
    const a = abilities?.[k] ?? {};
    const parts = { base: n(a.base), class: n(classBonus[k]) * Math.max(1, n(level)), growth: n(a.growth), equip: n(equip[k]), temp: n(a.temp) };
    parts.total = parts.base + parts.class + parts.growth + parts.equip + parts.temp;
    return [k, parts];
  }));
}

/** 능력치 보너스 = floor(x / 5) */
export function bonus(value) {
  return Math.floor((Number(value) || 0) / 5);
}

/**
 * @param {object} p
 * @param {{str,tec,vit,agi,luc}} p.abilities 원값
 * @param {number} p.level
 * @param {object} [p.weapon] { physAtk, elemAtk } (계산된 값)
 * @param {object} [p.armor]  { defense }
 * @param {object} [p.mods]   부능력치별 추가 보정 { physHit: n, …, hpMax, tpMax, carry }
 */
export function deriveCharacter({ abilities, level, weapon = {}, armor = {}, mods = {} }) {
  const B = Object.fromEntries(ABILITIES.map((k) => [k, bonus(abilities?.[k])]));
  const lv = Number(level) || 0;
  const m = (k) => Number(mods[k]) || 0;
  const sub = {
    physHit: Math.floor((B.str + B.agi) / 2) + m("physHit"),
    elemHit: Math.floor((B.tec + B.luc) / 2) + m("elemHit"),
    evasion: Math.floor((B.agi + B.luc) / 2) + 5 + m("evasion"),
    physAtk: B.str + (Number(weapon.physAtk) || 0) + m("physAtk"),
    elemAtk: B.tec + (Number(weapon.elemAtk) || 0) + m("elemAtk"),
    defense: (Number(armor.defense) || 0) + m("defense"),
    suppAtk: Math.floor((B.tec + B.luc) / 2) + m("suppAtk"),
    suppDef: Math.floor((B.vit + B.luc) / 2) + m("suppDef"),
    // 【속도】가 음수가 되면 0 (FAQ 3)
    speed: Math.max(0, (Number(abilities?.agi) || 0) + m("speed"))
  };
  return {
    bonus: B,
    hpMax: B.vit * 2 + lv + 5 + m("hpMax"),
    tpMax: B.tec + lv + 3 + m("tpMax"),
    carry: B.str + B.vit + 3 + m("carry"),
    sub
  };
}
