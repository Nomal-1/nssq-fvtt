/**
 * 명중 판정의 【FP】(01 #26 사용자 결정): 명중 판정도 일반 행위 판정이므로
 * - 주사위 추가: 공격 전에 「FP 주사위 +n」을 선언(액터 플래그 nssq.fpDice). 다음 공격의 명중 판정마다 n개씩, 남은 【FP】가 닿는 데까지(판정마다 n점).
 *   굴린 것 중 높은 2개를 쓰고, 늘린 판정은 【FP】를 얻지 않는다(엔진 resolveAttack fpDice)
 * - 다시 굴리기: 공격 카드의 명중 줄마다 [FP로 다시 굴리기](【FP】 1, 판정당 1번). 그 대상의 명중·대미지를 새로 굴린다.
 *   이미 적용했으면 되돌리고 다시 굴린 뒤, 자동 적용 「즉시」면 다시 적용한다. 활성 GM이 처리(소켓)
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
export async function spendFpDice(actor, spent) {
  if (actor?.type !== "character") return;
  const upd = {};
  if (spent > 0) upd["system.fp.value"] = Math.max(0, (actor.system.fp?.value ?? 0) - spent);
  if (actor.getFlag("nssq", "fpDice")) upd["flags.nssq.-=fpDice"] = null;
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

/** 활성 GM: 통상 공격 카드의 대상 index를 다시 굴린다 */
async function rerollAttack(message, index) {
  const card = foundry.utils.deepClone(message.getFlag("nssq", "attack"));
  const t = card?.targets?.[index];
  if (!t || t.rerolled || !t.params) return;
  const attacker = await fromUuid(card.attackerUuid);
  if ((attacker?.system.fp?.value ?? 0) < REROLL_COST) return;
  if (t.applied) await requestApply(message.id, index, true);
  const fresh = foundry.utils.deepClone(game.messages.get(message.id).getFlag("nssq", "attack"));
  const rolls = [];
  const r = await resolveAttack({ ...t.params, rerolled: true, rollDice: (n) => rollWith(rolls, n) });
  await showRolls(rolls);
  const target = await fromUuid(t.actorUuid);
  const { pendingReaction } = await import("./reaction.mjs");
  fresh.targets[index] = { ...fresh.targets[index], ...attackFields(r), applied: false, before: null, after: null, reaction: pendingReaction(target, "physical", r.hit) };
  await attacker.update({ "system.fp.value": Math.max(0, attacker.system.fp.value - REROLL_COST) });
  const { renderAttackCard } = await import("./attack.mjs");
  await message.update({ content: await renderAttackCard(fresh), "flags.nssq.attack": fresh });
  if (autoApplyMode() === "auto" && r.hit && !fresh.targets[index].reaction) await requestApply(message.id, index, false);
}

/** 활성 GM: 스킬 카드의 대상 index·명중 seq를 다시 굴린다 */
async function rerollSkill(message, index, seq) {
  const card = foundry.utils.deepClone(message.getFlag("nssq", "skillCard"));
  const e = card?.entries?.[index];
  const h = e?.hits?.find((x) => x.seq === seq);
  if (!h || h.rerolled || !h.params) return;
  const user = card.userUuid ? await fromUuid(card.userUuid) : null;
  if ((user?.system.fp?.value ?? 0) < REROLL_COST) return;
  const { applySkillCard, renderSkillCard } = await import("./skill-use.mjs");
  if (card.applied) await applySkillCard(message.id, true);
  const fresh = foundry.utils.deepClone(game.messages.get(message.id).getFlag("nssq", "skillCard"));
  const fe = fresh.entries[index];
  const fh = fe.hits.find((x) => x.seq === seq);
  const wasHit = !!fh.hit;
  const rolls = [];
  const r = await resolveAttack({ ...fh.params, rerolled: true, rollDice: (n) => rollWith(rolls, n) });
  await showRolls(rolls);
  Object.assign(fh, {
    hit: r.hit, total: r.hitCheck.total, absSuccess: r.hitCheck.absSuccess, absFailure: r.hitCheck.absFailure, dice: r.hitCheck.used,
    diceCount: r.diceCount ?? 0, dmg: r.damage?.dice ?? [], crit: !!r.crit, final: r.finalDamage ?? 0, resist: r.resist, raw: r.rawDamage ?? 0,
    rolled: r.hitCheck.rolled, fpDice: 0, rerolled: true
  });
  fe.damage = fe.hits.reduce((n, x) => n + (x.hit ? x.final ?? 0 : 0), 0) + (fe.extra?.add ?? 0);
  // 빗나가게 되면 그 명중에서 생긴 추가 효과(seq)를 없앤다. 새로 명중하면 추가 효과는 다시 계산하지 않으므로 GM 판단
  if (wasHit && !r.hit) for (const k of ["inflicts", "buffs", "resource"]) fe[k] = (fe[k] ?? []).filter((x) => x.seq !== seq);
  if (!wasHit && r.hit) fresh.gm = [...new Set([...(fresh.gm ?? []), "rerollHit"])];
  if (!r.hit) fe.reaction = null;
  else if (!fe.reaction) {
    const target = fe.uuid ? await fromUuid(fe.uuid) : null;
    fe.reaction = (await import("./reaction.mjs")).pendingReaction(target, fh.kind ?? "physical", true);
  }
  await user.update({ "system.fp.value": Math.max(0, user.system.fp.value - REROLL_COST) });
  await message.update({ content: renderSkillCard(fresh), "flags.nssq.skillCard": fresh });
  const { hasPendingReaction } = await import("./reaction.mjs");
  if (autoApplyMode() === "auto" && !hasPendingReaction(fresh.entries) && (!fresh.group || fresh.group.index === fresh.group.count)) await applySkillCard(message.id);
}

const queue = { p: Promise.resolve() };
function gmReroll({ messageId, type, index, seq }) {
  queue.p = queue.p.then(async () => {
    const message = game.messages.get(messageId);
    if (!message) return;
    if (type === "attack") await rerollAttack(message, index);
    else await rerollSkill(message, index, seq);
  }).catch((err) => console.error("NSSQ | fp reroll", err));
  return queue.p;
}

export function requestReroll(payload) {
  return isActiveGM() ? gmReroll(payload) : emit("fpReroll", payload);
}

export function registerFpDice() {
  onSocket("fpReroll", (p) => { if (isActiveGM()) gmReroll(p); });
  // 버튼: 공격자 소유자에게만, 남은 【FP】가 모자라면 끈다
  Hooks.on("renderChatMessage", (message, html) => {
    const el = html[0] ?? html;
    const atk = message.getFlag("nssq", "attack");
    const sk = message.getFlag("nssq", "skillCard");
    const owner = fromUuidSync((atk?.attackerUuid ?? sk?.userUuid) || "");
    el.querySelectorAll(".fp-reroll").forEach((b) => {
      if (!owner?.isOwner || owner.type !== "character") { b.remove(); return; }
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
