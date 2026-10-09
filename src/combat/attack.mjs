/**
 * 통상 공격(01 §3.4·3.5): 장비 무기(에너미는 공격 속성)로 물리 공격 롤.
 * 대상은 사용자가 지정(타깃)한 토큰. 계산은 engine/combat.mjs.
 */
import { inRange, resolveAttack } from "../engine/combat.mjs";
import { sumAttackBonuses } from "../engine/effects/passives.mjs";
import { autoApplyMode, requestApply } from "./apply.mjs";
import { combatProfile, friendly } from "./profile.mjs";
import { knowsEnemy } from "./bestiary.mjs";
import { decorateReactions, pendingReaction } from "./reaction.mjs";
import { guardAttack } from "./guard.mjs";
import { slotOccupant, weaponStats } from "../engine/equipment.mjs";
import { evaluate } from "../engine/expr.mjs";
import tables from "../generated/tables.mjs";

const TEMPLATE = "systems/nssq/templates/chat/attack-card.hbs";
const L = (k, d) => (d ? game.i18n.format(`NSSQ.Combat.${k}`, d) : game.i18n.localize(`NSSQ.Combat.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const elementLabel = (e) => (e === "none" ? game.i18n.localize("NSSQ.Combat.noElement") : game.i18n.localize(`NSSQ.Resist.${e}`));

function combatantOf(actor) {
  return game.combat?.combatants.find((c) => c.actor === actor || (actor.token && c.token?.id === actor.token.id)) ?? null;
}

/** 공격할 액터: 시트에서 부르면 그 액터, 아니면 선택한 토큰 */
export function attackerFromContext(actor) {
  if (actor) return actor;
  const t = canvas?.tokens?.controlled ?? [];
  if (t.length === 1) return t[0].actor;
  if (game.user.character) return game.user.character;
  ui.notifications.warn(L("pickAttacker"));
  return null;
}

/**
 * 쌍수(상시 dualWield: 장군 《두 번째 칼》·나이트시커 《추영의 칼날》·파이리츠 《건 소드》):
 * 무기 슬롯·기타 슬롯의 무기 종류가 weapons 두 목록에 하나씩 맞으면, 통상 공격을 무기마다 1회(각 hitMod·atkMod)
 * @returns {{ name, sl, hitMod, main: object, other: object }|null} main/other: 공격자 프로필에 더할 값(weaponMod)
 */
export function dualWieldOf(actor) {
  if (actor?.type !== "character") return null;
  const sk = actor.items.find((i) => i.type === "skill" && (i.system.sl ?? 0) > 0 && (i.system.effects ?? []).some((e) => e?.type === "dualWield"));
  if (!sk) return null;
  const e = sk.system.effects.find((x) => x?.type === "dualWield");
  const main = actor.system.equipment?.weapon;
  const other = slotOccupant(actor.items.contents, "other");
  if (!main?.item || other?.type !== "weapon") return null;
  const [A = [], B = []] = e.weapons ?? [];
  const mt = main.weaponType;
  const ot = other.system.weaponType;
  if (!((A.includes(mt) && B.includes(ot)) || (A.includes(ot) && B.includes(mt)))) return null;
  const vars = { SL: sk.system.sl ?? 1 };
  const hit = evaluate(e.hitMod ?? 0, vars);
  const atk = evaluate(e.atkMod ?? 0, vars);
  const table = tables.weapons[ot];
  if (!table) return null;
  // 기타 슬롯 무기의 성능으로 바꿔 넣는다(무기 슬롯 무기의 몫을 빼고 더함). 제련은 무기 슬롯 것만(07)
  const os = weaponStats(table, { rank: other.system.rank, level: actor.system.level });
  const imbue = actor.system.statusMods?.buffs?.elements ?? [];
  // 무기만 바꾼 값(쌍수 스킬 2회째, 《이도일인》·《추영의 잔상》): 통상 공격 보정 없이
  const swap = {
    physHit: -(Number(main.physHit) || 0) + os.physHit, physAtk: -(Number(main.physAtk) || 0) + os.physAtk,
    elements: [...new Set([other.system.element || table.element, ...imbue].filter(Boolean))], weaponName: other.name, weaponType: ot, range: os.range
  };
  return {
    name: sk.name, sl: vars.SL, hitMod: hit, swap,
    main: { physHit: hit, physAtk: atk, label: main.item.name },
    other: {
      physHit: hit - (Number(main.physHit) || 0) + os.physHit, physAtk: atk - (Number(main.physAtk) || 0) + os.physAtk,
      elements: [...new Set([other.system.element || table.element, ...imbue].filter(Boolean))], weaponName: other.name, weaponType: ot, range: os.range, label: other.name
    }
  };
}

/**
 * 통상 공격. 쌍수(dualWieldOf)면 무기마다 1회씩(추격·반격 등 followup은 1회)
 */
export async function normalAttack(attacker, opts = {}) {
  const dual = !opts.followup && !opts.weaponMod ? dualWieldOf(attacker) : null;
  if (!dual) return attackWith(attacker, opts);
  const first = await attackWith(attacker, { ...opts, weaponMod: { ...dual.main, by: dual.name } });
  if (!first) return first;
  // 2회째 대상은 다시 고른다(기타 슬롯 무기의 사거리 안, 07 #124)
  const target = await secondTarget(attacker, opts, dual.other);
  if (!target) return first;
  return attackWith(attacker, { ...opts, target, weaponMod: { ...dual.other, by: dual.name }, turnChecked: true });
}

/** 쌍수 2회째 대상: 살아 있는 적 중 사거리 안. 하나면 그것, 여럿이면 고르는 창(처음 대상이 기본) */
async function secondTarget(attacker, opts, weapon) {
  const first = opts.target ?? [...game.user.targets][0];
  const combat = game.combat;
  const me = combatantOf(attacker);
  if (!combat?.started || !me || !first?.actor) return first;
  // 아군을 친 공격([혼란])은 같은 대상
  if (friendly(attacker, first.actor)) return first;
  const row = attacker.system.row ?? "front";
  const range = combatProfile(attacker, me).range === "원" ? "원" : weapon.range ?? "근";
  const list = combat.combatants.filter((c) => c.actor && !c.defeated && (c.actor.system.hp?.value ?? 0) > 0 && !friendly(attacker, c.actor)
    && (opts.ignoreRange || inRange(range, row, c.actor.system.row ?? "front")));
  if (!list.length) return null;
  if (list.length === 1) return list[0].token;
  const firstId = list.find((c) => c.token?.id === first.id)?.id ?? list[0].id;
  const buttons = Object.fromEntries(list.map((c) => [c.id, { label: esc(c.name), callback: () => c.id }]));
  const id = await Dialog.wait({ title: L("dualSecondTitle", { name: me.name }), content: `<p>${esc(L("dualSecondHint", { weapon: weapon.label ?? "" }))}</p>`, buttons, default: firstId, close: () => null }, { classes: ["nssq", "dialog"] });
  return id ? combat.combatants.get(id)?.token ?? null : null;
}

/**
 * 통상 공격 1회
 * @param {Actor} attacker
 * @param {{ ignoreRange?: boolean, target?: TokenDocument }} [opts] GM은 Shift로 사거리 무시.
 *   target: 전투 화면에서 고른 대상(없으면 캔버스에서 지정한 타깃 1개)
 */
async function attackWith(attacker, { ignoreRange = false, target: picked = null, followup = null, weaponMod = null, turnChecked = false } = {}) {
  if (!attacker) return;
  const targets = picked ? [picked] : [...game.user.targets];
  if (targets.length !== 1) return ui.notifications.warn(L("pickOneTarget"));
  let targetToken = targets[0];
  let target = targetToken.actor;
  if (!target) return;
  const a = combatProfile(attacker, combatantOf(attacker));
  // 쌍수: 그 무기로(명중·공격 보정, 기타 슬롯 무기의 성능·속성·사거리)
  if (weaponMod) {
    a.physHit += weaponMod.physHit ?? 0;
    a.physAtk += weaponMod.physAtk ?? 0;
    if (weaponMod.elements?.length) a.elements = weaponMod.elements;
    if (weaponMod.weaponName) a.weaponName = weaponMod.weaponName;
    if (weaponMod.weaponType) a.weaponType = weaponMod.weaponType;
    if (weaponMod.range && a.range !== "원") a.range = weaponMod.range;
  }
  let d = combatProfile(target, combatantOf(target));
  if (a.ko) return ui.notifications.warn(L("attackerKO", { name: a.name }));
  if (d.ko) return ui.notifications.warn(L("targetKO", { name: target.name }));
  if (friendly(attacker, target) && !ignoreRange) return ui.notifications.warn(L("friendlyTarget"));
  if (!ignoreRange && !inRange(a.range, a.row, d.row)) {
    return ui.notifications.warn(L("outOfRange", { range: a.range, target: target.name }));
  }
  // 차례 확인: 진행 중인 전투의 참가자라면 메인 페이즈의 자기 차례에만. GM은 확인 후 강행할 수 있다
  const combat = game.combat;
  const me = combatantOf(attacker);
  // 추격·반복 공격(followup)은 차례와 관계없이
  if (combat?.started && me && !followup && !turnChecked) {
    const phase = combat.getFlag("nssq", "phase");
    const myTurn = phase === "main" && combat.combatant?.id === me.id;
    if (!myTurn) {
      const reason = phase !== "main" ? L("notMainPhase") : L("notYourTurn", { name: me.name, current: combat.combatant?.name ?? "-" });
      if (!game.user.isGM) return ui.notifications.warn(reason);
      const go = await Dialog.confirm({ title: L("normalAttack"), content: `<p>${reason}</p><p>${L("gmForce")}</p>`, rejectClose: false });
      if (!go) return;
    }
  }

  // 가드·도발(단계 8-C): 대상이 바뀌면 바뀐 대상으로, 반감·【방어】·【내성】 보정
  const tc = combatantOf(target);
  const guard = await guardAttack({ attacker, targets: tc ? [tc] : [], kind: "physical", elements: a.elements, single: true });
  const gc = guard.targets[0];
  // 공격 자체가 무효(《부정형 생물》)
  if (tc && !gc) return guard.commit(new Set());
  if (gc && gc !== tc) {
    target = gc.actor;
    targetToken = gc.token ?? targetToken;
    d = combatProfile(target, gc);
  }
  if (gc) d.id = gc.id;
  guard.apply(d);

  // 주사위는 Foundry Roll로(Dice So Nice 표시), 계산은 엔진
  const rolls = [];
  const rollDice = async (n) => {
    const r = await new Roll(`${n}d6`).evaluate();
    rolls.push(r);
    return r.dice[0].results.map((x) => x.result);
  };
  // 《돌격대장》: 이번 턴 다른 아군이 먼저 공격한 적이면 대미지 다이스 +SL
  const me2 = combatantOf(attacker);
  for (const [holder, v] of Object.entries(combat?.getFlag("nssq", "vanguard") ?? {})) {
    if (holder === me2?.id || v.round !== combat.round) continue;
    a.attackBonuses = [...(a.attackBonuses ?? []), { name: v.name, when: { targetIn: v.targets }, hitMod: 0, diceMod: v.sl ?? 1, atkMod: 0, critDice: 0, critUp: false }];
  }
  // 상시 스킬의 공격 보정(《선봉의 공명》 등)
  const pb = sumAttackBonuses(a.attackBonuses, { self: a, target: { ...d, skills: target.items.filter((i) => i.type === "skill").map((i) => i.name) }, attack: { kind: "physical", elements: a.elements } });
  // 《링크 이펙트》 등으로 더한 속성까지(카드 표시도 같은 값)
  const atkElements = pb.addElement.length ? [...new Set([...a.elements.filter((x) => x !== "none"), ...pb.addElement])] : a.elements;
  const r = await resolveAttack({
    attacker: { hit: a.physHit, physAtk: a.physAtk, elemAtk: a.elemAtk, elements: atkElements, critUp: a.critUp },
    target: { evasion: d.evasion, defense: d.defense, resist: d.resist, guarding: d.guarding, guardHalf: d.guardHalf },
    resistMod: pb.resistMod, resistLow: pb.resistLow, failAtOrBelow: pb.failAtOrBelow,
    kind: "physical", hitMod: pb.hitMod, diceMod: pb.diceMod, atkMod: pb.atkMod, critUp: pb.critUp, critDiceMod: pb.critDice,
    rollDice
  });

  // PC의 명중 판정에서 1이 나오면 【FP】(일반 행위 판정)
  if (r.fpGain && attacker.type === "character" && attacker.isOwner) {
    await attacker.update({ "system.fp.value": (attacker.system.fp?.value ?? 0) + r.fpGain });
  }

  const targetEntry = {
    actorUuid: target.uuid, name: targetToken.name, hit: r.hit,
    hitDice: r.hitCheck.used, hitTotal: r.hitCheck.total, evasion: d.evasion,
    absSuccess: r.hitCheck.absSuccess, absFailure: r.hitCheck.absFailure,
    resist: r.resist ?? null, diceCount: r.diceCount ?? 0,
    damageDice: r.damage?.dice ?? [], critDice: r.critExtra?.dice ?? [],
    crit: !!r.crit, rawDamage: r.rawDamage ?? 0, guarded: !!r.guarded, guardHalf: !!r.guardHalf, finalDamage: r.finalDamage ?? 0,
    applied: false, before: null, after: null,
    // 수동 반응(단계 6-C): 명중했고 대상이 쓸 수 있는 수동 스킬이 있으면 기다린다
    reaction: pendingReaction(target, "physical", r.hit)
  };
  await guard.commit(new Set(r.hit && gc ? [gc.id] : []));
  const flags = {
    nssq: {
      attack: {
        attackerUuid: attacker.uuid, kind: "physical", label: followup?.by ? `${L("normalAttack")} (${followup.by})` : weaponMod?.by ? `${L("normalAttack")} (《${weaponMod.by}》: ${weaponMod.label ?? ""})` : L("normalAttack"), ...(followup ? { followup } : {}),
        weapon: a.weaponName, elements: atkElements, physAtk: a.physAtk, defense: d.defense,
        hitStat: a.physHit, fpGain: r.fpGain, targets: [targetEntry],
        // [저주]: 공격자가 공격 시점에 [저주]면 실대미지 절반을 되돌려 받는다(적용할 때)
        curse: a.conditions.some((c) => c.id === "curse")
      }
    }
  };
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: attacker, token: attacker.token }),
    content: await renderAttackCard(flags.nssq.attack),
    rolls,
    sound: CONFIG.sounds.dice,
    flags
  });
}

export async function renderAttackCard(card) {
  return renderTemplate(TEMPLATE, {
    ...card,
    elementText: card.elements.map(elementLabel).join("·"),
    targets: card.targets.map((t) => ({
      ...t,
      dmg: t.damageDice.map((v) => ({ v, over: v > t.resist, six: v === 6, one: v === 1 })),
      crit4: t.critDice.map((v) => ({ v, over: v > t.resist }))
    })),
    mode: autoApplyMode()
  });
}

/** 이 액터가 대상인 최근 공격 카드를 다시 그린다 */
function rerenderCardsFor(actor) {
  const uuid = actor.uuid;
  for (const m of game.messages.contents.slice(-100)) {
    if (m.getFlag("nssq", "attack")?.targets?.some((t) => t.actorUuid === uuid)) ui.chat.updateMessage(m);
  }
}

/** 카드 버튼: [적용] [되돌리기]는 GM만. 적용 상태는 플래그에서 다시 그린다 */
export function registerAttackHooks() {
  // 식별되면 지난 카드의 【HP】 변화도 플레이어에게 보이게
  Hooks.on("updateActor", (actor, changes) => {
    if (foundry.utils.getProperty(changes, "system.identified") !== undefined) rerenderCardsFor(actor);
  });
  // 도감이 바뀌면(식별·처치 기록) 지난 카드도 다시 그린다
  Hooks.on("nssqBestiary", () => {
    for (const m of game.messages.contents.slice(-100)) if (m.getFlag("nssq", "attack")) ui.chat.updateMessage(m);
  });
  Hooks.on("updateToken", (token, changes) => {
    if (foundry.utils.getProperty(changes, "delta.system.identified") !== undefined && token.actor) rerenderCardsFor(token.actor);
  });
  Hooks.on("renderChatMessage", (message, html) => {
    const card = message.getFlag("nssq", "attack");
    if (!card) return;
    const el = html[0];
    // 플레이어가 모르는 에너미(식별·도감 기록 없음)의 수치는 ?로(07 #47)
    if (!game.user.isGM) {
      const attacker = card.attackerUuid ? fromUuidSync(card.attackerUuid) : null;
      if (attacker && !knowsEnemy(attacker)) el.querySelectorAll("[data-mask=atk]").forEach((x) => { x.textContent = "?"; });
      el.querySelectorAll(".attack-target").forEach((row) => {
        const target = fromUuidSync(card.targets[Number(row.dataset.index)]?.actorUuid ?? "");
        if (target && !knowsEnemy(target)) row.querySelectorAll("[data-mask=def]").forEach((x) => { x.textContent = "?"; });
      });
    }
    decorateReactions(el, message, "attack");
    el.querySelectorAll(".attack-target").forEach((row) => {
      const i = Number(row.dataset.index);
      const t = card.targets[i];
      const status = row.querySelector(".apply-status");
      const buttons = row.querySelector(".apply-buttons");
      if (!t?.hit) return buttons?.remove();
      // 【HP】 변화: GM, 또는 대상이 PC·식별된 에너미일 때만
      const target = fromUuidSync(t.actorUuid);
      const reveal = game.user.isGM || knowsEnemy(target);
      if (status) {
        status.textContent = t.applied ? (reveal ? L("appliedHp", { before: t.before, after: t.after }) : L("appliedHidden"))
          : autoApplyMode() === "off" ? L("manualApply") : "";
      }
      if (!buttons) return;
      if (!game.user.isGM) return buttons.remove();
      const apply = buttons.querySelector("[data-apply]");
      const undo = buttons.querySelector("[data-undo]");
      if (autoApplyMode() === "off") apply?.remove();
      if (t.applied) apply?.remove();
      else undo?.remove();
      apply?.addEventListener("click", () => requestApply(message.id, i));
      undo?.addEventListener("click", () => requestApply(message.id, i, true));
    });
  });
}
