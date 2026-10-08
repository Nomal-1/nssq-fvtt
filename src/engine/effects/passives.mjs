/**
 * 상시 스킬의 보정 (03 §3 modifier·flag). Foundry 비의존.
 * 타이밍 「상시」 스킬의 modifier를 SL로 계산해 장비 보정과 같은 키(physHit, abilities.str, resist.fire, hpMax, checks.identify …)로 합산한다.
 */
import { evaluate } from "../expr.mjs";
import { whenMatches } from "./when.mjs";

/**
 * @param {{name: string, sl: number, timing: string, effects: object[]}[]} skills
 * @param {object} ctx when 조건용 { self: { weaponType, dualWield, row, hp, hpMax } }
 * @returns {{mods: Record<string, number>, flags: Record<string, any>, sources: {name, path, value}[]}}
 */
export function collectPassives(skills, ctx = {}) {
  const mods = {};
  const flags = {};
  const sources = [];
  // 공격할 때 대상·공격에 따라 붙는 보정(attackBonus): when은 공격 시점에 본다(sumAttackBonuses)
  const attackBonuses = [];
  // 스킬을 쓸 때 붙는 보정(useBonus): 강화 지속 턴 + 등. when은 사용 시점(분류 등)
  const useBonuses = [];
  for (const s of skills ?? []) {
    if (s.timing !== "상시" || !(s.sl > 0)) continue;
    for (const e of s.effects ?? []) {
      if (e.type === "attackBonus") {
        const v = (x) => evaluate(x ?? 0, { SL: s.sl, self: ctx.self });
        attackBonuses.push({ name: s.name, when: e.when ?? null, hitMod: v(e.hitMod), diceMod: v(e.diceMod), atkMod: v(e.atkMod), critDice: v(e.critDice), critUp: !!e.critUp });
        continue;
      }
      if (e.type === "useBonus") {
        const v = (x) => evaluate(x ?? 0, { SL: s.sl, self: ctx.self });
        useBonuses.push({ name: s.name, when: e.when ?? null, buffTurns: v(e.buffTurns), debuffTurns: v(e.debuffTurns), healHp: v(e.healHp) });
        continue;
      }
      if (!whenMatches(e.when, ctx)) continue;
      if (e.type === "modifier" && e.path && !e.path.startsWith("condResist.")) {
        const v = evaluate(e.value ?? 0, { SL: s.sl, self: ctx.self });
        mods[e.path] = (mods[e.path] ?? 0) + v;
        sources.push({ name: s.name, path: e.path, value: v });
      } else if (e.type === "flag" && e.flag) flags[e.flag] = e.value ?? true;
    }
  }
  return { mods, flags, sources, attackBonuses, useBonuses };
}

/**
 * 상태 이상·봉인별 억제 방어 보정과 완전 내성(에너미 「내성/약점: ○○」·「완전 내성: ○○」)
 * modifier path `condResist.<id>` → { resist: { id: n } }, type `immune` → { immune: [id] }
 * @param {{sl: number, timing: string, effects: object[]}[]} skills
 */
export function collectConditionResist(skills) {
  const resist = {};
  const immune = [];
  for (const s of skills ?? []) {
    if (s.timing !== "상시") continue;
    for (const e of s.effects ?? []) {
      if (e.type === "immune" && e.condition) immune.push(...[].concat(e.condition));
      if (e.type === "modifier" && String(e.path).startsWith("condResist.")) {
        const id = e.path.slice("condResist.".length);
        resist[id] = (resist[id] ?? 0) + evaluate(e.value ?? 0, { SL: s.sl ?? 1 });
      }
    }
  }
  return { resist, immune };
}

/**
 * 공격 1회에 붙는 상시 보정의 합
 * @param {{when, hitMod, diceMod, atkMod}[]} list collectPassives의 attackBonuses
 * @param {object} ctx { self, target, attack: { kind, elements } }
 */
export function sumAttackBonuses(list, ctx = {}) {
  const out = { hitMod: 0, diceMod: 0, atkMod: 0, critDice: 0, critUp: false, names: [] };
  for (const b of list ?? []) {
    if (!whenMatches(b.when, ctx)) continue;
    out.hitMod += b.hitMod; out.diceMod += b.diceMod; out.atkMod += b.atkMod;
    out.critDice += b.critDice ?? 0;
    out.critUp ||= !!b.critUp;
    out.names.push(b.name);
  }
  return out;
}
