/**
 * 후발 행동·지연 공격·메인 페이즈 개시 선언(단계 8-D, 01 §3.3·3.11)
 * - 후발 행동 주행동 스킬(actionTiming last, 《데스 바운드》 등): 메인 페이즈 자기 차례에 쓰면 예약(전투원 플래그 late),
 *   모든 전투원이 행동한 뒤 【속도】 순으로 실행(코스트는 실행할 때)
 * - 지연 공격(delayed, 《딜레이 차지》 등): 쓰면 예약(전투원 플래그 delayed, 턴을 넘어 남는다).
 *   at nextTurnLate → n턴 뒤 메인 페이즈 끝(후발 행동과 함께), at endPhase → n턴 뒤 종료 페이즈 처음. 예약 중엔 새 지연 공격 불가
 * - 메인 페이즈 개시 선언(trigger on mainPhaseStart, 《소닉 레이드》 등): 개막 → 메인으로 넘어갈 때.
 *   의무·에너미·「자동」 토글은 바로, 선택형은 채팅 카드 [선언]/[안 함]. 선언하면 최속 행동으로 공격하고 그 턴 주행동은 끝(acted)
 */
import { autoKey } from "../engine/triggers.mjs";
import { meetsStateReq, meetsWeaponReq } from "../engine/effects/usage.mjs";
import { inRange, pickRandom } from "../engine/combat.mjs";
import { isActiveGM } from "./apply.mjs";
import { combatProfile, friendly } from "./profile.mjs";
import { actionState } from "./turn-status.mjs";
import { emit, onSocket } from "../socket.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Late.${k}`, d) : game.i18n.localize(`NSSQ.Late.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const alive = (c) => !!c?.actor && !c.defeated && (c.actor.system.hp?.value ?? 0) > 0;
const note = (content, actor = null) => ChatMessage.create({
  speaker: actor ? ChatMessage.getSpeaker({ actor }) : { alias: game.i18n.localize("NSSQ.Combat.tracker") },
  content: `<div class="nssq-combat-note"><i class="fas fa-hourglass-end"></i> ${content}</div>`
});

/** 후발 행동 주행동 스킬인가 */
export const isLateSkill = (effects) => (effects ?? []).some((e) => e?.type === "actionTiming" && e.value === "last");
/** 지연 공격 효과 */
export const delayedOf = (effects) => (effects ?? []).find((e) => e?.type === "delayed") ?? null;
/** 실행할 때는 행동 순서 효과를 뺀다(대상에게 「후발」이 붙지 않게) */
export const withoutTiming = (effects) => (effects ?? []).filter((e) => e?.type !== "actionTiming");

/* ---------------- 예약 ---------------- */

/** 후발 행동 예약(메인 페이즈 자기 차례) */
export async function reserveLate(combatant, kind, item, targets, variant) {
  await combatant.setFlag("nssq", "late", { kind, itemId: item.id, name: item.name, targets: targets.map((c) => c.id), variant });
  await note(esc(L("reserved", { name: combatant.name, skill: item.name })), combatant.actor);
}

/** 지연 공격 예약(코스트는 이미 냄) */
export async function reserveDelayed(combat, combatant, item, eff, targets) {
  const turns = Math.max(1, Number(eff.turns ?? 1) || 1);
  await combatant.setFlag("nssq", "delayed", {
    round: combat.round + turns, at: eff.at ?? "nextTurnLate", name: item.name, img: item.img, sl: item.system.sl ?? 1,
    effects: eff.effects ?? [], target: item.system.target ?? "", targets: targets.map((c) => c.id)
  });
  await note(esc(L(eff.at === "endPhase" ? "delayedEnd" : "delayedLate", { name: combatant.name, skill: item.name, n: turns })), combatant.actor);
}

/* ---------------- 실행 ---------------- */

/** 저장한 대상 → 지금 대상(범위·무작위면 다시 고른다, 쓰러진 대상은 뺀다) */
async function currentTargets(combat, c, target, effects, ids) {
  const { targetSpec, candidates } = await import("./skill-use.mjs");
  const spec = targetSpec(target, effects);
  if (spec.side === "self") return [c];
  if (spec.scope === "all" || spec.scope === "random") return candidates(combat, c, spec, "-");
  return ids.map((id) => combat.combatants.get(id)).filter(alive);
}

/** 메인 페이즈 끝: 이번 턴 지연 공격(nextTurnLate)과 후발 행동 예약을 【속도】 순으로 */
export async function runLateActions(combat) {
  const jobs = [];
  for (const c of combat.turns) {
    const d = c.getFlag("nssq", "delayed");
    if (d && (d.at ?? "nextTurnLate") === "nextTurnLate" && d.round <= combat.round) jobs.push({ c, delayed: d });
    const l = c.getFlag("nssq", "late");
    if (l) jobs.push({ c, late: l });
  }
  for (const j of jobs) {
    if (j.delayed) await runDelayed(combat, j.c, j.delayed);
    else await runLate(combat, j.c, j.late);
  }
}

/** 종료 페이즈 처음: 이번 턴 지연 공격(endPhase). 실행한 수 */
export async function runDelayedEnd(combat) {
  let n = 0;
  for (const c of combat.turns) {
    const d = c.getFlag("nssq", "delayed");
    if (d?.at === "endPhase" && d.round <= combat.round) { await runDelayed(combat, c, d); n++; }
  }
  return n;
}

async function runLate(combat, c, l) {
  await c.unsetFlag("nssq", "late");
  const item = c.actor?.items.get(l.itemId);
  if (!item) return;
  if (!alive(c) || actionState(c).noAction) return note(esc(L("cancelled", { name: c.name, skill: l.name })), c.actor);
  const cost = item.system.cost ?? {};
  const s = c.actor.system;
  if (l.kind === "skill" && ((cost.tp ?? 0) > (s.tp?.value ?? 0) || (cost.fp ?? 0) > (s.fp?.value ?? 0))) return note(esc(L("noCost", { name: c.name, skill: l.name })), c.actor);
  const targets = await currentTargets(combat, c, item.system.target, item.system.effects, l.targets);
  if (!targets.length) return note(esc(L("noTarget", { name: c.name, skill: l.name })), c.actor);
  await note(esc(L("lateRun", { name: c.name, skill: l.name })), c.actor);
  const { executeAction } = await import("./skill-use.mjs");
  await executeAction(combat, c, l.kind, l.itemId, targets, { variant: l.variant ?? null, late: true });
}

async function runDelayed(combat, c, d) {
  await c.unsetFlag("nssq", "delayed");
  if (!alive(c)) return note(esc(L("cancelled", { name: c.name, skill: d.name })), c.actor);
  const targets = await currentTargets(combat, c, d.target, d.effects, d.targets ?? []);
  if (!targets.length) return note(esc(L("noTarget", { name: c.name, skill: d.name })), c.actor);
  const { resolveAndPost } = await import("./skill-use.mjs");
  await resolveAndPost({
    actor: c.actor, combatant: c, kind: "skill", mainAction: false, followup: { type: "delayed" },
    item: { name: d.name, img: d.img, system: { effects: d.effects, sl: d.sl ?? 1, category: "", description: "", target: d.target } },
    units: targets.map((t) => ({ actor: t.actor, combatant: t }))
  });
}

/* ---------------- 메인 페이즈 개시 선언 ---------------- */

/** 이 전투원이 지금 선언할 수 있는 스킬(trigger on mainPhaseStart) */
function declarables(c) {
  const a = c.actor;
  if (!alive(c) || actionState(c).noAction || c.getFlag("nssq", "waiting") || c.getFlag("nssq", "acted")) return [];
  const s = a.system;
  const states = (a.getFlag("nssq", "states") ?? []).map((x) => x.id);
  return a.items.filter((i) => i.type === "skill" && (a.type !== "character" || (i.system.sl ?? 0) > 0))
    .map((i) => ({ item: i, trig: (i.system.effects ?? []).find((e) => e?.type === "trigger" && e.on === "mainPhaseStart") }))
    .filter(({ item, trig }) => trig && meetsStateReq(item.system.effects, { states })
      && (a.type !== "character" || meetsWeaponReq(item.system.weaponReq, { weaponType: s.equipment?.weapon?.weaponType, shield: !!s.equipment?.shield }))
      && (item.system.cost?.tp ?? 0) <= (s.tp?.value ?? 0) && (item.system.cost?.fp ?? 0) <= (s.fp?.value ?? 0));
}

/**
 * 개막 → 메인(활성 GM, 첫 차례를 정하기 전): 의무·에너미·자동은 바로 실행, 선택형은 [선언] 카드
 */
export async function mainStartDeclarations(combat) {
  const ask = [];
  for (const c of combat.turns) {
    const list = declarables(c);
    if (!list.length) continue;
    const auto = c.actor.type !== "character" || !list[0].trig.optional || !!c.actor.getFlag("nssq", "autoTrigger")?.[autoKey(list[0].item.system.key)];
    if (auto) await declare(combat, c, list[0].item);
    else ask.push({ combatantId: c.id, itemId: list[0].item.id, name: c.name, skill: list[0].item.name, state: "pending" });
  }
  if (!ask.length) return;
  await ChatMessage.create({
    speaker: { alias: game.i18n.localize("NSSQ.Combat.tracker") },
    content: `<div class="nssq-combat-note"><i class="fas fa-bolt"></i> ${esc(L("declareTitle"))}</div>`,
    flags: { nssq: { declare: { combatId: combat.id, round: combat.round, list: ask } } }
  });
}

/** 선언 실행: 코스트 → 최속 행동으로 공격 → 그 턴 주행동 끝 */
async function declare(combat, c, item, pickedId = null) {
  const trig = (item.system.effects ?? []).find((e) => e?.type === "trigger" && e.on === "mainPhaseStart");
  if (!trig) return false;
  const a = combatProfile(c.actor, c);
  const foes = combat.combatants.filter((x) => alive(x) && !friendly(x.actor, c.actor) && inRange(a.range, a.row, x.actor.system.row ?? "front"));
  const target = foes.find((x) => x.id === pickedId) ?? pickRandom(foes, () => CONFIG.Dice.randomUniform());
  if (!target) { await note(esc(L("noTarget", { name: c.name, skill: item.name })), c.actor); return false; }
  const cost = item.system.cost ?? {};
  const upd = {};
  if (cost.tp) upd["system.tp.value"] = Math.max(0, (c.actor.system.tp?.value ?? 0) - cost.tp);
  if (cost.fp) upd["system.fp.value"] = Math.max(0, (c.actor.system.fp?.value ?? 0) - cost.fp);
  if (Object.keys(upd).length) await c.actor.update(upd);
  await c.setFlag("nssq", "acted", true);
  await note(esc(L("declared", { name: c.name, skill: item.name })), c.actor);
  const { resolveAndPost } = await import("./skill-use.mjs");
  await resolveAndPost({
    actor: c.actor, combatant: c, kind: "skill", mainAction: false,
    item: { name: item.name, img: item.img, system: { ...item.system, effects: withoutTiming(trig.effects), target: "적 단일" } },
    units: [{ actor: target.actor, combatant: target }]
  });
  return true;
}

/* ---------------- 선언 카드 버튼 ---------------- */

async function gmDeclare({ messageId, index, run, targetId }) {
  const message = game.messages.get(messageId);
  const data = foundry.utils.deepClone(message?.getFlag("nssq", "declare"));
  const combat = game.combats.get(data?.combatId);
  const e = data?.list[index];
  if (!e || e.state !== "pending" || !combat) return;
  e.state = run ? "done" : "declined";
  await message.setFlag("nssq", "declare", data);
  if (!run) return;
  const c = combat.combatants.get(e.combatantId);
  const item = c?.actor?.items.get(e.itemId);
  if (!c || !item || combat.round !== data.round || combat.getFlag("nssq", "phase") !== "main") {
    e.state = "declined";
    return message.setFlag("nssq", "declare", data);
  }
  if (!(await declare(combat, c, item, targetId))) {
    e.state = "declined";
    return message.setFlag("nssq", "declare", data);
  }
  // 지금 그 전투원의 차례면 넘긴다(주행동을 썼다)
  if (combat.combatant?.id === c.id) await combat.nextTurn();
}

const send = (p) => (isActiveGM() ? gmDeclare(p) : emit("declare", p));

function decorate(message, el) {
  const data = message.getFlag("nssq", "declare");
  if (!data) return;
  const box = document.createElement("div");
  box.className = "nssq-followups";
  data.list.forEach((e, i) => {
    const row = document.createElement("div");
    row.className = "nssq-reaction";
    const c = game.combats.get(data.combatId)?.combatants.get(e.combatantId);
    const d = { name: e.name, skill: e.skill };
    if (e.state === "done") row.innerHTML = `<i class="fas fa-bolt"></i> ${esc(L("declared", d))}`;
    else if (e.state === "declined") row.innerHTML = `<span class="notes">${esc(L("notDeclared", d))}</span>`;
    else if (!c?.actor?.isOwner) row.innerHTML = `<span class="notes">${esc(L("waiting", d))}</span>`;
    else {
      row.innerHTML = `<button type="button" data-dc-run><i class="fas fa-bolt"></i> ${esc(L("declareBtn", d))}</button><button type="button" data-dc-no>${esc(game.i18n.localize("NSSQ.Chase.decline"))}</button>`;
      // 대상: 지정한 토큰이 하나면 그것, 아니면 사거리 안의 적 중 무작위
      row.querySelector("[data-dc-run]").addEventListener("click", () => {
        const t = [...game.user.targets];
        const picked = t.length === 1 ? game.combats.get(data.combatId)?.combatants.find((x) => x.tokenId === t[0].id)?.id ?? null : null;
        send({ messageId: message.id, index: i, run: true, targetId: picked });
      });
      row.querySelector("[data-dc-no]").addEventListener("click", () => send({ messageId: message.id, index: i, run: false }));
    }
    box.append(row);
  });
  el.querySelector(".nssq-combat-note")?.append(box);
}

export function registerLate() {
  onSocket("declare", (p) => { if (isActiveGM()) gmDeclare(p); });
  Hooks.on("renderChatMessage", (message, html) => decorate(message, html[0]));
}
