/**
 * 그 밖의 트리거(단계 8-F): 전투 중 일이 생겼을 때 스킬의 trigger 효과를 실행한다(활성 GM).
 *   enemyKO(자신의 공격으로 적을 쓰러뜨림) · damaged(적의 공격 롤로 대미지) · hpLost(【HP】 감소) · beforeKO(전투 불능이 될 때)
 *   conditionGained(상태 이상·봉인이 걸리는 순간) · buffGained(강화를 얻음) · endPhase · openingPhase · battleWon
 * 의무·에너미·「자동」 토글은 바로, 선택형(「사용을 선언한다」)은 채팅 카드 [선언]/[안 함](combat/chase.mjs 버튼 공용)
 * limit perBattle: 전투원 플래그 usedTriggers(라운드마다 지우지 않음)
 */
import { autoKey } from "../engine/triggers.mjs";
import { whenMatches } from "../engine/effects/when.mjs";
import { evaluate } from "../engine/expr.mjs";
import { inRange, pickRandom } from "../engine/combat.mjs";
import { BUFFS } from "../engine/buffs.mjs";
import { isActiveGM } from "./apply.mjs";
import { combatProfile, friendly } from "./profile.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Event.${k}`, d) : game.i18n.localize(`NSSQ.Event.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const alive = (c) => !!c?.actor && !c.defeated && (c.actor.system.hp?.value ?? 0) > 0;
const combatantOf = (actor) => (game.combat?.started ? game.combat.combatants.find((c) => c.actor === actor || c.actor?.uuid === actor?.uuid) ?? null : null);

/** 이 전투원의 trigger on 「on」 스킬 */
function triggersOf(c, on) {
  const a = c?.actor;
  if (!a) return [];
  return a.items.filter((i) => i.type === "skill" && (a.type !== "character" || (i.system.sl ?? 0) > 0))
    .flatMap((i) => (i.system.effects ?? []).filter((e) => e?.type === "trigger" && e.on === on).map((e) => ({ item: i, trig: e })));
}

/** when 조건용 자신 정보 */
const selfCtx = (c) => ({
  hp: c.actor.system.hp?.value ?? 0, hpMax: c.actor.system.hp?.max ?? 0, conditions: c.actor.system.conditions ?? [],
  tokens: (c.getFlag("nssq", "tokens") ?? []).map((t) => t.key)
});

/**
 * 트리거 처리: when → perBattle → 선택형이면 카드, 아니면 실행
 * @param {Combatant} c 스킬을 가진 전투원
 * @param {string} on
 * @param {object} [o] { ctx: when 추가 정보, target: 대상 전투원, transform: (effects) => effects }
 */
async function fire(c, on, o = {}) {
  if (!c?.actor || !isActiveGM()) return;
  const pending = [];
  for (const { item, trig } of triggersOf(c, on)) {
    if (!whenMatches(trig.when, { self: selfCtx(c), ...(o.ctx ?? {}) })) continue;
    const key = item.system.key ?? item.name;
    if (trig.limit === "perBattle" && c.getFlag("nssq", "usedTriggers")?.[autoKey(key)]) continue;
    const effects = o.transform ? o.transform(trig.effects ?? []) : trig.effects ?? [];
    const auto = !trig.optional || c.actor.type !== "character" || !!c.actor.getFlag("nssq", "autoTrigger")?.[autoKey(key)];
    const f = { id: foundry.utils.randomID(), unitId: c.id, type: "event", name: item.name, optional: !!trig.optional, target: o.target?.id ?? null,
      effects, chance: trig.chance ?? null, limit: trig.limit ?? null, source: { key, name: item.name, sl: item.system.sl ?? 1, itemId: item.id }, state: "pending" };
    if (auto) await runEvent(f);
    else pending.push(f);
  }
  if (pending.length) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: c.actor }),
      content: `<div class="nssq-combat-note"><i class="fas fa-bolt"></i> ${esc(L(`ask.${on}`, { name: c.name }))}</div>`,
      flags: { nssq: { followups: pending } }
    });
  }
}

/** 실행(코스트·확률·대상) → 카드. 실행했으면 true */
export async function runEvent(f) {
  const combat = game.combat;
  const c = combat?.combatants.get(f.unitId);
  const a = c?.actor;
  const item = a?.items.get(f.source?.itemId);
  if (!item) return false;
  const note = (k, d = {}) => ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: a }), content: `<div class="nssq-combat-note"><i class="fas fa-bolt"></i> ${esc(L(k, { name: c.name, skill: item.name, ...d }))}</div>` });
  // 선언형: 코스트
  if (f.optional) {
    const cost = item.system.cost ?? {};
    if ((cost.tp ?? 0) > (a.system.tp?.value ?? 0) || (cost.fp ?? 0) > (a.system.fp?.value ?? 0)) { await note("noCost"); return false; }
    const upd = {};
    if (cost.tp) upd["system.tp.value"] = (a.system.tp?.value ?? 0) - cost.tp;
    if (cost.fp) upd["system.fp.value"] = (a.system.fp?.value ?? 0) - cost.fp;
    if (Object.keys(upd).length) await a.update(upd);
  }
  if (f.limit === "perBattle") await c.setFlag("nssq", "usedTriggers", { ...(c.getFlag("nssq", "usedTriggers") ?? {}), [autoKey(f.source.key)]: true });
  // 확률(「1D6 ≤ SL이면」 《이 악물기》)
  if (f.chance) {
    const roll = await new Roll(f.chance.roll ?? "1d6").evaluate();
    const lte = evaluate(f.chance.lte ?? 0, { SL: f.source.sl ?? 1 });
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: a }), rolls: [roll], sound: CONFIG.sounds.dice, content: `<div class="nssq-combat-note"><i class="fas fa-dice"></i> ${esc(L(roll.total <= lte ? "chanceOk" : "chanceNg", { name: c.name, skill: item.name, die: roll.total, lte }))}</div>` });
    if (roll.total > lte) return false;
  }
  // 대상: 효과의 target(아군 전체·아군 열·적 단일) → 아니면 지정 대상(없으면 자신)
  const spec = f.effects.find((e) => e?.type === "target");
  let units;
  const isAttack = f.effects.some((e) => e?.type === "attack");
  if (spec?.side === "ally") {
    const row = a.system.row ?? "front";
    units = combat.combatants.filter((x) => alive(x) && friendly(x.actor, a) && (spec.scope !== "row" || (x.actor.system.row ?? "front") === row));
  } else if (isAttack) {
    // 적 단일 공격(《피의 폭주》): 지정 대상이 없으면 사거리 안의 적 중 무작위
    const p = combatProfile(a, c);
    const foes = combat.combatants.filter((x) => alive(x) && !friendly(x.actor, a) && inRange(p.range, p.row, x.actor.system.row ?? "front"));
    const t = combat.combatants.get(f.target);
    units = [t && foes.includes(t) ? t : pickRandom(foes, () => CONFIG.Dice.randomUniform())].filter(Boolean);
    if (!units.length) { await note("noTarget"); return false; }
  } else units = [combat.combatants.get(f.target) ?? c];
  const { resolveAndPost } = await import("./skill-use.mjs");
  await resolveAndPost({
    actor: a, combatant: c, kind: "skill", mainAction: false, followup: { type: isAttack ? "chase" : "trigger" },
    item: { name: item.name, img: item.img, system: { effects: f.effects.filter((e) => e?.type !== "target"), sl: f.source.sl ?? 1, category: "", description: "", target: isAttack ? "적 단일" : spec?.side === "ally" ? (spec.scope === "row" ? "아군 열" : "아군 전체") : "자신" } },
    units: units.map((u) => ({ actor: u.actor, combatant: u }))
  });
  return true;
}

/* ---------------- 일이 생겼을 때 ---------------- */

/**
 * 【HP】가 바뀐 뒤(공격·스킬 카드 적용, 활성 GM): beforeKO → damaged·hpLost → enemyKO
 * @param {Actor} actor 대상
 * @param {number} before
 * @param {number} after
 * @param {string} [sourceUuid] 공격한 액터
 * @param {boolean} [attackRoll] 공격 롤로 받은 대미지인가
 */
export async function onHpChange(actor, before, after, sourceUuid = null, attackRoll = false) {
  if (!isActiveGM() || !(after < before)) return;
  const c = combatantOf(actor);
  if (!c) return;
  const src = sourceUuid ? combatantOf(fromUuidSync(sourceUuid)) : null;
  // 전투 불능이 될 때(《이 악물기》): 버티면 【HP】 1
  let survived = false;
  if (before > 0 && after <= 0) {
    for (const { item, trig } of triggersOf(c, "beforeKO")) {
      const f = { id: "", unitId: c.id, type: "event", name: item.name, optional: false, target: c.id, effects: trig.effects ?? [], chance: trig.chance ?? null, source: { key: item.system.key, name: item.name, sl: item.system.sl ?? 1, itemId: item.id } };
      if (await runEvent(f)) { survived = true; break; }
    }
  }
  const foe = src && !friendly(src.actor, actor);
  if (foe && attackRoll) await fire(c, "damaged");
  await fire(c, "hpLost", { target: src && foe ? src : null });
  // 자신의 공격으로 적을 쓰러뜨림(《피니셔》 등). 《이 악물기》로 버텼으면 아님
  if (before > 0 && after <= 0 && !survived && foe) await fire(src, "enemyKO");
}

/** 상태 이상·봉인이 걸린 순간(《무아지경》: 그 상태 이상을 무효) */
export async function onConditionGained(actor, id) {
  const c = combatantOf(actor);
  if (!c || !isActiveGM()) return;
  await fire(c, "conditionGained", {
    ctx: { condition: id },
    target: c,
    // 「그 상태 이상을 무효화」: 해제 대상을 지금 걸린 것으로
    transform: (effects) => effects.map((e) => (e.type === "cure" && !e.conditions ? { type: "cure", conditions: [id] } : e))
  });
}

/** 강화 효과를 얻었을 때(《왕가의 혈통》) */
export async function onBuffsGained(actor, ids) {
  if (!(ids ?? []).some((id) => BUFFS[id]?.kind === "buff")) return;
  const c = combatantOf(actor);
  if (c) await fire(c, "buffGained");
}

/** 종료 페이즈 처음(《로열 벨》·《진 회복》): 살아 있는 전투원 */
export async function onEndPhase(combat) {
  for (const c of combat.turns) if (alive(c)) await fire(c, "endPhase");
}

/** 개막 페이즈(《가디언》·《성인의 가호》) */
export async function onOpeningPhase(combat) {
  for (const c of combat.turns) if (alive(c)) await fire(c, "openingPhase");
}

/** 전투 승리(《왕의 개선가》): 전투 불능이 아닌 파티 */
export async function onBattleWon(combat) {
  for (const c of combat.turns) if (alive(c) && c.actor.type !== "enemy") await fire(c, "battleWon");
}
