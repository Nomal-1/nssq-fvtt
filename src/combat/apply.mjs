/**
 * 【HP】 변경 적용·되돌리기. 설정 autoApply(off/confirm/auto)를 따르고,
 * 소유하지 않은 액터는 소켓으로 활성 GM에게 맡긴다(04 §5.5).
 */
import { rowSwap, sideDefeated } from "../engine/combat.mjs";
import { emit, onSocket } from "../socket.mjs";
import { sideOf } from "./profile.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Combat.${k}`, d) : game.i18n.localize(`NSSQ.Combat.${k}`));

export const autoApplyMode = () => game.settings.get("nssq", "autoApply");

/** 이 클라이언트가 GM 처리를 맡는가(활성 GM 1명) */
export function isActiveGM() {
  const gm = game.users.activeGM;
  return !!gm && gm.id === game.user.id;
}

/** 전투에서 빠진 상태: 【HP】 0 이하, 또는 GM이 「쓰러짐으로 표시」한 전투원 */
const isOut = (c) => !!c.defeated || (c.actor?.system.hp?.value ?? 0) <= 0;
const sideKey = (actor) => (sideOf(actor) === "enemy" ? "enemy" : "party");

/**
 * 【HP】가 바뀌었을 때: 【HP】 0 이하면 쓰러짐 표시를 붙이고(시스템이 붙였다고 기록),
 * 되살아나면 시스템이 붙인 표시만 뗀다(GM이 직접 붙인 표시는 그대로). 그다음 진영 검사.
 */
async function afterHpChange(actor) {
  const ko = (actor.system.hp?.value ?? 0) <= 0;
  const combat = game.combat;
  const combatant = combat?.combatants.find((c) => c.actor === actor || c.actor?.uuid === actor.uuid);
  const dead = CONFIG.specialStatusEffects.DEFEATED;
  const setOverlay = async (on) => { if (actor.statuses?.has(dead) !== on) await actor.toggleStatusEffect(dead, { active: on, overlay: true }); };
  if (combatant) {
    const auto = !!combatant.getFlag("nssq", "autoDefeated");
    if (ko && !combatant.defeated) {
      await combatant.update({ defeated: true, "flags.nssq.autoDefeated": true }, { nssqAuto: true });
      await setOverlay(true);
    } else if (!ko && combatant.defeated && auto) {
      await combatant.update({ defeated: false, "flags.nssq.-=autoDefeated": null }, { nssqAuto: true });
      await setOverlay(false);
    }
  } else await setOverlay(ko);
  if (combat && combatant) await checkSides(combat, sideKey(actor));
}

/** 전위 전멸 교대(그 진영), 진영 전멸이면 종료 대기. 쓰러짐 표시를 바꿨을 때도 부른다 */
async function checkSides(combat, changedSide = null) {
  for (const side of changedSide ? [changedSide] : ["party", "enemy"]) {
    const members = combat.combatants.filter((c) => c.actor && sideKey(c.actor) === side);
    const swaps = rowSwap(members.map((c) => ({ id: c.id, row: c.actor.system.row ?? "front", ko: isOut(c) })));
    if (swaps.length) {
      for (const s of swaps) await combat.combatants.get(s.id).actor.update({ "system.row": s.row });
      await ChatMessage.create({ content: `<div class="nssq-combat-note"><i class="fas fa-exchange-alt"></i> ${L(side === "enemy" ? "rowSwapEnemy" : "rowSwapParty")}</div>` });
    }
  }
  // 전멸 판정: 한 진영이 전원 빠지면 「종료 대기」(되살아나면 해제)
  const unitsOf = (side) => combat.combatants.filter((c) => c.actor && sideKey(c.actor) === side).map((c) => ({ ko: isOut(c) }));
  const over = sideDefeated(unitsOf("enemy")) ? "victory" : sideDefeated(unitsOf("party")) ? "defeat" : null;
  const before = combat.getFlag("nssq", "over") ?? null;
  if (over !== before) {
    await combat.setFlag("nssq", "over", over);
    if (over) {
      await ChatMessage.create({ content: `<div class="nssq-combat-note end"><i class="fas fa-flag-checkered"></i> ${L(over === "victory" ? "enemyDefeated" : "partyDefeated")}</div>` });
    }
  }
}

/** GM 쪽 실제 적용: 메시지의 적용 기록을 갱신한다 */
async function gmApply({ messageId, index, undo = false }) {
  const message = game.messages.get(messageId);
  const card = message?.getFlag("nssq", "attack");
  const t = card?.targets?.[index];
  if (!t) return;
  const actor = await fromUuid(t.actorUuid);
  if (!actor) return;
  const targets = foundry.utils.deepClone(card.targets);
  if (!undo) {
    if (t.applied) return;
    const before = actor.system.hp.value;
    const after = before - (t.finalDamage ?? 0);
    await actor.update({ "system.hp.value": after });
    targets[index] = { ...t, applied: true, before, after };
  } else {
    if (!t.applied) return;
    await actor.update({ "system.hp.value": t.before });
    targets[index] = { ...t, applied: false, after: null };
  }
  await message.update({ "flags.nssq.attack.targets": targets });
  // 전투 불능·열 교대는 updateActor 훅(afterHpChange)이 처리한다
}

/** 적용(또는 되돌리기) 요청: GM이면 바로, 아니면 소켓 */
export async function requestApply(messageId, index, undo = false) {
  if (isActiveGM()) return gmApply({ messageId, index, undo });
  if (!game.users.activeGM) return ui.notifications.warn(L("noGM"));
  emit("applyAttack", { messageId, index, undo });
}

/** 공격 카드가 만들어졌을 때 autoApply=auto면 GM이 적용한다 */
export async function autoApplyCard(message) {
  if (autoApplyMode() !== "auto" || !isActiveGM()) return;
  const card = message.getFlag("nssq", "attack");
  for (let i = 0; i < (card?.targets?.length ?? 0); i++) if (card.targets[i].hit) await gmApply({ messageId: message.id, index: i });
}

export function registerApply() {
  onSocket("applyAttack", (p) => { if (isActiveGM()) gmApply(p); });
  Hooks.on("createChatMessage", (message) => { if (message.getFlag("nssq", "attack")) autoApplyCard(message); });
  // 전투 추적기의 「쓰러짐으로 표시」를 켜고 끌 때도 진영 검사(손으로 켜면 시스템 표시가 아니므로 기록을 지운다)
  Hooks.on("updateCombatant", (combatant, changes, options) => {
    if (!isActiveGM() || !("defeated" in changes) || !combatant.actor) return;
    if (options?.nssqAuto) return;
    if (combatant.getFlag("nssq", "autoDefeated") && !changes.flags?.nssq?.autoDefeated) combatant.unsetFlag("nssq", "autoDefeated");
    checkSides(combatant.combat, sideKey(combatant.actor));
  });
  // HP를 손으로 고쳐도 전투 불능 표시를 맞춘다
  Hooks.on("updateActor", (actor, changes) => {
    if (!isActiveGM() || foundry.utils.getProperty(changes, "system.hp.value") === undefined) return;
    afterHpChange(actor);
  });
}
