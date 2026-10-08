/**
 * 스킬 사용 가능 확인 (03 §6-1). Foundry 비의존.
 */
import { evaluateCheck } from "../check.mjs";

/** 부위 → 그 부위를 막는 봉인 */
export const PART_BIND = { 머리: "bindHead", 팔: "bindArm", 다리: "bindLeg" };

/** 능동으로 쓰는 타이밍 → 쓸 수 있는 페이즈 */
const PHASE_OF = { 주행동: "main", 개막: "opening" };

/**
 * 스킬의 「무기」 칸 조건: 무기 슬롯의 무기 종류가 들어 있거나, 「방패」면 방패를 장비(기타 슬롯)했을 때(07 #56)
 * @param {string[]} weaponReq
 * @param {{weaponType?: string, shield?: boolean}} user
 */
export function meetsWeaponReq(weaponReq, user) {
  const req = (weaponReq ?? []).filter(Boolean);
  if (!req.length) return true;
  return req.includes(user.weaponType) || (req.includes("방패") && !!user.shield);
}

/**
 * 「《청안의 자세》 상태 한정」 같은 조건: effects의 { type: "requireState", state: id } 가 모두 있어야(07 #57)
 * @param {object[]} effects
 * @param {{states?: string[]}} user states는 지금 가진 전투 고유 상태 id 목록
 */
export function meetsStateReq(effects, user) {
  const need = (effects ?? []).filter((e) => e?.type === "requireState").map((e) => e.state);
  return need.every((id) => (user.states ?? []).includes(id));
}

/**
 * @param {object} skill { timing, part, weaponReq: [], cost: {tp, fp}, effects: [], name }
 * @param {object} user { tp, fp, weaponType, shield?: boolean, states?: string[], conditions: [], overheat?: number, delayedPending?: boolean, noAction?: boolean }
 * @param {{phase: string, myTurn?: boolean, drive?: boolean, openingDone?: boolean}} ctx drive: 《○○ 드라이브》(오버히트 대상)
 * @returns {{ok: boolean, reason: string|null}} reason은 ko.json NSSQ.SkillUse.reason.* 키
 */
export function canUseSkill(skill, user, ctx = {}) {
  const s = skill ?? {};
  if (!s.effects?.some((e) => e?.type !== "requireState")) return { ok: false, reason: "noEffects" };
  const phase = PHASE_OF[s.timing];
  if (!phase) return { ok: false, reason: "timing" };
  if (ctx.phase !== phase) return { ok: false, reason: phase === "main" ? "notMain" : "notOpening" };
  if (phase === "main" && ctx.myTurn === false) return { ok: false, reason: "notTurn" };
  // 개막 페이즈는 전원 1행동(01 §3.3): 이미 배치 변경·무기 교체·개막 스킬을 했으면 끝
  if (phase === "opening" && ctx.openingDone) return { ok: false, reason: "openingDone" };
  if (user.noAction) return { ok: false, reason: "noAction" };
  const bind = PART_BIND[s.part];
  if (bind && (user.conditions ?? []).some((c) => c.id === bind)) return { ok: false, reason: "bound" };
  if (!meetsWeaponReq(s.weaponReq, user)) return { ok: false, reason: "weapon" };
  if (!meetsStateReq(s.effects, user)) return { ok: false, reason: "state" };
  if (ctx.drive && (user.overheat ?? 0) > 0) return { ok: false, reason: "overheat" };
  if (user.delayedPending && s.effects.some((e) => e.type === "delayed")) return { ok: false, reason: "delayed" };
  // 토큰을 없애는 스킬(《비스트 귀환》 등)은 그 분류의 토큰이 있어야
  const tr = s.effects.find((e) => e?.type === "tokenRemove");
  if (tr && !(user.tokens ?? []).some((t) => !tr.category || t.category === tr.category)) return { ok: false, reason: "noToken" };
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
