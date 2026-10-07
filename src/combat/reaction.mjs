/**
 * 수동 반응(단계 6-C): 공격 카드·스킬 결과 카드에서 대상이 「수동」 스킬로 반응한다.
 * - 카드를 만들 때 대상이 쓸 수 있는 수동 스킬이 있으면 reaction: { state: "pending", options } 를 붙인다(명중한 대상만)
 * - 그 캐릭터 소유자·GM에게 [수동: 《패링》]·[반응 안 함] 버튼. 공격 롤 1회에 1번(01 §3.5)
 * - 능동 회피(대항 판정, 07 #51)·《완전 방어》(대미지 0·추가 효과 무효). 결과는 활성 GM이 카드에 반영
 * - 자동 적용 「즉시」라도 반응을 기다리는 대상이 있으면 적용을 미룬다(반응하거나 [반응 안 함]·[적용]으로 진행)
 */
import { activeEvade, reactionEffect } from "../engine/effects/reaction.mjs";
import { meetsStateReq, meetsWeaponReq, PART_BIND } from "../engine/effects/usage.mjs";
import { BUFFS, canonicalBuff } from "../engine/buffs.mjs";
import { autoApplyMode, isActiveGM } from "./apply.mjs";
import { friendly } from "./profile.mjs";
import { emit, onSocket } from "../socket.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Reaction.${k}`, d) : game.i18n.localize(`NSSQ.Reaction.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** 이 캐릭터가 이 공격(kind)에 쓸 수 있는 수동 스킬 */
export function reactionChoices(actor, kind) {
  if (!actor || actor.type !== "character") return [];
  const s = actor.system;
  const conds = s.conditions ?? [];
  if (conds.some((c) => ["petrify", "sleep", "stun"].includes(c.id))) return [];
  return actor.items.filter((i) => i.type === "skill" && i.system.timing === "수동" && (i.system.sl ?? 0) > 0 && reactionEffect(i.system.effects, kind))
    .filter((i) => (i.system.cost?.tp ?? 0) <= (s.tp?.value ?? 0) && (i.system.cost?.fp ?? 0) <= (s.fp?.value ?? 0))
    .filter((i) => !(PART_BIND[i.system.part] && conds.some((c) => c.id === PART_BIND[i.system.part])))
    .filter((i) => meetsWeaponReq(i.system.weaponReq, { weaponType: s.equipment?.weapon?.weaponType, shield: !!s.equipment?.shield }))
    .filter((i) => meetsStateReq(i.system.effects, { states: (actor.getFlag("nssq", "states") ?? []).map((x) => x.id) }))
    .map((i) => ({ id: i.id, name: i.name }));
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
    if (r.state === "used") box.innerHTML = `<i class="fas fa-shield-alt"></i> ${esc(r.text ?? "")}`;
    else if (r.state === "declined") box.innerHTML = `<span class="notes">${esc(L("declined"))}</span>`;
    else if (r.state === "pending" && !applied) {
      const actor = fromUuidSync(type === "attack" ? t.actorUuid : t.uuid);
      if (!actor?.isOwner) {
        box.innerHTML = `<span class="notes">${esc(L("waiting", { name: t.name }))}</span>`;
      } else {
        box.innerHTML = r.options.map((o) => `<button type="button" data-react="${o.id}"><i class="fas fa-shield-alt"></i> ${esc(L("use", { name: o.name }))}</button>`).join("")
          + `<button type="button" data-react-decline>${esc(L("decline"))}</button>`;
        box.querySelectorAll("[data-react]").forEach((b) => b.addEventListener("click", () => useReaction(message, type, i, b.dataset.react)));
        box.querySelector("[data-react-decline]")?.addEventListener("click", () => send({ messageId: message.id, type, index: i, result: { declined: true } }));
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
  const actor = await fromUuid(type === "attack" ? t.actorUuid : t.uuid);
  const skill = actor?.items.get(skillId);
  if (!skill) return;
  const kind = type === "attack" ? card.kind : (t.hits.find((h) => h.hit)?.kind ?? "physical");
  const eff = reactionEffect(skill.system.effects, kind);
  if (!eff) return;
  // 코스트
  const c = skill.system.cost ?? {};
  const upd = {};
  if (c.tp) upd["system.tp.value"] = Math.max(0, (actor.system.tp?.value ?? 0) - c.tp);
  if (c.fp) upd["system.fp.value"] = Math.max(0, (actor.system.fp?.value ?? 0) - c.fp);
  if (Object.keys(upd).length) await actor.update(upd);

  if (eff.type === "nullify") {
    const text = L("nullified", { skill: skill.name, name: actor.name });
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<div class="nssq-combat-note"><i class="fas fa-shield-alt"></i> ${esc(text)}</div>` });
    return send({ messageId: message.id, type, index, result: { nullify: true, reactorUuid: actor.uuid, text } });
  }
  // 능동 회피: 공격자의 명중 판정(카드의 달성값)과 대항
  const hit = type === "attack" ? { total: t.hitTotal, absSuccess: t.absSuccess, absFailure: t.absFailure } : t.hits.find((h) => h.hit);
  const roll = await new Roll("2d6").evaluate();
  const r = activeEvade({
    dice: roll.dice[0].results.map((x) => x.result), abilityBonus: actor.system.bonus?.[eff.ability] ?? 0,
    bonus: eff.bonus ?? 0, sl: skill.system.sl ?? 1, attack: { total: hit.total, absSuccess: hit.absSuccess, absFailure: hit.absFailure }
  });
  const note = skill.system.effectsNote ? ` (${game.i18n.format("NSSQ.SkillUse.gmNeeded", { what: skill.system.effectsNote })})` : "";
  const text = L(r.evaded ? "evaded" : "notEvaded", { skill: skill.name, dice: r.check.used.join("+"), mod: r.mod, total: r.check.total, vs: hit.total }) + (r.evaded ? note : "");
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), rolls: [roll], sound: CONFIG.sounds.dice, content: `<div class="nssq-combat-note"><i class="fas fa-shield-alt"></i> ${esc(text)}</div>` });
  return send({ messageId: message.id, type, index, result: { evaded: r.evaded, text } });
}

/* ---------------- 카드 반영(GM) ---------------- */

async function gmReaction({ messageId, type, index, result }) {
  const message = game.messages.get(messageId);
  if (!message) return;
  const { renderAttackCard } = await import("./attack.mjs");
  const { renderSkillCard, applySkillCard } = await import("./skill-use.mjs");
  if (type === "attack") {
    const card = foundry.utils.deepClone(message.getFlag("nssq", "attack"));
    const targets = card.targets;
    const t = targets[index];
    if (t?.reaction?.state !== "pending") return;
    if (result.declined) t.reaction.state = "declined";
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
  else {
    e.reaction = { ...e.reaction, state: "used", text: result.text };
    if (result.nullify) {
      // 《완전 방어》: 반응한 캐릭터의 같은 편 대상 전부(다회 공격이면 모든 타격)
      const reactor = await fromUuid(result.reactorUuid);
      for (const c of [{ card }, ...others]) {
        for (const x of c.card.entries) {
          const a = x.uuid ? await fromUuid(x.uuid) : null;
          if (a && reactor && friendly(a, reactor)) { voidEntry(x); c.changed = true; }
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

export function registerReaction() {
  onSocket("reaction", (p) => { if (isActiveGM()) gmReaction(p); });
}
