/**
 * 토큰(소환수·방진) 전투 연결(단계 8-E). 계산은 engine/tokens.mjs
 * - 캔버스에 놓지 않고 배치자 전투원 플래그 tokens에 둔다. 전투 화면 배치자 카드에 칩(07 #77)
 * - 행동: 메인 페이즈에서 차례가 배치자 자리를 지날 때(배치자가 행동한 뒤, 대기·행동 불가여도) 정해진 행동을 자동으로.
 *   대상은 대상 문구대로 무작위, 사거리 없음(07 #78). 배치자의 능력치로 판정
 * - 종료 페이즈: 남은 턴 −1, 0이면 소멸. 배치자가 쓰러지면 소멸. 소멸하면 배치자의 trigger on tokenGone(《진 환원》)
 */
import { placeToken, removeOldest, tickTokens, tokenTargets } from "../engine/tokens.mjs";
import { friendly } from "./profile.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Token.${k}`, d) : game.i18n.localize(`NSSQ.Token.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const alive = (c) => !!c?.actor && !c.defeated && (c.actor.system.hp?.value ?? 0) > 0;
const note = (actor, text) => ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<div class="nssq-combat-note"><i class="fas fa-paw"></i> ${esc(text)}</div>` });

export const tokensOf = (c) => c?.getFlag("nssq", "tokens") ?? [];
export const tokenEffectOf = (effects) => (effects ?? []).filter((e) => e?.type === "token");

/** 토큰 이름: 「화염도마뱀 소환」 → 「화염도마뱀」, 선언 명칭이 있으면 그것(《큰 새 소환》 → 큰 새) */
function tokenName(item, variant) {
  const base = variant !== null && variant !== undefined && item.system.variants?.[variant] ? item.system.variants[variant] : item.name;
  return String(base).replace(/\s*소환$/, "");
}

/** 배치(스킬 사용 때, 코스트는 이미 냄) */
export async function placeTokens(combat, combatant, item, variant = null) {
  const a = combatant.actor;
  const mods = a.system.equipment?.mods ?? {};
  const max = Number(a.system.passives?.flags?.tokenMax ?? 1) || 1;
  const category = item.system.category && item.system.category !== "-" ? item.system.category : "토큰";
  let list = tokensOf(combatant);
  const gone = [];
  const placed = [];
  for (const e of tokenEffectOf(item.system.effects).filter((x) => x.variant === undefined || x.variant === variant)) {
    // 《방진 마스터리》: 『방진』 토큰의 지속 턴 +(SL/2)
    const left = Math.max(1, Number(e.turns ?? 3) + (category === "방진" ? Math.floor(mods.tokenTurns ?? 0) : 0));
    const token = { id: foundry.utils.randomID(), key: e.tokenKey ?? "", name: tokenName(item, variant), img: item.img, category, left, sl: item.system.sl ?? 1, action: e.action ?? {}, placedRound: combat.round };
    const r = placeToken(list, token, max);
    list = r.list;
    gone.push(...r.removed);
    placed.push(token);
  }
  await combatant.setFlag("nssq", "tokens", list);
  for (const t of placed) await note(a, L("placed", { name: combatant.name, token: t.name, n: t.left }));
  await tokensGone(combatant, gone, "replaced");
}

/** 소멸 안내 + 배치자의 trigger on tokenGone */
async function tokensGone(combatant, gone, why) {
  if (!gone.length || !combatant?.actor) return;
  for (const t of gone) await note(combatant.actor, L(`gone.${why}`, { name: combatant.name, token: t.name }));
  const a = combatant.actor;
  const triggers = a.items.filter((i) => i.type === "skill" && (a.type !== "character" || (i.system.sl ?? 0) > 0))
    .flatMap((i) => (i.system.effects ?? []).filter((e) => e?.type === "trigger" && e.on === "tokenGone").map((e) => ({ i, e })));
  if (!triggers.length || !alive(combatant)) return;
  const { resolveAndPost } = await import("./skill-use.mjs");
  for (let k = 0; k < gone.length; k++) {
    for (const { i, e } of triggers) {
      await resolveAndPost({
        actor: a, combatant, kind: "skill", mainAction: false, followup: { type: "trigger" },
        item: { name: i.name, img: i.img, system: { effects: e.effects ?? [], sl: i.system.sl ?? 1, category: "", description: "", target: "자신" } },
        units: [{ actor: a, combatant }]
      });
    }
  }
}

/** 분류의 토큰 하나를 없앤다(《비스트 귀환》·《야수의 우정》·《파진》). 없앴으면 true */
export async function removeToken(combatant, category) {
  const r = removeOldest(tokensOf(combatant), category);
  if (!r.removed.length) return false;
  await combatant.setFlag("nssq", "tokens", r.list);
  await tokensGone(combatant, r.removed, "removed");
  return true;
}

/** 종료 페이즈: 지속 턴 감소·배치자 쓰러짐 소멸 */
export async function tickAllTokens(combat) {
  for (const c of combat.combatants) {
    const list = tokensOf(c);
    if (!list.length) continue;
    if (!alive(c)) { await c.unsetFlag("nssq", "tokens"); await tokensGone(c, list, "ownerKO"); continue; }
    const r = tickTokens(list);
    await c.setFlag("nssq", "tokens", r.list);
    await tokensGone(c, r.removed, "expired");
  }
}

/** 차례가 이 전투원들 자리를 지날 때: 그들의 토큰이 행동 */
export async function runTokensFor(combat, combatants) {
  for (const c of combatants) {
    const list = tokensOf(c);
    if (!list.length) continue;
    if (!alive(c)) { await c.unsetFlag("nssq", "tokens"); await tokensGone(c, list, "ownerKO"); continue; }
    for (const t of list) await tokenAct(combat, c, t);
  }
}

async function tokenAct(combat, owner, t) {
  const effects = (t.action?.effects ?? []);
  // 행동이 방어뿐인 토큰(《부정형 생물 소환》: 항상 대기)은 차례에 아무것도 하지 않는다
  const acts = effects.filter((e) => e?.type !== "guard");
  if (!acts.length) return;
  const a = owner.actor;
  const foes = combat.combatants.filter((x) => alive(x) && !friendly(x.actor, a))
    .map((x) => ({ id: x.id, row: x.actor.system.row ?? "front", order: x.actor.system.order ?? 0 }));
  const pick = tokenTargets(t.action?.target, foes, () => CONFIG.Dice.randomUniform());
  const units = pick.scope === "self" ? [owner] : pick.ids.map((id) => combat.combatants.get(id)).filter(Boolean);
  if (!units.length) return note(a, L("noTarget", { token: t.name }));
  // 《수왕 마스터리》: 『소환수』 토큰의 공격 명중 +(SL/2)
  const hit = t.category === "소환수" ? Math.floor(a.system.equipment?.mods?.tokenHit ?? 0) : 0;
  const withHit = hit ? acts.map((e) => (e.type === "attack" ? { ...e, hitMod: `(${e.hitMod ?? 0})+${hit}` } : e)) : acts;
  const { resolveAndPost } = await import("./skill-use.mjs");
  await resolveAndPost({
    actor: a, combatant: owner, kind: "skill", mainAction: false, followup: { type: "token" },
    item: { name: L("cardName", { token: t.name }), img: t.img, system: { effects: withHit, sl: t.sl ?? 1, category: "", description: "", target: pick.scope === "single" ? "적 단일" : pick.scope === "all" ? "적 전체" : "적 열" } },
    units: units.map((u) => ({ actor: u.actor, combatant: u }))
  });
}

/**
 * 가드용: 배치자의 토큰 중 방어 효과(《부정형 생물》 nullify)를 대기 상태처럼 보이게(guard.mjs). 턴에 1회
 */
export function tokenStances(combat, c) {
  return tokensOf(c).filter((t) => (t.action?.effects ?? []).some((e) => e?.type === "guard"))
    .map((t) => ({ id: `tk:${t.id}`, name: t.name, key: t.key, sl: t.sl ?? 1, left: t.usedRound === combat.round ? 0 : 1, guardTargets: [c.id], effects: (t.action.effects ?? []).filter((e) => e?.type === "guard") }));
}

/** 가드에서 쓴 토큰 표시(이번 턴 사용) */
export async function spendTokenStance(c, stanceId, round) {
  const id = String(stanceId).replace(/^tk:/, "");
  await c.setFlag("nssq", "tokens", tokensOf(c).map((t) => (t.id === id ? { ...t, usedRound: round } : t)));
}
