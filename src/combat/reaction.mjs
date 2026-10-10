/**
 * 수동 반응(단계 6-C): 공격 카드·스킬 결과 카드에서 대상이 「수동」 스킬로 반응한다.
 * - 카드를 만들 때 대상이 쓸 수 있는 수동 스킬이 있으면 reaction: { state: "pending", options } 를 붙인다(명중한 대상만)
 * - 그 캐릭터 소유자·GM에게 [수동: 《패링》]·[반응 안 함] 버튼. 공격 롤 1회에 1번(01 §3.5)
 * - 능동 회피(대항 판정, 07 #51)·《완전 방어》(대미지 0·추가 효과 무효). 결과는 활성 GM이 카드에 반영
 * - 판단할 사람에게 팝업(대상 소유 플레이어, 접속 중인 플레이어가 없으면 활성 GM). 시트 「자동」을 켠 수동 스킬은 팝업 없이 바로
 * - 자동 적용 「즉시」라도 반응을 기다리는 대상이 있으면 적용을 미룬다(반응하거나 [반응 안 함]·[적용]으로 진행)
 */
import { activeEvade, reactionEffect } from "../engine/effects/reaction.mjs";
import { meetsStateReq, meetsWeaponReq, PART_BIND } from "../engine/effects/usage.mjs";
import { BUFFS, canonicalBuff } from "../engine/buffs.mjs";
import { autoApplyMode, isActiveGM } from "./apply.mjs";
import { combatProfile, friendly } from "./profile.mjs";
import { emit, onSocket } from "../socket.mjs";
import { autoKey } from "../engine/triggers.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Reaction.${k}`, d) : game.i18n.localize(`NSSQ.Reaction.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** 이 캐릭터가 이 공격(kind)에 쓸 수 있는 수동 스킬 */
export function reactionChoices(actor, kind) {
  // 《와이드 패링》이 먼저(실패하면 대상 자신의 능동 회피를 이어서 고를 수 있다)
  return wideChoices(actor, kind).concat(ownChoices(actor, kind));
}

/** 대상 자신의 수동 스킬·대기 상태 */
function ownChoices(actor, kind) {
  // 에너미의 수동 능동 회피(큰무당벌레 《바람의 순간》 등)도: 카드가 생기면 활성 GM이 자동으로 쓴다
  if (!actor || !["character", "enemy"].includes(actor.type)) return [];
  const s = actor.system;
  const conds = s.conditions ?? [];
  if (conds.some((c) => ["petrify", "sleep", "stun"].includes(c.id))) return [];
  // [마비]·[공포] 판정에 실패한 턴은 모든 행동 불가(수동 스킬 포함). [혼란]은 수동 스킬 가능
  if (game.combat?.combatants.find((c) => c.actor?.uuid === actor.uuid)?.getFlag("nssq", "disabled")) return [];
  return actor.items.filter((i) => i.type === "skill" && i.system.timing === "수동" && (i.system.sl ?? 0) > 0 && reactionEffect(i.system.effects, kind))
    .filter((i) => (i.system.cost?.tp ?? 0) <= (s.tp?.value ?? 0) && (i.system.cost?.fp ?? 0) <= (s.fp?.value ?? 0))
    .filter((i) => !(PART_BIND[i.system.part] && conds.some((c) => c.id === PART_BIND[i.system.part])))
    .filter((i) => meetsWeaponReq(i.system.weaponReq, { weaponType: s.equipment?.weapon?.weaponType, shield: !!s.equipment?.shield }))
    .filter((i) => meetsStateReq(i.system.effects, { states: (actor.getFlag("nssq", "states") ?? []).map((x) => x.id) }))
    // 토큰을 없애고 쓰는 것(《야수의 우정》)은 그 분류의 토큰이 있어야
    .filter((i) => {
      const tr = (i.system.effects ?? []).find((e) => e?.type === "tokenRemove");
      if (!tr) return true;
      const cb = game.combat?.combatants.find((c) => c.actor?.uuid === actor.uuid);
      return (cb?.getFlag("nssq", "tokens") ?? []).some((t) => !tr.category || t.category === tr.category);
    })
    .map((i) => ({ id: i.id, name: i.name }))
    // 대기 상태 안의 능동 회피(무사 《몽상검》: 대기 중 물리 공격을 받으면 【AGI】로 능동 회피)
    .concat(stanceOf(actor).filter((st) => reactionEffect(st.effects, kind)).map((st) => ({ id: `stance:${st.id}`, name: st.name })));
}

/**
 * 팔랑크스 《와이드 패링》(상시 wideEvade): 같은 열 아군이 공격받을 때 자신의 능동 회피 수동 스킬로 대신 판정
 * 선택지 id `ally:<보유자 uuid>:<스킬 id>`. 코스트·능력치는 보유자 것
 */
function wideChoices(actor, kind) {
  const combat = game.combat;
  if (!combat?.started) return [];
  const row = actor.system.row ?? "front";
  const out = [];
  for (const c of combat.combatants) {
    const h = c.actor;
    if (!h || h.uuid === actor.uuid || c.defeated || (h.system.hp?.value ?? 0) <= 0 || !friendly(h, actor) || (h.system.row ?? "front") !== row) continue;
    if (!h.items.some((i) => i.type === "skill" && (i.system.sl ?? 0) > 0 && (i.system.effects ?? []).some((e) => e?.type === "wideEvade"))) continue;
    for (const o of ownChoices(h, kind).filter((x) => !String(x.id).includes(":"))) {
      const sk = h.items.get(o.id);
      if (reactionEffect(sk?.system.effects, kind)?.type !== "activeEvade") continue;
      out.push({ id: `ally:${h.uuid}:${o.id}`, name: `${o.name}(${c.name})`, holder: h.uuid });
    }
  }
  return out;
}

/** 이 캐릭터의 대기 상태(진행 중인 전투) */
function stanceOf(actor) {
  const cb = game.combat?.combatants.find((c) => c.actor?.uuid === actor.uuid);
  return cb?.getFlag("nssq", "stances") ?? [];
}

/** 카드를 만들 때: 명중했고 쓸 수 있는 수동 스킬이 있으면 기다리는 표시 */
export function pendingReaction(actor, kind, hit) {
  if (!hit) return null;
  const options = reactionChoices(actor, kind);
  return options.length ? { state: "pending", options } : null;
}

/** 카드에서 반응을 기다리는 대상이 있는가 */
export const hasPendingReaction = (list) => (list ?? []).some((t) => t?.reaction?.state === "pending");

/* ---------------- 버튼 ---------------- */

/**
 * 카드에 반응 버튼·결과 줄을 붙인다
 * @param {HTMLElement} el 카드 HTML
 * @param {ChatMessage} message
 * @param {"attack"|"skill"} type
 */
export function decorateReactions(el, message, type) {
  const card = type === "attack" ? message.getFlag("nssq", "attack") : message.getFlag("nssq", "skillCard");
  const list = type === "attack" ? card?.targets : card?.entries;
  if (!list) return;
  const applied = type === "attack" ? list.some((t) => t.applied) : card.applied;
  el.querySelectorAll(type === "attack" ? ".attack-target" : ".sk-target").forEach((row) => {
    const i = Number(row.dataset.index);
    const t = list[i];
    const r = t?.reaction;
    if (!r) return;
    const box = document.createElement("div");
    box.className = "nssq-reaction";
    // 앞서 실패한 《와이드 패링》 결과
    const prior = r.prior ? `<div><i class="fas fa-shield-alt"></i> ${esc(r.prior)}</div>` : "";
    if (r.state === "used") box.innerHTML = `${prior}<i class="fas fa-shield-alt"></i> ${esc(r.text ?? "")}`;
    else if (r.state === "declined") box.innerHTML = `${prior}<span class="notes">${esc(L("declined"))}</span>`;
    else if (r.state === "pending" && !applied) {
      const actor = fromUuidSync(type === "attack" ? t.actorUuid : t.uuid);
      // 대상 자신의 선택지·[반응 안 함]은 대상 소유자, 《와이드 패링》 선택지·[넘기기]는 그 보유자 소유자만(GM은 모두)
      const ownsTarget = !!actor?.isOwner;
      const mine = r.options.filter((o) => (o.holder ? !!fromUuidSync(o.holder)?.isOwner : ownsTarget));
      const holders = [...new Set(mine.filter((o) => o.holder).map((o) => o.holder))];
      if (!mine.length && !ownsTarget) {
        box.innerHTML = `${prior}<span class="notes">${esc(L("waiting", { name: t.name }))}</span>`;
      } else {
        box.innerHTML = prior + mine.map((o) => `<button type="button" data-react="${o.id}"><i class="fas fa-shield-alt"></i> ${esc(L("use", { name: o.name }))}</button>`).join("")
          + (ownsTarget ? `<button type="button" data-react-decline>${esc(L("decline"))}</button>` : holders.map((h) => `<button type="button" data-react-pass="${h}">${esc(L("pass"))}</button>`).join(""));
        box.querySelectorAll("[data-react]").forEach((b) => b.addEventListener("click", () => useReaction(message, type, i, b.dataset.react)));
        box.querySelector("[data-react-decline]")?.addEventListener("click", () => send({ messageId: message.id, type, index: i, result: { declined: true } }));
        box.querySelectorAll("[data-react-pass]").forEach((b) => b.addEventListener("click", () => send({ messageId: message.id, type, index: i, result: { passAlly: b.dataset.reactPass } })));
      }
    } else return;
    row.append(box);
  });
}

/* ---------------- 사용 ---------------- */

const send = (payload) => (isActiveGM() ? gmReaction(payload) : emit("reaction", payload));

async function useReaction(message, type, index, skillId) {
  const card = type === "attack" ? message.getFlag("nssq", "attack") : message.getFlag("nssq", "skillCard");
  const t = (type === "attack" ? card.targets : card.entries)[index];
  if (t?.reaction?.state !== "pending") return;
  let actor = await fromUuid(type === "attack" ? t.actorUuid : t.uuid);
  const ally = String(skillId).startsWith("ally:");
  // 《와이드 패링》: 같은 열 아군(보유자)의 스킬·코스트·능력치로
  if (String(skillId).startsWith("ally:")) {
    const [, uuid, id] = String(skillId).match(/^ally:(.+):([^:]+)$/) ?? [];
    actor = uuid ? await fromUuid(uuid) : null;
    skillId = id;
    if (!actor) return;
  }
  // 대기 상태의 능동 회피는 그 대기 상태를 스킬처럼(코스트 없음)
  const st = String(skillId).startsWith("stance:") ? stanceOf(actor).find((x) => `stance:${x.id}` === skillId) : null;
  const skill = st ? { id: skillId, name: st.name, system: { effects: st.effects ?? [], sl: st.sl ?? 1, key: st.key, cost: {} } } : actor?.items.get(skillId);
  if (!skill) return;
  const kind = type === "attack" ? card.kind : (t.hits.find((h) => h.hit)?.kind ?? "physical");
  const eff = reactionEffect(skill.system.effects, kind);
  if (!eff) return;
  // 코스트: 카드를 만든 뒤 다른 반응에 써서 모자라면 쓸 수 없다
  const c = skill.system.cost ?? {};
  if ((c.tp ?? 0) > (actor.system.tp?.value ?? 0) || (c.fp ?? 0) > (actor.system.fp?.value ?? 0)) return ui.notifications.warn(L("noCost", { skill: skill.name }));
  const upd = {};
  if (c.tp) upd["system.tp.value"] = Math.max(0, (actor.system.tp?.value ?? 0) - c.tp);
  if (c.fp) upd["system.fp.value"] = Math.max(0, (actor.system.fp?.value ?? 0) - c.fp);
  if (Object.keys(upd).length) await actor.update(upd);

  // 토큰 1개를 없앤다(《야수의 우정》)
  const tr = (skill.system.effects ?? []).find((e) => e?.type === "tokenRemove");
  if (tr) {
    const cb = game.combat?.combatants.find((c) => c.actor?.uuid === actor.uuid);
    if (cb) await (await import("./tokens.mjs")).removeToken(cb, tr.category ?? null);
  }
  if (eff.type === "nullify") {
    const text = L("nullified", { skill: skill.name, name: actor.name });
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<div class="nssq-combat-note"><i class="fas fa-shield-alt"></i> ${esc(text)}</div>` });
    return send({ messageId: message.id, type, index, result: { nullify: true, selfOnly: eff.scope === "self", reactorUuid: actor.uuid, text } });
  }
  // 능동 회피: 공격자의 명중 판정(카드의 달성값)과 대항
  const hit = type === "attack" ? { total: t.hitTotal, absSuccess: t.absSuccess, absFailure: t.absFailure } : t.hits.find((h) => h.hit);
  const roll = await new Roll("2d6").evaluate();
  const r = activeEvade({
    // ability "evasion": 【회피】 값(에너미 《바람의 순간》 「(【회피】−5)에 의한 능동 회피」)
    dice: roll.dice[0].results.map((x) => x.result), abilityBonus: eff.ability === "evasion" ? combatProfile(actor, game.combat?.combatants.find((c) => c.actor?.uuid === actor.uuid) ?? null).evasion : actor.system.bonus?.[eff.ability] ?? 0,
    bonus: eff.bonus ?? 0, sl: skill.system.sl ?? 1, attack: { total: hit.total, absSuccess: hit.absSuccess, absFailure: hit.absFailure }
  });
  const note = skill.system.effectsNote ? ` (${game.i18n.format("NSSQ.SkillUse.gmNeeded", { what: skill.system.effectsNote })})` : "";
  const text = L(r.evaded ? "evaded" : hit.absSuccess && r.check.total >= hit.total ? "notEvadedAbs" : "notEvaded", { skill: skill.name, dice: r.check.used.join("+"), mod: r.mod, total: r.check.total, vs: hit.total }) + (r.evaded ? note : "");
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), rolls: [roll], sound: CONFIG.sounds.dice, content: `<div class="nssq-combat-note"><i class="fas fa-shield-alt"></i> ${esc(text)}</div>` });
  // 회피 성공 시 반격(《검의 춤》)
  const counter = r.evaded && (skill.system.effects ?? []).some((e) => e?.type === "counter" && e.onlyIfEvaded);
  const counterEff = counter ? { name: skill.name, sl: skill.system.sl ?? 1, key: skill.system.key ?? null, effects: (skill.system.effects ?? []).filter((e) => e?.type === "counter") } : null;
  return send({ messageId: message.id, type, index, result: { evaded: r.evaded, text, ...(ally ? { ally: true } : {}), ...(counter ? { counter: counterEff, reactorUuid: actor.uuid } : {}) } });
}

/* ---------------- 카드 반영(GM) ---------------- */

async function gmReaction({ messageId, type, index, result }) {
  const message = game.messages.get(messageId);
  if (!message) return;
  await updateReaction({ message, messageId, type, index, result });
  if (result.counter) {
    const reactor = await fromUuid(result.reactorUuid);
    const x = result.counter;
    const { counterAfterEvade } = await import("./chase.mjs");
    if (reactor) await counterAfterEvade(message, reactor.uuid, { name: x.name, system: { effects: x.effects ?? [], sl: x.sl ?? 1, key: x.key } });
  }
}

/**
 * 《와이드 패링》 회피 실패: 대상 자신의 선택지가 남아 있으면 그대로 기다린다(원문 「실패하면 대상이 능동 회피」)
 * @returns {boolean} 계속 기다리면 true
 */
function wideFailed(t, result) {
  if (!result.ally || result.evaded) return false;
  const rest = (t.reaction.options ?? []).filter((o) => !String(o.id).startsWith("ally:"));
  if (!rest.length) return false;
  t.reaction = { ...t.reaction, state: "pending", options: rest, prior: result.text };
  return true;
}

/** 《와이드 패링》 보유자가 팝업에서 넘김: 그 보유자의 선택지만 빼고, 남은 것이 없으면 반응 안 함 */
function passAlly(t, result) {
  if (!result.passAlly) return false;
  const rest = (t.reaction.options ?? []).filter((o) => o.holder !== result.passAlly);
  t.reaction = rest.length ? { ...t.reaction, options: rest } : { ...t.reaction, state: "declined" };
  return true;
}

async function updateReaction({ message, messageId, type, index, result }) {
  const { renderAttackCard } = await import("./attack.mjs");
  const { renderSkillCard, applySkillCard } = await import("./skill-use.mjs");
  if (type === "attack") {
    const card = foundry.utils.deepClone(message.getFlag("nssq", "attack"));
    const targets = card.targets;
    const t = targets[index];
    if (t?.reaction?.state !== "pending") return;
    if (result.declined) t.reaction.state = "declined";
    else if (passAlly(t, result) || wideFailed(t, result)) { /* 대상 자신의 능동 회피를 기다린다 */ }
    else {
      t.reaction = { ...t.reaction, state: "used", text: result.text };
      if (result.evaded || result.nullify) Object.assign(t, { hit: false, finalDamage: 0, rawDamage: 0 });
    }
    await message.update({ content: await renderAttackCard(card), "flags.nssq.attack": card });
    if (autoApplyMode() === "auto" && !hasPendingReaction(targets)) {
      const { autoApplyCard } = await import("./apply.mjs");
      await autoApplyCard(game.messages.get(messageId));
    }
    return;
  }
  const card = foundry.utils.deepClone(message.getFlag("nssq", "skillCard"));
  const e = card.entries[index];
  if (e?.reaction?.state !== "pending") return;
  const { groupMessages, groupPendingReaction } = await import("./skill-use.mjs");
  // 다회 공격을 타격마다 나눈 카드: 같은 공격의 다른 카드도 함께 고친다(적용하지 않은 것만)
  const others = card.group ? groupMessages(card).filter((m) => m.id !== message.id && !m.getFlag("nssq", "skillCard").applied)
    .map((m) => ({ m, card: foundry.utils.deepClone(m.getFlag("nssq", "skillCard")), changed: false })) : [];
  const voidEntry = (x) => {
    x.hits = (x.hits ?? []).map((h) => (h.hit ? { ...h, hit: false, final: 0 } : h));
    x.damage = 0;
    x.inflicts = [];
    x.buffs = (x.buffs ?? []).filter((b) => BUFFS[canonicalBuff(b.id)]?.kind !== "debuff");
  };
  if (result.declined) e.reaction.state = "declined";
  else if (passAlly(e, result) || wideFailed(e, result)) { /* 대상 자신의 능동 회피를 기다린다 */ }
  else {
    e.reaction = { ...e.reaction, state: "used", text: result.text };
    if (result.nullify) {
      // 《완전 방어》: 반응한 캐릭터의 같은 편 대상 전부(다회 공격이면 모든 타격)
      const reactor = await fromUuid(result.reactorUuid);
      for (const c of [{ card }, ...others]) {
        for (const x of c.card.entries) {
          const a = x.uuid ? await fromUuid(x.uuid) : null;
          // scope self(《야수의 우정》 「자신이 받는 공격 하나」)면 자신만
          const hitMe = result.selfOnly ? x.uuid === result.reactorUuid : a && reactor && friendly(a, reactor);
          if (hitMe) { voidEntry(x); c.changed = true; }
        }
      }
    } else if (result.evaded) {
      // 처음 명중한 공격 하나를 빗나감으로(공격 롤 1회에 1번). 남은 명중이 없으면 추가 효과도 없음
      const h = e.hits.find((x) => x.hit);
      if (h) { h.hit = false; h.final = 0; }
      e.damage = e.hits.reduce((n, x) => n + (x.hit ? x.final ?? 0 : 0), 0);
      if (card.group) {
        // 타격 카드: 그 타격의 추가 효과는 없어지고, 다른 타격에도 명중이 없으면 그 대상의 나머지 효과(마지막 카드)도
        voidEntry(e);
        const rest = others.flatMap((c) => c.card.entries.filter((x) => x.uuid === e.uuid).map((x) => ({ c, x })));
        if (!rest.some(({ x }) => x.hits?.some((y) => y.hit))) for (const { c, x } of rest) { voidEntry(x); c.changed = true; }
      } else if (!e.hits.some((x) => x.hit)) voidEntry(e);
    }
  }
  await message.update({ content: renderSkillCard(card), "flags.nssq.skillCard": card });
  for (const c of others.filter((x) => x.changed)) await c.m.update({ content: renderSkillCard(c.card), "flags.nssq.skillCard": c.card });
  if (autoApplyMode() !== "auto") return;
  if (!card.group) {
    if (!hasPendingReaction(card.entries)) await applySkillCard(messageId);
    return;
  }
  // 다회 공격: 모든 카드가 나왔고 기다리는 반응이 없으면 마지막 카드까지 한꺼번에
  const list = groupMessages(card);
  const lastMsg = list.at(-1);
  if (list.length === card.group.count && !groupPendingReaction(card)) await applySkillCard(lastMsg.id);
}

/* ---------------- 팝업 ---------------- */

/** 이 캐릭터의 반응을 정할 사용자: 접속 중인 소유 플레이어(그 캐릭터가 배정된 사람 먼저), 없으면 활성 GM */
function responderFor(uuid) {
  const actor = uuid ? fromUuidSync(uuid) : null;
  if (!actor) return null;
  const players = game.users.filter((u) => u.active && !u.isGM && actor.testUserPermission(u, "OWNER"));
  return players.find((u) => u.character?.uuid === actor.uuid) ?? players[0] ?? game.users.activeGM ?? null;
}

const popups = new Map(); // key → 열린 Dialog
const seen = new Set(); // 한 번 띄운(또는 자동으로 쓴) key: 닫아도 다시 띄우지 않는다(카드 버튼은 남음)
let popupQueue = Promise.resolve();

/** 이 카드에서 이 클라이언트가 판단할 반응: [{ key, index, actorUuid, options, holder }] */
function myPending(message) {
  const atk = message.getFlag("nssq", "attack");
  const sk = message.getFlag("nssq", "skillCard");
  const list = atk ? atk.targets : sk?.entries;
  if (!list || (atk ? list.some((t) => t.applied) : sk.applied)) return [];
  const out = [];
  list.forEach((t, index) => {
    const r = t?.reaction;
    if (r?.state !== "pending") return;
    const uuid = atk ? t.actorUuid : t.uuid;
    if (fromUuidSync(uuid)?.type === "enemy") return;
    const ally = r.options.filter((o) => o.holder);
    // 《와이드 패링》이 먼저: 보유자마다 그 보유자에게
    const groups = ally.length ? [...new Set(ally.map((o) => o.holder))].map((h) => ({ holder: h, options: ally.filter((o) => o.holder === h), who: h }))
      : [{ holder: null, options: r.options, who: uuid }];
    for (const g of groups) {
      if (responderFor(g.who)?.id !== game.user.id) continue;
      out.push({ key: `${message.id}:${index}:${g.options.map((o) => o.id).join(",")}`, index, actorUuid: uuid, options: g.options, holder: g.holder, target: t });
    }
  });
  return out;
}

/** 선택지의 스킬 아이템(코스트 표시·「자동」 확인) */
function optionItem(p, o) {
  const m = String(o.id).match(/^ally:(.+):([^:]+)$/);
  const actor = fromUuidSync(m ? m[1] : p.actorUuid);
  return actor?.items.get(m ? m[2] : o.id) ?? null;
}

function scanPopups(message) {
  const type = message.getFlag("nssq", "attack") ? "attack" : message.getFlag("nssq", "skillCard") ? "skill" : null;
  if (!type) return;
  const mine = myPending(message);
  const keys = new Set(mine.map((p) => p.key));
  // 이미 정해진(다른 곳에서 고른) 반응의 팝업은 닫는다
  for (const [k, d] of popups) if (k.startsWith(`${message.id}:`) && !keys.has(k)) { popups.delete(k); d?.close(); }
  for (const p of mine) {
    if (seen.has(p.key)) continue;
    seen.add(p.key);
    // 「자동」을 켠 수동 스킬은 팝업 없이 바로
    const auto = p.options.find((o) => {
      const it = optionItem(p, o);
      return it && !!it.actor?.getFlag("nssq", "autoTrigger")?.[autoKey(it.system.key)];
    });
    if (auto) { useReaction(message, type, p.index, auto.id); continue; }
    // 하나씩 차례로
    popupQueue = popupQueue.then(() => showPopup(message.id, type, p)).catch((e) => console.error(e));
  }
}

function showPopup(messageId, type, p) {
  const message = game.messages.get(messageId);
  if (!message || !myPending(message).some((x) => x.key === p.key)) return null;
  const card = type === "attack" ? message.getFlag("nssq", "attack") : message.getFlag("nssq", "skillCard");
  const t = p.target;
  const hit = type === "attack" ? { total: t.hitTotal, absSuccess: t.absSuccess } : (t.hits ?? []).find((h) => h.hit) ?? {};
  const by = type === "attack" ? (fromUuidSync(card.attackerUuid)?.name ?? "") : card.userName;
  const what = type === "attack" ? card.label : card.name;
  const holder = p.holder ? fromUuidSync(p.holder) : null;
  const content = `<p>${esc(L("popupHead", { by, what, name: t.name }))}</p><p><b>${esc(L("popupHit", { total: hit.total ?? "?" }))}</b>${hit.absSuccess ? ` ${esc(L("popupAbs"))}` : ""}</p>`
    + (holder ? `<p class="notes">${esc(L("popupWide", { holder: holder.name, name: t.name }))}</p>` : "");
  const buttons = {};
  p.options.forEach((o, i) => {
    const c = optionItem(p, o)?.system.cost ?? {};
    const cost = [c.tp ? `TP ${c.tp}` : "", c.fp ? `FP ${c.fp}` : ""].filter(Boolean).join(" ");
    buttons[`o${i}`] = { icon: '<i class="fas fa-shield-alt"></i>', label: esc(L("use", { name: o.name })) + (cost ? ` (${cost})` : ""), callback: () => useReaction(game.messages.get(messageId), type, p.index, o.id) };
  });
  buttons.no = {
    icon: '<i class="fas fa-times"></i>', label: esc(L(holder ? "pass" : "decline")),
    callback: () => send({ messageId, type, index: p.index, result: holder ? { passAlly: p.holder } : { declined: true } })
  };
  try { foundry.audio.AudioHelper.play({ src: CONFIG.sounds.notification, volume: 0.8, autoplay: true, loop: false }, false); } catch { /* 소리 없음 */ }
  return new Promise((resolve) => {
    const d = new Dialog({ title: L("popupTitle"), content, buttons, default: "o0", close: () => { popups.delete(p.key); resolve(); } }, { classes: ["dialog", "nssq-reaction-popup"] });
    popups.set(p.key, d);
    d.render(true);
  });
}

export function registerReaction() {
  onSocket("reaction", (p) => { if (isActiveGM()) gmReaction(p); });
  // 판단할 사람에게 팝업(카드가 생기거나 바뀔 때: 《와이드 패링》 실패 뒤 대상 자신의 차례 등)
  Hooks.on("createChatMessage", (message) => setTimeout(() => scanPopups(message), 300));
  Hooks.on("updateChatMessage", (message) => scanPopups(message));
  // 에너미는 수동 반응을 항상 자동으로(첫 선택지)
  Hooks.on("createChatMessage", (message) => {
    if (!isActiveGM()) return;
    const atk = message.getFlag("nssq", "attack");
    const sk = message.getFlag("nssq", "skillCard");
    const list = atk ? atk.targets : sk?.entries;
    const type = atk ? "attack" : "skill";
    (list ?? []).forEach((t, i) => {
      if (t?.reaction?.state !== "pending") return;
      const a = fromUuidSync(atk ? t.actorUuid : t.uuid);
      if (a?.type === "enemy") setTimeout(() => useReaction(message, type, i, t.reaction.options[0].id), 200 * (i + 1));
    });
  });
}
