/**
 * 추격·반격·명중/크리티컬 시 발동(단계 8-B, 01 §3.11)
 * - 공격 카드·스킬 결과 카드가 나오면(활성 GM) 공격 이벤트를 만들어 후보를 찾는다(engine/triggers.mjs)
 * - 의무(「~한다」)·자동 사용 토글을 켠 선택형·에너미 → 바로 실행(추격·반격 카드)
 * - 선택형(「~할 수 있다」·「사용을 선언한다」) → 원래 카드에 [추격: 《○○》]/[안 함] 버튼(그 캐릭터 소유자·GM)
 * - 추격·반격 카드도 공격 이벤트가 된다: 추격에 대한 반격은 있고, 추격의 추격·반격의 추격·반격의 반격은 없다
 */
import { autoRuns, canCounterAfter, findHitTriggers, findReactions, spendStance } from "../engine/triggers.mjs";
import { extendDamage, inRange } from "../engine/combat.mjs";
import { autoApplyMode, isActiveGM } from "./apply.mjs";
import { combatProfile, sideOf } from "./profile.mjs";
import { actionState } from "./turn-status.mjs";
import { emit, onSocket } from "../socket.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Chase.${k}`, d) : game.i18n.localize(`NSSQ.Chase.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const alive = (c) => !!c?.actor && !c.defeated && (c.actor.system.hp?.value ?? 0) > 0;
const typeLabel = (f) => L(`type.${(f.type === "trigger" && f.optional) || f.type === "event" ? "declare" : f.type}`);
/** 표시 이름: 스킬은 《이름》, 『추격』 강화는 그대로 */
const shown = (f) => (f.source?.buff !== undefined ? f.name : `《${f.name}》`);

/* ---------------- 공격 이벤트 ---------------- */

const combatantByUuid = (combat, uuid) => combat.combatants.find((c) => c.actor?.uuid === uuid) ?? null;
const unitSide = (actor) => (sideOf(actor) === "enemy" ? "enemy" : "party");

/**
 * 카드 → 공격 이벤트(engine/triggers.mjs 모양). 공격 롤이 없으면 null
 * 다회 공격을 타격마다 나눈 카드는 마지막 카드에서 한 번(공격 하나 = 이벤트 하나)
 */
export async function attackEvent(message) {
  const combat = game.combat;
  if (!combat?.started) return null;
  const atk = message.getFlag("nssq", "attack");
  const sk = message.getFlag("nssq", "skillCard");
  let attackerUuid;
  let kind;
  let attackKind;
  let elements;
  let category;
  const rows = [];
  // 공격 롤 수(대상·회차마다 1회, 01 §3.5)와 굴린 대미지 다이스의 1의 수(《나찰》)
  let rollCount = 0;
  let ones = 0;
  if (atk) {
    attackerUuid = atk.attackerUuid;
    kind = atk.followup?.type ?? "normal";
    attackKind = atk.kind ?? "physical";
    elements = atk.elements ?? [];
    category = "";
    for (const t of atk.targets ?? []) {
      rollCount++;
      ones += [...(t.damageDice ?? []), ...(t.critDice ?? [])].filter((d) => d === 1).length;
      rows.push({ uuid: t.actorUuid, hit: !!t.hit, crit: !!t.crit, hitData: t.hit ? { dice: t.damageDice ?? [], resist: t.resist ?? 0, crit: !!t.crit, raw: t.rawDamage ?? 0, halves: Number(!!t.guarded) + Number(!!t.guardHalf) } : null });
    }
  } else if (sk && !sk.failed) {
    if (sk.group && sk.group.index !== sk.group.count) return null;
    const { groupMessages } = await import("./skill-use.mjs");
    const cards = sk.group ? groupMessages(sk).map((m) => m.getFlag("nssq", "skillCard")) : [sk];
    const hits = cards.flatMap((c) => (c.entries ?? []).flatMap((e) => (e.hits ?? []).filter((h) => !h.skipped).map((h) => ({ e, h }))));
    if (!hits.length) return null;
    rollCount = hits.length;
    ones = hits.reduce((n, { h }) => n + (h.dmg ?? []).filter((d) => d === 1).length, 0);
    attackerUuid = sk.userUuid;
    kind = sk.followup?.type === "trigger" ? "skill" : sk.followup?.type ?? "skill";
    attackKind = hits[0].h.kind ?? "physical";
    elements = [...new Set(hits.flatMap(({ h }) => h.elements ?? []))];
    // 통상 공격(분류 없음)과 구별: 분류가 빈 스킬은 「-」. 추격·반격은 통상 공격의 물리 공격 롤(01 §3.11)
    category = ["chase", "counter"].includes(sk.followup?.type) ? "" : sk.category || "-";
    const seen = new Map();
    for (const { e, h } of hits) {
      const r = seen.get(e.uuid) ?? { uuid: e.uuid, hit: false, crit: false, hitData: null };
      if (h.hit) {
        r.hit = true;
        r.crit ||= !!h.crit;
        r.hitData ??= { dice: h.dmg ?? [], resist: h.resist ?? 0, crit: !!h.crit, raw: h.raw ?? h.final ?? 0, halves: h.halves ?? 0 };
      }
      seen.set(e.uuid, r);
    }
    rows.push(...seen.values());
  } else return null;
  const attacker = combatantByUuid(combat, attackerUuid);
  if (!attacker) return null;
  const targets = rows.map((r) => {
    const c = combatantByUuid(combat, r.uuid);
    return c ? { id: c.id, side: unitSide(c.actor), row: c.actor.system.row ?? "front", hit: r.hit, crit: r.crit, hitData: r.hitData } : null;
  }).filter(Boolean);
  if (!targets.length) return null;
  return {
    kind, attackerId: attacker.id, attackerUuid: attacker.actor.uuid, attackerSide: unitSide(attacker.actor),
    attackerRow: attacker.actor.system.row ?? "front", attackKind, elements, category, targets, rollCount, ones,
    // 같은 공격 반복(《더블 액션》 등)·《크로스 차지》용: 그 공격의 스킬
    skillKey: sk?.skillKey ?? null, origin: atk ? { kind: "normal" } : { kind: "skill", itemId: sk.itemId ?? null, variant: sk.variant ?? null }
  };
}

/** 상시 스킬에 직접 든 반격·추격(에너미 《바늘 지옥》 등): 끝나지 않는 대기 상태처럼 본다 */
function passiveStances(actor) {
  return actor.items.filter((i) => i.type === "skill" && (actor.type !== "character" || (i.system.sl ?? 0) > 0))
    .map((i) => ({ i, list: (i.system.effects ?? []).filter((e) => ["counter", "chase"].includes(e?.type)) }))
    .filter(({ i, list }) => list.length && i.system.timing !== "수동")
    .map(({ i, list }) => ({ id: `p:${i.id}`, name: i.name, key: i.system.key ?? i.name, sl: i.system.sl ?? 1, effects: list, left: null }));
}

/** 명중·크리티컬 시 발동(trigger on selfHit/crit)이 든 스킬 */
function hitTriggers(actor) {
  const out = [];
  for (const i of actor.items) {
    if (i.type !== "skill" || (actor.type === "character" && (i.system.sl ?? 0) <= 0)) continue;
    for (const e of i.system.effects ?? []) {
      if (e?.type !== "trigger" || !["selfHit", "crit"].includes(e.on)) continue;
      out.push({ key: i.system.key ?? i.name, name: i.name, sl: i.system.sl ?? 1, itemId: i.id, on: e.on, when: e.when, effects: e.effects ?? [], optional: !!e.optional, limit: e.limit });
    }
  }
  return out;
}

function unitOf(c) {
  const a = c.actor;
  return {
    id: c.id, side: unitSide(a), row: a.system.row ?? "front", uuid: a.uuid,
    hp: a.system.hp?.value ?? 0, hpMax: a.system.hp?.max ?? 0, conditions: a.system.conditions ?? [],
    // 쓰러졌거나 행동 불가([스턴]·[수면] 등)면 추격·반격하지 않는다
    ko: !alive(c) || actionState(c).noAction,
    stances: [...(c.getFlag("nssq", "stances") ?? []), ...passiveStances(a)],
    buffs: a.system.buffs ?? [],
    autoTrigger: a.getFlag("nssq", "autoTrigger") ?? {},
    triggers: hitTriggers(a)
  };
}

/* ---------------- 후보 → 실행·버튼 ---------------- */

/** 원래 카드의 자동 적용이 끝날 때까지(최대 3초). 반응 대기·수동 적용이면 기다리지 않는다 */
function settled(message) {
  if (autoApplyMode() !== "auto") return Promise.resolve();
  const done = () => {
    const m = game.messages.get(message.id);
    const atk = m?.getFlag("nssq", "attack");
    if (atk) return atk.targets.some((t) => t.reaction?.state === "pending") || atk.targets.every((t) => !t.hit || t.applied);
    const sk = m?.getFlag("nssq", "skillCard");
    return !sk || !!sk.applied || (sk.entries ?? []).some((e) => e.reaction?.state === "pending");
  };
  if (done()) return Promise.resolve();
  return new Promise((resolve) => {
    let id = null;
    const end = () => { Hooks.off("updateChatMessage", id); resolve(); };
    id = Hooks.on("updateChatMessage", (m) => { if (m.id === message.id && done()) end(); });
    setTimeout(end, 3000);
  });
}

async function perAttackCost(combat, ev) {
  const c = combat.combatants.get(ev.attackerId);
  const st = (c?.actor?.getFlag("nssq", "states") ?? []).find((s) => s.perAttack);
  if (!st) return;
  // 공격 롤마다: 1의 수는 그 행동에서 굴린 대미지 다이스 전부, 【TP】는 롤 수 × tp
  const ones = st.perAttack.selfDamage === "ones" ? ev.ones ?? 0 : 0;
  const tp = (Number(st.perAttack.tp ?? 0) || 0) * Math.max(1, ev.rollCount ?? 1);
  const effects = [...(ones ? [{ type: "resource", resource: "hp", delta: -ones }] : []), ...(tp ? [{ type: "resource", resource: "tp", delta: -tp }] : [])];
  if (!effects.length) return;
  const { resolveAndPost } = await import("./skill-use.mjs");
  await resolveAndPost({
    actor: c.actor, combatant: c, kind: "skill", mainAction: false, followup: { type: "trigger" },
    item: { name: st.name, img: c.actor.img, system: { effects, sl: 1, category: "", description: "", target: "자신" } },
    units: [{ actor: c.actor, combatant: c }]
  });
}

/** 공격 카드 하나 처리(활성 GM) */
async function onAttackCard(message) {
  const ev = await attackEvent(message);
  if (!ev) return;
  const combat = game.combat;
  // 공격 롤마다 대가를 치르는 전투 고유 상태(모노노후 《나찰》 perAttack: 자신의 대미지 다이스 1의 수만큼 【HP】, 【TP】 n)
  await perAttackCost(combat, ev);
  // 이번 턴에 나온 〈염〉〈빙〉〈뇌〉 공격(《스피어 인볼브》)
  const els = (ev.elements ?? []).filter((x) => ["fire", "ice", "volt"].includes(x));
  if (els.length) {
    const prev = combat.getFlag("nssq", "turnElements");
    const cur = prev?.round === combat.round ? prev.elements ?? [] : [];
    if (els.some((x) => !cur.includes(x))) await combat.setFlag("nssq", "turnElements", { round: combat.round, elements: [...new Set([...cur, ...els])] });
  }
  // 《돌격대장》: 이번 턴 자신이 공격한 적을 기록(같은 적을 공격하는 아군의 대미지 다이스 +SL)
  const me = combat.combatants.get(ev.attackerId);
  const vg = me?.actor.items.find((i) => i.type === "skill" && (i.system.sl ?? 0) > 0 && (i.system.effects ?? []).some((e) => e?.type === "flag" && e.flag === "vanguard"));
  if (vg) {
    const all = foundry.utils.deepClone(combat.getFlag("nssq", "vanguard") ?? {});
    const prev = all[me.id]?.round === combat.round ? all[me.id].targets : [];
    all[me.id] = { round: combat.round, sl: vg.system.sl ?? 1, name: vg.name, targets: [...new Set([...prev, ...ev.targets.map((t) => t.id)])] };
    await combat.setFlag("nssq", "vanguard", all);
  }
  const units = combat.combatants.filter((c) => c.actor).map(unitOf);
  const byId = new Map(units.map((u) => [u.id, u]));
  const list = findReactions(ev, units).map((r) => ({ ...r, name: r.source.name ?? L("chaseBuff") }));
  const attacker = byId.get(ev.attackerId);
  // 공격한 쪽이 행동 불가여도 크리티컬 시 효과는 그 공격의 일부
  for (const t of findHitTriggers(ev, attacker)) {
    list.push({ unitId: ev.attackerId, type: "trigger", target: t.target, name: t.name, optional: t.optional, effects: t.effects,
      source: { key: t.key, name: t.name, sl: t.sl, itemId: attacker.triggers.find((x) => x.key === t.key)?.itemId },
      hitData: ev.targets.find((x) => x.id === t.target)?.hitData ?? null, origin: ev.origin });
  }
  if (!list.length) return;
  await settled(message);
  const pending = [];
  for (const f of list) {
    if (autoRuns(f, byId.get(f.unitId))) await runFollowup(f, ev.kind);
    else pending.push({ ...f, id: foundry.utils.randomID(), state: "pending", originKind: ev.kind });
  }
  // 그 사이 카드가 지워졌으면(GM이 삭제) 버튼을 달 곳이 없다
  if (pending.length && game.messages.has(message.id)) await message.setFlag("nssq", "followups", pending);
}

/** 추격·반격·발동 실행 → 카드. 실행했으면 true */
export async function runFollowup(f, originKind = "normal") {
  // 그 밖의 트리거(단계 8-F, combat/events.mjs)
  if (f.type === "event") return (await import("./events.mjs")).runEvent(f);
  const combat = game.combat;
  const c = combat?.combatants.get(f.unitId);
  const target = combat?.combatants.get(f.target);
  if (!c?.actor || !target?.actor) return false;
  const actor = c.actor;
  const note = (key) => ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<div class="nssq-combat-note">${esc(L(key, { actor: c.name, name: shown(f), type: typeLabel(f) }))}</div>` });
  const { resolveAndPost } = await import("./skill-use.mjs");
  if (f.type === "trigger") {
    const item = actor.items.get(f.source.itemId);
    if (!item) return false;
    // 같은 공격을 다시(《더블 액션》·《와이드 이펙트》·《페너트레이터》)
    const rep = f.effects.find((e) => e.type === "repeat");
    if (rep) return repeatAttack(combat, c, target, f, rep, item);
    // 선언(「사용을 선언한다」): 코스트 지불
    if (f.optional) {
      const cost = item.system.cost ?? {};
      if ((cost.tp ?? 0) > (actor.system.tp?.value ?? 0) || (cost.fp ?? 0) > (actor.system.fp?.value ?? 0)) { await note("noCost"); return false; }
      const upd = {};
      if (cost.tp) upd["system.tp.value"] = (actor.system.tp?.value ?? 0) - cost.tp;
      if (cost.fp) upd["system.fp.value"] = (actor.system.fp?.value ?? 0) - cost.fp;
      if (Object.keys(upd).length) await actor.update(upd);
    }
    // 대미지 다이스 +n(attackBonus diceMod): 그 명중에 주사위를 더 굴린다
    const plus = f.effects.filter((e) => e.type === "attackBonus").reduce((n, e) => n + (Number(e.diceMod) || 0), 0);
    const rolls = [];
    let extra = null;
    if (plus && f.hitData) {
      const rollDice = async (n) => {
        const r = await new Roll(`${n}d6`).evaluate();
        rolls.push(r);
        return r.dice[0].results.map((x) => x.result);
      };
      const x = await extendDamage({ ...f.hitData, critUp: combatProfile(actor, c).critUp }, plus, rollDice);
      extra = { [target.actor.uuid]: { ...x, count: plus } };
    }
    // 크리티컬 시 「스스로 물리 공격으로 추격」(《아류 살법》)은 추격 카드
    const chase = f.effects.some((e) => e.type === "attack");
    // 대상에게 거는 효과(《스턴 어택》 등)는 대상이 쓰러졌으면 없음. 자신에게(toSelf)만이면 그대로
    const onTarget = f.effects.some((e) => !["attackBonus"].includes(e.type) && !e.toSelf);
    if (onTarget && !alive(target)) { if (chase) await note("skipKO"); return false; }
    await resolveAndPost({
      actor, combatant: c, kind: "skill", mainAction: false, extra, extraRolls: rolls,
      item: { name: item.name, img: item.img, system: { effects: f.effects, sl: f.source.sl ?? 1, category: "", description: "", target: "적 단일" } },
      units: [{ actor: target.actor, combatant: target }], followup: { type: chase ? "chase" : "trigger" }
    });
    return true;
  }
  // 추격·반격
  if (f.type === "counter" && !canCounterAfter(originKind)) return false;
  // 「쓰러져도 반격」(evenIfKO)은 대미지를 받아 쓰러진 뒤에도
  if (!f.evenIfKO && (!alive(c) || actionState(c).noAction)) return false;
  if (!alive(target)) { await note("skipKO"); return false; }
  const me = combatProfile(actor, c);
  if (!inRange(me.range, me.row, target.actor.system.row ?? "front")) { await note("skipRange"); return false; }
  // 누적 n회 대기 상태: 횟수 차감
  if (f.source?.stance && !String(f.source.stance).startsWith("p:")) {
    await c.setFlag("nssq", "stances", spendStance(c.getFlag("nssq", "stances") ?? [], f.source.stance));
  }
  const { copyElement, ...attack } = f.attack ?? { kind: "physical" };
  void copyElement;
  await resolveAndPost({
    actor, combatant: c, kind: "skill", mainAction: false,
    item: { name: f.name, img: actor.img, system: { effects: [{ type: "attack", ...attack }], sl: f.source?.sl ?? 1, category: "", description: "", target: "적 단일" } },
    units: [{ actor: target.actor, combatant: target }], followup: { type: f.type }
  });
  return true;
}

/**
 * 아군 일제 추격(《일제 사격》·《난룡의 진》): 사용자 이외의 행동할 수 있는 아군을 【속도】 순으로 최대 count명(07 #88)
 * weapons가 있으면 그 무기 종류를 장비한 아군만. 각자 통상 공격의 물리 공격으로 추격(사거리는 무시하지 않음)
 */
export async function rallyChase(user, rally) {
  const combat = game.combat;
  const target = combat?.combatants.get(rally.target);
  if (!target) return;
  const allies = combat.turns.filter((x) => x.id !== user.id && alive(x) && !actionState(x).noAction && (sideOf(x.actor) === "enemy") === (sideOf(user.actor) === "enemy")
    && (!rally.weapons || rally.weapons.includes(x.actor.system.equipment?.weapon?.weaponType)));
  // 「아군을 최대 n명 선택」(07 #88): 사용자가 고른다(에너미·소유자가 아닌 화면은 【속도】 순)
  let chosen = allies.slice(0, rally.count);
  if (allies.length && user.actor.type === "character" && user.actor.isOwner) {
    const html = `<p>${esc(L("rallyHint", { n: rally.count }))}</p>${allies.map((a, k) => `<div class="form-group"><label><input type="checkbox" name="r${k}" ${k < rally.count ? "checked" : ""}/> ${esc(a.name)}</label></div>`).join("")}`;
    const picked = await Dialog.prompt({
      title: L("rallyTitle"), content: html, label: L("rallyGo"), rejectClose: false,
      callback: (h) => allies.filter((a, k) => !!h[0].querySelector(`[name=r${k}]`)?.checked)
    });
    if (!picked) return;
    chosen = picked.slice(0, rally.count);
  }
  for (const a of chosen) {
    await runFollowup({ unitId: a.id, type: "chase", target: target.id, name: L("rally"), attack: { kind: "physical" }, source: { buff: 0, key: "rally", sl: 1 } }, "skill");
  }
}

/**
 * 같은 공격 반복: scope same(같은 대상) / row(대상과 같은 열의 다른 적 전부) / back(후위 적 1체, 무작위)
 * cost: 스킬 공격이면 그 스킬의 코스트를 한 번 더(통상 공격은 없음)
 */
async function repeatAttack(combat, c, target, f, rep, trigItem) {
  const actor = c.actor;
  const note = (key) => ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<div class="nssq-combat-note">${esc(L(key, { actor: c.name, name: shown(f), type: typeLabel(f) }))}</div>` });
  const foes = combat.combatants.filter((x) => alive(x) && (sideOf(x.actor) === "enemy") !== (sideOf(actor) === "enemy"));
  const row = target.actor.system.row ?? "front";
  const scope = rep.scope ?? "same";
  const targets = scope === "row" ? foes.filter((x) => x.id !== target.id && (x.actor.system.row ?? "front") === row)
    : scope === "back" ? [foes.filter((x) => (x.actor.system.row ?? "front") === "back").sort(() => CONFIG.Dice.randomUniform() - 0.5)[0]].filter(Boolean)
      : alive(target) ? [target] : [];
  if (!targets.length) { await note("skipKO"); return false; }
  const origin = f.origin ?? { kind: "normal" };
  if (origin.kind === "normal") {
    const { normalAttack } = await import("./attack.mjs");
    for (const t of targets) await normalAttack(actor, { target: t.token, ignoreRange: true, followup: { type: "repeat", by: trigItem.name } });
    return true;
  }
  const item = actor.items.get(origin.itemId);
  if (!item) return false;
  const cost = item.system.cost ?? {};
  if (rep.cost) {
    if ((cost.tp ?? 0) > (actor.system.tp?.value ?? 0) || (cost.fp ?? 0) > (actor.system.fp?.value ?? 0)) { await note("noCost"); return false; }
    const upd = {};
    if (cost.tp) upd["system.tp.value"] = (actor.system.tp?.value ?? 0) - cost.tp;
    if (cost.fp) upd["system.fp.value"] = (actor.system.fp?.value ?? 0) - cost.fp;
    if (Object.keys(upd).length) await actor.update(upd);
  }
  const { resolveAndPost } = await import("./skill-use.mjs");
  await resolveAndPost({
    actor, combatant: c, kind: "skill", mainAction: false, variant: origin.variant ?? null, followup: { type: "repeat", by: trigItem.name },
    item: { id: item.id, name: item.name, img: item.img, system: { ...item.system, target: scope === "row" ? "적 열" : "적 단일" } },
    units: targets.map((t) => ({ actor: t.actor, combatant: t }))
  });
  return true;
}

/**
 * 수동 반응으로 회피에 성공하면 반격(《검의 춤》 「회피 성공 시 통상 공격으로 반격」)
 * @param {ChatMessage} message 공격 카드
 */
export async function counterAfterEvade(message, reactorUuid, skill) {
  const eff = (skill.system.effects ?? []).find((e) => e?.type === "counter" && e.onlyIfEvaded);
  if (!eff) return;
  const ev = await attackEvent(message);
  if (!ev || !canCounterAfter(ev.kind)) return;
  const me = combatantByUuid(game.combat, reactorUuid);
  if (!me) return;
  await runFollowup({ unitId: me.id, type: "counter", target: ev.attackerId, name: skill.name, attack: eff.attack ?? { kind: "physical" }, source: { key: skill.system.key, sl: skill.system.sl ?? 1 } }, ev.kind);
}

/* ---------------- 버튼 ---------------- */

const send = (payload) => (isActiveGM() ? gmFollowup(payload) : emit("followup", payload));

async function gmFollowup({ messageId, id, run }) {
  const message = game.messages.get(messageId);
  const list = foundry.utils.deepClone(message?.getFlag("nssq", "followups") ?? []);
  const f = list.find((x) => x.id === id);
  if (!f || f.state !== "pending") return;
  f.state = run ? "done" : "declined";
  await message.setFlag("nssq", "followups", list);
  if (run && !(await runFollowup(f, f.originKind))) {
    f.state = "declined";
    await message.setFlag("nssq", "followups", list);
  }
}

/** 카드에 선택형 추격·선언 버튼·결과 줄 */
function decorate(message, el) {
  const list = message.getFlag("nssq", "followups");
  if (!list?.length) return;
  const box = document.createElement("div");
  box.className = "nssq-followups";
  for (const f of list) {
    const c = game.combat?.combatants.get(f.unitId);
    const actor = c?.actor;
    const d = { actor: c?.name ?? "?", name: shown(f), type: typeLabel(f) };
    const row = document.createElement("div");
    row.className = "nssq-reaction";
    if (f.state === "done") row.innerHTML = `<i class="fas fa-angle-double-right"></i> ${esc(L("done", d))}`;
    else if (f.state === "declined") row.innerHTML = `<span class="notes">${esc(L("declined", d))}</span>`;
    else if (!actor?.isOwner) row.innerHTML = `<span class="notes">${esc(L("waiting", d))}</span>`;
    else {
      const label = f.type === "trigger" || f.type === "event" ? L("declare", d) : L("run", d);
      row.innerHTML = `<button type="button" data-fu-run><i class="fas fa-angle-double-right"></i> ${esc(label)}</button><button type="button" data-fu-decline>${esc(L("decline"))}</button>`;
      row.querySelector("[data-fu-run]").addEventListener("click", () => send({ messageId: message.id, id: f.id, run: true }));
      row.querySelector("[data-fu-decline]").addEventListener("click", () => send({ messageId: message.id, id: f.id, run: false }));
    }
    box.append(row);
  }
  el.append(box);
}

export function registerChase() {
  onSocket("followup", (p) => { if (isActiveGM()) gmFollowup(p); });
  Hooks.on("createChatMessage", (message) => {
    if (!isActiveGM() || !(message.getFlag("nssq", "attack") || message.getFlag("nssq", "skillCard"))) return;
    onAttackCard(message).catch((err) => console.error("NSSQ | 추격·반격", err));
  });
  Hooks.on("renderChatMessage", (message, html) => decorate(message, html[0]));
}
