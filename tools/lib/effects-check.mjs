// 효과 데이터(effects) 검사 (03, 단계 7). data/*.json 의 effects가 스키마·엔진과 맞는지 확인하고 review 상태를 센다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "../../src/engine/expr.mjs";
import { unknownWhenKeys } from "../../src/engine/effects/when.mjs";
import { BUFFS, canonicalBuff } from "../../src/engine/buffs.mjs";
import { CONDITIONS } from "../../src/engine/conditions.mjs";
import { ABILITIES, RESISTS } from "../../src/engine/derive.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** 엔진이 받는 type과 필드(필수: true) */
export const TYPES = {
  attack: { kind: false, element: false, addElement: false, failAtOrBelow: false, copyElement: false, randomFrom: false, times: false, hitMod: false, diceMod: false, atkMod: false, atkMultiplier: false, random: false, uniqueTarget: false, onHit: false, bonuses: false, halfDamage: false, fixedDice: false, ignoreBuffs: false, addTurnElements: false },
  heal: { mode: false, bonus: false, amount: false, resource: false, revive: false },
  inflict: { condition: true, check: false, depth: false, choose: false, randomPick: false, selfSame: false },
  command: { mode: true },
  spreadAilment: { from: false, count: false, check: false },
  emitImbue: { kind: false },
  requireSelf: { when: true },
  multiUse: { category: true, count: false },
  grantLateAction: {},
  redirectAlly: {},
  anytime: { action: true, skillKey: false },
  dualWield: { weapons: true, hitMod: false, atkMod: false },
  dualSkill: { category: false, hitMod: false },
  wideEvade: {},
  guardLateAttack: {},
  timePenalty: { time: true, value: true },
  dropAdjust: { range: true },
  dropDoubleUp: {},
  dropExtra: { count: true, choices: true },
  gatherAdjust: { range: true },
  gatherDoubleUp: {},
  gatherDoubleExtra: {},
  gatherExtra: { count: true, choices: true },
  preemptBlock: {},
  escapeDungeon: {},
  checkBonus: { kinds: true, value: true, ability: false },
  checkAssist: { value: true },
  checkFlip: {},
  checkExtraDie: {},
  rerollBonus: { value: true },
  forceRow: { row: false, check: false },
  cure: { conditions: false, kind: false, count: false, buffs: false },
  buff: { id: true, value: false, turns: false, param: false },
  debuff: { id: true, value: false, turns: false, param: false },
  modifier: { path: true, value: true },
  resource: { resource: true, delta: false, set: false },
  stance: { effects: true, until: false, count: false, holder: false, wait: false },
  trigger: { on: true, effects: true, limit: false, optional: false },
  counter: { attack: true, on: false, count: false, onlyIfEvaded: false, evenIfKO: false, optional: false },
  chase: { attack: true, on: false, count: false, optional: false },
  delayed: { at: true, turns: false, effects: true },
  token: { tokenKey: true, action: false, maxCount: false, turns: false },
  overheat: { turns: true },
  overheatReduce: { turns: true },
  state: { id: true, label: true, group: false, mods: false, max: false, note: false, perAttack: false },
  requireState: { state: true },
  flag: { flag: true, value: false },
  custom: { handler: true },
  activeEvade: { ability: true, bonus: false, vs: false },
  nullify: { scope: false },
  actionTiming: { value: true },
  extraAction: { count: false },
  revenge: {},
  lateRepeat: { diceMod: false },
  requireAllies: { name: true, count: false, sameRow: false },
  focus: {},
  repeat: { scope: false, cost: false },
  rallyChase: { count: false, weapons: false },
  tokenRemove: { category: false },
  attackBonus: { hitMod: false, diceMod: false, atkMod: false, critDice: false, critUp: false, resistMod: false, addElement: false, resistLow: false },
  scopeChange: { category: false, fromSide: false, fromScope: false, scope: true, side: false },
  hostileHitFail: { value: true },
  kill: { check: true },
  immune: { condition: true },
  useBonus: { buffTurns: false, debuffTurns: false, healHp: false },
  drain: { resource: false, mode: false },
  recoil: { mode: false, to: false },
  healFromDamage: {},
  nextTurn: { effects: true },
  target: { side: true, scope: true, count: false, excludeSelf: false, row: false },
  guard: { mode: true, scope: false, optional: false },
  aura: { path: true, value: true, scope: false },
  provoke: { count: false, to: false }
};
const COMMON = ["type", "when", "chance", "label", "variant", "toSelf", "whenNote", "always"];

/** modifier path: derive가 읽는 키 */
export const MOD_PATHS = new Set([
  "physAtk", "elemAtk", "physHit", "elemHit", "defense", "evasion", "speed", "suppAtk", "suppDef", "hpMax", "tpMax", "carry", "healDice", "guardCount", "itemHeal", "overheatTurns", "tokenHit", "campHeal", "tokenTurns",
  ...ABILITIES.map((k) => `abilities.${k}`), ...RESISTS.map((k) => `resist.${k}`)
]);
const MOD_PREFIX = ["checks.", "gather.", "condResist."];
const NESTED = ["onHit", "effects"];
const EXPR_FIELDS = ["debuffTurns", "healHp", "buffTurns", "critDice", "times", "hitMod", "diceMod", "atkMod", "atkMultiplier", "bonus", "amount", "value", "turns", "delta", "set", "count", "depth", "max", "maxCount"];

function checkExpr(v, where, errors) {
  if (v === undefined || v === null || typeof v === "number" || typeof v === "boolean") return;
  if (typeof v !== "string") return errors.push(`${where}: 수식이 문자열·숫자가 아니다`);
  try { parse(v); } catch (e) { errors.push(`${where}: ${e.message}`); }
}

/** effects 배열 하나 검사 */
export function checkEffects(list, where, errors = []) {
  if (!Array.isArray(list)) { errors.push(`${where}: effects가 배열이 아니다`); return errors; }
  list.forEach((e, i) => {
    const at = `${where}[${i}]`;
    const spec = TYPES[e?.type];
    if (!spec) return errors.push(`${at}: 모르는 type \`${e?.type}\``);
    for (const [k, req] of Object.entries(spec)) if (req && e[k] === undefined) errors.push(`${at}: ${e.type}에 ${k}가 없다`);
    for (const k of Object.keys(e)) if (!(k in spec) && !COMMON.includes(k)) errors.push(`${at}: ${e.type}에 모르는 필드 ${k}`);
    const bad = unknownWhenKeys(e.when);
    if (bad.length) errors.push(`${at}: 모르는 when 키 ${bad.join(", ")}`);
    for (const k of EXPR_FIELDS) if (k in e && !(e.type === "flag" && k === "value")) checkExpr(e[k], `${at}.${k}`, errors);
    if (e.chance) checkExpr(e.chance.lte, `${at}.chance.lte`, errors);
    if (e.type === "modifier" && !MOD_PATHS.has(e.path) && !MOD_PREFIX.some((p) => e.path.startsWith(p))) errors.push(`${at}: 모르는 modifier path \`${e.path}\``);
    if ((e.type === "buff" || e.type === "debuff")) {
      const def = BUFFS[canonicalBuff(e.id)];
      if (!def) errors.push(`${at}: 모르는 강화·약화 id \`${e.id}\``);
      else if (def.kind !== e.type) errors.push(`${at}: \`${e.id}\`는 ${def.kind}인데 type이 ${e.type}`);
    }
    if (e.type === "command" && !["stop", "enemyAttack", "selfAttack"].includes(e.mode)) errors.push(`${at}: command.mode는 stop/enemyAttack/selfAttack`);
    if (e.type === "target" && (!["enemy", "ally", "self"].includes(e.side) || !["single", "row", "all", "random"].includes(e.scope))) errors.push(`${at}: target side/scope`);
    if (e.type === "kill") checkExpr(e.check?.type === "contest" ? e.check.atkMod : e.check?.target, `${at}.check`, errors);
    if (e.check?.type === "contest") checkExpr(e.check.atkMod, `${at}.check.atkMod`, errors);
    if (e.type === "inflict") {
      // death: 판정 없는 확정 즉사(《참수》 크리티컬 시)
      for (const c of [].concat(e.condition)) if (!CONDITIONS[c] && !(c === "death" && !e.check)) errors.push(`${at}: 모르는 상태 이상 \`${c}\``);
      if (e.choose !== undefined) checkExpr(e.choose, `${at}.choose`, errors);
      if (e.check && !["fixed", "contest", "forced"].includes(e.check.type)) errors.push(`${at}: check.type은 fixed/contest/forced`);
      if (e.check?.type === "fixed") { checkExpr(e.check.target, `${at}.check.target`, errors); checkExpr(e.check.defMod, `${at}.check.defMod`, errors); }
    }
    if (e.type === "cure") {
      if (e.conditions !== undefined && e.conditions !== "all" && !(Array.isArray(e.conditions) && e.conditions.every((c) => CONDITIONS[c]))) errors.push(`${at}: cure.conditions는 "all" 또는 상태 이상 id 배열`);
      if (e.kind !== undefined && !["ailment", "bind", "debuff", "buff"].includes(e.kind)) errors.push(`${at}: cure.kind는 ailment/bind/debuff/buff`);
    }
    if (e.type === "attack") {
      if (e.kind && !["physical", "elemental"].includes(e.kind)) errors.push(`${at}: attack.kind는 physical/elemental`);
      for (const el of [...[].concat(e.element ?? []), ...[].concat(e.addElement ?? [])]) if (!RESISTS.includes(el) && el !== "none") errors.push(`${at}: 모르는 속성 \`${el}\``);
      (e.bonuses ?? []).forEach((b, j) => {
        const bk = unknownWhenKeys(b.when);
        if (bk.length) errors.push(`${at}.bonuses[${j}]: 모르는 when 키 ${bk.join(", ")}`);
        checkExpr(b.hitMod, `${at}.bonuses[${j}].hitMod`, errors);
        checkExpr(b.diceMod, `${at}.bonuses[${j}].diceMod`, errors);
        checkExpr(b.atkMod, `${at}.bonuses[${j}].atkMod`, errors);
      });
    }
    if (e.type === "heal" && e.mode && !["roll", "fixed", "full", "percent"].includes(e.mode)) errors.push(`${at}: heal.mode`);
    if (e.type === "state") for (const m of e.mods ?? []) {
      if (!MOD_PATHS.has(m.path)) errors.push(`${at}: state.mods 모르는 path \`${m.path}\``);
      checkExpr(m.value, `${at}.mods.value`, errors);
    }
    if (e.type === "flag" && !FLAGS.includes(e.flag)) errors.push(`${at}: 모르는 flag \`${e.flag}\``);
    if (e.type === "trigger" && !TRIGGER_ON.includes(e.on)) errors.push(`${at}: 모르는 trigger.on \`${e.on}\``);
    if (e.type === "guard" && !["half", "cover", "defense", "redirect", "reflect", "nullify"].includes(e.mode)) errors.push(`${at}: guard.mode는 half/cover/defense/redirect/reflect/nullify`);
    if ((e.type === "guard" || e.type === "aura") && e.scope && !["front", "back", "row", "all", "target", "owner"].includes(e.scope)) errors.push(`${at}: scope는 front/back/row/all/target/owner`);
    if (e.type === "aura" && !MOD_PATHS.has(e.path)) errors.push(`${at}: 모르는 aura path \`${e.path}\``);
    if (e.type === "actionTiming" && !["first", "last"].includes(e.value)) errors.push(`${at}: actionTiming.value는 first/last`);
    if (e.type === "counter" || e.type === "chase") checkEffects([{ type: "attack", ...e.attack }], `${at}.attack`, errors);
    for (const k of NESTED) if (Array.isArray(e[k])) checkEffects(e[k], `${at}.${k}`, errors);
    if (e.type === "token" && Array.isArray(e.action?.effects)) checkEffects(e.action.effects, `${at}.action.effects`, errors);
  });
  return errors;
}

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));

/** 검사 대상: { group, name, holder(system 또는 노드) } */
export function collectHolders() {
  const out = [];
  for (const f of fs.readdirSync(path.join(ROOT, "data/skills")).filter((x) => x.endsWith(".json")).sort()) {
    for (const s of readJson(`data/skills/${f}`)) out.push({ group: s._meta?.className ?? f.replace(".json", ""), name: s.name, holder: s.system });
  }
  for (const f of fs.readdirSync(path.join(ROOT, "data/enemies")).filter((x) => x.endsWith(".json")).sort()) {
    for (const a of readJson(`data/enemies/${f}`)) for (const it of a.items ?? []) out.push({ group: `에너미 ${f.replace(".json", "")}`, name: `${a.name}/${it.name}`, holder: it.system });
  }
  for (const [f, label] of [["items.json", "아이템"], ["accessories.json", "장식"]]) {
    for (const it of readJson(`data/${f}`)) out.push({ group: label, name: it.name, holder: it.system });
  }
  for (const r of readJson("data/refinements.json")) out.push({ group: "제련", name: r.name, holder: r });
  return out;
}

/** 단계 8에 연결할 type */
/** flag 이름(03 §3) */
export const FLAGS = ["itemRevive", "noCarryCount", "ownLimit", "weaponElement", "tokenMax", "campCookHp", "campCookTp", "campCookCure", "openingCategory", "vanguard", "rangeAll", "anyAilment", "lateCategory", "healThreshold", "overheatLock", "markElementKey"];
/** trigger.on 값(03 §3) */
export const TRIGGER_ON = ["crit", "beforeKO", "attacked", "allyAttacked", "rowAttacked", "endPhase", "openingPhase", "battleStart", "selfHit", "mainPhaseStart", "escapeCheck", "hpLost", "enemyKO", "buffGained", "battleWon", "damaged", "conditionGained", "tokenGone", "bindInflicted", "useSkill"];

export const STAGE8 = new Set(["stance", "trigger", "counter", "chase", "delayed", "token", "guard", "aura", "provoke"]);
const usesStage8 = (list) => (list ?? []).some((e) => STAGE8.has(e.type) || NESTED.some((k) => usesStage8(e[k])));

export function checkAll() {
  const errors = [];
  const counts = new Map();
  const partial = [];
  const gm = [];
  const stage8 = [];
  // 같은 이름의 스킬(여러 클래스의 《HP 부스트》 등)은 해설이 같으면 effects도 같아야 한다
  const byName = new Map();
  for (const { group, name, holder } of collectHolders()) {
    if (holder.review && holder.review !== "todo" && holder.description) {
      const k = `${name}\u0000${holder.description}`;
      const v = JSON.stringify(holder.effects ?? []);
      const prev = byName.get(k);
      if (prev && prev.v !== v) errors.push(`${group} 《${name}》: 해설이 같은 ${prev.group}의 것과 effects가 다르다`);
      else if (!prev) byName.set(k, { v, group });
    }
    const where = `${group} 《${name}》`;
    const review = holder.review ?? (holder.effects?.length ? "auto" : "todo");
    const c = counts.get(group) ?? { todo: 0, auto: 0, partial: 0, ok: 0, none: 0, gm: 0 };
    c[review] = (c[review] ?? 0) + 1;
    counts.set(group, c);
    checkEffects(holder.effects ?? [], where, errors);
    for (const e of holder.effects ?? []) if (e.variant !== undefined && !(Number.isInteger(e.variant) && e.variant >= 0 && e.variant < (holder.variants ?? []).length)) errors.push(`${where}: variant ${e.variant}가 선언 명칭 범위 밖`);
    if (review === "partial") {
      if (!holder.effectsNote) errors.push(`${where}: partial인데 effectsNote가 없다`);
      partial.push(`${where}: ${holder.effectsNote ?? ""}`);
    }
    // gm: 자동화할 수 없어 GM 개입이 반드시 필요한 것(전투 밖 연출·지형 등). effectsNote가 GM이 할 일
    if (review === "gm") {
      if (!holder.effectsNote) errors.push(`${where}: gm인데 effectsNote가 없다`);
      gm.push(`${where}: ${holder.effectsNote ?? ""}`);
    }
    if (review === "none" && (holder.effects ?? []).length) errors.push(`${where}: none인데 effects가 있다`);
    if (["ok", "auto"].includes(review) && !(holder.effects ?? []).length) errors.push(`${where}: ${review}인데 effects가 비었다`);
    if (usesStage8(holder.effects)) stage8.push(where);
  }
  return { errors, counts, partial, gm, stage8 };
}

export function reportMarkdown({ errors, counts, partial, gm = [], stage8 }) {
  const total = { todo: 0, auto: 0, partial: 0, ok: 0, none: 0, gm: 0 };
  const rows = [...counts].map(([g, c]) => {
    for (const k of Object.keys(total)) total[k] += c[k] ?? 0;
    return `| ${g} | ${c.todo ?? 0} | ${c.auto ?? 0} | ${c.partial ?? 0} | ${c.ok ?? 0} | ${c.none ?? 0} | ${c.gm ?? 0} |`;
  });
  return [
    "# 효과 데이터 리포트 (tools/effects-check.mjs)", "",
    `오류 ${errors.length}건 · todo ${total.todo} · auto ${total.auto} · partial ${total.partial} · ok ${total.ok} · none(규칙상 효과 없음) ${total.none} · gm(GM 개입 필수) ${total.gm}`, "",
    "| 묶음 | todo | auto | partial | ok | none | gm |", "|---|---|---|---|---|---|---|", ...rows, "",
    "## 오류", ...(errors.length ? errors.map((e) => `- ${e}`) : ["없음"]), "",
    "## partial (남은 처리)", ...(partial.length ? partial.map((e) => `- ${e}`) : ["없음"]), "",
    "## gm (자동화 불가, GM 개입 필수)", ...(gm.length ? gm.map((e) => `- ${e}`) : ["없음"]), "",
    "## 단계 8 대기(트리거·대기 상태·지연·추격·반격·토큰)", ...(stage8.length ? stage8.map((e) => `- ${e}`) : ["없음"]), ""
  ].join("\n");
}
