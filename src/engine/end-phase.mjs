/**
 * 종료 페이즈 (01 §3.12). Foundry 비의존 순수 함수. 순서 고정:
 *  1. 지연 공격(단계 8 전까지 없음)
 *  2. [독] 대미지: 독을 건 자의 【억제 공격】(전투에 없으면 걸 때 기록한 값, 07 #43). 방어·내성 무시(07 #8)
 *  3. "종료 페이즈에 ~" 효과: HP·TP 리젠
 *  4. [석화]·[스턴]을 제외한 상태 이상·봉인 자연 회복: 2D6 + 【억제 방어】 ≥ 심도면 소멸
 *  5. 강화·약화 남은 턴 −1, 0이면 소멸
 *  6. [석화]·[스턴]을 제외한 남은 상태 이상·봉인의 심도 −1(0에서 멈춤, 07 #38). [스턴]은 그 턴에 끝나므로 소멸
 */
import { CONDITIONS } from "./conditions.mjs";
import { buffMods, tickBuffs } from "./buffs.mjs";
import { evaluateCheck } from "./check.mjs";

export const END_STEPS = ["delayed", "poison", "effects", "recovery", "buffs", "depth"];

/** 자연 회복·심도 감소 대상: 심도를 기록하는 것([석화]·[스턴] 제외) */
const hasDepth = (c) => !!CONDITIONS[c.id]?.depth;

/**
 * 한 전투원의 종료 페이즈
 * @param {object} u
 * @param {{value: number, max: number}} u.hp
 * @param {{value: number, max: number}} [u.tp]
 * @param {number} u.suppDef
 * @param {object[]} u.conditions
 * @param {object[]} u.buffs
 * @param {(c: object) => number} [u.poisonPower] [독]의 대미지(건 자의 【억제 공격】). 없으면 기록값
 * @param {() => number[]|Promise<number[]>} roll2d6 자연 회복 굴림
 * @returns {Promise<{hp: number, tp: number|null, conditions: object[], buffs: object[], log: object[]}>}
 *   log: { step, ... } 단계별 기록(카드 표시용)
 */
export async function endPhaseFor(u, roll2d6) {
  const log = [];
  let hp = u.hp?.value ?? 0;
  let tp = u.tp ? u.tp.value ?? 0 : null;
  let conditions = [...(u.conditions ?? [])];
  let buffs = [...(u.buffs ?? [])];

  // 2. 독
  const poison = conditions.find((c) => c.id === "poison");
  if (poison && hp > 0) {
    const dmg = Math.max(0, Number(u.poisonPower ? u.poisonPower(poison) : poison.sourceSuppAtk) || 0);
    hp -= dmg;
    log.push({ step: "poison", damage: dmg, hp });
  }

  // 3. 리젠(쓰러져 있으면 회복하지 않는다)
  const regen = buffMods(buffs).regen;
  if (hp > 0 && regen.hp) {
    const before = hp;
    hp = Math.min(u.hp?.max ?? hp, hp + regen.hp);
    log.push({ step: "effects", resource: "hp", amount: hp - before, hp });
  }
  if (hp > 0 && tp !== null && regen.tp) {
    const before = tp;
    tp = Math.min(u.tp?.max ?? tp, tp + regen.tp);
    log.push({ step: "effects", resource: "tp", amount: tp - before, tp });
  }

  // 4. 자연 회복
  const kept = [];
  for (const c of conditions) {
    if (!hasDepth(c)) { kept.push(c); continue; }
    const dice = await roll2d6();
    // 상태 이상별 억제 방어 보정(「내성/약점: ○○」)
    const r = evaluateCheck({ dice, modifier: (u.suppDef ?? 0) + (u.condResist?.[c.id] ?? 0), target: c.depth ?? 0 });
    log.push({ step: "recovery", id: c.id, depth: c.depth, dice: r.used, total: r.total, success: !!r.success });
    if (!r.success) kept.push(c);
  }
  conditions = kept;

  // 5. 강화·약화 턴 감소
  // 남은 것도 기록한다(기록이 비면 그 전투원을 건너뛰어 턴이 줄지 않던 문제)
  const t = tickBuffs(buffs);
  for (const b of t.list) log.push({ step: "buffs", buff: b, from: b.turns + 1, to: b.turns });
  for (const b of t.expired) log.push({ step: "buffs", expired: b });
  buffs = t.list;

  // 6. 심도 감소, [스턴] 소멸
  const after = [];
  for (const c of conditions) {
    if (c.id === "stun") { log.push({ step: "depth", id: c.id, ended: true }); continue; }
    if (hasDepth(c)) {
      const depth = Math.max(0, (c.depth ?? 0) - 1);
      if (depth !== c.depth) log.push({ step: "depth", id: c.id, from: c.depth, to: depth });
      after.push({ ...c, depth });
    } else after.push(c);
  }
  conditions = after;

  return { hp, tp, conditions, buffs, log };
}
