/**
 * 【HP】 변경 적용·되돌리기. 설정 autoApply(off/confirm/auto)를 따르고,
 * 소유하지 않은 액터는 소켓으로 활성 GM에게 맡긴다(04 §5.5).
 */
import { halve, rowSwap, sideDefeated } from "../engine/combat.mjs";
import { isPetrified, removeCondition } from "../engine/conditions.mjs";
import { emit, onSocket } from "../socket.mjs";
import { sideOf } from "./profile.mjs";
import { recordBestiary } from "./bestiary.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Combat.${k}`, d) : game.i18n.localize(`NSSQ.Combat.${k}`));

/**
 * 자동 적용 방식: 월드 설정, 단 진행 중인 전투에서 GM이 전투 화면의 [자동 적용]을 켜고 끄면 그 전투에서만 그것(켬 → auto, 끔 → confirm)
 */
export function autoApplyMode() {
  const setting = game.settings.get("nssq", "autoApply");
  const battle = game.combats?.find((c) => c.getFlag("nssq", "battle") && c.started);
  const v = battle?.getFlag("nssq", "autoApply");
  if (v === undefined || v === null) return setting;
  return v ? "auto" : "confirm";
}

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
  // 쓰러지면 상태 이상·봉인·강화·약화가 모두 풀린다(07 #49)
  if (ko && ((actor.system.conditions ?? []).length || (actor.system.buffs ?? []).length)) {
    await actor.update({ "system.conditions": [], "system.buffs": [] });
  }
  const combat = game.combat;
  const combatant = combat?.combatants.find((c) => c.actor === actor || c.actor?.uuid === actor.uuid);
  const dead = CONFIG.specialStatusEffects.DEFEATED;
  const setOverlay = async (on) => { if (actor.statuses?.has(dead) !== on) await actor.toggleStatusEffect(dead, { active: on, overlay: true }); };
  if (combatant) {
    const auto = !!combatant.getFlag("nssq", "autoDefeated");
    if (ko && !combatant.defeated) {
      await combatant.update({ defeated: true, "flags.nssq.autoDefeated": true }, { nssqAuto: true });
      await setOverlay(true);
      // 도감: 처치 기록(정보 공개, 07 #47)
      if (actor.type === "enemy") await recordBestiary(actor, { defeated: 1 });
    } else if (!ko && combatant.defeated && auto) {
      await combatant.update({ defeated: false, "flags.nssq.-=autoDefeated": null }, { nssqAuto: true });
      await setOverlay(false);
    }
  } else await setOverlay(ko);
  if (combat && combatant) await checkSides(combat, sideKey(actor));
}

/** 전위 전멸 교대(그 진영), 진영 전멸이면 종료 대기. 쓰러짐 표시를 바꿨을 때도 부른다 */
export async function checkSides(combat, changedSide = null) {
  for (const side of changedSide ? [changedSide] : ["party", "enemy"]) {
    const members = combat.combatants.filter((c) => c.actor && sideKey(c.actor) === side);
    const swaps = rowSwap(members.map((c) => ({ id: c.id, row: c.actor.system.row ?? "front", ko: isOut(c) })));
    if (swaps.length) {
      for (const s of swaps) await combat.combatants.get(s.id).actor.update({ "system.row": s.row });
      await ChatMessage.create({ content: `<div class="nssq-combat-note"><i class="fas fa-exchange-alt"></i> ${L(side === "enemy" ? "rowSwapEnemy" : "rowSwapParty")}</div>` });
    }
  }
  // 전멸 판정: 한 진영이 전원 [전투 불능] 또는 [석화]면 「종료 대기」(되살아나면 해제, 01 §3.13)
  const unitsOf = (side) => combat.combatants.filter((c) => c.actor && sideKey(c.actor) === side).map((c) => ({ ko: isOut(c), petrified: isPetrified(c.actor) }));
  const over = sideDefeated(unitsOf("enemy")) ? "victory" : sideDefeated(unitsOf("party")) ? "defeat" : null;
  const before = combat.getFlag("nssq", "over") ?? null;
  if (over !== before) {
    await combat.setFlag("nssq", "over", over);
    if (over) {
      await ChatMessage.create({ content: `<div class="nssq-combat-note end"><i class="fas fa-flag-checkered"></i> ${L(over === "victory" ? "enemyDefeated" : "partyDefeated")}</div>` });
      // 전투 승리(《왕의 개선가》)
      if (over === "victory" && isActiveGM()) await (await import("./events.mjs")).onBattleWon(combat);
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
  const attacker = card.attackerUuid ? await fromUuid(card.attackerUuid) : null;
  if (!undo) {
    if (t.applied) return;
    const before = actor.system.hp.value;
    const after = before - (t.finalDamage ?? 0);
    const upd = { "system.hp.value": after };
    // [수면]: 명중한 공격의 처리 직후 풀린다(07 #37)
    const sleep = t.hit ? (actor.system.conditions ?? []).find((c) => c.id === "sleep") : null;
    if (sleep) upd["system.conditions"] = removeCondition(actor.system.conditions, "sleep");
    await actor.update(upd);
    const entry = { ...t, applied: true, before, after, sleepEntry: sleep ?? null, curse: null };
    // [저주]: 실대미지의 절반(버림)이 공격자에게(방어·내성 무시, 쓰러질 수 있다 07 #44)
    const back = card.curse && attacker ? halve(t.finalDamage ?? 0) : 0;
    if (back > 0) {
      const cb = attacker.system.hp.value;
      await attacker.update({ "system.hp.value": cb - back });
      entry.curse = { before: cb, after: cb - back, amount: back };
    }
    targets[index] = entry;
    // 그 밖의 트리거(단계 8-F): 《이 악물기》·《성채 기사의 마음가짐》·《피의 폭주》·《피니셔》 등
    if (after < before) await (await import("./events.mjs")).onHpChange(actor, before, after, card.attackerUuid, true);
    const notes = [];
    if (sleep) notes.push(L("sleepWoke", { name: t.name }));
    if (back > 0) notes.push(L("curseBack", { name: attacker.token?.name ?? attacker.name, n: back }));
    if (notes.length) await ChatMessage.create({ speaker: { alias: L("tracker") }, content: `<div class="nssq-combat-note nssq-status-note">${notes.join("<br>")}</div>` });
  } else {
    if (!t.applied) return;
    const upd = { "system.hp.value": t.before };
    if (t.sleepEntry && !(actor.system.conditions ?? []).some((c) => c.id === "sleep")) upd["system.conditions"] = [...(actor.system.conditions ?? []), t.sleepEntry];
    await actor.update(upd);
    if (t.curse && attacker) await attacker.update({ "system.hp.value": t.curse.before });
    targets[index] = { ...t, applied: false, after: null, sleepEntry: null, curse: null };
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
  // 수동 반응을 기다리는 대상이 있으면 미룬다(반응·[반응 안 함] 뒤 reaction.mjs가 다시 부른다)
  if ((card?.targets ?? []).some((t) => t?.reaction?.state === "pending")) return;
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
  // 페이즈가 바뀌거나 메인 페이즈 차례가 넘어갈 때도 전열이 비었는지 본다(섞기·난입·배치 변경 뒤 등)
  Hooks.on("updateCombat", (combat, changes) => {
    if (!isActiveGM() || !combat.getFlag("nssq", "battle")) return;
    if (foundry.utils.hasProperty(changes, "turn") || foundry.utils.hasProperty(changes, "round") || foundry.utils.hasProperty(changes, "flags.nssq.phase")) checkSides(combat);
  });
  // HP를 손으로 고쳐도 전투 불능 표시를 맞춘다
  Hooks.on("updateActor", (actor, changes) => {
    if (!isActiveGM() || foundry.utils.getProperty(changes, "system.hp.value") === undefined) return;
    afterHpChange(actor);
  });
}
