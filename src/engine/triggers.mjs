/**
 * 트리거계(단계 8): 공격 이벤트 → 추격·반격 후보. Foundry 비의존.
 *
 * 공격 이벤트(event)
 *   { kind: normal|skill|chase|counter|delayed|token, attackerId, attackerSide, attackerRow,
 *     attackKind: physical|elemental, elements: [..], category: "백병"|…|"",
 *     targets: [{ id, side, row, hit }] }
 * 전투원(unit)
 *   { id, side, row, ko, uuid, stances: [{ id, name, effects, left }], buffs: [{ id, param }],
 *     autoTrigger: { [skillKey]: true, chaseBuff: true } }
 *
 * 연쇄 금지(01 §3.11): 추격의 추격·반격의 추격·반격의 반격은 없다. 추격에 대한 반격은 있다.
 */
import { whenMatches } from "./effects/when.mjs";

/** 「자동 사용」 토글 키(스킬 key의 점은 플래그 경로가 되므로 바꾼다) */
export const autoKey = (key) => String(key ?? "").replace(/\./g, "_");

/** 선택형 효과(「사용을 선언한다」 트리거 등)가 있는가 → 시트에 자동 사용 토글 */
export const hasOptional = (effects) => (effects ?? []).some((e) => e?.optional || hasOptional(e?.effects));

/** 이 공격에 이어 추격할 수 있는가 */
export const canChaseAfter = (kind) => kind !== "chase" && kind !== "counter";
/** 이 공격에 반격할 수 있는가 */
export const canCounterAfter = (kind) => kind !== "counter";

const enemyOf = (a, b) => (a === "enemy") !== (b === "enemy");

/**
 * 대기 상태의 반격(counter) 조건
 * on: attacked(자신이 대상) / rowAttacked(자신과 같은 열의 아군이 대상) / frontRowAttacked(아군 전열이 대상)
 */
function counterHits(on, unit, event) {
  const mine = event.targets.filter((t) => !enemyOf(t.side, unit.side));
  if (!mine.length) return false;
  switch (on ?? "attacked") {
    case "attacked": return mine.some((t) => t.id === unit.id);
    case "rowAttacked": return mine.some((t) => t.row === unit.row);
    case "frontRowAttacked": return mine.some((t) => t.row === "front");
    default: return false;
  }
}

/**
 * 대기 상태의 추격(chase) 대상(없으면 null)
 * on: (없음)/anyAttack(적에게 공격 롤이 행해지면, 공격자 불문) / rowAllyAttack(같은 열 아군이 적을 공격) / allyAttack(아군이 적을 공격)
 *   / targetAttacked(선언한 대상 st.guardTargets에 공격이 가해지면, 《링크 오더》)
 */
function chaseTarget(on, unit, event, st) {
  const foes = event.targets.filter((t) => enemyOf(t.side, unit.side));
  if (!foes.length || event.attackerId === unit.id) return null;
  switch (on ?? "anyAttack") {
    case "anyAttack": return foes[0];
    case "allyAttack": return !enemyOf(event.attackerSide, unit.side) ? foes[0] : null;
    case "rowAllyAttack": return !enemyOf(event.attackerSide, unit.side) && event.attackerRow === unit.row ? foes[0] : null;
    case "targetAttacked": return foes.find((t) => (st?.guardTargets ?? []).includes(t.id)) ?? null;
    default: return null;
  }
}

/**
 * 공격 하나에 대한 추격·반격 후보
 * @returns {{unitId, type: "chase"|"counter", target: string, attack: object, optional: boolean, source: object}[]}
 *   source: { stance: stanceId } | { buff: index } — 횟수 차감·표시용
 */
export function findReactions(event, units) {
  const out = [];
  const ctxFor = (unit) => ({ self: unit, attack: { kind: event.attackKind, elements: event.elements }, category: event.category });
  for (const u of units) {
    if (u.id === undefined) continue;
    // 대기 상태의 반격·추격
    for (const st of u.stances ?? []) {
      if (st.left !== undefined && st.left !== null && st.left <= 0) continue;
      // 한 대기 상태는 공격 하나에 추격·반격 각 1번(《삼색 체이스》처럼 속성별 효과가 여럿이어도)
      const done = new Set();
      const src = { stance: st.id, key: st.key, name: st.name, sl: st.sl ?? 1 };
      for (const e of st.effects ?? []) {
        if (done.has(e.type)) continue;
        // 쓰러졌거나 행동 불가면 없음. evenIfKO(「쓰러져도 반격」, 에너미 《바늘 지옥》)만 예외
        if (u.ko && !e.evenIfKO) continue;
        if (e.type === "counter" && canCounterAfter(event.kind) && enemyOf(event.attackerSide, u.side)
          && counterHits(e.on, u, event) && whenMatches(e.when, ctxFor(u))) {
          if (e.onlyIfEvaded) continue; // 회피 성공 시 반격(《검의 춤》 등)은 수동 반응 쪽에서
          done.add(e.type);
          out.push({ unitId: u.id, type: "counter", target: event.attackerId, attack: e.attack ?? { kind: "physical" }, optional: !!e.optional, source: src, ...(e.evenIfKO ? { evenIfKO: true } : {}) });
        }
        if (e.type === "chase" && canChaseAfter(event.kind) && whenMatches(e.when, ctxFor(u))) {
          const foe = chaseTarget(e.on, u, event, st);
          if (!foe) continue;
          done.add(e.type);
          // copyElement: 그 공격과 같은 속성(〈염〉〈빙〉〈뇌〉 중 포함된 것, 《링크 오더》)
          const copy = e.attack?.copyElement ? (event.elements ?? []).filter((x) => !e.when?.element || [].concat(e.when.element).includes(x)) : null;
          out.push({ unitId: u.id, type: "chase", target: foe.id, attack: { ...(e.attack ?? { kind: "physical" }), ...(copy ? { element: copy } : {}) }, optional: !!e.optional, source: src });
        }
      }
    }
    // 『추격: ○』 강화: ○(param = 액터 uuid)가 공격 롤을 하면 추격할 수 있다(선택)
    if (canChaseAfter(event.kind) && !u.ko) {
      (u.buffs ?? []).forEach((b, i) => {
        if (b.id !== "chase" || !b.param || b.param !== event.attackerUuid) return;
        const foe = event.targets.find((t) => enemyOf(t.side, u.side));
        if (foe) out.push({ unitId: u.id, type: "chase", target: foe.id, attack: { kind: "physical" }, optional: true, source: { buff: i, key: "chaseBuff", sl: 1 } });
      });
    }
  }
  return out;
}

/** 후보를 실행할지: 의무거나, 선택인데 그 전투원이 자동 사용을 켰거나, 에너미 */
export const autoRuns = (reaction, unit) => !reaction.optional || unit?.side === "enemy" || !!unit?.autoTrigger?.[autoKey(reaction.source?.key)];

/**
 * 공격한 쪽의 명중·크리티컬 시 발동(trigger on selfHit / crit)
 * @param {object} event 공격 이벤트(targets에 hit·crit)
 * @param {{ id, side, triggers: [{ key, name, sl, on, when, effects, optional, limit }] }} attacker
 * @returns {{ key, name, sl, on, target, effects, optional }[]}
 *   selfHit: 의무는 공격 하나에 1번(대상 = 처음 명중한 대상), 선언(optional)은 명중한 대상마다
 *   crit: 크리티컬이 난 대상마다. limit perAction이면 1번. 공격(attack)이 든 것은 추격이므로 추격·반격 뒤에는 없다
 */
export function findHitTriggers(event, attacker) {
  const out = [];
  for (const tr of attacker?.triggers ?? []) {
    if (!["selfHit", "crit"].includes(tr.on)) continue;
    if (tr.on === "crit" && (tr.effects ?? []).some((e) => e.type === "attack") && !canChaseAfter(event.kind)) continue;
    const list = event.targets.filter((t) => enemyOf(t.side, attacker.side) && (tr.on === "crit" ? t.crit : t.hit)
      && whenMatches(tr.when, { self: attacker, target: t, attack: { kind: event.attackKind, elements: event.elements }, category: event.category }));
    const once = tr.limit === "perAction" || (tr.on === "selfHit" && !tr.optional);
    for (const t of once ? list.slice(0, 1) : list) out.push({ key: tr.key, name: tr.name, sl: tr.sl ?? 1, on: tr.on, target: t.id, effects: tr.effects ?? [], optional: !!tr.optional });
  }
  return out;
}

/**
 * 대기 상태 횟수 차감(누적 n회). 0이 되면 그 대기 상태는 끝(목록에서 뺌)
 * @returns {object[]} 새 목록
 */
export function spendStance(stances, stanceId) {
  return (stances ?? []).map((s) => (s.id === stanceId && s.left !== null && s.left !== undefined ? { ...s, left: s.left - 1 } : s))
    .filter((s) => s.left === null || s.left === undefined || s.left > 0);
}
