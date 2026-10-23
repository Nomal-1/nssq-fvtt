/**
 * 스킬·아이템 결과 카드의 적용·되돌리기(활성 GM, 플레이어는 소켓으로 맡김). combat/skill-use.mjs가 다시 내보낸다
 */
import { addCondition, CONDITIONS, removeCondition } from "../engine/conditions.mjs";
import { addBuff, BUFFS } from "../engine/buffs.mjs";
import { addState } from "../engine/states.mjs";
import { pickRandom } from "../engine/combat.mjs";
import { isActiveGM } from "./apply.mjs";
import { combatProfile, friendly } from "./profile.mjs";
import { onInflicted } from "./turn-status.mjs";
import { emit } from "../socket.mjs";
import { esc } from "../util.mjs";
import { groupMessages } from "./skill-card.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.SkillUse.${k}`, d) : game.i18n.localize(`NSSQ.SkillUse.${k}`));
const alive = (c) => !!c.actor && !c.defeated && (c.actor.system.hp?.value ?? 0) > 0;
const combatantOf = (actor) => game.combat?.combatants.find((c) => c.actor === actor || c.actor?.uuid === actor.uuid) ?? null;

/* ---------------- 《명하노니》: 적용할 때 실행 ---------------- */

/** stop: 이미 행동 불능(카드 안내만) / selfAttack: 자신을 / enemyAttack: 자신 이외의 같은 편 무작위 1체를 통상 공격 */
async function runCommand(actor, mode) {
  const combat = game.combat;
  const me = combat?.combatants.find((c) => c.actor === actor || c.actor?.uuid === actor.uuid);
  if (!me || !alive(me) || mode === "stop") return;
  const { normalAttack } = await import("./attack.mjs");
  let target = me;
  if (mode === "enemyAttack") {
    target = pickRandom(combat.combatants.filter((c) => c !== me && alive(c) && friendly(c.actor, actor)), () => CONFIG.Dice.randomUniform());
    if (!target) return ChatMessage.create({ speaker: { alias: game.i18n.localize("NSSQ.Combat.tracker") }, content: `<div class="nssq-combat-note">${esc(L("commandNone", { name: me.name }))}</div>` });
  }
  return normalAttack(actor, { target: target.token, ignoreRange: true });
}

/* ---------------- 적용 ---------------- */

/** 한 대상에 결과를 적용 → 되돌리기용 이전 상태 */
async function applyEntry(actor, e, sourceUuid, meta = {}) {
  const s = actor.system;
  const before = { hp: s.hp?.value, tp: s.tp?.value ?? null, conditions: s.conditions ?? [], buffs: s.buffs ?? [], states: actor.getFlag("nssq", "states") ?? [] };
  let hp = s.hp?.value ?? 0;
  let tp = s.tp?.value ?? null;
  // 부활: 【HP】 0 이하에서 회복량만큼(쓰러진 상태의 음수 HP는 0으로 본다)
  if (e.revive && hp <= 0) hp = 0;
  hp = Math.min(s.hp?.max ?? hp, hp - (e.damage ?? 0) + (e.heal?.hp ?? 0));
  if (tp !== null) tp = Math.min(s.tp?.max ?? tp, tp + (e.heal?.tp ?? 0));
  for (const x of e.resource ?? []) {
    if (x.resource === "hp") hp = x.set !== undefined ? x.set : hp + (x.delta ?? 0);
    if (x.resource === "tp" && tp !== null) tp = x.set !== undefined ? x.set : tp + (x.delta ?? 0);
  }
  // 강제 이동(《떠올리기》): 판정에 실패했고 지금 그 열이 아니면. 파티는 빈 칸이 있을 때만(01 #130)
  let rowMove = null;
  for (const x of e.resource ?? []) {
    if (!x.forceRow || x.resisted || (s.row ?? "front") === x.forceRow) continue;
    if (actor.type === "enemy") rowMove = { row: x.forceRow, order: s.order ?? 0 };
    else {
      const { freePartySlot } = await import("./formation.mjs");
      const cb = combatantOf(actor);
      const idx = freePartySlot(cb?.parent?.scene ?? game.scenes.get(cb?.sceneId), actor, x.forceRow);
      if (idx !== null) rowMove = { row: x.forceRow, order: idx };
    }
  }
  if (rowMove) { before.row = s.row ?? "front"; before.order = s.order ?? 0; }
  let conds = [...(s.conditions ?? [])];
  if (e.sleepBroken) conds = removeCondition(conds, "sleep");
  for (const c of e.cures ?? []) {
    if (c.kind === "debuff" || c.kind === "buff") continue;
    const match = (x) => (c.conditions === "all" || c.conditions?.includes(x.id)) && (!c.kind || CONDITIONS[x.id]?.kind === c.kind);
    // 「(SL)개까지」: 사용자가 고른 것(pick), 없으면 걸린 순서대로 count개
    if (c.pick) { conds = conds.filter((x) => !(match(x) && c.pick.includes(x.id))); continue; }
    let left = c.count ?? Infinity;
    conds = conds.filter((x) => !(match(x) && left-- > 0));
  }
  const newly = [];
  const source = sourceUuid ? fromUuidSync(sourceUuid) : null;
  for (const i of e.inflicts ?? []) {
    if (i.resisted || i.broken) continue;
    // 즉사
    if (i.id === "death") { hp = Math.min(hp, 0); continue; }
    // 고정 대미지(「독향」): 건 자를 남기지 않고 기록값으로만(turn-status poisonPower가 기록값을 쓴다)
    const fixed = i.power !== undefined && i.power !== null;
    const r = addCondition(conds, { id: i.id, depth: i.depth, source: fixed ? "" : sourceUuid ?? "", sourceSuppAtk: fixed ? i.power : source ? combatProfile(source).suppAtk : 0 });
    conds = r.list;
    if (!["ignored", "blocked"].includes(r.result)) newly.push(i.id);
  }
  let buffs = [...(s.buffs ?? [])];
  // 약화(debuff)·강화(buff) 해제: 걸린 순서대로 count개. buffs가 있으면 그 종류만(《조명탄》 『명중 저하』)
  for (const c of (e.cures ?? []).filter((x) => x.kind === "debuff" || x.kind === "buff")) {
    let left = c.count ?? Infinity;
    buffs = buffs.filter((b) => !(BUFFS[b.id]?.kind === c.kind && (!c.buffs || c.buffs.includes(b.id)) && left-- > 0));
  }
  for (const b of e.buffs ?? []) buffs = addBuff(buffs, b).list;
  const upd = { "system.hp.value": hp, "system.conditions": conds, "system.buffs": buffs };
  if (tp !== null) upd["system.tp.value"] = tp;
  if (rowMove) { upd["system.row"] = rowMove.row; upd["system.order"] = rowMove.order; }
  // 전투 고유 상태(같은 계열은 바꿔 끼움, engine/states.mjs)
  if (e.states?.length) {
    let states = [...before.states];
    for (const st of e.states) states = addState(states, st).list;
    upd["flags.nssq.states"] = states;
  }
  // nssqMsg: 쓰러진 시각을 이 카드의 시각으로(해부용 수용액)
  await actor.update(upd, { nssqMsg: meta.messageId ?? null });
  for (const id of newly) await onInflicted(actor, id);
  // 《명하노니》: 적용 큐가 끝난 뒤 공격(공격 카드의 적용도 이 큐를 쓴다)
  if (e.command) setTimeout(() => runCommand(actor, e.command), 0);
  // 그 밖의 트리거(단계 8-F): 【HP】 감소·상태 이상·강화
  const ev = await import("./events.mjs");
  // 대미지·자원 감소로 줄었을 때만(회복이 최대치에 맞춰 깎인 것은 아님)
  const lost = (e.damage ?? 0) > 0 || (e.resource ?? []).some((x) => x.resource === "hp" && ((x.delta ?? 0) < 0 || x.set !== undefined));
  if (lost && hp < (before.hp ?? 0)) await ev.onHpChange(actor, before.hp ?? 0, hp, sourceUuid, (e.hits ?? []).some((h) => h.hit));
  for (const id of newly) await ev.onConditionGained(actor, id, sourceUuid, !!meta.main);
  if (e.buffs?.length) await ev.onBuffsGained(actor, e.buffs.map((b) => b.id));
  // 대기 상태(단계 8): 전투원 플래그. 대기 상태가 되면 메인 행동을 하지 않는다(waiting)
  if (e.stances?.length) {
    const cb = combatantOf(actor);
    if (cb) {
      before.combatant = { id: cb.id, stances: cb.getFlag("nssq", "stances") ?? null, waiting: cb.getFlag("nssq", "waiting") ?? null };
      const add = e.stances.map((st) => ({ ...st, id: foundry.utils.randomID() }));
      await cb.update({ "flags.nssq.stances": [...(cb.getFlag("nssq", "stances") ?? []), ...add], ...(add.some((st) => st.waiting) ? { "flags.nssq.waiting": true } : {}) });
    }
  }
  return before;
}

// 적용은 한 번에 하나씩(같은 대상에 여러 카드가 동시에 적용되면 앞 결과를 덮어쓴다)
let queue = Promise.resolve();
const enqueue = (fn) => (queue = queue.then(fn, fn));

/**
 * 카드 결과 적용·되돌리기(활성 GM).
 * 다회 공격의 타격 카드는 순서를 지킨다: 적용하면 앞 타격 중 적용하지 않은 것부터, 되돌리면 뒤 타격 중 적용한 것부터
 */
export function applySkillCard(messageId, undo = false) {
  return enqueue(async () => {
    const message = game.messages.get(messageId);
    const card = message?.getFlag("nssq", "skillCard");
    if (!card?.group) return applyOne(message, undo);
    const list = groupMessages(card);
    const k = card.group.index;
    if (!undo) for (const m of list.filter((x) => x.getFlag("nssq", "skillCard").group.index <= k)) await applyOne(m, false);
    else for (const m of list.filter((x) => x.getFlag("nssq", "skillCard").group.index >= k).reverse()) await applyOne(m, true);
  });
}

async function applyOne(message, undo) {
  const card = message?.getFlag("nssq", "skillCard");
  if (!card || card.failed || card.applied === !undo) return;
  const entries = foundry.utils.deepClone(card.entries);
  for (const e of entries) {
    const actor = e.uuid ? await fromUuid(e.uuid) : null;
    if (!actor) continue;
    if (!undo) e.before = await applyEntry(actor, e, card.userUuid, { main: !!card.main && !card.followup, messageId: message.id });
    else if (e.before) {
      const upd = { "system.hp.value": e.before.hp, "system.conditions": e.before.conditions, "system.buffs": e.before.buffs };
      if (e.before.states) upd["flags.nssq.states"] = e.before.states;
      if (e.before.tp !== null && e.before.tp !== undefined) upd["system.tp.value"] = e.before.tp;
      if (e.before.row) { upd["system.row"] = e.before.row; upd["system.order"] = e.before.order ?? 0; }
      await actor.update(upd, { nssqUndo: true });
      const cb = e.before.combatant && game.combat?.combatants.get(e.before.combatant.id);
      if (cb) {
        const f = e.before.combatant;
        await cb.update({
          ...(f.stances ? { "flags.nssq.stances": f.stances } : { "flags.nssq.-=stances": null }),
          ...(f.waiting ? { "flags.nssq.waiting": f.waiting } : { "flags.nssq.-=waiting": null })
        });
      }
      e.before = null;
    }
  }
  await message.update({ "flags.nssq.skillCard.entries": entries, "flags.nssq.skillCard.applied": !undo });
}

export const requestSkillApply = (messageId, undo = false) => (isActiveGM() ? applySkillCard(messageId, undo) : emit("skillApply", { messageId, undo }));
