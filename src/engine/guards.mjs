/**
 * 가드·도발·반사·오라(단계 8-C): 공격 롤 전에 대상과 대상의 방어 값을 정한다. Foundry 비의존.
 *
 * 전투원(unit)
 *   { id, side, row, ko, defense, stances: [{ id, name, key, sl, left, guardTargets, effects }], autoTrigger }
 * 공격(attack)
 *   { kind: physical|elemental, elements: [..], single: boolean, noRedirect?: boolean }
 *
 * 순서: 도발(provoke, 단일 대상 공격만) → 《캐슬링》(redirect) → 선견술(reflect, 속성 공격) → 대신 받기(cover)
 *       → 대상마다 반감(half)·【방어】(defense)·【내성】(aura)
 * 횟수: 도발·반사·대신 받기는 그때 1회, 반감·【방어】는 명중해 대미지를 줄였을 때 1회(spendOnHit)
 */
import { whenMatches } from "./effects/when.mjs";
import { evaluate } from "./expr.mjs";
import { autoKey } from "./triggers.mjs";

const enemyOf = (a, b) => (a === "enemy") !== (b === "enemy");

/**
 * @param {object} p
 * @param {object} p.attack
 * @param {{ id, side }} p.attacker
 * @param {string[]} p.targets 대상 id(순서대로, 같은 id가 여럿일 수 있다)
 * @param {object[]} p.units 전투원 전부
 * @param {(q: {holder, stance, target}) => boolean|Promise<boolean>} [p.decide] 선택형 대신 받기(《디바이드 모드》)를 할지
 * @returns {Promise<{ targets: string[], notes: object[], mods: Object<string, object>, spendNow: object[], spendOnHit: Object<string, object[]> }>}
 */
export async function planGuards({ attack, attacker, targets, units, decide = () => false }) {
  const byId = new Map(units.map((u) => [u.id, u]));
  const ok = (id) => !!byId.get(id) && !byId.get(id).ko;
  const left = new Map();
  const keyOf = (u, st) => `${u.id}:${st.id}`;
  const remain = (u, st) => (left.has(keyOf(u, st)) ? left.get(keyOf(u, st)) : st.left ?? null);
  const take = (u, st) => {
    const n = remain(u, st);
    if (n !== null && n <= 0) return false;
    if (n !== null) left.set(keyOf(u, st), n - 1);
    return true;
  };
  const ctx = { attack: { kind: attack.kind, elements: attack.elements ?? [] } };
  // 대상 쪽(공격자의 적) 전투원의 대기 상태 효과
  const side = (t) => byId.get(t)?.side;
  const guardsOf = (targetSide, type, mode) => {
    const out = [];
    for (const u of units) {
      if (u.ko || enemyOf(u.side, targetSide)) continue;
      for (const st of u.stances ?? []) {
        for (const e of st.effects ?? []) if (e?.type === type && (!mode || e.mode === mode)) out.push({ u, st, e });
      }
    }
    return out;
  };
  const notes = [];
  const spendNow = [];
  let list = [...targets];
  const defSide = list.length ? side(list[0]) : null;
  if (!defSide || !enemyOf(defSide, attacker.side)) return { targets: list, notes, mods: {}, spendNow, spendOnHit: {} };

  if (!attack.noRedirect) {
    // 도발: 단일 대상 공격의 대상을 자신(또는 선언한 아군 to: "target")으로
    if (attack.single && list.length === 1) {
      for (const { u, st, e } of guardsOf(defSide, "provoke")) {
        const to = e.to === "target" ? st.guardTargets?.[0] : u.id;
        if (!to || to === list[0] || !ok(to) || !take(u, st)) continue;
        notes.push({ type: "provoke", name: st.name, holder: u.id, from: list[0], to });
        spendNow.push({ unitId: u.id, stanceId: st.id });
        list = [to];
        break;
      }
    }
    // 《캐슬링》: 자신이 대상이 되면 선언한 아군으로
    list = list.map((t) => {
      const g = guardsOf(defSide, "guard", "redirect").find(({ u, st }) => u.id === t && ok(st.guardTargets?.[0]) && st.guardTargets[0] !== t);
      if (!g || !take(g.u, g.st)) return t;
      notes.push({ type: "redirect", name: g.st.name, holder: g.u.id, from: t, to: g.st.guardTargets[0] });
      spendNow.push({ unitId: g.u.id, stanceId: g.st.id });
      return g.st.guardTargets[0];
    });
    // 선견술: 아군을 노린 해당 속성 공격을 공격자에게 반사(범위 공격은 1회분만 반사, 나머지 무효)
    if (attack.kind === "elemental") {
      const g = guardsOf(defSide, "guard", "reflect").find(({ e }) => whenMatches(e.when, ctx));
      if (g && take(g.u, g.st)) {
        notes.push({ type: "reflect", name: g.st.name, holder: g.u.id, nullified: list.length - 1 });
        spendNow.push({ unitId: g.u.id, stanceId: g.st.id });
        return { targets: [attacker.id], notes, mods: {}, spendNow, spendOnHit: {}, reflected: true };
      }
    }
    // 대신 받기
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      for (const { u, st, e } of guardsOf(defSide, "guard", "cover")) {
        if (u.id === t) continue;
        const scope = e.scope ?? "target";
        const covers = scope === "all" ? true
          : scope === "row" ? (st.guardTargets?.length ? st.guardTargets.includes(t) : byId.get(t)?.row === u.row)
            : (st.guardTargets ?? []).includes(t);
        if (!covers || remain(u, st) === 0) continue;
        if (e.optional && u.side !== "enemy" && !u.autoTrigger?.[autoKey(st.key)] && !(await decide({ holder: u, stance: st, target: byId.get(t) }))) continue;
        if (!take(u, st)) continue;
        notes.push({ type: "cover", name: st.name, holder: u.id, from: t, to: u.id });
        spendNow.push({ unitId: u.id, stanceId: st.id });
        list[i] = u.id;
        break;
      }
    }
  }

  // 대상마다: 반감·【방어】·【내성】
  const mods = {};
  const spendOnHit = {};
  for (const t of [...new Set(list)]) {
    const tu = byId.get(t);
    if (!tu || enemyOf(tu.side, defSide)) continue;
    const m = {};
    for (const { u, st, e } of guardsOf(defSide, "guard", "half")) {
      const scope = e.scope ?? "all";
      const inScope = scope === "all" || (scope === "front" && tu.row === "front") || (scope === "back" && tu.row === "back")
        || (scope === "row" && tu.row === u.row) || (scope === "target" && (st.guardTargets ?? []).includes(t));
      if (!inScope || !whenMatches(e.when, ctx) || !take(u, st)) continue;
      m.half = { unitId: u.id, stanceId: st.id, name: st.name };
      break;
    }
    for (const { u, st } of guardsOf(defSide, "guard", "defense")) {
      if (!(st.guardTargets ?? []).includes(t) || u.id === t || !take(u, st)) continue;
      m.defense = { value: u.defense ?? 0, unitId: u.id, stanceId: st.id, name: st.name };
      break;
    }
    for (const { st, e } of guardsOf(defSide, "aura")) {
      const scope = e.scope ?? "all";
      if (scope === "target" && !(st.guardTargets ?? []).includes(t)) continue;
      const [root, key] = String(e.path).split(".");
      if (root !== "resist" || !key) continue;
      m.resist ??= {};
      m.resist[key] = (m.resist[key] ?? 0) + evaluate(e.value ?? 0, { SL: st.sl ?? 1 });
    }
    if (Object.keys(m).length) mods[t] = m;
    spendOnHit[t] = [m.half, m.defense].filter(Boolean).map(({ unitId, stanceId }) => ({ unitId, stanceId }));
  }
  return { targets: list, notes, mods, spendNow, spendOnHit };
}

/**
 * 횟수 차감 목록 → 전투원별 대기 상태 새 목록(0이 되면 뺀다)
 * @param {{unitId, stanceId}[]} spends
 * @param {(unitId) => object[]} stancesOf
 * @returns {Map<string, object[]>}
 */
export function applySpends(spends, stancesOf) {
  const out = new Map();
  for (const { unitId, stanceId } of spends) {
    const cur = out.get(unitId) ?? stancesOf(unitId) ?? [];
    out.set(unitId, cur.map((s) => (s.id === stanceId && s.left !== null && s.left !== undefined ? { ...s, left: s.left - 1 } : s))
      .filter((s) => s.left === null || s.left === undefined || s.left > 0));
  }
  return out;
}
