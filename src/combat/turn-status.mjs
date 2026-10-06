/**
 * 상태 이상의 턴 진행(단계 5-B)
 * - 개막 페이즈와 부여 순간: [혼란]·[마비]·[공포] 1D6, 1~3이면 그 턴 행동 불가(혼란은 혼란 행동)
 * - 행동 가능 여부: [석화]·[수면]·[스턴]·판정 실패는 행동 불가(메인 차례 건너뜀, 개막 행동 없음)
 * - [혼란] 행동: 자신을 뺀 같은 열 아군 중 무작위에게 통상 공격(없으면 아무것도 하지 않음, 07 #42)
 * - 종료 페이즈 6단계(engine/end-phase.mjs) → 결과 카드, autoApply를 따른다(07 #45)
 */
import { CONDITIONS, openingRollFails } from "../engine/conditions.mjs";
import { endPhaseFor } from "../engine/end-phase.mjs";
import { pickRandom } from "../engine/combat.mjs";
import { autoApplyMode, isActiveGM } from "./apply.mjs";
import { normalAttack } from "./attack.mjs";
import { combatProfile, friendly } from "./profile.mjs";
import { buffLabel, conditionName } from "./status.mjs";
import { emit, onSocket } from "../socket.mjs";
import { knowsEnemy } from "./bestiary.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Turn.${k}`, d) : game.i18n.localize(`NSSQ.Turn.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const alive = (c) => !!c.actor && !c.defeated && (c.actor.system.hp?.value ?? 0) > 0;
const note = (content) => ChatMessage.create({
  speaker: { alias: game.i18n.localize("NSSQ.Combat.tracker") },
  content: `<div class="nssq-combat-note nssq-status-note">${content}</div>`
});

/* ---------------- 행동 가능 여부 ---------------- */

/**
 * @returns {{noAction: boolean, confused: boolean, noOpening: boolean, reason: string}}
 *  noAction: 그 턴 모든 행동 불가 / confused: 혼란 판정 실패(개막 불가, 메인은 혼란 행동) / noOpening: 개막 행동 불가
 */
export function actionState(combatant) {
  const conds = combatant?.actor?.system.conditions ?? [];
  const stuck = conds.find((c) => CONDITIONS[c.id]?.noAction);
  const disabled = !!combatant?.getFlag("nssq", "disabled");
  const confused = !!combatant?.getFlag("nssq", "confused");
  const noAction = !!stuck || disabled;
  const reason = stuck ? conditionName(stuck.id) : disabled ? conditionName(combatant.getFlag("nssq", "disabled")) : confused ? conditionName("confuse") : "";
  return { noAction, confused: confused && !noAction, noOpening: noAction || confused, reason };
}

/* ---------------- 1D6 판정(개막·부여 순간) ---------------- */

const ROLL_IDS = Object.keys(CONDITIONS).filter((id) => CONDITIONS[id].roll);

/** 한 전투원의 [혼란]·[마비]·[공포] 판정. 실패하면 이번 턴 플래그와 대기 취소. 결과 줄 HTML */
async function rollFor(combatant, id, rolls) {
  const roll = await new Roll("1d6").evaluate();
  rolls.push(roll);
  const die = roll.total;
  const fail = openingRollFails(die);
  if (fail) {
    const u = CONDITIONS[id].roll === "confuse"
      ? { "flags.nssq.confused": true }
      // 행동 불가가 되면 대기 상태(방어 전념 등)도 취소(01 §3.8)
      : { "flags.nssq.disabled": id, "flags.nssq.guarding": null, "flags.nssq.waiting": null };
    await combatant.update(u);
  }
  return `<li class="${fail ? "ng" : "ok"}">${esc(combatant.name)} [${esc(conditionName(id))}] 1D6 = <b>${die}</b> → ${fail ? L(CONDITIONS[id].roll === "confuse" ? "confusedFail" : "disabledFail") : L("rollOk")}</li>`;
}

/** 개막 페이즈 시작: 해당 전투원 모두 */
export async function openingRolls(combat) {
  if (!isActiveGM() || !combat) return;
  const rolls = [];
  const rows = [];
  for (const c of combat.turns) {
    if (!alive(c)) continue;
    for (const cond of c.actor.system.conditions ?? []) if (ROLL_IDS.includes(cond.id)) rows.push(await rollFor(c, cond.id, rolls));
  }
  if (!rows.length) return;
  await ChatMessage.create({
    speaker: { alias: game.i18n.localize("NSSQ.Combat.tracker") },
    rolls, sound: CONFIG.sounds.dice,
    content: `<div class="nssq-combat-note nssq-status-note"><b><i class="fas fa-dice-one"></i> ${L("openingTitle")}</b><ul>${rows.join("")}</ul></div>`
  });
}

/** 부여 순간: [혼란]·[마비]·[공포]가 새로 걸렸을 때. [스턴]은 대기를 취소한다 */
export async function onInflicted(actor, id) {
  const combat = game.combat;
  const c = combat?.started ? combat.combatants.find((x) => x.actor === actor || x.actor?.uuid === actor.uuid) : null;
  if (!c) return;
  if (id === "stun" && (c.getFlag("nssq", "guarding") || c.getFlag("nssq", "waiting"))) {
    await c.update({ "flags.nssq.guarding": null, "flags.nssq.waiting": null });
  }
  if (!CONDITIONS[id]?.roll) return;
  const rolls = [];
  const row = await rollFor(c, id, rolls);
  await ChatMessage.create({
    speaker: { alias: game.i18n.localize("NSSQ.Combat.tracker") },
    rolls, sound: CONFIG.sounds.dice,
    content: `<div class="nssq-combat-note nssq-status-note"><b><i class="fas fa-dice-one"></i> ${L("inflictTitle")}</b><ul>${row}</ul></div>`
  });
}

/* ---------------- 혼란 행동 ---------------- */

export async function confusedAction(combat, combatant) {
  const me = combatant?.actor;
  if (!me) return;
  const row = me.system.row ?? "front";
  const allies = combat.combatants.filter((x) => x !== combatant && alive(x) && friendly(x.actor, me) && (x.actor.system.row ?? "front") === row);
  const target = pickRandom(allies, () => CONFIG.Dice.randomUniform());
  if (!target) return note(`<i class="fas fa-question"></i> ${L("confusedNone", { name: esc(combatant.name) })}`);
  await note(`<i class="fas fa-dizzy"></i> ${L("confusedAttack", { name: esc(combatant.name), target: esc(target.name) })}`);
  // 혼란 공격은 아군 대상·사거리 무시(같은 열 아군)
  return normalAttack(me, { target: target.token, ignoreRange: true });
}

/* ---------------- 종료 페이즈 ---------------- */

async function roll2d6(rolls) {
  const r = await new Roll("2d6").evaluate();
  rolls.push(r);
  return r.dice[0].results.map((x) => x.result);
}

/** 독의 대미지: 건 자가 전투에 있으면 현재 【억제 공격】, 없으면 기록값(07 #43) */
function poisonPower(combat, cond) {
  const src = cond.source ? combat.combatants.find((x) => x.actor?.uuid === cond.source && alive(x)) : null;
  return src ? combatProfile(src.actor, src).suppAtk : cond.sourceSuppAtk;
}

const isHidden = (actor) => !knowsEnemy(actor);

function logLine(entry) {
  switch (entry.step) {
    case "poison": return L("logPoison", { n: entry.damage });
    case "effects": return L(entry.resource === "hp" ? "logRegenHp" : "logRegenTp", { n: entry.amount });
    case "recovery": return L(entry.success ? "logRecovered" : "logNotRecovered", { label: conditionName(entry.id), dice: entry.dice.join("+"), total: entry.total, depth: entry.depth });
    case "buffs": return L("logExpired", { label: buffLabel(entry.expired) });
    case "depth": return entry.ended ? L("logStunEnd") : L("logDepth", { label: conditionName(entry.id), from: entry.from, to: entry.to });
    default: return "";
  }
}

/** 종료 페이즈 처리(활성 GM): 결과 카드. autoApply=auto면 바로 적용 */
export async function runEndPhase(combat) {
  if (!isActiveGM() || !combat) return;
  const rolls = [];
  const updates = [];
  const blocks = [];
  for (const c of combat.turns) {
    if (!alive(c)) continue;
    const a = c.actor;
    const s = a.system;
    const p = combatProfile(a, c);
    const r = await endPhaseFor({
      hp: s.hp, tp: a.type === "character" ? s.tp : null, suppDef: p.suppDef,
      conditions: s.conditions ?? [], buffs: s.buffs ?? [],
      poisonPower: (cond) => poisonPower(combat, cond)
    }, () => roll2d6(rolls));
    if (!r.log.length) continue;
    updates.push({
      uuid: a.uuid,
      after: { hp: r.hp, tp: r.tp, conditions: r.conditions, buffs: r.buffs },
      before: { hp: s.hp.value, tp: a.type === "character" ? s.tp.value : null, conditions: s.conditions ?? [], buffs: s.buffs ?? [] }
    });
    blocks.push(`<li><b>${esc(c.name)}</b><ul>${r.log.map((e) => `<li class="${e.step}">${esc(logLine(e))}</li>`).join("")}</ul>${isHidden(a) ? "" : `<span class="hp-line">${L("hpLine", { before: s.hp.value, after: r.hp })}</span>`}</li>`);
  }
  const content = `<div class="nssq-end-phase"><header class="check-header"><span class="check-label"><i class="fas fa-hourglass-end"></i> ${L("endTitle", { round: combat.round })}</span></header>
    <p class="notes">${L("delayedNone")}</p>
    ${blocks.length ? `<ul class="end-units">${blocks.join("")}</ul>` : `<p>${L("endNothing")}</p>`}
    <div class="end-apply"><span class="apply-status"></span><span class="apply-buttons"><button type="button" data-end-apply><i class="fas fa-check"></i> ${L("apply")}</button><button type="button" data-end-undo><i class="fas fa-undo"></i> ${L("undo")}</button></span></div>
  </div>`;
  const message = await ChatMessage.create({
    speaker: { alias: game.i18n.localize("NSSQ.Combat.tracker") },
    rolls, sound: rolls.length ? CONFIG.sounds.dice : undefined,
    content,
    flags: { nssq: { endPhase: { updates, applied: false } } }
  });
  if (updates.length && autoApplyMode() === "auto") await applyEndPhase(message.id);
}

/** 종료 페이즈 결과 적용·되돌리기(GM) */
export async function applyEndPhase(messageId, undo = false) {
  const message = game.messages.get(messageId);
  const data = message?.getFlag("nssq", "endPhase");
  if (!data || data.applied === !undo) return;
  for (const u of data.updates) {
    const actor = await fromUuid(u.uuid);
    if (!actor) continue;
    const v = undo ? u.before : u.after;
    const upd = { "system.conditions": v.conditions, "system.buffs": v.buffs, "system.hp.value": v.hp };
    if (v.tp !== null && v.tp !== undefined) upd["system.tp.value"] = v.tp;
    await actor.update(upd);
  }
  await message.setFlag("nssq", "endPhase.applied", !undo);
}

export function registerTurnStatus() {
  onSocket("endPhaseApply", ({ messageId, undo }) => { if (isActiveGM()) applyEndPhase(messageId, undo); });
  Hooks.on("renderChatMessage", (message, html) => {
    const data = message.getFlag("nssq", "endPhase");
    if (!data) return;
    const el = html[0];
    const status = el.querySelector(".apply-status");
    const buttons = el.querySelector(".apply-buttons");
    if (status) status.textContent = data.applied ? L("applied") : data.updates.length ? L("notApplied") : "";
    if (!buttons) return;
    if (!game.user.isGM || !data.updates.length) return buttons.remove();
    const apply = buttons.querySelector("[data-end-apply]");
    const undo = buttons.querySelector("[data-end-undo]");
    if (data.applied) apply?.remove();
    else undo?.remove();
    const send = (u) => (isActiveGM() ? applyEndPhase(message.id, u) : emit("endPhaseApply", { messageId: message.id, undo: u }));
    apply?.addEventListener("click", () => send(false));
    undo?.addEventListener("click", () => send(true));
  });
}
