/**
 * 스킬 사용 가능 확인 (03 §6-1). Foundry 비의존.
 */
import { evaluateCheck } from "../check.mjs";

/** 부위 → 그 부위를 막는 봉인 */
export const PART_BIND = { 머리: "bindHead", 팔: "bindArm", 다리: "bindLeg" };

/** 능동으로 쓰는 타이밍 → 쓸 수 있는 페이즈 */
const PHASE_OF = { 주행동: "main", 개막: "opening" };

/**
 * @param {object} skill { timing, part, weaponReq: [], cost: {tp, fp}, effects: [], name }
 * @param {object} user { tp, fp, weaponType, conditions: [], overheat?: number, delayedPending?: boolean, noAction?: boolean }
 * @param {{phase: string, myTurn?: boolean, drive?: boolean}} ctx drive: 《○○ 드라이브》(오버히트 대상)
 * @returns {{ok: boolean, reason: string|null}} reason은 ko.json NSSQ.SkillUse.reason.* 키
 */
export function canUseSkill(skill, user, ctx = {}) {
  const s = skill ?? {};
  if (!s.effects?.length) return { ok: false, reason: "noEffects" };
  const phase = PHASE_OF[s.timing];
  if (!phase) return { ok: false, reason: "timing" };
  if (ctx.phase !== phase) return { ok: false, reason: phase === "main" ? "notMain" : "notOpening" };
  if (phase === "main" && ctx.myTurn === false) return { ok: false, reason: "notTurn" };
  if (user.noAction) return { ok: false, reason: "noAction" };
  const bind = PART_BIND[s.part];
  if (bind && (user.conditions ?? []).some((c) => c.id === bind)) return { ok: false, reason: "bound" };
  const req = (s.weaponReq ?? []).filter(Boolean);
  if (req.length && !req.includes(user.weaponType)) return { ok: false, reason: "weapon" };
  if (ctx.drive && (user.overheat ?? 0) > 0) return { ok: false, reason: "overheat" };
  if (user.delayedPending && s.effects.some((e) => e.type === "delayed")) return { ok: false, reason: "delayed" };
  if ((s.cost?.tp ?? 0) > (user.tp ?? 0)) return { ok: false, reason: "tp" };
  if ((s.cost?.fp ?? 0) > (user.fp ?? 0)) return { ok: false, reason: "fp" };
  return { ok: true, reason: null };
}

/**
 * 「주행동」 스킬 발동 판정: 2D6, 1이 2개면 실패(코스트는 이미 소모, 07 #9). 1이면 FP(일반 행위 판정과 같음)
 * @param {number[]} dice
 * @returns {{ok: boolean, fpGain: number, check: object}}
 */
export function activationRoll(dice) {
  const check = evaluateCheck({ dice });
  return { ok: !check.absFailure, fpGain: check.fpGain, check };
}
