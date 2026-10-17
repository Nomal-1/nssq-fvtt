/**
 * 명중 판정의 【FP】(01 #26 사용자 결정): 명중 판정도 일반 행위 판정이므로
 * - 주사위 추가: 공격 전에 「FP 주사위 +n」을 선언(액터 플래그 nssq.fpDice). 다음 공격의 명중 판정마다 n개씩, 남은 【FP】가 닿는 데까지(판정마다 n점).
 *   굴린 것 중 높은 2개를 쓰고, 늘린 판정은 【FP】를 얻지 않는다(엔진 resolveAttack fpDice)
 * - 다시 굴리기: 공격 카드의 명중 줄마다 [FP로 다시 굴리기](【FP】 1, 판정당 1번). 그 대상의 명중·대미지를 새로 굴린다.
 *   이미 적용했으면 되돌리고 다시 굴린 뒤, 자동 적용 「즉시」면 다시 적용한다. 활성 GM이 처리(소켓)
 *   스킬 카드: 빗나감 → 명중이면 그 공격의 명중 시 효과(onHit: 부여·강화·흡수·자신 【TP】 등)를 이제 계산해 붙이고,
 *   명중 → 빗나감이면 그 명중에서 생긴 것(같은 회차 seq, 대상·사용자 모두)을 뺀다.
 *   행동 전체의 대미지로 정해지는 효과(반동·《블랙 사바스》 회복)가 있는 스킬은 버튼을 두지 않는다(skill-use.mjs noReroll)
 */
import { resolveAttack } from "../engine/combat.mjs";
import { REROLL_COST } from "../engine/check.mjs";
import { autoApplyMode, isActiveGM, requestApply } from "./apply.mjs";
import { emit, onSocket } from "../socket.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.FpDice.${k}`, d) : game.i18n.localize(`NSSQ.FpDice.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** 선언한 주사위 수(캐릭터만) */
export const declaredFpDice = (actor) => (actor?.type === "character" ? Math.max(0, Number(actor.getFlag("nssq", "fpDice")) || 0) : 0);

/** 공격 뒤: 쓴 【FP】를 빼고 선언을 지운다 */
export async function spendFpDice(actor, spent, { keep = false } = {}) {
  if (actor?.type !== "character") return;
  const upd = {};
  if (spent > 0) upd["system.fp.value"] = Math.max(0, (actor.system.fp?.value ?? 0) - spent);
  // keep: 같은 행동의 다음 공격(쌍수 2회째)도 선언을 쓴다
  if (!keep && actor.getFlag("nssq", "fpDice")) upd["flags.nssq.-=fpDice"] = null;
  if (Object.keys(upd).length) await actor.update(upd);
}

/** 전투 화면 FP 칸을 눌렀을 때: 다음 공격의 명중 판정에 더할 주사위 수 */
export async function openFpDiceDialog(actor) {
  if (!actor?.isOwner || actor.type !== "character") return null;
  const fp = actor.system.fp?.value ?? 0;
  const cur = declaredFpDice(actor);
  const n = await Dialog.prompt({
    title: L("title", { name: actor.name }),
    content: `<form><p class="notes">${esc(L("hint"))}</p>
      <div class="form-group"><label>${esc(L("label", { fp }))}</label><input type="number" name="n" min="0" max="${fp}" value="${Math.min(cur, fp)}"/></div></form>`,
    label: L("ok"), rejectClose: false, options: { classes: ["nssq", "dialog"] },
    callback: (html) => Math.clamp(Number(html[0].querySelector("[name=n]").value) || 0, 0, fp)
  });
  if (n === null || n === undefined) return null;
  return n ? actor.setFlag("nssq", "fpDice", n) : actor.unsetFlag("nssq", "fpDice");
}

/** 카드 표시용: 늘린 주사위·다시 굴림 표시 */
export function fpNote(h) {
  const parts = [];
  if (h?.fpDice) parts.push(L("added", { n: h.fpDice, dice: (h.rolled ?? []).join(",") }));
  if (h?.rerolled) parts.push(L("rerolledTag"));
  return parts.length ? ` <em class="fp-note">${esc(parts.join(" · "))}</em>` : "";
}

/** 다시 굴리기 버튼(판정당 1번, 공격자 소유자만 보이게는 렌더 훅에서) */
export const rerollButton = (attrs) => `<button type="button" class="fp-reroll" ${attrs} title="${esc(L("rerollHint", { cost: REROLL_COST }))}"><i class="fas fa-redo"></i> ${esc(L("reroll"))}</button>`;

async function rollWith(rolls, n) {
  const r = await new Roll(`${n}d6`).evaluate();
  rolls.push(r);
  return r.dice[0].results.map((x) => x.result);
}

/** 다시 굴린 결과를 공격 카드 대상 줄 형식으로 */
function attackFields(r) {
  return {
    hit: r.hit, hitDice: r.hitCheck.used, hitTotal: r.hitCheck.total, absSuccess: r.hitCheck.absSuccess, absFailure: r.hitCheck.absFailure,
    resist: r.resist ?? null, diceCount: r.diceCount ?? 0, damageDice: r.damage?.dice ?? [], critDice: r.critExtra?.dice ?? [],
    crit: !!r.crit, rawDamage: r.rawDamage ?? 0, guarded: !!r.guarded, guardHalf: !!r.guardHalf, finalDamage: r.finalDamage ?? 0,
    rolled: r.hitCheck.rolled, fpDice: 0, rerolled: true
  };
}

async function showRolls(rolls) {
  if (!game.dice3d) return;
  for (const r of rolls) await game.dice3d.showForRoll(r, game.user, true).catch(() => {});
}

/** 다시 굴리기: 플레이어 캐릭터면 그 플레이어 화면에 명중·대미지 팝업(combat/dice-flow.mjs), 아니면 바로 */
async function rerollWith(attacker, target, name, params, rolls) {
  const { usePopup, resolveWithPopups, hiddenStats } = await import("./dice-flow.mjs");
  if (!usePopup(attacker)) return resolveAttack({ ...params, rerolled: true, rollDice: (n) => rollWith(rolls, n) });
  const out = await resolveWithPopups((roll) => resolveAttack({ ...params, rerolled: true, rollDice: (n, m) => roll(n, m && { ...m, targetId: "t" }) }),
    { title: game.i18n.format("NSSQ.DiceFlow.rerollTitle", { name }), nameOf: () => name, known: () => !hiddenStats(target), rolls, actor: attacker });
  return out.result;
}

/** 활성 GM: 통상 공격 카드의 대상 index를 다시 굴린다 */
async function rerollAttack(message, index, by) {
  const card = foundry.utils.deepClone(message.getFlag("nssq", "attack"));
  const t = card?.targets?.[index];
  // 수동 반응(능동 회피·《완전 방어》)이 이미 쓰였으면 그 판정은 끝났다
  if (!t || t.rerolled || !t.params || t.reaction?.state === "used") return;
  const attacker = await fromUuid(card.attackerUuid);
  if (!mayReroll(attacker, by) || (attacker?.system.fp?.value ?? 0) < REROLL_COST) return;
  if (t.applied) await requestApply(message.id, index, true);
  const fresh = foundry.utils.deepClone(game.messages.get(message.id).getFlag("nssq", "attack"));
  const rolls = [];
  const target = await fromUuid(t.actorUuid);
  const r = await rerollWith(attacker, target, t.name, t.params, rolls);
  await showRolls(rolls);
  const { pendingReaction } = await import("./reaction.mjs");
  fresh.targets[index] = { ...fresh.targets[index], ...attackFields(r), applied: false, before: null, after: null, reaction: pendingReaction(target, "physical", r.hit) };
  // 처음 판정의 1로 얻은 【FP】는 다시 굴리면 얻지 못한 것이 된다(원문 「다시 굴리기 전에 1이 나왔더라도 얻을 수 없다」)
  const lost = fresh.fpGain ?? 0;
  fresh.fpGain = 0;
  await attacker.update({ "system.fp.value": Math.max(0, attacker.system.fp.value - REROLL_COST - lost) });
  const { renderAttackCard } = await import("./attack.mjs");
  await message.update({ content: await renderAttackCard(fresh), "flags.nssq.attack": fresh });
  if (autoApplyMode() === "auto" && r.hit && !fresh.targets[index].reaction) await requestApply(message.id, index, false);
}

/** 활성 GM: 스킬 카드의 대상 index·명중 seq를 다시 굴린다 */
async function rerollSkill(message, index, seq, by) {
  const card = foundry.utils.deepClone(message.getFlag("nssq", "skillCard"));
  const e = card?.entries?.[index];
  const h = e?.hits?.find((x) => x.seq === seq);
  if (!h || h.rerolled || !h.params || e.reaction?.state === "used") return;
  const user = card.userUuid ? await fromUuid(card.userUuid) : null;
  if (!mayReroll(user, by) || (user?.system.fp?.value ?? 0) < REROLL_COST) return;
  const { applySkillCard, renderSkillCard } = await import("./skill-use.mjs");
  if (card.applied) await applySkillCard(message.id, true);
  const fresh = foundry.utils.deepClone(game.messages.get(message.id).getFlag("nssq", "skillCard"));
  const fe = fresh.entries[index];
  const fh = fe.hits.find((x) => x.seq === seq);
  const wasHit = !!fh.hit;
  const rolls = [];
  const r = await rerollWith(user, e.uuid ? await fromUuid(e.uuid) : null, e.name, fh.params, rolls);
  await showRolls(rolls);
  Object.assign(fh, {
    hit: r.hit, total: r.hitCheck.total, absSuccess: r.hitCheck.absSuccess, absFailure: r.hitCheck.absFailure, dice: r.hitCheck.used,
    diceCount: r.diceCount ?? 0, dmg: r.damage?.dice ?? [], crit: !!r.crit, final: r.finalDamage ?? 0, resist: r.resist, raw: r.rawDamage ?? 0,
    rolled: r.hitCheck.rolled, fpDice: 0, rerolled: true
  });
  fe.damage = fe.hits.reduce((n, x) => n + (x.hit ? x.final ?? 0 : 0), 0) + (fe.extra?.add ?? 0);
  // 빗나가게 되면 그 명중에서 생긴 것(같은 회차, 대상·사용자 모두)을 없앤다
  if (wasHit && !r.hit) {
    for (const x of fresh.entries) for (const k of ["inflicts", "buffs", "resource"]) x[k] = (x[k] ?? []).filter((y) => y.seq !== seq);
    // 그래서 빈 줄이 된 사용자 줄은 뺀다
    const empty = (x) => !x.hits?.length && !x.damage && !x.heal?.hp && !x.heal?.tp && ![x.inflicts, x.buffs, x.resource, x.cures, x.states, x.stances].some((l) => l?.length);
    fresh.entries = fresh.entries.filter((x) => x === fe || !empty(x));
  }
  // 새로 명중하면 그 공격의 명중 시 효과를 지금 계산한다
  if (!wasHit && r.hit && fh.onHit?.length) await addOnHit(fresh, fe, fh, r, user, rolls);
  // [수면]: 명중하면 깨고, 빗나가면 이 명중으로 깬 것을 거둔다(01 #37)
  const target = fe.uuid ? await fromUuid(fe.uuid) : null;
  if (r.hit && !fe.sleepBroken && (target?.system.conditions ?? []).some((c) => c.id === "sleep")) { fh.woke = true; fe.sleepBroken = true; }
  if (!r.hit && fh.woke) {
    fh.woke = false;
    fe.sleepBroken = fe.hits.some((x) => x.woke);
    for (const i of fe.inflicts ?? []) if (i.broken === seq) delete i.broken;
  }
  const { groupMessages, groupPendingReaction } = await import("./skill-use.mjs");
  const { hasPendingReaction, pendingReaction } = await import("./reaction.mjs");
  if (!r.hit) fe.reaction = null;
  else if (!fe.reaction) {
    // 같은 대상을 여러 번 치는 공격은 그 대상에게 반응 1번(01 #54): 다른 타격 카드에 이미 반응이 있으면 새로 두지 않는다
    const others = fresh.group && !fresh.group.random ? groupMessages(fresh).filter((m) => m.id !== message.id) : [];
    const already = others.some((m) => (m.getFlag("nssq", "skillCard").entries ?? []).some((x) => x.uuid === fe.uuid && x.reaction));
    if (!already) fe.reaction = pendingReaction(target, fh.kind ?? "physical", true);
  }
  // 처음 판정의 1로 얻은 【FP】(행동의 첫 명중 판정)는 다시 굴리면 얻지 못한 것이 된다
  const lost = fh.seq === 1 ? fresh.fpGain ?? 0 : 0;
  if (lost) fresh.fpGain = 0;
  await user.update({ "system.fp.value": Math.max(0, user.system.fp.value - REROLL_COST - lost) });
  await message.update({ content: renderSkillCard(fresh), "flags.nssq.skillCard": fresh });
  if (autoApplyMode() !== "auto") return;
  if (!fresh.group) { if (!hasPendingReaction(fresh.entries)) await applySkillCard(message.id); return; }
  // 다회 공격: 되돌린 뒤 카드가 모두 있고 기다리는 반응이 없으면 마지막 카드까지 다시 적용
  const list = groupMessages(fresh);
  if (list.length === fresh.group.count && !groupPendingReaction(fresh)) await applySkillCard(list.at(-1).id);
}

/** 그 카드의 공격자를 소유한 사용자(또는 GM)만 다시 굴릴 수 있다 */
function mayReroll(actor, userId) {
  const u = game.users.get(userId);
  return !!actor && !!u && (u.isGM || actor.testUserPermission(u, "OWNER"));
}

/** 다시 굴려 새로 명중한 공격의 onHit(부여·강화·흡수 등)를 계산해 카드에 붙인다(회차 seq를 달아 다음에 빼거나 적용할 수 있게) */
async function addOnHit(card, fe, fh, r, user, rolls) {
  const { unitProfile } = await import("./skill-use.mjs");
  const { resolveEffects } = await import("../engine/effects/resolve.mjs");
  const combat = game.combat;
  const cOf = (a) => combat?.combatants.find((c) => c.actor?.uuid === a?.uuid) ?? null;
  const target = fe.uuid ? await fromUuid(fe.uuid) : null;
  if (!target || !user) return;
  const u = unitProfile(user, cOf(user));
  const t = unitProfile(target, cOf(target));
  const out = await resolveEffects({
    effects: fh.onHit, sl: card.sl ?? 1, user: u, targets: [t], mainAction: false, lastHit: r,
    rollDice: (n) => rollWith(rolls, n), rng: () => CONFIG.Dice.randomUniform(), category: card.category ?? "", source: card.kind ?? "skill"
  });
  const tag = (list) => (list ?? []).map((x) => ({ ...x, seq: fh.seq }));
  const merge = (entry, x) => {
    if (!x) return;
    entry.inflicts = [...(entry.inflicts ?? []), ...tag(x.inflicts)];
    entry.buffs = [...(entry.buffs ?? []), ...tag(x.buffs)];
    entry.resource = [...(entry.resource ?? []), ...tag(x.resource)];
  };
  merge(fe, out.results.get(t.id));
  // 사용자 자신에게 오는 것(toSelf·흡수): 사용자 줄에(없으면 만든다)
  const mine = out.results.get(u.id);
  if (mine && u.id !== t.id && (mine.inflicts?.length || mine.buffs?.length || mine.resource?.length)) {
    let ue = card.entries.find((x) => x.uuid === user.uuid);
    if (!ue) {
      ue = { uuid: user.uuid, name: card.userName ?? user.name, damage: 0, heal: { hp: 0, tp: 0 }, inflicts: [], buffs: [], cures: [], resource: [], states: [], stances: [], hits: [], applied: false, before: null, reaction: null };
      card.entries.push(ue);
    }
    merge(ue, mine);
  }
}

/** 판정 메시지인가(주사위를 굴렸거나 공격·스킬·판정·종료 페이즈·탐색·갈무리 카드) */
const JUDGE_FLAGS = ["attack", "skillCard", "check", "endPhase", "explore", "loot", "dungeonEvent"];
const isJudgment = (m) => !!m?.rolls?.length || JUDGE_FLAGS.some((k) => m?.getFlag("nssq", k));

/**
 * 다시 굴릴 수 있는가: 그 카드 뒤에 다른 판정이 나오지 않았을 때만(사용자 결정 01 #26).
 * 같은 다회 공격의 다른 타격 카드는 「다른 판정」으로 치지 않는다. 반응(능동 회피)·추격·반격은 다른 판정이다
 */
export function canRerollNow(message) {
  const list = game.messages.contents;
  const i = list.findIndex((m) => m.id === message?.id);
  if (i < 0) return false;
  const group = message.getFlag("nssq", "skillCard")?.group?.id ?? null;
  return !list.slice(i + 1).some((m) => isJudgment(m) && !(group && m.getFlag("nssq", "skillCard")?.group?.id === group));
}

const queue = { p: Promise.resolve() };
function gmReroll({ messageId, type, index, seq, by }) {
  queue.p = queue.p.then(async () => {
    const message = game.messages.get(messageId);
    if (!message || !canRerollNow(message)) return ui.notifications.warn(L("tooLate"));
    if (type === "attack") await rerollAttack(message, index, by);
    else await rerollSkill(message, index, seq, by);
  }).catch((err) => console.error("NSSQ | fp reroll", err));
  return queue.p;
}

export function requestReroll(payload) {
  // 누른 사람 쪽에서도 먼저 본다(버튼이 사라지기 전에 누른 경우 등)
  if (!canRerollNow(game.messages.get(payload.messageId))) return ui.notifications.warn(L("tooLate"));
  payload = { ...payload, by: game.user.id };
  return isActiveGM() ? gmReroll(payload) : emit("fpReroll", payload);
}

export function registerFpDice() {
  onSocket("fpReroll", (p) => { if (isActiveGM()) gmReroll(p); });
  // 새 판정이 나오면 앞 카드들의 다시 굴리기 버튼을 거둔다
  Hooks.on("createChatMessage", (m) => {
    if (!isJudgment(m)) return;
    setTimeout(() => document.querySelectorAll(".chat-message .fp-reroll").forEach((b) => {
      const msg = game.messages.get(b.closest("[data-message-id]")?.dataset.messageId);
      if (!msg || !canRerollNow(msg)) b.remove();
    }), 100);
  });
  // 버튼: 공격자 소유자에게만, 남은 【FP】가 모자라면 끈다
  Hooks.on("renderChatMessage", (message, html) => {
    const el = html[0] ?? html;
    const atk = message.getFlag("nssq", "attack");
    const sk = message.getFlag("nssq", "skillCard");
    const owner = fromUuidSync((atk?.attackerUuid ?? sk?.userUuid) || "");
    el.querySelectorAll(".fp-reroll").forEach((b) => {
      const i = Number(b.closest("[data-index]")?.dataset.index ?? 0);
      const reacted = (atk ? atk.targets?.[i] : sk?.entries?.[i])?.reaction?.state === "used";
      if (!owner?.isOwner || owner.type !== "character" || !canRerollNow(message) || reacted) { b.remove(); return; }
      if ((owner.system.fp?.value ?? 0) < REROLL_COST) b.disabled = true;
      b.addEventListener("click", (ev) => {
        ev.preventDefault();
        b.disabled = true;
        const row = b.closest("[data-index]");
        requestReroll({ messageId: message.id, type: atk ? "attack" : "skill", index: Number(row?.dataset.index ?? 0), seq: Number(b.dataset.seq ?? 0) });
      });
    });
  });
}
