/**
 * 스킬·아이템 사용 흐름 (03 §6, 단계 6-B)
 * 사용 가능 확인(engine/effects/usage) → 대상 결정(대상 문구) → 코스트 지불 → 발동 판정·효과 해석(engine/effects/resolve)
 * → 결과 카드 → 자동 적용 설정(autoApply)대로 적용(GM, 플레이어는 소켓으로 맡김)
 * 효과 데이터가 없는 스킬은 쓸 수 없다(07 #52).
 */
import { canUseSkill } from "../engine/effects/usage.mjs";
import { resolveEffects } from "../engine/effects/resolve.mjs";
import { addCondition, CONDITIONS, removeCondition } from "../engine/conditions.mjs";
import { addBuff, BUFFS } from "../engine/buffs.mjs";
import { inRange, pickRandom } from "../engine/combat.mjs";
import { autoApplyMode, isActiveGM } from "./apply.mjs";
import { combatProfile, friendly } from "./profile.mjs";
import { actionState, onInflicted } from "./turn-status.mjs";
import { buffLabel, conditionName } from "./status.mjs";
import { knowsEnemy, recordBestiary } from "./bestiary.mjs";
import { emit, onSocket } from "../socket.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.SkillUse.${k}`, d) : game.i18n.localize(`NSSQ.SkillUse.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const alive = (c) => !!c.actor && !c.defeated && (c.actor.system.hp?.value ?? 0) > 0;

/* ---------------- 대상 ---------------- */

/**
 * 대상 문구 → { side, scope }
 * side: enemy(상대 진영)·ally(같은 편)·self, scope: single·row·all·random
 * 「관통」 등 아직 모르는 범위는 single + GM 판단
 */
export function targetSpec(text = "") {
  const t = String(text);
  if (/자신/.test(t) && !/아군|적/.test(t)) return { side: "self", scope: "single" };
  const side = /아군/.test(t) ? "ally" : "enemy";
  if (/전체/.test(t)) return { side, scope: "all" };
  if (/열/.test(t)) return { side, scope: "row" };
  if (/특수|무작위/.test(t)) return { side, scope: "random" };
  return { side, scope: "single", unknown: !/단일|단체|1체/.test(t) };
}

/** 이 사용자의 대상 후보(살아 있는 것, 상대 진영이면 사거리 안) */
function candidates(combat, user, spec, range) {
  const me = user.actor;
  const row = me.system.row ?? "front";
  return combat.combatants.filter((c) => alive(c) && (spec.side === "ally" ? friendly(c.actor, me) : !friendly(c.actor, me)))
    .filter((c) => spec.side === "ally" || range === "-" || !range || inRange(range, row, c.actor.system.row ?? "front"));
}

/* ---------------- 목록 ---------------- */

/** 사용자 프로필(engine/effects에 넘기는 모양) */
export function unitProfile(actor, combatant) {
  const p = combatProfile(actor, combatant);
  const s = actor.system;
  return {
    ...p,
    id: combatant?.id ?? actor.id,
    tp: s.tp?.value ?? 0, tpMax: s.tp?.max ?? 0, fp: s.fp?.value ?? 0,
    weaponType: s.equipment?.weapon?.weaponType ?? null,
    skills: actor.items.filter((i) => i.type === "skill").map((i) => i.name),
    acted: false,
    noAction: actionState(combatant).noAction,
    overheat: Number(actor.getFlag("nssq", "overheat") ?? 0)
  };
}

const isDrive = (item) => /드라이브/.test(item.name);

/**
 * 지금 쓸 수 있는 스킬·아이템 목록
 * @param {"skill"|"item"} kind
 * @returns {{id, name, cost, target, ok, reason}[]}
 */
export function actionList(combat, combatant, kind) {
  const actor = combatant.actor;
  const phase = combat.getFlag("nssq", "phase");
  const myTurn = combat.combatant?.id === combatant.id;
  const user = unitProfile(actor, combatant);
  if (kind === "item") {
    return actor.items.filter((i) => i.type === "consumable" && (i.system.quantity ?? 0) > 0 && !i.system.stored).map((i) => {
      const ok = phase === "main" && myTurn && !!i.system.effects?.length && !user.noAction;
      const reason = !i.system.effects?.length ? "noEffects" : phase !== "main" ? "notMain" : !myTurn ? "notTurn" : user.noAction ? "noAction" : null;
      return { id: i.id, name: i.name, cost: `×${i.system.quantity}`, target: i.system.target || L("allySingle"), ok, reason };
    });
  }
  return actor.items.filter((i) => i.type === "skill" && ["주행동", "개막"].includes(i.system.timing) && (i.system.sl ?? 0) > 0)
    .map((i) => {
      const r = canUseSkill(i.system, user, { phase, myTurn, drive: isDrive(i) });
      const c = i.system.cost ?? {};
      return { id: i.id, name: i.name, cost: [c.tp ? `TP ${c.tp}` : "", c.fp ? `FP ${c.fp}` : ""].filter(Boolean).join(" ") || "-", target: i.system.target, timing: i.system.timing, ok: r.ok, reason: r.reason };
    })
    .sort((a, b) => Number(b.ok) - Number(a.ok));
}

/**
 * 사용 시작: 대상을 골라야 하면 { pick: [combatantId] }, 아니면 바로 실행
 */
export async function beginAction(combat, combatant, kind, id) {
  const actor = combatant.actor;
  const item = actor.items.get(id);
  if (!item) return null;
  const entry = actionList(combat, combatant, kind).find((x) => x.id === id);
  if (!entry?.ok) return ui.notifications.warn(L(`reason.${entry?.reason ?? "timing"}`)) && null;
  const spec = kind === "item" ? targetSpec(item.system.target || "아군 단일") : targetSpec(item.system.target);
  const range = kind === "item" ? "-" : item.system.range;
  if (spec.side === "self") return executeAction(combat, combatant, kind, id, [combatant]);
  const list = candidates(combat, combatant, spec, range);
  if (!list.length) return ui.notifications.warn(L("noTarget")) && null;
  if (spec.scope === "all" || spec.scope === "random") return executeAction(combat, combatant, kind, id, list);
  return { pick: list.map((c) => c.id), spec };
}

/** 고른 카드로 실행(열 범위면 그 카드의 열 전체) */
export async function pickTarget(combat, combatant, kind, id, picked, spec) {
  let targets = [picked];
  if (spec.scope === "row") {
    const row = picked.actor.system.row ?? "front";
    targets = candidates(combat, combatant, spec, "-").filter((c) => (c.actor.system.row ?? "front") === row);
  }
  return executeAction(combat, combatant, kind, id, targets);
}

/* ---------------- 실행 ---------------- */

async function rollWith(rolls, n) {
  if (!n) return [];
  const r = await new Roll(`${n}d6`).evaluate();
  rolls.push(r);
  return r.dice[0].results.map((x) => x.result);
}

/** 실행: 코스트 → 발동·효과 해석 → 결과 카드 */
export async function executeAction(combat, combatant, kind, id, targetCombatants) {
  const actor = combatant.actor;
  const item = actor.items.get(id);
  if (!item) return null;
  const sys = item.system;
  const spec = kind === "item" ? targetSpec(sys.target || "아군 단일") : targetSpec(sys.target);
  // 코스트 지불(아이템은 수량 −1). 발동에 실패해도 소모(07 #9)
  const upd = {};
  if (kind === "skill") {
    if (sys.cost?.tp) upd["system.tp.value"] = Math.max(0, (actor.system.tp?.value ?? 0) - sys.cost.tp);
    if (sys.cost?.fp) upd["system.fp.value"] = Math.max(0, (actor.system.fp?.value ?? 0) - sys.cost.fp);
    if (Object.keys(upd).length) await actor.update(upd);
  } else {
    await item.update({ "system.quantity": Math.max(0, (sys.quantity ?? 1) - 1) });
  }
  const rolls = [];
  const user = unitProfile(actor, combatant);
  const targets = targetCombatants.map((c) => unitProfile(c.actor, c));
  const pool = spec.scope === "random" ? targets : [];
  const r = await resolveEffects({
    effects: sys.effects ?? [], sl: kind === "skill" ? sys.sl ?? 1 : 1, user,
    targets: spec.scope === "random" ? [] : targets, pool,
    mainAction: kind === "skill" && sys.timing === "주행동",
    rollDice: (n) => rollWith(rolls, n), rng: () => CONFIG.Dice.randomUniform()
  });
  // FP(캐릭터만), 오버히트
  if (r.fpGain && actor.type === "character") await actor.update({ "system.fp.value": (actor.system.fp?.value ?? 0) + r.fpGain });
  if (r.overheat) await actor.setFlag("nssq", "overheat", r.overheat);
  // 개막 페이즈에 쓴 스킬은 그 전투원의 개막 행동
  if (combat.getFlag("nssq", "phase") === "opening") await combatant.setFlag("nssq", "opening", "skill");
  if (actor.type === "enemy" && kind === "skill") await recordBestiary(actor, { skill: item.name });

  const byId = new Map(combat.combatants.map((c) => [c.id, c]));
  const entries = [...r.results.values()].map((x) => ({
    uuid: byId.get(x.id)?.actor?.uuid ?? null, name: x.name,
    damage: x.damage, heal: x.heal, inflicts: x.inflicts, buffs: x.buffs, cures: x.cures, resource: x.resource,
    sleepBroken: x.sleepBroken,
    hits: x.hits.map((h) => (h.skipped ? { skipped: true } : { hit: h.hit, total: h.hitCheck?.total, dice: h.hitCheck?.used, diceCount: h.diceCount ?? 0, dmg: h.damage?.dice ?? [], crit: !!h.crit, final: h.finalDamage ?? 0, resist: h.resist })),
    applied: false, before: null
  }));
  const card = {
    userUuid: actor.uuid, userName: combatant.name, kind, name: item.name, img: item.img, sl: sys.sl ?? null,
    activation: r.activation, failed: r.failed, fpGain: r.fpGain, gm: r.gm, partial: sys.partial ?? sys.effectsNote ?? "",
    unknownScope: !!spec.unknown, entries, applied: false
  };
  const message = await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor, token: actor.token }),
    content: renderCard(card),
    rolls, sound: rolls.length ? CONFIG.sounds.dice : undefined,
    flags: { nssq: { skillCard: card } }
  });
  return message;
}

/* ---------------- 카드 ---------------- */

function entryLines(e, card) {
  const out = [];
  for (const h of e.hits ?? []) {
    if (h.skipped) { out.push(`<li class="miss">${esc(L("skipped"))}</li>`); continue; }
    out.push(`<li class="${h.hit ? "hit" : "miss"}">${esc(L(h.hit ? "hitLine" : "missLine", { total: `<span data-mask="${card.kind}">${h.total}</span>`, dice: h.dice?.join("+") ?? "" }))}${h.hit ? ` — ${esc(L("damageLine", { n: h.final, count: h.diceCount }))}${h.crit ? ` <b class="crit">${esc(L("crit"))}</b>` : ""}` : ""}</li>`);
  }
  if (e.damage && (e.hits ?? []).length > 1) out.push(`<li class="total">${esc(L("damageTotal", { n: e.damage }))}</li>`);
  if (e.heal?.hp) out.push(`<li class="heal">${esc(L("healHp", { n: e.heal.hp }))}</li>`);
  if (e.heal?.tp) out.push(`<li class="heal">${esc(L("healTp", { n: e.heal.tp }))}</li>`);
  for (const i of e.inflicts ?? []) out.push(`<li class="${i.resisted ? "resist" : "inflict"}">${esc(L(i.resisted ? "inflictResisted" : "inflictLine", { label: conditionName(i.id), depth: i.depth ?? "-" }))}</li>`);
  for (const b of e.buffs ?? []) out.push(`<li class="${BUFFS[b.id]?.kind ?? "buff"}">${esc(L("buffLine", { label: buffLabel(b), turns: b.turns }))}</li>`);
  for (const c of e.cures ?? []) out.push(`<li class="cure">${esc(L(`cure.${c.kind ?? "all"}`))}</li>`);
  for (const x of e.resource ?? []) if (x.chanceFailed) out.push(`<li class="miss">${esc(L("chanceFailed", { die: x.die }))}</li>`);
  return out.join("");
}

function renderCard(card) {
  const head = `<header class="check-header"><span class="check-label"><img src="${esc(card.img)}" width="20" height="20"/> ${esc(card.name)}${card.sl ? ` <small>SL${card.sl}</small>` : ""}</span><span class="check-kind">${esc(card.userName)}</span></header>`;
  const act = card.activation ? `<p class="activation ${card.activation.ok ? "ok" : "ng"}">${esc(L(card.activation.ok ? "activationOk" : "activationFail", { dice: card.activation.dice.join("+") }))}</p>` : "";
  const fp = card.fpGain ? `<p class="fp-gain">FP +${card.fpGain}</p>` : "";
  if (card.failed) return `<div class="nssq-skill-card">${head}${act}${fp}</div>`;
  const rows = card.entries.map((e, i) => `<section class="sk-target" data-index="${i}"><div class="target-name"><i class="fas fa-bullseye"></i> ${esc(e.name)}</div><ul>${entryLines(e, card)}</ul><div class="sk-status"></div></section>`).join("");
  const gm = [
    ...(card.gm ?? []).map((g) => L("gmNeeded", { what: game.i18n.localize(`NSSQ.SkillUse.type.${String(g).split(":")[0]}`) })),
    ...(card.partial ? [L("gmNeeded", { what: card.partial })] : []),
    ...(card.unknownScope ? [L("gmScope")] : [])
  ];
  return `<div class="nssq-skill-card">${head}${act}${rows}${fp}${gm.map((g) => `<p class="gm-needed"><i class="fas fa-exclamation-triangle"></i> ${esc(g)}</p>`).join("")}
    <div class="sk-apply"><span class="apply-status"></span><span class="apply-buttons"><button type="button" data-sk-apply><i class="fas fa-check"></i> ${esc(L("apply"))}</button><button type="button" data-sk-undo><i class="fas fa-undo"></i> ${esc(L("undo"))}</button></span></div></div>`;
}

/* ---------------- 적용 ---------------- */

/** 한 대상에 결과를 적용 → 되돌리기용 이전 상태 */
async function applyEntry(actor, e, sourceUuid) {
  const s = actor.system;
  const before = { hp: s.hp?.value, tp: s.tp?.value ?? null, conditions: s.conditions ?? [], buffs: s.buffs ?? [] };
  let hp = s.hp?.value ?? 0;
  let tp = s.tp?.value ?? null;
  hp = Math.min(s.hp?.max ?? hp, hp - (e.damage ?? 0) + (e.heal?.hp ?? 0));
  if (tp !== null) tp = Math.min(s.tp?.max ?? tp, tp + (e.heal?.tp ?? 0));
  for (const x of e.resource ?? []) {
    if (x.resource === "hp") hp = x.set !== undefined ? x.set : hp + (x.delta ?? 0);
    if (x.resource === "tp" && tp !== null) tp = x.set !== undefined ? x.set : tp + (x.delta ?? 0);
  }
  let conds = [...(s.conditions ?? [])];
  if (e.sleepBroken) conds = removeCondition(conds, "sleep");
  for (const c of e.cures ?? []) {
    if (c.kind === "debuff") continue;
    const match = (x) => (c.conditions === "all" || c.conditions?.includes(x.id)) && (!c.kind || CONDITIONS[x.id]?.kind === c.kind);
    conds = conds.filter((x) => !match(x));
  }
  const newly = [];
  const source = sourceUuid ? fromUuidSync(sourceUuid) : null;
  for (const i of e.inflicts ?? []) {
    if (i.resisted) continue;
    const r = addCondition(conds, { id: i.id, depth: i.depth, source: sourceUuid ?? "", sourceSuppAtk: source ? combatProfile(source).suppAtk : 0 });
    conds = r.list;
    if (!["ignored", "blocked"].includes(r.result)) newly.push(i.id);
  }
  let buffs = [...(s.buffs ?? [])];
  if ((e.cures ?? []).some((c) => c.kind === "debuff")) buffs = buffs.filter((b) => BUFFS[b.id]?.kind !== "debuff");
  for (const b of e.buffs ?? []) buffs = addBuff(buffs, b).list;
  const upd = { "system.hp.value": hp, "system.conditions": conds, "system.buffs": buffs };
  if (tp !== null) upd["system.tp.value"] = tp;
  await actor.update(upd);
  for (const id of newly) await onInflicted(actor, id);
  return before;
}

/** 카드 결과 적용·되돌리기(활성 GM) */
export async function applySkillCard(messageId, undo = false) {
  const message = game.messages.get(messageId);
  const card = message?.getFlag("nssq", "skillCard");
  if (!card || card.failed || card.applied === !undo) return;
  const entries = foundry.utils.deepClone(card.entries);
  for (const e of entries) {
    const actor = e.uuid ? await fromUuid(e.uuid) : null;
    if (!actor) continue;
    if (!undo) e.before = await applyEntry(actor, e, card.userUuid);
    else if (e.before) {
      const upd = { "system.hp.value": e.before.hp, "system.conditions": e.before.conditions, "system.buffs": e.before.buffs };
      if (e.before.tp !== null && e.before.tp !== undefined) upd["system.tp.value"] = e.before.tp;
      await actor.update(upd);
      e.before = null;
    }
  }
  await message.update({ "flags.nssq.skillCard.entries": entries, "flags.nssq.skillCard.applied": !undo });
}

export const requestSkillApply = (messageId, undo = false) => (isActiveGM() ? applySkillCard(messageId, undo) : emit("skillApply", { messageId, undo }));

export function registerSkillUse() {
  onSocket("skillApply", ({ messageId, undo }) => { if (isActiveGM()) applySkillCard(messageId, undo); });
  // 자동 적용 「즉시」: 카드가 생기면 GM이 적용
  Hooks.on("createChatMessage", (message) => {
    const card = message.getFlag("nssq", "skillCard");
    if (card && !card.failed && autoApplyMode() === "auto" && isActiveGM()) applySkillCard(message.id);
  });
  Hooks.on("renderChatMessage", (message, html) => {
    const card = message.getFlag("nssq", "skillCard");
    if (!card) return;
    const el = html[0];
    // 플레이어가 모르는 에너미가 쓴 스킬의 명중 달성값은 ?(07 #47)
    if (!game.user.isGM) {
      const user = fromUuidSync(card.userUuid);
      if (user && !knowsEnemy(user)) el.querySelectorAll("[data-mask]").forEach((x) => { x.textContent = "?"; });
    }
    const status = el.querySelector(".apply-status");
    const buttons = el.querySelector(".apply-buttons");
    if (status) status.textContent = card.applied ? L("applied") : L("notApplied");
    if (!buttons) return;
    if (!game.user.isGM) return buttons.remove();
    const apply = buttons.querySelector("[data-sk-apply]");
    const undo = buttons.querySelector("[data-sk-undo]");
    if (card.applied) apply?.remove();
    else undo?.remove();
    apply?.addEventListener("click", () => requestSkillApply(message.id));
    undo?.addEventListener("click", () => requestSkillApply(message.id, true));
  });
}

/** 에너미 랜덤 행동: 효과가 있는 스킬이면 이 흐름으로(대상은 무작위 또는 범위 전체) */
export async function enemyUseSkill(combat, combatant, skill) {
  const spec = targetSpec(skill.system.target);
  if (spec.side === "self") return executeAction(combat, combatant, "skill", skill.id, [combatant]);
  const list = candidates(combat, combatant, spec, skill.system.range);
  if (!list.length) return null;
  if (spec.scope === "all" || spec.scope === "random") return executeAction(combat, combatant, "skill", skill.id, list);
  const pick = pickRandom(list, () => CONFIG.Dice.randomUniform());
  return pickTarget(combat, combatant, "skill", skill.id, pick, spec);
}

