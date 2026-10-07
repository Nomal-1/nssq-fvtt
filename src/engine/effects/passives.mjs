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
  for (const s of skills ?? []) {
    if (s.timing !== "상시" || !(s.sl > 0)) continue;
    for (const e of s.effects ?? []) {
      if (!whenMatches(e.when, ctx)) continue;
      if (e.type === "modifier" && e.path) {
        const v = evaluate(e.value ?? 0, { SL: s.sl, self: ctx.self });
        mods[e.path] = (mods[e.path] ?? 0) + v;
        sources.push({ name: s.name, path: e.path, value: v });
      } else if (e.type === "flag" && e.flag) flags[e.flag] = e.value ?? true;
    }
  }
  return { mods, flags, sources };
}
