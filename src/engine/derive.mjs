/**
 * 능력치 보너스·부능력치 계산 (01 §1.2). Foundry 비의존 순수 함수.
 * 장비·스킬·효과 보정은 이후 단계에서 mods로 합산한다.
 */

export const ABILITIES = ["str", "tec", "vit", "agi", "luc"];
export const RESISTS = ["slash", "strike", "pierce", "fire", "ice", "volt"];
export const SUB_STATS = ["physHit", "elemHit", "evasion", "physAtk", "elemAtk", "defense", "suppAtk", "suppDef", "speed"];

/**
 * 능력치 출처: 굴림 · 클래스(보정×Lv) · 성장(경험점 10의 배수) · GM 보너스 · 장비.
 * 룰에서 능력치를 바꾸는 것은 장비(장식·제련)뿐이고 강화·약화 효과는 부능력치를 바꾸므로 「일시」 출처는 없다.
 * v0.6.0까지 저장된 temp 값은 GM 보너스에 합산한다.
 */
export const ABILITY_SOURCES = ["base", "class", "growth", "bonus", "equip"];

/**
 * 능력치를 출처별로 나눠 합계를 낸다.
 * 클래스 보정은 작성 시 1회 + 레벨업마다 1회이므로 보정 × Lv(세션 결과와 성장).
 * @param {object} p
 * @param {{[k]: {base, growth, bonus, temp?}}} p.abilities 저장값(temp는 v0.6.0 이전 값, bonus에 합산)
 * @param {{[k]: number}} [p.classBonus] 메인 클래스의 능력치 보정
 * @param {number} [p.level]
 * @param {{[k]: number}} [p.equip] 장비(장식·제련) 보정
 * @returns {{[k]: {base, class, growth, bonus, equip, total}}}
 */
export function abilityBreakdown({ abilities, classBonus = {}, level = 1, equip = {} }) {
  const n = (v) => Number(v) || 0;
  return Object.fromEntries(ABILITIES.map((k) => {
    const a = abilities?.[k] ?? {};
    const parts = { base: n(a.base), class: n(classBonus[k]) * Math.max(1, n(level)), growth: n(a.growth), bonus: n(a.bonus) + n(a.temp), equip: n(equip[k]) };
    parts.total = parts.base + parts.class + parts.growth + parts.bonus + parts.equip;
    return [k, parts];
  }));
}

/**
 * 부능력치 계산 내역(시트의 마우스 내역용). 값은 deriveCharacter와 같다.
 * @returns {{[k]: {formula: string, parts: {label: string, value: number}[], total: number}}}
 *   label은 표시용 키: "str"…(능력치 B), "agi:raw"(【AGI】 원값), "weapon", "armor", "mods", "base5"
 */
export function subStatBreakdown({ abilities, level, weapon = {}, armor = {}, mods = {} }) {
  const d = deriveCharacter({ abilities, level, weapon, armor, mods });
  const B = d.bonus;
  const m = (k) => Number(mods[k]) || 0;
  const half = (a, b) => ({ formula: `(${a}B + ${b}B) ÷ 2`, parts: [{ label: a, value: B[a] }, { label: b, value: B[b] }] });
  const rows = {
    physHit: half("str", "agi"),
    elemHit: half("tec", "luc"),
    evasion: { ...half("agi", "luc"), formula: "(agiB + lucB) ÷ 2 + 5", parts: [{ label: "agi", value: B.agi }, { label: "luc", value: B.luc }, { label: "base5", value: 5 }] },
    physAtk: { formula: "strB + weapon", parts: [{ label: "str", value: B.str }, { label: "weapon", value: Number(weapon.physAtk) || 0 }] },
    elemAtk: { formula: "tecB + weapon", parts: [{ label: "tec", value: B.tec }, { label: "weapon", value: Number(weapon.elemAtk) || 0 }] },
    defense: { formula: "armor", parts: [{ label: "armor", value: Number(armor.defense) || 0 }] },
    suppAtk: half("tec", "luc"),
    suppDef: half("vit", "luc"),
    speed: { formula: "agi", parts: [{ label: "agi:raw", value: Number(abilities?.agi) || 0 }] }
  };
  for (const [k, r] of Object.entries(rows)) {
    if (m(k)) r.parts.push({ label: "mods", value: m(k) });
    r.total = d.sub[k];
  }
  return rows;
}

/**
 * 능력치 성장: 누적 경험점이 10의 배수에 도달할 때마다 1회. 이미 올린 성장(합계)보다 많으면 굴릴 수 있다.
 * @returns {{earned: number, used: number, left: number}}
 */
export function growthAvailable({ exp = 0, abilities = {} }) {
  const earned = Math.floor((Number(exp) || 0) / 10);
  const used = ABILITIES.reduce((n, k) => n + (Number(abilities?.[k]?.growth) || 0), 0);
  return { earned, used, left: Math.max(0, earned - used) };
}

/** 성장 1D6 → 능력치(6은 고르기) */
export function growthAbility(die) {
  return [null, "str", "tec", "vit", "agi", "luc", null][die] ?? null;
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
