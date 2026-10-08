/**
 * 개막 페이즈 진행(01 §3.3: 전원 동시에 1행동)
 * - 전투원마다 개막 행동은 한 번: 방어 전념·배치 변경·무기 교체·개막 스킬·도주·[행동 안 함] 중 하나(combatant 플래그 opening)
 * - 모두 정해야 메인 페이즈로. 남은 게 GM이 맡은 전투원(에너미·동료 NPC)뿐이면 확인 뒤 「행동 안 함」으로 처리
 * - 개막 페이즈가 시작될 때 상태를 기록해 두고, GM [개막 행동 되돌리기]로 아무도 행동하지 않은 처음 상태로 되돌린다
 *   (【HP】·【TP】·【FP】·상태 이상·강화·전투 고유 상태·열·무기 슬롯·토큰 위치·전투원 표시)
 */
import { sideOf } from "./profile.mjs";
import { actionState } from "./turn-status.mjs";
import { emit, onSocket } from "../socket.mjs";
import { isActiveGM } from "./apply.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Opening.${k}`, d) : game.i18n.localize(`NSSQ.Opening.${k}`));
const alive = (c) => !!c.actor && !c.defeated && (c.actor.system.hp?.value ?? 0) > 0;
const COMBATANT_FLAGS = ["guarding", "waiting", "opening", "disabled", "confused", "timing", "stances", "late", "acted", "extraAction", "delayed"];

/** 이 전투원은 개막 행동을 정해야 하는가(쓰러짐·행동 불가 판정 실패는 제외) */
export const needsOpening = (c) => alive(c) && !actionState(c).noOpening;

/** 아직 개막 행동을 정하지 않은 전투원: { players, gm } */
export function pendingOpening(combat) {
  const list = combat.combatants.filter((c) => needsOpening(c) && !c.getFlag("nssq", "opening"));
  return { players: list.filter((c) => sideOf(c.actor) === "pc"), gm: list.filter((c) => sideOf(c.actor) !== "pc") };
}

/** 이미 개막 행동을 했는가 */
export const openingDone = (c) => !!c?.getFlag("nssq", "opening");

/** 개막 행동 이름(채팅·커맨드 창) */
export const openingLabel = (flag) => L(`act.${flag}`);

/** [행동 안 함] */
export async function passOpening(combatant) {
  if (openingDone(combatant)) return;
  await combatant.setFlag("nssq", "opening", "pass");
}

/* ---------------- 기록·되돌리기 ---------------- */

/** 개막 페이즈 시작(개막 1D6 판정 뒤): 지금 상태를 전투 플래그에 기록 */
export async function snapshotOpening(combat) {
  // UUID에는 점(.)이 있어 객체 키로 쓰면 setFlag가 중첩 경로로 펼친다 → 배열에 uuid를 함께 넣는다
  const actors = [];
  const tokens = [];
  const combatants = [];
  for (const c of combat.combatants) {
    const a = c.actor;
    if (!a) continue;
    const s = a.system;
    actors.push({
      uuid: a.uuid,
      hp: s.hp?.value ?? null, tp: s.tp?.value ?? null, fp: s.fp?.value ?? null,
      conditions: s.conditions ?? [], buffs: s.buffs ?? [], row: s.row ?? "front", order: s.order ?? null,
      states: a.getFlag("nssq", "states") ?? [], overheat: a.getFlag("nssq", "overheat") ?? null,
      slots: a.type === "character" ? a.items.filter((i) => i.type === "weapon").map((i) => ({ _id: i.id, slot: i.system.slot ?? null, equipped: !!i.system.equipped })) : []
    });
    if (c.token) tokens.push({ uuid: c.token.uuid, x: c.token.x, y: c.token.y });
    combatants.push({ id: c.id, flags: Object.fromEntries(COMBATANT_FLAGS.map((k) => [k, c.getFlag("nssq", k) ?? null])) });
  }
  // 예전 기록(객체)과 합쳐지지 않도록 지우고 새로 쓴다
  await combat.update({ "flags.nssq.-=openingSnapshot": null });
  await combat.setFlag("nssq", "openingSnapshot", { round: combat.round, actors, tokens, combatants });
}

/** GM: 이번 개막 페이즈를 처음 상태로 */
export async function restoreOpening(combat) {
  if (!game.user.isGM) return;
  const snap = combat.getFlag("nssq", "openingSnapshot");
  if (!snap || snap.round !== combat.round || combat.getFlag("nssq", "phase") !== "opening" || !Array.isArray(snap.actors)) return ui.notifications.warn(L("noSnapshot"));
  const ok = await Dialog.confirm({ title: L("undoTitle"), content: `<p>${L("undoConfirm")}</p>`, rejectClose: false });
  if (!ok) return;
  for (const v of snap.actors) {
    const a = await fromUuid(v.uuid);
    if (!a) continue;
    const upd = { "system.conditions": v.conditions, "system.buffs": v.buffs, "system.row": v.row, "flags.nssq.states": v.states };
    if (v.hp !== null) upd["system.hp.value"] = v.hp;
    if (v.tp !== null && a.system.tp) upd["system.tp.value"] = v.tp;
    if (v.fp !== null && a.system.fp) upd["system.fp.value"] = v.fp;
    if (v.order !== null && "order" in a.system) upd["system.order"] = v.order;
    if (v.overheat === null) upd["flags.nssq.-=overheat"] = null;
    else upd["flags.nssq.overheat"] = v.overheat;
    await a.update(upd);
    const slots = (v.slots ?? []).filter((x) => a.items.get(x._id));
    if (slots.length) await a.updateEmbeddedDocuments("Item", slots.map((x) => ({ _id: x._id, "system.slot": x.slot, "system.equipped": x.equipped })));
  }
  for (const pos of snap.tokens ?? []) {
    const t = await fromUuid(pos.uuid);
    if (t && (t.x !== pos.x || t.y !== pos.y)) await t.update({ x: pos.x, y: pos.y }, { animate: false });
  }
  const updates = (snap.combatants ?? []).filter(({ id }) => combat.combatants.has(id)).map(({ id, flags }) => {
    const u = { _id: id };
    for (const k of COMBATANT_FLAGS) {
      if (flags[k] === null || flags[k] === undefined) u[`flags.nssq.-=${k}`] = null;
      else u[`flags.nssq.${k}`] = flags[k];
    }
    return u;
  });
  if (updates.length) await combat.updateEmbeddedDocuments("Combatant", updates);
  await ChatMessage.create({ speaker: { alias: game.i18n.localize("NSSQ.Combat.tracker") }, content: `<div class="nssq-combat-note"><i class="fas fa-undo"></i> ${L("undone", { round: combat.round })}</div>` });
}

/* ---------------- 메인 페이즈로 ---------------- */

/**
 * 개막 → 메인 전에(GM): 모두 정했는가. 플레이어가 남았으면 기다리거나(기본) 강제로 진행,
 * GM이 맡은 전투원만 남았으면 확인 뒤 「행동 안 함」으로
 * @returns {Promise<boolean>} 넘어가도 되면 true
 */
export async function confirmOpeningDone(combat) {
  const { players, gm } = pendingOpening(combat);
  if (!players.length && !gm.length) return true;
  const names = (list) => list.map((c) => c.name).join(", ");
  let ok;
  if (players.length) {
    ok = await Dialog.confirm({
      title: L("pendingTitle"),
      content: `<p>${L("pendingPlayers", { names: names(players) })}</p>${gm.length ? `<p>${L("pendingGm", { names: names(gm) })}</p>` : ""}<p class="notes">${L("forceNote")}</p>`,
      yes: () => true, no: () => false, defaultYes: false, rejectClose: false
    });
  } else {
    ok = await Dialog.confirm({
      title: L("pendingTitle"),
      content: `<p>${L("pendingGm", { names: names(gm) })}</p><p>${L("autoPass")}</p>`,
      yes: () => true, no: () => false, defaultYes: true, rejectClose: false
    });
  }
  if (!ok) return false;
  const rest = [...players, ...gm];
  await combat.updateEmbeddedDocuments("Combatant", rest.map((c) => ({ _id: c.id, "flags.nssq.opening": "pass" })));
  return true;
}

/* ---------------- 플레이어 → GM ---------------- */

/** 플레이어가 고른 [행동 안 함]: 전투원 문서는 GM만 고칠 수 있을 수 있으므로 GM에게 맡긴다 */
export function requestPass(combatant) {
  if (game.user.isGM || combatant.isOwner) return passOpening(combatant);
  emit("openingPass", { combatId: combatant.combat.id, combatantId: combatant.id });
}

export function registerOpening() {
  onSocket("openingPass", ({ combatId, combatantId }) => {
    if (!isActiveGM()) return;
    const c = game.combats.get(combatId)?.combatants.get(combatantId);
    if (c) passOpening(c);
  });
}
