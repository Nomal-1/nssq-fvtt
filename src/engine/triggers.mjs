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
 * 대기 상태의 추격(chase) 조건
 * on: (없음)/anyAttack(적에게 공격 롤이 행해지면, 공격자 불문) / rowAllyAttack(같은 열 아군이 적을 공격) / allyAttack(아군이 적을 공격)
 */
function chaseHits(on, unit, event) {
  const foes = event.targets.filter((t) => enemyOf(t.side, unit.side));
  if (!foes.length || event.attackerId === unit.id) return false;
  switch (on ?? "anyAttack") {
    case "anyAttack": return true;
    case "allyAttack": return !enemyOf(event.attackerSide, unit.side);
    case "rowAllyAttack": return !enemyOf(event.attackerSide, unit.side) && event.attackerRow === unit.row;
    default: return false;
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
    if (u.ko || u.id === undefined) continue;
    // 대기 상태의 반격·추격
    for (const st of u.stances ?? []) {
      if (st.left !== undefined && st.left !== null && st.left <= 0) continue;
      for (const e of st.effects ?? []) {
        if (e.type === "counter" && canCounterAfter(event.kind) && enemyOf(event.attackerSide, u.side)
          && counterHits(e.on, u, event) && whenMatches(e.when, ctxFor(u))) {
          if (e.onlyIfEvaded) continue; // 회피 성공 시 반격(《몽상검》 등)은 수동 반응 쪽에서
          out.push({ unitId: u.id, type: "counter", target: event.attackerId, attack: e.attack ?? { kind: "physical" }, optional: !!e.optional, source: { stance: st.id, key: st.key } });
        }
        if (e.type === "chase" && canChaseAfter(event.kind) && chaseHits(e.on, u, event) && whenMatches(e.when, ctxFor(u))) {
          const foe = event.targets.find((t) => enemyOf(t.side, u.side));
          out.push({ unitId: u.id, type: "chase", target: foe.id, attack: { ...(e.attack ?? { kind: "physical" }), ...(e.attack?.copyElement ? { element: event.elements } : {}) }, optional: !!e.optional, source: { stance: st.id, key: st.key } });
        }
      }
    }
    // 『추격: ○』 강화: ○(param = 액터 uuid)가 공격 롤을 하면 추격할 수 있다(선택)
    if (canChaseAfter(event.kind)) {
      (u.buffs ?? []).forEach((b, i) => {
        if (b.id !== "chase" || !b.param || b.param !== event.attackerUuid) return;
        const foe = event.targets.find((t) => enemyOf(t.side, u.side));
        if (foe) out.push({ unitId: u.id, type: "chase", target: foe.id, attack: { kind: "physical" }, optional: true, source: { buff: i, key: "chaseBuff" } });
      });
    }
  }
  return out;
}

/** 후보를 실행할지: 의무거나, 선택인데 그 전투원이 자동 사용을 켰거나, 에너미 */
export const autoRuns = (reaction, unit) => !reaction.optional || unit?.side === "enemy" || !!unit?.autoTrigger?.[reaction.source?.key];

/**
 * 대기 상태 횟수 차감(누적 n회). 0이 되면 그 대기 상태는 끝(목록에서 뺌)
 * @returns {object[]} 새 목록
 */
export function spendStance(stances, stanceId) {
  return (stances ?? []).map((s) => (s.id === stanceId && s.left !== null && s.left !== undefined ? { ...s, left: s.left - 1 } : s))
    .filter((s) => s.left === null || s.left === undefined || s.left > 0);
}
