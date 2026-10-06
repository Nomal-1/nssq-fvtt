/**
 * 강화 효과·약화 효과 (01 §3.10). Foundry 비의존 순수 함수.
 * 저장 모양: { id, value, turns, param } — param은 속성(내성 부여 등)이나 추격 대상 문구
 *
 * 01 표 밖의 이름(07 #39, 사용자 결정)
 * - 『물리 방어 상승』·『물리 방어 저하』는 『방어 상승』·『방어 저하』와 같은 것(ALIASES로 바꿔 저장)
 * - 『공격 상승』·『물리 명중 상승』·『억제 공격 상승』·『내성 상승』·『내성 저하』는 원문 스킬·에너미에 나온다
 * - 『공격 저하』·『물리 명중 저하』·『억제 공격 저하』는 원문에 없다. 기능·대항은 넣되 custom(커스텀 스킬 전용):
 *   GM [상태] 창 목록에 나오지 않고, 효과 데이터(단계 6~)에서만 쓴다
 * 「완전 내성: ○」은 강화가 아니라 에너미의 상시 스킬(그 상태 이상을 받지 않음)이라 여기 없다.
 */
import { RESISTS } from "./derive.mjs";

export const IMBUE_ELEMENTS = ["fire", "ice", "volt"];
export const MAX_KINDS = 3;

/**
 * kind: buff/debuff, value: 수치가 있는가, stats: 더할 부능력치, counter: 대항 id,
 * param: "element"(속성 1개·여러 개·전체)·"imbue"(염·빙·뇌)·"text"(자유 문구), custom: 기본 룰에 없음
 */
const up = (stats, counter, extra = {}) => ({ kind: "buff", value: true, stats, counter, ...extra });
const down = (stats, counter, extra = {}) => ({ kind: "debuff", value: true, stats, counter, sign: -1, ...extra });
export const BUFFS = {
  // 강화
  elemImbue: { kind: "buff", value: false, param: "imbue" },
  resistGrant: { kind: "buff", value: false, param: "element", counter: "weaknessGrant" },
  resistUp: { kind: "buff", value: false, param: "element", counter: "resistDown" },
  atkUp: up(["physAtk", "elemAtk"], "atkDown"),
  physAtkUp: up(["physAtk"], "physAtkDown"),
  elemAtkUp: up(["elemAtk"], "elemAtkDown"),
  defenseUp: up(["defense"], "defenseDown"),
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
  atkDown: down(["physAtk", "elemAtk"], "atkUp", { custom: true }),
  physAtkDown: down(["physAtk"], "physAtkUp"),
  elemAtkDown: down(["elemAtk"], "elemAtkUp"),
  defenseDown: down(["defense"], "defenseUp"),
  speedDown: down(["speed"], "speedUp"),
  hitDown: down(["physHit", "elemHit"], "hitUp"),
  physHitDown: down(["physHit"], "physHitUp", { custom: true }),
  evasionDown: down(["evasion"], "evasionUp"),
  suppAtkDown: down(["suppAtk"], "suppAtkUp", { custom: true }),
  suppDefDown: down(["suppDef"], "suppDefUp"),
  resistDown: { kind: "debuff", value: false, param: "element", counter: "resistUp" },
  weaknessGrant: { kind: "debuff", value: false, param: "element", counter: "resistGrant" }
};
export const BUFF_IDS = Object.keys(BUFFS);

/** 원문의 다른 이름 → 같은 효과(07 #39) */
export const ALIASES = { physDefUp: "defenseUp", physDefDown: "defenseDown" };
export const canonicalBuff = (id) => ALIASES[id] ?? id;

/**
 * 속성 param: "fire" 한 개, "fire,ice,volt"(염빙뇌) 같은 여러 개, "all"(전체).
 * 여러 속성이어도 강화 1종류로 센다(07 #39). 내성 증감은 속성마다 ±1
 */
export function paramElements(param) {
  if (param === "all") return [...RESISTS];
  return String(param ?? "").split(",").map((x) => x.trim()).filter((x) => RESISTS.includes(x));
}

const keyOf = (b) => `${b.id}|${BUFFS[b.id]?.param ? b.param ?? "" : ""}`;

/** 같은 종류 둘 중 남길 것: 수치가 큰 쪽, 같으면 남은 턴이 긴 쪽(07 #36) */
function stronger(a, b) {
  const def = BUFFS[a.id];
  if (def.value && a.value !== b.value) return a.value > b.value ? a : b;
  return (a.turns ?? 0) >= (b.turns ?? 0) ? a : b;
}

/**
 * 효과를 비교하기 위한 모양: { 대상: 양 } (부능력치·내성은 부호 있는 수치, 그 밖은 1)
 * 예) 『공격 상승: 3』 → { physAtk: 3, elemAtk: 3 }, 『내성 상승: 전체』 → { "resist.slash": 1, … }
 */
function effectVector(b) {
  const def = BUFFS[b.id];
  const v = Number(b.value) || 0;
  const out = {};
  if (def.stats) for (const k of def.stats) out[k] = (def.sign ?? 1) * v;
  const delta = { resistGrant: 1, resistUp: 1, weaknessGrant: -1, resistDown: -1 }[b.id];
  if (delta) for (const el of paramElements(b.param)) out[`resist.${el}`] = delta;
  if (!def.stats && !delta) out[`${b.id}:${b.param ?? ""}`] = def.value ? v : 1;
  return out;
}

/** existing이 incoming의 하위 호환인가: existing이 바꾸는 모든 대상을 incoming도 같은 방향으로 같거나 더 크게 바꾼다 */
export function isInferior(existing, incoming) {
  const e = effectVector(existing);
  const n = effectVector(incoming);
  return Object.entries(e).every(([k, v]) => k in n && Math.sign(n[k]) === Math.sign(v) && Math.abs(n[k]) >= Math.abs(v));
}

/**
 * 강화·약화 부여. 목록 순서 = 걸린 순서(갱신된 것은 맨 뒤로)
 * - 대항 효과가 있으면 둘 다 소멸(countered)
 * - 같은 종류면 큰 효과 하나만(07 #36, 3종류가 차 있어도 같음)
 * - 같은 분류가 이미 3종류면(07 #7, 사용자 결정): 새 효과의 하위 호환인 것이 있으면 그것을,
 *   없으면 가장 먼저 걸린 것(갱신된 것은 갱신한 때 걸린 것으로 본다)을 지우고 새 효과를 건다(replaced)
 * @returns {{list: object[], result: "added"|"updated"|"ignored"|"countered"|"replaced", removed?: object}}
 */
export function addBuff(list, { id, value = 0, turns = 1, param = "" }) {
  id = canonicalBuff(id);
  const def = BUFFS[id];
  const cur = list ?? [];
  if (!def) return { list: [...cur], result: "ignored" };
  const entry = { id, value: def.value ? Number(value) || 0 : 0, turns: Math.max(1, Number(turns) || 1), param: def.param ? String(param ?? "") : "" };
  // 대항: 같은 param(있으면)의 반대 효과가 있으면 둘 다 소멸(속성이 정확히 같을 때만, 07 #41)
  if (def.counter) {
    const j = cur.findIndex((b) => b.id === def.counter && (!def.param || (b.param ?? "") === entry.param));
    if (j >= 0) return { list: cur.filter((_, k) => k !== j), result: "countered", removed: cur[j] };
  }
  const i = cur.findIndex((b) => keyOf(b) === keyOf(entry));
  if (i >= 0) {
    const keep = stronger(entry, cur[i]);
    if (keep === cur[i]) return { list: [...cur], result: "ignored" };
    return { list: [...cur.filter((_, k) => k !== i), entry], result: "updated" };
  }
  const same = cur.filter((b) => BUFFS[b.id]?.kind === def.kind);
  if (new Set(same.map(keyOf)).size < MAX_KINDS) return { list: [...cur, entry], result: "added" };
  const out = same.find((b) => isInferior(b, entry)) ?? same[0];
  return { list: [...cur.filter((b) => b !== out), entry], result: "replaced", removed: out };
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
  for (const raw of list ?? []) {
    const b = { ...raw, id: canonicalBuff(raw.id) };
    const def = BUFFS[b.id];
    if (!def) continue;
    const v = Number(b.value) || 0;
    for (const k of def.stats ?? []) add[k] = (add[k] ?? 0) + (def.sign ?? 1) * v;
    // 내성 부여·내성 상승 +1, 약점 부여·내성 저하 −1(내성 상승·저하는 원문에 수치가 없어 ±1, 07 #39). 지정 속성마다
    const delta = { resistGrant: 1, resistUp: 1, weaknessGrant: -1, resistDown: -1 }[b.id];
    if (delta) for (const el of paramElements(b.param)) resistAdd[el] = (resistAdd[el] ?? 0) + delta;
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
