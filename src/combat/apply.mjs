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

/** 전투 불능 표시·해제, 전위 전멸 시 열 교대, 진영 전멸 알림 (GM에서만) */
async function afterHpChange(actor) {
  const ko = (actor.system.hp?.value ?? 0) <= 0;
  const combat = game.combat;
  const combatant = combat?.combatants.find((c) => c.actor === actor || c.actor?.uuid === actor.uuid);
  if (combatant && combatant.defeated !== ko) await combatant.update({ defeated: ko });
  const dead = CONFIG.specialStatusEffects.DEFEATED;
  if (actor.statuses?.has(dead) !== ko) await actor.toggleStatusEffect(dead, { active: ko, overlay: true });
  if (!combat || !combatant) return;

  const side = sideOf(actor) === "enemy" ? "enemy" : "party";
  const members = combat.combatants.filter((c) => c.actor && (sideOf(c.actor) === "enemy" ? "enemy" : "party") === side);
  const units = members.map((c) => ({ id: c.id, row: c.actor.system.row ?? "front", ko: (c.actor.system.hp?.value ?? 0) <= 0 }));
  const swaps = rowSwap(units);
  if (swaps.length) {
    for (const s of swaps) await combat.combatants.get(s.id).actor.update({ "system.row": s.row });
    await ChatMessage.create({ content: `<div class="nssq-combat-note"><i class="fas fa-exchange-alt"></i> ${L(side === "enemy" ? "rowSwapEnemy" : "rowSwapParty")}</div>` });
  }
  // 전멸 판정: 한 진영이 전멸하면 전투를 「종료 대기」로(되살아나면 해제)
  const sideUnits = (pred) => combat.combatants.filter((c) => c.actor && pred(c.actor))
    .map((c) => ({ ko: (c.actor.system.hp?.value ?? 0) <= 0 }));
  const enemiesDown = sideDefeated(sideUnits((a) => sideOf(a) === "enemy"));
  const partyDown = sideDefeated(sideUnits((a) => sideOf(a) !== "enemy"));
  const over = enemiesDown ? "victory" : partyDown ? "defeat" : null;
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
  // HP를 손으로 고쳐도 전투 불능 표시를 맞춘다
  Hooks.on("updateActor", (actor, changes) => {
    if (!isActiveGM() || foundry.utils.getProperty(changes, "system.hp.value") === undefined) return;
    afterHpChange(actor);
  });
}
