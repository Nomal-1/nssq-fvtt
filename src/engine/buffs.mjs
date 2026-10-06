/**
 * 강화 효과·약화 효과 (01 §3.10). Foundry 비의존 순수 함수.
 * 저장 모양: { id, value, turns, param } — param은 속성(내성 부여 등)이나 추격 대상 문구
 *
 * 01 표 밖의 이름(공격 상승·물리 명중 상승·물리 방어 상승·억제 공격 상승·내성 상승·완전 내성)은
 * 07 #11대로 '상승'=강화, '저하'=약화, 대항은 같은 수치의 상승↔저하. 완전 내성은 강화·대항 없음.
 */
import { RESISTS } from "./derive.mjs";

export const IMBUE_ELEMENTS = ["fire", "ice", "volt"];
export const MAX_KINDS = 3;

/**
 * kind: buff/debuff, value: 수치가 있는가, stats: 더할 부능력치, counter: 대항 id,
 * param: "element"(내성 6종)·"imbue"(염·빙·뇌)·"text"(자유 문구)
 */
const up = (stats, counter) => ({ kind: "buff", value: true, stats, counter });
const down = (stats, counter) => ({ kind: "debuff", value: true, stats, counter, sign: -1 });
export const BUFFS = {
  // 강화
  elemImbue: { kind: "buff", value: false, param: "imbue" },
  resistGrant: { kind: "buff", value: false, param: "element", counter: "weaknessGrant" },
  resistUp: { kind: "buff", value: true, param: "element", counter: "resistDown" },
  fullResist: { kind: "buff", value: false, param: "element" },
  atkUp: up(["physAtk", "elemAtk"], "atkDown"),
  physAtkUp: up(["physAtk"], "physAtkDown"),
  elemAtkUp: up(["elemAtk"], "elemAtkDown"),
  defenseUp: up(["defense"], "defenseDown"),
  physDefUp: up(["defense"], "physDefDown"),
  speedUp: up(["speed"], "speedDown"),
  hitUp: up(["physHit", "elemHit"], "hitDown"),
  physHitUp: up(["physHit"], "physHitDown"),
  evasionUp: up(["evasion"], "evasionDown"),
  suppAtkUp: up(["suppAtk"], "suppAtkDown"),
  suppDefUp: up(["suppDef"], "suppDefDown"),
  hpMaxUp: up(["hpMax"], null),
  hpRegen: { kind: "buff", value: true },
  tpRegen: { kind: "buff", value: true },
  chase: { kind: "buff", value: false, param: "text" },
  critUp: { kind: "buff", value: false },
  // 약화
  atkDown: down(["physAtk", "elemAtk"], "atkUp"),
  physAtkDown: down(["physAtk"], "physAtkUp"),
  elemAtkDown: down(["elemAtk"], "elemAtkUp"),
  defenseDown: down(["defense"], "defenseUp"),
  physDefDown: down(["defense"], "physDefUp"),
  speedDown: down(["speed"], "speedUp"),
  hitDown: down(["physHit", "elemHit"], "hitUp"),
  physHitDown: down(["physHit"], "physHitUp"),
  evasionDown: down(["evasion"], "evasionUp"),
  suppAtkDown: down(["suppAtk"], "suppAtkUp"),
  suppDefDown: down(["suppDef"], "suppDefUp"),
  resistDown: { kind: "debuff", value: true, param: "element", counter: "resistUp" },
  weaknessGrant: { kind: "debuff", value: false, param: "element", counter: "resistGrant" }
};
export const BUFF_IDS = Object.keys(BUFFS);

const keyOf = (b) => `${b.id}|${BUFFS[b.id]?.param ? b.param ?? "" : ""}`;

/** 같은 종류 둘 중 남길 것: 수치가 큰 쪽, 같으면 남은 턴이 긴 쪽(07 #36) */
function stronger(a, b) {
  const def = BUFFS[a.id];
  if (def.value && a.value !== b.value) return a.value > b.value ? a : b;
  return (a.turns ?? 0) >= (b.turns ?? 0) ? a : b;
}

/**
 * 강화·약화 부여
 * @returns {{list: object[], result: "added"|"updated"|"ignored"|"countered"|"rejected", removed?: object}}
 *  - countered: 대항 효과와 함께 둘 다 소멸 / rejected: 같은 분류 4종류째(07 #7)
 */
export function addBuff(list, { id, value = 0, turns = 1, param = "" }) {
  const def = BUFFS[id];
  const cur = list ?? [];
  if (!def) return { list: [...cur], result: "ignored" };
  const entry = { id, value: def.value ? Number(value) || 0 : 0, turns: Math.max(1, Number(turns) || 1), param: def.param ? String(param ?? "") : "" };
  // 대항: 같은 param(있으면)의 반대 효과가 있으면 둘 다 소멸
  if (def.counter) {
    const j = cur.findIndex((b) => b.id === def.counter && (!def.param || (b.param ?? "") === entry.param));
    if (j >= 0) return { list: cur.filter((_, k) => k !== j), result: "countered", removed: cur[j] };
  }
  const i = cur.findIndex((b) => keyOf(b) === keyOf(entry));
  if (i >= 0) {
    const keep = stronger(entry, cur[i]);
    if (keep === cur[i]) return { list: [...cur], result: "ignored" };
    return { list: cur.map((b, k) => (k === i ? entry : b)), result: "updated" };
  }
  const kinds = new Set(cur.filter((b) => BUFFS[b.id]?.kind === def.kind).map(keyOf));
  if (kinds.size >= MAX_KINDS) return { list: [...cur], result: "rejected" };
  return { list: [...cur, entry], result: "added" };
}

export const removeBuff = (list, index) => (list ?? []).filter((_, i) => i !== index);

/**
 * 강화·약화에 의한 보정
 * @returns {{add: object, resistAdd: object, resistSet: object, elements: string[], critUp: boolean, regen: {hp: number, tp: number}}}
 */
export function buffMods(list) {
  const add = {};
  const resistAdd = {};
  const resistSet = {};
  const elements = [];
  const regen = { hp: 0, tp: 0 };
  let critUp = false;
  for (const b of list ?? []) {
    const def = BUFFS[b.id];
    if (!def) continue;
    const v = Number(b.value) || 0;
    for (const k of def.stats ?? []) add[k] = (add[k] ?? 0) + (def.sign ?? 1) * v;
    const el = RESISTS.includes(b.param) ? b.param : null;
    if (b.id === "resistGrant" && el) resistAdd[el] = (resistAdd[el] ?? 0) + 1;
    if (b.id === "weaknessGrant" && el) resistAdd[el] = (resistAdd[el] ?? 0) - 1;
    if (b.id === "resistUp" && el) resistAdd[el] = (resistAdd[el] ?? 0) + v;
    if (b.id === "resistDown" && el) resistAdd[el] = (resistAdd[el] ?? 0) - v;
    // 완전 내성: 내성 6(모든 눈이 막힌다, 07 #39)
    if (b.id === "fullResist" && el) resistSet[el] = 6;
    if (b.id === "elemImbue" && IMBUE_ELEMENTS.includes(b.param) && !elements.includes(b.param)) elements.push(b.param);
    if (b.id === "critUp") critUp = true;
    if (b.id === "hpRegen") regen.hp += v;
    if (b.id === "tpRegen") regen.tp += v;
  }
  return { add, resistAdd, resistSet, elements, critUp, regen };
}

/** 종료 페이즈: 남은 턴 −1, 0이면 소멸 → { list, expired } */
export function tickBuffs(list) {
  const next = [];
  const expired = [];
  for (const b of list ?? []) {
    const t = (Number(b.turns) || 0) - 1;
    if (t > 0) next.push({ ...b, turns: t });
    else expired.push(b);
  }
  return { list: next, expired };
}

/**
 * 부능력치·내성에 상태·강화 보정을 한 번에 적용한다.
 * 순서: 더하기 → 0 고정([석화]·[다리] 봉인 등의 【회피】 0) → 【속도】 음수면 0. 내성은 더하기 → 설정값
 * @param {{sub: object, resist: object, hpMax?: number}} base
 * @param {object[]} parts conditionMods·buffMods 결과들
 */
export function applyMods({ sub, resist, hpMax = 0 }, parts) {
  const s = { ...sub };
  const r = { ...resist };
  let hp = hpMax;
  const zero = new Set();
  for (const p of parts) {
    for (const [k, v] of Object.entries(p.add ?? {})) {
      if (k === "hpMax") hp += v;
      else if (k in s) s[k] += v;
    }
    for (const [k, v] of Object.entries(p.resistAdd ?? {})) r[k] = (r[k] ?? 0) + v;
    for (const k of p.zero ?? []) zero.add(k);
  }
  for (const p of parts) for (const [k, v] of Object.entries(p.resistSet ?? {})) r[k] = v;
  for (const k of zero) if (k in s) s[k] = 0;
  if ("speed" in s) s.speed = Math.max(0, s.speed);
  return { sub: s, resist: r, hpMax: Math.max(1, hp) };
}
