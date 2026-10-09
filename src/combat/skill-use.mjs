/**
 * 스킬·아이템 사용 흐름 (03 §6, 단계 6-B)
 * 사용 가능 확인(engine/effects/usage) → 대상 결정(대상 문구) → 코스트 지불 → 발동 판정·효과 해석(engine/effects/resolve)
 * → 결과 카드 → 자동 적용 설정(autoApply)대로 적용(GM, 플레이어는 소켓으로 맡김)
 * 효과 데이터가 없는 스킬은 쓸 수 없다(07 #52).
 */
import { canUseSkill } from "../engine/effects/usage.mjs";
import { hasVariants, resolveEffects, variantEffects } from "../engine/effects/resolve.mjs";
import { evaluate } from "../engine/expr.mjs";
import { guardAttack } from "./guard.mjs";
import { autoKey } from "../engine/triggers.mjs";
import { delayedOf, isLateSkill, reserveDelayed, reserveLate, withoutTiming } from "./late.mjs";
import { placeTokens, removeToken, tokenEffectOf, tokensOf } from "./tokens.mjs";
import { addCondition, CONDITIONS, removeCondition } from "../engine/conditions.mjs";
import { addBuff, BUFFS } from "../engine/buffs.mjs";
import { addState } from "../engine/states.mjs";
import { inRange, pickRandom } from "../engine/combat.mjs";
import { autoApplyMode, isActiveGM } from "./apply.mjs";
import { combatProfile, friendly } from "./profile.mjs";
import { actionState, onInflicted } from "./turn-status.mjs";
import { buffLabel, conditionName } from "./status.mjs";
import { knowsEnemy, recordBestiary } from "./bestiary.mjs";
import { emit, onSocket } from "../socket.mjs";
import { decorateReactions, hasPendingReaction, pendingReaction } from "./reaction.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.SkillUse.${k}`, d) : game.i18n.localize(`NSSQ.SkillUse.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// 상태 이상은 [독], 봉인은 이름 그대로([팔] 봉인)
const condLabel = (id) => (CONDITIONS[id]?.kind === "bind" ? conditionName(id) : `[${conditionName(id)}]`);
const alive = (c) => !!c.actor && !c.defeated && (c.actor.system.hp?.value ?? 0) > 0;

/* ---------------- 대상 ---------------- */

/**
 * 대상 문구 → { side, scope }
 * side: enemy(상대 진영)·ally(같은 편)·self, scope: single·row·all·random
 * 「관통」 등 아직 모르는 범위는 single + GM 판단
 */
export function targetSpec(text = "", effects = null) {
  // 데이터의 대상 지정(type "target")이 있으면 그것을(대상 칸이 「특수」인 스킬 등)
  const o = (effects ?? []).find((e) => e?.type === "target");
  if (o) return { side: o.side ?? "enemy", scope: o.scope ?? "single", ...(o.count ? { count: o.count } : {}), ...(o.row ? { row: o.row } : {}), ...(o.excludeSelf ? { excludeSelf: true } : {}) };
  const t = String(text);
  if (/자신/.test(t) && !/아군|적/.test(t)) return { side: "self", scope: "single" };
  const side = /아군/.test(t) ? "ally" : "enemy";
  if (/전체/.test(t)) return { side, scope: "all" };
  if (/관통/.test(t)) return { side, scope: "pierce" };
  if (/열/.test(t)) return { side, scope: "row" };
  if (/특수|무작위/.test(t)) return { side, scope: "random" };
  return { side, scope: "single", unknown: !/단일|단체|1체/.test(t) };
}

/**
 * 이번 턴 대상 범위 변경(거너 폼·《아름다운 춤》·《스프레드 스로》·《승리의 맹세》·《일제 구호》): 전투원의 「그 턴 동안」 효과 scopeChange
 * { category, fromSide?, fromScope?, scope, side? }: 그 분류이고 원래 범위가 맞으면 범위를 바꾼다
 */
export function turnScope(combatant, item, spec) {
  if (!combatant?.actor || !item?.system) return spec;
  for (const e of combatProfile(combatant.actor, combatant).scopeChanges ?? []) {
    if (e.category && item.system.category !== e.category) continue;
    if (e.fromSide && spec.side !== e.fromSide) continue;
    if (e.fromScope && ![].concat(e.fromScope).includes(spec.scope)) continue;
    if (spec.side === "self") continue;
    return { ...spec, scope: e.scope, ...(e.side ? { side: e.side } : {}), unknown: false };
  }
  return spec;
}

/** 쓰러진 아군도 대상이 되는 효과(revive)가 있는가 */
const revives = (item) => (item?.system.effects ?? []).some((e) => e?.type === "heal" && (e.revive
  // 《간이 소생》: 그 캐릭터가 쓰는 HP 회복 아이템
  || (item.type === "consumable" && (e.resource ?? "hp") === "hp" && !!item.parent?.system.passives?.flags?.itemRevive)));

/** 이 사용자의 대상 후보(살아 있는 것, 상대 진영이면 사거리 안). allowKO: 쓰러진 아군도(부활 효과) */
export function candidates(combat, user, spec, range, { allowKO = false } = {}) {
  const me = user.actor;
  const row = me.system.row ?? "front";
  return combat.combatants.filter((c) => (alive(c) || (allowKO && spec.side === "ally" && !!c.actor)) && (spec.side === "ally" ? friendly(c.actor, me) : !friendly(c.actor, me)))
    .filter((c) => spec.side === "ally" || range === "-" || !range || inRange(range, row, c.actor.system.row ?? "front"))
    .filter((c) => !(spec.excludeSelf && c.id === user.id));
}

/* ---------------- 목록 ---------------- */

/** 사용자 프로필(engine/effects에 넘기는 모양) */
export function unitProfile(actor, combatant) {
  const p = combatProfile(actor, combatant);
  const s = actor.system;
  return {
    ...p,
    // 회복 마스터리 등: 『회복』 스킬의 회복량 다이스(상시 보정 healDice)
    healDice: s.equipment?.mods?.healDice ?? 0,
    // 《집중 치료》: 이번 턴 회복 롤의 기준 눈
    healThreshold: p.turnFlags?.healThreshold ?? 4,
    // 《이피션트》·《간이 소생》: 아이템 회복 +, HP 회복 아이템에 부활
    itemHeal: s.equipment?.mods?.itemHeal ?? 0,
    overheatMod: s.equipment?.mods?.overheatTurns ?? 0,
    // 《방패 마스터리》: 『방어』 스킬 대기 상태 횟수 +
    guardCount: s.equipment?.mods?.guardCount ?? 0,
    uuid: actor.uuid,
    useBonuses: s.passives?.useBonuses ?? [],
    // 능력치 보너스(수식 @self.bonus.agi 등). 에너미는 0
    bonus: s.bonus ?? { str: 0, tec: 0, vit: 0, agi: 0, luc: 0 },
    itemRevive: !!s.passives?.flags?.itemRevive,
    id: combatant?.id ?? actor.id,
    tp: s.tp?.value ?? 0, tpMax: s.tp?.max ?? 0, fp: s.fp?.value ?? 0,
    weaponType: s.equipment?.weapon?.weaponType ?? null,
    shield: !!s.equipment?.shield,
    states: (actor.getFlag("nssq", "states") ?? []).map((x) => x.id),
    // 수식용: 걸린 봉인·상태 이상 수(《헤븐즈 샷》 @target.bindCount)
    bindCount: (s.conditions ?? []).filter((c) => CONDITIONS[c.id]?.kind === "bind").length,
    // 수식용: 같은 편 인원수(자신 포함, 쓰러진 사람 제외. 《레기온 스러스트》 @self.allyCount)
    allyCount: combatant?.combat ? combatant.combat.combatants.filter((c) => c.actor && friendly(c.actor, actor) && alive(c)).length : 1,
    ailmentCount: (s.conditions ?? []).filter((c) => CONDITIONS[c.id]?.kind === "ailment").length,
    skills: actor.items.filter((i) => i.type === "skill").map((i) => i.name),
    noAction: actionState(combatant).noAction,
    // 지연 공격 예약 중이면 새 지연 공격 스킬 불가(01 §3.11)
    delayedPending: !!combatant?.getFlag("nssq", "delayed"),
    tokens: tokensOf(combatant),
    overheat: Number(actor.getFlag("nssq", "overheat") ?? 0)
  };
}

const isDrive = (item) => /드라이브/.test(item.name);
/** 스킬에 든 flag(상시가 아닌 특수 스킬도): 그 값과 스킬(《명군의 재능》 openingCategory 등) */
export function skillFlag(actor, flag) {
  for (const i of actor?.items ?? []) {
    if (i.type !== "skill" || (actor.type === "character" && (i.system.sl ?? 0) <= 0)) continue;
    const e = (i.system.effects ?? []).find((x) => x?.type === "flag" && x.flag === flag);
    if (e) return { value: e.value ?? true, item: i };
  }
  return null;
}
/** 해설 HTML → 툴팁용 한 줄 글 */
const plain = (html) => String(html ?? "").replace(/<br\s*\/?>|<\/p>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();

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
      return { id: i.id, name: i.name, cost: `×${i.system.quantity}`, target: i.system.target || L("allySingle"), ok, reason, desc: plain(i.system.description) };
    });
  }
  // 《명군의 재능》: 『호령』 주행동 스킬 하나를 개막 페이즈에(개막 행동으로, 그 스킬 FP를 더 낸다)
  const early = phase === "opening" ? skillFlag(actor, "openingCategory") : null;
  const openingDone = !!combatant.getFlag("nssq", "opening") || !!combatant.getFlag("nssq", "guarding");
  return actor.items.filter((i) => i.type === "skill" && ["주행동", "개막"].includes(i.system.timing) && (i.system.sl ?? 0) > 0)
    .map((i) => {
      const asOpening = early && i.system.timing === "주행동" && i.system.category === early.value;
      const r = asOpening ? (openingDone ? { ok: false, reason: "openingDone" } : canUseSkill({ ...i.system, cost: { tp: (i.system.cost?.tp ?? 0) + (early.item.system.cost?.tp ?? 0), fp: (i.system.cost?.fp ?? 0) + (early.item.system.cost?.fp ?? 0) } }, user, { phase: "main", myTurn: true, drive: isDrive(i) }))
        : canUseSkill(i.system, user, { phase, myTurn, drive: isDrive(i), openingDone });
      const c = i.system.cost ?? {};
      return { id: i.id, name: i.name, cost: [c.tp ? `TP ${c.tp}` : "", c.fp ? `FP ${c.fp}` : ""].filter(Boolean).join(" ") || "-", target: i.system.target, timing: i.system.timing, range: i.system.range, ok: r.ok, reason: r.reason, desc: plain(i.system.description) };
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
  const spec = { ...(kind === "item" ? targetSpec(item.system.target || "아군 단일", item.system.effects) : turnScope(combatant, item, targetSpec(item.system.target, item.system.effects))), variant: null };
  // 선언 명칭(《삼색 세이버》 → 《플레임 세이버》 등)을 먼저 고른다
  if (hasVariants(item.system.effects) && item.system.variants?.length) {
    spec.variant = await pickVariant(item);
    if (spec.variant === null) return null;
  }
  // 사용 때 선언하는 스킬(trigger on useSkill, 《저주의 방울 소리》)
  if (kind === "skill") {
    spec.declares = await useDeclarations(actor, item);
    if (spec.declares === null) return null;
    // 부위 등을 고르는 부여(《스티그마》 「원하는 부위 (SL)곳」)
    spec.choices = await pickChoices(item, spec.variant);
    if (spec.choices === null) return null;
  }
  const range = kind === "item" ? "-" : item.system.range;
  const opts = { variant: spec.variant, declares: spec.declares ?? [], choices: spec.choices ?? [] };
  if (spec.side === "self") return executeAction(combat, combatant, kind, id, [combatant], opts);
  const list = candidates(combat, combatant, spec, range, { allowKO: revives(item) });
  if (!list.length) return ui.notifications.warn(L("noTarget")) && null;
  if (spec.scope === "all" || spec.scope === "random") return executeAction(combat, combatant, kind, id, list, opts);
  // 「(SL)명에게」(《트릭 삼바》): 단일 대상 n명을 한 번에 고른다
  const n = spec.scope === "single" && spec.count ? evaluate(spec.count, { SL: item.system.sl ?? 1 }) : 1;
  if (n > 1) {
    const got = await pickSome(list, n, item.name);
    return got ? executeAction(combat, combatant, kind, id, got, opts) : null;
  }
  return { pick: list.map((c) => c.id), spec };
}

/**
 * 스킬을 쓸 때 선언할 수 있는 스킬(trigger on useSkill): 코스트가 되면 확인(시트 「자동」이면 바로)
 * @returns {Promise<{name, cost, mods}[]|null>} 취소면 null
 */
async function useDeclarations(actor, item) {
  const out = [];
  for (const i of actor.items.filter((x) => x.type === "skill" && (x.system.sl ?? 0) > 0 && x.id !== item.id)) {
    const t = (i.system.effects ?? []).find((e) => e?.type === "trigger" && e.on === "useSkill");
    if (!t || (t.when?.category && ![].concat(t.when.category).includes(item.system.category))) continue;
    const cost = i.system.cost ?? {};
    if ((cost.tp ?? 0) + (item.system.cost?.tp ?? 0) > (actor.system.tp?.value ?? 0) || (cost.fp ?? 0) + (item.system.cost?.fp ?? 0) > (actor.system.fp?.value ?? 0)) continue;
    const auto = !t.optional || !!actor.getFlag("nssq", "autoTrigger")?.[autoKey(i.system.key)];
    const ok = auto || await Dialog.confirm({ title: L("declareTitle"), content: `<p>${esc(L("declareAsk", { name: i.name, skill: item.name }))}</p>`, rejectClose: false });
    if (ok === null) return null;
    if (!ok) continue;
    const mods = {};
    for (const e of t.effects ?? []) if (e.type === "modifier") mods[e.path] = (mods[e.path] ?? 0) + (Number(e.value) || 0);
    out.push({ name: i.name, cost, mods });
  }
  return out;
}

/** 고르는 부여(inflict choose): 체크 상자 창 → 고른 상태 이상 id 목록(고를 것이 없으면 [], 취소면 null) */
async function pickChoices(item, variant) {
  const e = variantEffects(item.system.effects, variant).find((x) => x?.type === "inflict" && x.choose !== undefined && [].concat(x.condition).length > 1);
  if (!e) return [];
  const ids = [].concat(e.condition);
  const n = Math.max(1, evaluate(e.choose, { SL: item.system.sl ?? 1 }));
  if (n >= ids.length) return ids;
  const boxes = ids.map((id, i) => `<label class="choice"><input type="checkbox" name="c" value="${esc(id)}" ${i < n ? "checked" : ""}/> [${esc(conditionName(id))}]</label>`).join("");
  return Dialog.prompt({
    title: L("chooseTitle", { name: item.name }),
    content: `<p>${esc(L("chooseHint", { n }))}</p><form class="nssq-choices">${boxes}</form>`,
    label: L("chooseGo"),
    callback: (html) => {
      const got = [...(html[0] ?? html).querySelectorAll("input[name=c]:checked")].map((x) => x.value);
      return (got.length ? got : ids).slice(0, n);
    },
    rejectClose: false
  }, { classes: ["nssq", "dialog"] }).then((r) => r ?? null);
}

/** 선언 명칭 고르기 → 번호(취소면 null) */
async function pickVariant(item) {
  const names = item.system.variants;
  const buttons = Object.fromEntries(names.map((n, i) => [`v${i}`, { label: `《${esc(n)}》`, callback: () => i }]));
  return Dialog.wait({ title: L("variantTitle", { name: item.name }), content: `<p>${esc(L("variantHint"))}</p>`, buttons, close: () => null }, { classes: ["nssq", "dialog"] });
}

/** 이번 턴에 나온 공격의 〈염〉〈빙〉〈뇌〉(전투 플래그 turnElements, combat/chase.mjs가 기록) */
export function turnElementsOf(combat) {
  const f = combat?.getFlag("nssq", "turnElements");
  return f && f.round === combat.round ? f.elements ?? [] : [];
}

/**
 * 「그 턴 이미 나온 〈염〉〈빙〉〈뇌〉를 부가」(attack addTurnElements, 《스피어 인볼브》): 둘 이상이면 하나를 고른다(07 #119)
 * 활성 GM 화면(후발 행동 실행)이면 소유자에게 채팅 카드, 아니면 그 화면의 창
 */
async function pickTurnElement(combatant, item, effects, variant) {
  const all = turnElementsOf(combatant?.combat);
  const want = variantEffects(effects, variant).flatMap((e) => (e?.type === "attack" ? [].concat(e.addTurnElements ?? []) : []));
  const els = all.filter((x) => want.includes(x));
  if (els.length <= 1) return els;
  const label = (x) => game.i18n.localize(`NSSQ.Resist.${x}`);
  const text = L("chooseElement", { name: combatant.name, skill: item.name });
  if (isActiveGM()) {
    const { chooseOption } = await import("./late.mjs");
    const got = await chooseOption(combatant.combat, combatant, text, els.map((x) => ({ id: x, name: label(x) })));
    return els.includes(got) ? [got] : [els[0]];
  }
  const buttons = Object.fromEntries(els.map((x) => [x, { label: label(x), callback: () => x }]));
  const got = await Dialog.wait({ title: item.name, content: `<p>${esc(text)}</p>`, buttons, close: () => els[0] }, { classes: ["nssq", "dialog"] });
  return [got ?? els[0]];
}

/** 대상 수 제한(「(SL)명」·「같은 열의 적 2체」): 후보가 n보다 많으면 고르는 창. 취소면 null */
async function pickSome(list, n, title) {
  if (list.length <= n) return list;
  const boxes = list.map((c, i) => `<label class="choice"><input type="checkbox" name="c" value="${c.id}" ${i < n ? "checked" : ""}/> ${esc(c.name)}</label>`).join("");
  const ids = await Dialog.prompt({
    title, content: `<p>${esc(L("chooseHint", { n }))}</p><form class="nssq-choices">${boxes}</form>`, label: L("chooseGo"), rejectClose: false,
    callback: (html) => [...(html[0] ?? html).querySelectorAll("input[name=c]:checked")].map((x) => x.value).slice(0, n)
  }, { classes: ["nssq", "dialog"] });
  if (!ids) return null;
  const got = list.filter((c) => ids.includes(c.id));
  return got.length ? got : list.slice(0, n);
}

/** 고른 카드로 실행(열 범위면 그 카드의 열 전체) */
export async function pickTarget(combat, combatant, kind, id, picked, spec) {
  let targets = [picked];
  if (spec.scope === "row") {
    const row = picked.actor.system.row ?? "front";
    targets = candidates(combat, combatant, spec, "-", { allowKO: revives(combatant.actor.items.get(id)) }).filter((c) => (c.actor.system.row ?? "front") === row);
    // 「같은 열의 적 2체」(《화구의 인술》): 고른 대상 + 나머지에서
    const n = spec.count ? evaluate(spec.count, { SL: combatant.actor.items.get(id)?.system.sl ?? 1 }) : 0;
    if (n && targets.length > n) {
      const rest = await pickSome(targets.filter((c) => c !== picked), n - 1, combatant.actor.items.get(id)?.name ?? "");
      if (rest === null) return null;
      targets = [picked, ...rest];
    }
  } else if (spec.scope === "pierce") {
    // 「관통」: 고른 대상 + 다른 열에서 순서가 가장 가까운 1체. 가장 가까운 적이 여럿이면 그중에서 다시 고른다(07 #60)
    if (spec.first) {
      const first = combat.combatants.get(spec.first);
      targets = first ? [first, picked] : [picked];
    } else {
      const row = picked.actor.system.row ?? "front";
      const order = picked.actor.system.order ?? 0;
      const dist = (c) => Math.abs((c.actor.system.order ?? 0) - order);
      const others = candidates(combat, combatant, spec, "-").filter((c) => (c.actor.system.row ?? "front") !== row);
      const best = Math.min(...others.map(dist));
      const nearest = others.filter((c) => dist(c) === best);
      if (nearest.length > 1) return { pick: nearest.map((c) => c.id), spec: { ...spec, first: picked.id } };
      if (nearest.length) targets.push(nearest[0]);
    }
  }
  return executeAction(combat, combatant, kind, id, targets, { variant: spec.variant ?? null, declares: spec.declares ?? [], choices: spec.choices ?? [] });
}

/* ---------------- 실행 ---------------- */

async function rollWith(rolls, n) {
  if (!n) return [];
  const r = await new Roll(`${n}d6`).evaluate();
  rolls.push(r);
  return r.dice[0].results.map((x) => x.result);
}

/** 진행 중인 전투에서 이 액터의 전투원 */
const combatantOf = (actor) => game.combat?.combatants.find((c) => c.actor === actor || c.actor?.uuid === actor.uuid) ?? null;

/** 실행: 코스트 → 발동·효과 해석 → 결과 카드 */
export async function executeAction(combat, combatant, kind, id, targetCombatants, { variant = null, late = false, declares = [], choices = [], free = false } = {}) {
  const actor = combatant.actor;
  const item = actor.items.get(id);
  if (!item) return null;
  const sys = item.system;
  const phase = combat.getFlag("nssq", "phase");
  // 《끝없는 원무곡》으로 다시 행동하는 차례는 후발 행동 취급
  if (combat.getFlag("nssq", "bonusTurn") === combatant.id) late = true;
  const effects = variantEffects(sys.effects ?? [], variant);
  // 후발 행동 주행동 스킬: 메인 페이즈에 쓰면 예약만(모든 전투원 행동 뒤 실행, combat/late.mjs)
  // 《에테르 압축》: 그 턴 그 분류(술식)의 공격도 후발(이번 턴 효과 flag lateCategory)
  const lateCat = combatProfile(actor, combatant).turnFlags?.lateCategory;
  const lateByTurn = lateCat && sys.category === lateCat && effects.some((e) => e?.type === "attack");
  if (!late && kind === "skill" && combat.started && phase === "main" && sys.timing === "주행동" && (isLateSkill(effects) || lateByTurn)) {
    return reserveLate(combatant, kind, item, targetCombatants, variant);
  }
  // 코스트 지불(아이템은 수량 −1). 발동에 실패해도 소모(07 #9)
  const upd = {};
  if (kind === "skill" && !free) {
    // 《명군의 재능》으로 개막 페이즈에 쓰는 주행동 스킬: 그 스킬의 코스트도
    const early = phase === "opening" && sys.timing === "주행동" ? skillFlag(actor, "openingCategory") : null;
    const extra = early && sys.category === early.value ? { ...(early.item.system.cost ?? {}) } : {};
    // 사용 때 선언(《저주의 방울 소리》 등)의 코스트
    for (const d of declares) { extra.tp = (extra.tp ?? 0) + (d.cost?.tp ?? 0); extra.fp = (extra.fp ?? 0) + (d.cost?.fp ?? 0); }
    const tp = (sys.cost?.tp ?? 0) + (extra.tp ?? 0);
    const fp = (sys.cost?.fp ?? 0) + (extra.fp ?? 0);
    if (tp) upd["system.tp.value"] = Math.max(0, (actor.system.tp?.value ?? 0) - tp);
    if (fp) upd["system.fp.value"] = Math.max(0, (actor.system.fp?.value ?? 0) - fp);
    if (Object.keys(upd).length) await actor.update(upd);
  } else if (kind !== "skill") {
    await item.update({ "system.quantity": Math.max(0, (sys.quantity ?? 1) - 1) });
  }
  // 《최종 결전의 군가》: 그 분류의 주행동 스킬 여러 개를 TP 없이 한 번에
  const multi = kind === "skill" ? effects.find((e) => e?.type === "multiUse") : null;
  if (multi) return useMulti(combat, combatant, item, multi, late);
  // 토큰 배치(소환수·방진): 그 효과만 있는 스킬이면 카드는 배치 안내뿐(combat/tokens.mjs)
  if (combat.started && tokenEffectOf(effects).length) {
    await placeTokens(combat, combatant, item, variant);
    if (effects.every((e) => ["token", "target"].includes(e?.type))) return null;
  }
  // 지연 공격: 코스트를 내고 예약(그 효과만 있는 스킬이면 카드는 예약 안내뿐)
  const delayed = combat.started ? delayedOf(effects) : null;
  if (delayed) {
    await reserveDelayed(combat, combatant, item, delayed, targetCombatants);
    if (effects.every((e) => ["delayed", "target"].includes(e?.type))) {
      if (kind === "skill" && actor.type === "enemy") await recordBestiary(actor, { skill: item.name });
      return null;
    }
  }
  const userMods = declares.reduce((m, d) => { for (const [k, v] of Object.entries(d.mods ?? {})) m[k] = (m[k] ?? 0) + v; return m; }, {});
  // 《이도일인》·《추영의 잔상》: 쌍수 중 그 분류 공격 스킬을 2회(TP 2회분, 2회째는 고를 수 있음)
  const twice = kind === "skill" && !free ? await askDualSkill(actor, item, effects) : null;
  if (twice) userMods.physHit = (userMods.physHit ?? 0) + twice.hitMod;
  const post = (units, weaponMod = null) => resolveAndPost({
    actor, combatant, item, kind, units,
    mainAction: kind === "skill" && sys.timing === "주행동", variant, choices, stripTiming: late, skipDelayed: !!delayed, skipToken: tokenEffectOf(effects).length > 0,
    userMods, weaponMod
  });
  const message = await post(targetCombatants.map((c) => ({ actor: c.actor, combatant: c })));
  // 2회째: 기타 슬롯 무기로(성능·속성, 07 #125)
  if (twice) {
    await new Promise((r) => setTimeout(r, 300));
    const left = targetCombatants.filter(alive);
    if (left.length) await post(left.map((c) => ({ actor: c.actor, combatant: c })), twice.swap);
  }
  if (kind === "skill" && actor.type === "enemy") await recordBestiary(actor, { skill: item.name });
  // 개막 페이즈에 쓴 스킬은 그 전투원의 개막 행동
  if (combat.getFlag("nssq", "phase") === "opening") await combatant.setFlag("nssq", "opening", "skill");
  return message;
}

/**
 * 쌍수 스킬 2회(상시 dualSkill {category, hitMod}): 통상 공격 쌍수 조건(combat/attack.mjs dualWieldOf)이 맞고 그 분류의 공격 스킬이면
 * 2회째를 쓸지 묻고, 쓰면 코스트를 한 번 더 낸다. @returns {{ hitMod }|null}
 */
async function askDualSkill(actor, item, effects) {
  const sk = actor.items.find((i) => i.type === "skill" && (i.system.sl ?? 0) > 0 && (i.system.effects ?? []).some((e) => e?.type === "dualSkill"));
  if (!sk || !effects.some((e) => e?.type === "attack")) return null;
  const e = sk.system.effects.find((x) => x?.type === "dualSkill");
  if (item.system.category !== (e.category ?? "백병")) return null;
  const { dualWieldOf } = await import("./attack.mjs");
  if (!dualWieldOf(actor)) return null;
  const cost = item.system.cost ?? {};
  if ((cost.tp ?? 0) > (actor.system.tp?.value ?? 0) || (cost.fp ?? 0) > (actor.system.fp?.value ?? 0)) return null;
  const ok = await Dialog.confirm({ title: `《${sk.name}》`, content: `<p>${esc(L("dualAsk", { skill: item.name, name: sk.name }))}</p>`, rejectClose: false });
  if (!ok) return null;
  const upd = {};
  if (cost.tp) upd["system.tp.value"] = actor.system.tp.value - cost.tp;
  if (cost.fp) upd["system.fp.value"] = actor.system.fp.value - cost.fp;
  if (Object.keys(upd).length) await actor.update(upd);
  return { hitMod: evaluate(e.hitMod ?? 0, { SL: sk.system.sl ?? 1 }), swap: dualWieldOf(actor)?.swap ?? null };
}

/** 《최종 결전의 군가》: 고른 스킬(최대 count개, 대상이 자신·전체인 것)을 코스트 없이 차례로 */
async function useMulti(combat, combatant, item, { category, count = 3 }, late) {
  const actor = combatant.actor;
  const user = unitProfile(actor, combatant);
  const list = actor.items.filter((i) => i.type === "skill" && i.id !== item.id && i.system.timing === "주행동" && i.system.category === category && (i.system.sl ?? 0) > 0)
    .filter((i) => { const sp = targetSpec(i.system.target, i.system.effects); return !sp.unknown && (sp.side === "self" || sp.scope === "all"); })
    .filter((i) => canUseSkill({ ...i.system, cost: {} }, user, { phase: "main", myTurn: true }).ok);
  if (!list.length) return ui.notifications.warn(L("multiNone")) && null;
  const n = Math.max(1, Number(count) || 3);
  const boxes = list.map((i, k) => `<label class="choice"><input type="checkbox" name="c" value="${i.id}" ${k < n ? "checked" : ""}/> 《${esc(i.name)}》</label>`).join("");
  const ids = await Dialog.prompt({
    title: L("chooseTitle", { name: item.name }), content: `<p>${esc(L("multiHint", { n }))}</p><form class="nssq-choices">${boxes}</form>`, label: L("chooseGo"), rejectClose: false,
    callback: (html) => [...(html[0] ?? html).querySelectorAll("input[name=c]:checked")].map((x) => x.value).slice(0, n)
  }, { classes: ["nssq", "dialog"] });
  if (!ids?.length) return null;
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<div class="nssq-combat-note"><i class="fas fa-music"></i> ${esc(L("multiUsed", { name: combatant.name, skill: item.name, list: ids.map((x) => `《${actor.items.get(x)?.name}》`).join("") }))}</div>` });
  let first = null;
  for (const id of ids) {
    const it = actor.items.get(id);
    const sp = turnScope(combatant, it, targetSpec(it.system.target, it.system.effects));
    const targets = sp.side === "self" ? [combatant] : candidates(combat, combatant, sp, it.system.range, { allowKO: revives(it) });
    if (!targets.length) continue;
    const m = await executeAction(combat, combatant, "skill", id, targets, { free: true, late });
    first ??= m;
  }
  if (combat.getFlag("nssq", "phase") === "opening") await combatant.setFlag("nssq", "opening", "skill");
  return first;
}

/**
 * 전투 밖에서 소모품 쓰기(캐릭터 시트의 [사용]). 수량은 호출한 쪽이 줄인다
 * 대상이 「자신」이면 자신, 아니면 파티에서 고른다
 */
export async function useItemOutside(actor, item, targets) {
  return resolveAndPost({ actor, combatant: null, item, kind: "item", units: targets.map((a) => ({ actor: a, combatant: null })), mainAction: false });
}

/**
 * 효과 해석 → FP·오버히트 → 결과 카드
 * 추격·반격·발동(combat/chase.mjs)은 item 대신 { name, img, system: { effects, sl, category } } 모양을 넘긴다
 * @param {{ type: "chase"|"counter"|"trigger" }} [followup] 이 카드가 추격·반격 등이면(연쇄 금지 판단용)
 * @param {Object<string, object>} [extra] 대상 uuid → 더한 대미지 다이스(《풀 게인》 등, engine extendDamage 결과 + count)
 */
export async function resolveAndPost({ actor, combatant, item, kind, units, mainAction, variant = null, choices = [], weaponMod = null, followup = null, extra = null, extraRolls = [], stripTiming = false, skipDelayed = false, skipToken = false, userMods = {} }) {
  const sys = item.system;
  // 후발 행동으로 실행할 때는 행동 순서 효과를 빼고, 예약한 지연 공격은 다시 해석하지 않는다
  let effectsAll = sys.effects ?? [];
  if (stripTiming) effectsAll = withoutTiming(effectsAll);
  if (skipDelayed) effectsAll = effectsAll.filter((e) => e?.type !== "delayed");
  if (skipToken) effectsAll = effectsAll.filter((e) => e?.type !== "token");
  const spec = kind === "item" ? targetSpec(sys.target || "아군 단일", sys.effects) : turnScope(combatant, item, targetSpec(sys.target, sys.effects));
  const rolls = [...extraRolls];
  const user = unitProfile(actor, combatant);
  // 사용 때 선언한 보정(《저주의 방울 소리》 억제 공격 +5)
  for (const [k, v] of Object.entries(userMods ?? {})) user[k] = (user[k] ?? 0) + v;
  // 다른 무기로(쌍수 스킬 2회째): 성능 차이·속성·종류
  if (weaponMod) {
    user.physHit += weaponMod.physHit ?? 0;
    user.physAtk += weaponMod.physAtk ?? 0;
    user.elemAtk += weaponMod.elemAtk ?? 0;
    if (weaponMod.elements?.length) user.elements = weaponMod.elements;
    if (weaponMod.weaponType) user.weaponType = weaponMod.weaponType;
  }
  // 《돌격대장》: 이번 턴 다른 아군이 먼저 공격한 적에게는 대미지 다이스 +SL
  const vg = combatant?.combat?.getFlag("nssq", "vanguard") ?? {};
  for (const [holder, v] of Object.entries(vg)) {
    if (holder === combatant.id || v.round !== combatant.combat.round || !v.targets?.length) continue;
    user.attackBonuses = [...(user.attackBonuses ?? []), { name: v.name, when: { targetIn: v.targets }, hitMod: 0, diceMod: v.sl ?? 1, atkMod: 0, critDice: 0, critUp: false }];
  }
  // 가드·도발·반사(단계 8-C): 공격 롤이 있는 스킬이면 대상·방어 값을 먼저 정한다
  const atk = variantEffects(effectsAll, variant).find((e) => e?.type === "attack");
  let guard = null;
  if (atk && units.length && units.every((u) => u.combatant)) {
    const elements = atk.element ? [].concat(atk.element) : atk.addElement ? [...new Set([...(user.elements ?? []).filter((x) => x !== "none"), ...[].concat(atk.addElement)])] : user.elements;
    guard = await guardAttack({ attacker: actor, targets: units.map((u) => u.combatant), kind: atk.kind ?? "physical", elements, single: spec.scope === "single" && units.length === 1, noRedirect: spec.scope === "random" });
    units = guard.targets.map((c) => ({ actor: c.actor, combatant: c }));
  }
  const targets = units.map((u) => unitProfile(u.actor, u.combatant));
  if (guard) for (const t of targets) guard.apply(t);
  const actorOf = new Map(units.map((u, i) => [targets[i].id, u.actor]));
  // 《인법: 수경》: 대상과 같은 편 전투원(같은 열에 상태 이상을 옮긴다)
  let spreadPool = [];
  if (effectsAll.some((e) => e?.type === "spreadAilment" && e.from !== "self") && units[0]?.combatant?.combat) {
    const first = units[0].actor;
    const mates = units[0].combatant.combat.combatants.filter((c) => alive(c) && c.actor !== first && friendly(c.actor, first));
    spreadPool = mates.map((c) => unitProfile(c.actor, c));
    mates.forEach((c, i) => actorOf.set(spreadPool[i].id, c.actor));
  }
  // 흡수(drain) 등 사용자 자신에게 돌아오는 결과
  if (!actorOf.has(user.id)) actorOf.set(user.id, actor);
  const r = await resolveEffects({
    effects: effectsAll, sl: kind === "skill" ? sys.sl ?? 1 : 1, user,
    targets: spec.scope === "random" ? [] : targets, pool: spec.scope === "random" ? targets : spreadPool,
    mainAction, rollDice: (n) => rollWith(rolls, n), rng: () => CONFIG.Dice.randomUniform(),
    variant, category: sys.category ?? "", source: kind, ctx: { skillKey: sys.key ?? null, choices, turnElements: await pickTurnElement(combatant, item, effectsAll, variant) }
  });
  if (guard) await guard.commit(new Set([...r.results.values()].filter((x) => x.hits.some((h) => h.hit)).map((x) => x.id)));
  // 「최속/후발 행동」(개막 페이즈에 쓴 것): 이번 턴 행동 순서. 메인 페이즈로 넘어갈 때 이니셔티브에 반영
  if (!r.failed) {
    for (const [i, t] of targets.entries()) {
      const at = r.results.get(t.id)?.actionTiming;
      if (at && units[i].combatant) await units[i].combatant.setFlag("nssq", "timing", at);
      // 「그 턴 주행동 2회」(《인법: 분신》)
      const extraN = r.results.get(t.id)?.extraAction;
      if (extraN && units[i].combatant) await units[i].combatant.update({ "flags.nssq.extraAction": (units[i].combatant.getFlag("nssq", "extraAction") ?? 0) + extraN, "flags.nssq.extraActionRound": units[i].combatant.combat?.round ?? 0 });
    }
  }
  // 《끝없는 원무곡》: 대상 아군이 후발 행동 취급으로 다시 행동(메인 페이즈 끝, documents/combat.mjs afterLate)
  if (!r.failed && combatant?.combat) {
    const add = units.filter((u, i) => u.combatant && r.results.get(targets[i].id)?.bonusTurn).map((u) => u.combatant.id);
    if (add.length) await combatant.combat.setFlag("nssq", "bonusTurns", [...(combatant.combat.getFlag("nssq", "bonusTurns") ?? []), ...add]);
  }
  // 「다음 턴」 효과(《차지 에지》): 전투원 플래그 nextTurn(다음 라운드에 「그 턴 동안」 효과처럼, combat/profile.mjs)
  const nt = r.results.get(user.id)?.nextTurn;
  if (nt && !r.failed && combatant?.combat) {
    const round = combatant.combat.round + 1;
    const keep = (combatant.getFlag("nssq", "nextTurn") ?? []).filter((x) => x.round >= combatant.combat.round);
    await combatant.setFlag("nssq", "nextTurn", [...keep, { round, name: item.name, sl: sys.sl ?? 1, effects: nt.effects }]);
  }
  // 토큰 1개 소멸(《비스트 귀환》·《파진》)
  const tr = r.results.get(user.id)?.tokenRemove;
  if (tr !== undefined && !r.failed && combatant) await removeToken(combatant, tr || null);
  // FP(캐릭터만), 오버히트
  if (r.fpGain && actor.type === "character") await actor.update({ "system.fp.value": (actor.system.fp?.value ?? 0) + r.fpGain });
  if (r.overheat) {
    await actor.setFlag("nssq", "overheat", r.overheat);
    // 《리미트 오버》: 그 전투 동안 오버히트가 회복되지 않는다
    if (user.turnFlags?.overheatLock) await actor.setFlag("nssq", "overheatLock", true);
  }
  // 《링크 이펙트》: 이 스킬(《삼색 세이버》)로 공격한 적에게 이번 턴 다른 공격에도 그 속성
  const linkKey = user.turnFlags?.markElementKey;
  if (linkKey && linkKey === sys.key && !r.failed && combatant?.combat) {
    const els = (variantEffects(effectsAll, variant).find((e) => e?.type === "attack")?.addElement) ?? [];
    const c0 = combatant.combat;
    const prev = c0.getFlag("nssq", "linkMarks");
    const marks = prev?.round === c0.round ? { ...prev.marks } : {};
    for (const x of r.results.values()) if (x.id !== user.id && x.hits.some((h) => h.hit)) marks[x.id] = [...new Set([...(marks[x.id] ?? []), ...[].concat(els)])];
    if (els.length) await c0.setFlag("nssq", "linkMarks", { round: c0.round, name: item.name, marks });
  }
  else if (r.overheatReduce && !r.failed) {
    const cur = Number(actor.getFlag("nssq", "overheat") ?? 0);
    if (cur > 0) await actor.setFlag("nssq", "overheat", Math.max(0, cur - r.overheatReduce));
  }

  const entries = [...r.results.values()].map((x) => ({
    uuid: actorOf.get(x.id)?.uuid ?? null, name: x.name,
    damage: x.damage + (extra?.[actorOf.get(x.id)?.uuid]?.add ?? 0), extra: extra?.[actorOf.get(x.id)?.uuid] ?? null, heal: x.heal, inflicts: x.inflicts, buffs: x.buffs, cures: x.cures, resource: x.resource,
    states: x.states.map((st) => ({ ...st, name: st.name || item.name })),
    sleepBroken: x.sleepBroken, revive: !!x.revive, command: x.command ?? null,
    stances: (x.stances ?? []).map((st) => ({ ...st, name: item.name, key: sys.key ?? item.name })),
    hits: x.hits.map((h) => (h.skipped ? { skipped: true, seq: h.seq } : { seq: h.seq, woke: !!h.woke, hit: h.hit, kind: h.kind, total: h.hitCheck?.total, absSuccess: !!h.hitCheck?.absSuccess, absFailure: !!h.hitCheck?.absFailure, dice: h.hitCheck?.used, diceCount: h.diceCount ?? 0, dmg: h.damage?.dice ?? [], crit: !!h.crit, final: h.finalDamage ?? 0, resist: h.resist, raw: h.rawDamage ?? 0, halves: Number(!!h.guarded) + Number(!!h.halved) + Number(!!h.guardHalf), elements: h.elements ?? [] })),
    applied: false, before: null,
    // 수동 반응(단계 6-C): 명중한 공격이 있고 대상이 쓸 수 있는 수동 스킬이 있으면 기다린다
    reaction: pendingReaction(actorOf.get(x.id), x.hits.find((h) => h.hit)?.kind ?? "physical", x.hits.some((h) => h.hit))
  }));
  // 아무 결과도 없는 대상 줄은 뺀다(《디코이 사인》처럼 대상은 지정만 하고 효과는 사용자에게 저장되는 스킬)
  const empty = (e) => !e.hits.length && !e.damage && !e.heal?.hp && !e.heal?.tp && !e.revive && !e.sleepBroken && !e.extra
    && ![e.inflicts, e.buffs, e.cures, e.resource, e.states, e.stances].some((l) => l?.length);
  for (let i = entries.length - 1; i >= 0; i--) if (empty(entries[i]) && entries.length > 1) entries.splice(i, 1);
  // 아군 반동(《레기온 스러스트》 「자신 외 아군 전원」)·아군 회복(《블랙 사바스》 「아군 전체」)
  if (!r.failed && (r.allyRecoil || r.allyHeal) && combatant?.combat) {
    const mates = combatant.combat.combatants.filter((c) => alive(c) && friendly(c.actor, actor) && c.actor.type !== "token");
    for (const c of mates) {
      if (c.id === combatant.id && !r.allyHeal) continue;
      let e = entries.find((x) => x.uuid === c.actor.uuid);
      if (!e) entries.push(e = { uuid: c.actor.uuid, name: c.name, damage: 0, extra: null, heal: { hp: 0, tp: 0 }, inflicts: [], buffs: [], cures: [], resource: [], states: [], stances: [], hits: [], sleepBroken: false, revive: false, applied: false, before: null, reaction: null });
      if (r.allyRecoil && c.id !== combatant.id) { e.damage += r.allyRecoil; e.resource.push({ recoil: r.allyRecoil }); }
      if (r.allyHeal) { e.heal.hp += r.allyHeal; e.resource.push({ heal: "hp", amount: r.allyHeal }); }
    }
  }
  // 더한 대미지 다이스만 있는 대상(《풀 게인》: 효과 해석 결과가 없다)
  for (const [uuid, x] of Object.entries(extra ?? {})) {
    if (entries.some((e) => e.uuid === uuid)) continue;
    const u = units.find((v) => v.actor.uuid === uuid);
    entries.push({ uuid, name: u?.combatant?.name ?? u?.actor.name ?? "", damage: x.add, extra: x, heal: { hp: 0, tp: 0 }, inflicts: [], buffs: [], cures: [], resource: [], states: [], stances: [], hits: [], sleepBroken: false, revive: false, applied: false, before: null, reaction: null });
  }
  const card = {
    userUuid: actor.uuid, userName: combatant?.name ?? actor.name, kind,
    name: variant !== null && sys.variants?.[variant] ? `${item.name}《${sys.variants[variant]}》` : item.name, img: item.img, sl: kind === "skill" ? sys.sl ?? null : null,
    activation: r.activation, failed: r.failed, fpGain: r.fpGain, gm: r.gm, partial: sys.effectsNote ?? "",
    category: sys.category ?? "", ...(followup ? { followup } : {}),
    // 같은 공격 반복·《크로스 차지》용(combat/chase.mjs)
    itemId: item.id ?? null, variant, skillKey: sys.key ?? null, main: !!mainAction,
    description: sys.description ?? "",
    unknownScope: !!spec.unknown, entries, applied: false
  };
  const speaker = ChatMessage.getSpeaker({ actor, token: actor.token });
  const post = (c, first) => ChatMessage.create({
    speaker, content: renderCard(c),
    ...(first ? { rolls, sound: rolls.length ? CONFIG.sounds.dice : undefined } : {}),
    flags: { nssq: { skillCard: c } }
  });
  // 《딜레이 스탭》: 명중했으면 후발 추가 공격 예약(메인 페이즈 끝까지 대미지를 받으면 취소, combat/events.mjs)
  const lrep = r.results.get(user.id)?.lateRepeat;
  if (lrep && !r.failed && combatant?.combat) await combatant.setFlag("nssq", "lateRepeat", { ...lrep, name: item.name, img: item.img, sl: sys.sl ?? 1 });
  // 《타기팅》: 전투 플래그 focus(이번 턴)
  if (!r.failed && r.focus && combatant?.combat) {
    const fc = targets.find((t) => t.id === r.focus);
    if (fc) await combatant.combat.setFlag("nssq", "focus", { targetId: r.focus, round: combatant.combat.round, side: actor.type === "enemy" ? "enemy" : "party" });
  }
  // 아군 일제 추격(《일제 사격》·《난룡의 진》): 카드 뒤에
  const rally = !r.failed && r.rally ? r.rally : null;
  const afterPost = async (m) => {
    if (rally && combatant) await (await import("./chase.mjs")).rallyChase(combatant, rally);
    // 《이밋 웨펀》: 해제한 『속성 부여』의 속성으로 적 전체 공격
    if (!r.failed && r.emit && combatant?.combat) await emitAttack(combatant, item, r.emit);
    return m;
  };
  // 《아리아드네의 실》: 던전 긴급 탈출(전투 중이면 도주로 끝냄, apps/dungeon.mjs)
  if (!r.failed && effectsAll.some((e) => e?.type === "escapeDungeon")) setTimeout(async () => (await import("../apps/dungeon.mjs")).escapeDungeon(combatant?.name ?? actor.name), 0);
  // 다회 공격은 타격마다 카드를 따로 낸다(주사위·발동 판정·GM 안내는 첫 카드에)
  const parts = splitHits(card, spec.scope === "random");
  if (!parts) return afterPost(await post(card, true));
  let first = null;
  for (const [i, c] of parts.entries()) {
    const m = await post(c, i === 0);
    first ??= m;
  }
  return afterPost(first);
}

/** 《이밋 웨펀》 뒤의 속성 공격: 사용자의 적 전체(살아 있는) */
async function emitAttack(combatant, item, { element, kind }) {
  const foes = combatant.combat.combatants.filter((c) => alive(c) && !friendly(c.actor, combatant.actor));
  if (!foes.length) return null;
  const sys = item.system;
  return resolveAndPost({
    actor: combatant.actor, combatant, kind: "skill",
    item: { id: null, name: item.name, img: item.img, system: { effects: [{ type: "attack", kind, element }], sl: sys.sl ?? 1, category: sys.category ?? "", key: sys.key ?? null, target: "적 전체" } },
    units: foes.map((c) => ({ actor: c.actor, combatant: c })), mainAction: false
  });
}

/* ---------------- 《명하노니》: 적용할 때 실행 ---------------- */

/** stop: 이미 행동 불능(카드 안내만) / selfAttack: 자신을 / enemyAttack: 자신 이외의 같은 편 무작위 1체를 통상 공격 */
async function runCommand(actor, mode) {
  const combat = game.combat;
  const me = combat?.combatants.find((c) => c.actor === actor || c.actor?.uuid === actor.uuid);
  if (!me || !alive(me) || mode === "stop") return;
  const { normalAttack } = await import("./attack.mjs");
  let target = me;
  if (mode === "enemyAttack") {
    target = pickRandom(combat.combatants.filter((c) => c !== me && alive(c) && friendly(c.actor, actor)), () => CONFIG.Dice.randomUniform());
    if (!target) return ChatMessage.create({ speaker: { alias: game.i18n.localize("NSSQ.Combat.tracker") }, content: `<div class="nssq-combat-note">${esc(L("commandNone", { name: me.name }))}</div>` });
  }
  return normalAttack(actor, { target: target.token, ignoreRange: true });
}

/* ---------------- 다회 공격: 타격마다 카드 ---------------- */

/**
 * 결과 카드를 타격(회차)별 카드로 나눈다. 다회 공격이 아니면 null
 * - 무작위 대상: 공격 하나(seq)가 한 장. 그 밖(단일·열·전체): n번째 타격끼리 한 장(대상마다 한 줄)
 * - 명중으로 생긴 부여·강화·자원 변화(seq가 붙은 것)는 그 타격 카드에, 나머지(회복·상태·해제 등)는 마지막 카드에
 * - 수동 반응은 그 대상이 처음 명중한 카드에(공격 롤 1회에 1번)
 */
function splitHits(card, random) {
  if (card.failed) return null;
  const entries = card.entries ?? [];
  const seqs = [...new Set(entries.flatMap((e) => (e.hits ?? []).map((h) => h.seq)))].sort((a, b) => a - b);
  const count = random ? seqs.length : Math.max(0, ...entries.map((e) => e.hits?.length ?? 0));
  if (count < 2) return null;
  const hitAt = (e, k) => (random ? (e.hits ?? []).find((h) => h.seq === seqs[k]) : e.hits?.[k]) ?? null;
  const roundOf = (e, seq) => (random ? seqs.indexOf(seq) : (e.hits ?? []).findIndex((h) => h.seq === seq)) + 1;
  const hasRest = (e) => !!(e.heal?.hp || e.heal?.tp || e.states?.length || e.cures?.length
    || [e.inflicts, e.buffs, e.resource].some((l) => (l ?? []).some((x) => !x.seq)));
  const part = (e, h, last) => {
    const pick = (list) => (list ?? []).filter((x) => (x.seq ? x.seq === h?.seq : last));
    const firstHit = (e.hits ?? []).find((x) => x.hit);
    return {
      ...e, hits: h ? [h] : [], damage: h?.hit ? h.final ?? 0 : 0,
      heal: last ? e.heal : { hp: 0, tp: 0 }, states: last ? e.states : [], cures: last ? e.cures : [],
      inflicts: pick(e.inflicts).map((i) => (i.broken ? { ...i, broken: roundOf(e, i.broken) } : i)),
      buffs: pick(e.buffs), resource: pick(e.resource),
      sleepBroken: !!h?.woke,
      // 다른 타격에 명중이 없으면 이 카드로 반응하면 대상의 추가 효과까지 없어진다(reaction.mjs)
      reaction: h && h === firstHit ? e.reaction : null,
      applied: false, before: null
    };
  };
  const id = foundry.utils.randomID();
  const out = [];
  for (let k = 0; k < count; k++) {
    const last = k === count - 1;
    const list = [];
    for (const e of entries) {
      const h = hitAt(e, k);
      if (h || (last && hasRest(e))) list.push(part(e, h, last));
    }
    out.push({
      ...card, entries: list, applied: false, group: { id, index: k + 1, count },
      ...(k ? { activation: null, fpGain: 0, gm: [], partial: "", description: "", unknownScope: false } : {})
    });
  }
  return out;
}

/** 같은 다회 공격에서 나온 카드 메시지(회차 순) */
export function groupMessages(card) {
  if (!card?.group) return [];
  return game.messages.filter((m) => m.getFlag("nssq", "skillCard")?.group?.id === card.group.id)
    .sort((a, b) => a.getFlag("nssq", "skillCard").group.index - b.getFlag("nssq", "skillCard").group.index);
}

/** 이 카드(다회 공격이면 같은 공격의 모든 카드)에 반응을 기다리는 대상이 있는가 */
export function groupPendingReaction(card) {
  const cards = card?.group ? groupMessages(card).map((m) => m.getFlag("nssq", "skillCard")) : [card];
  return cards.some((c) => hasPendingReaction(c?.entries));
}

/* ---------------- 카드 ---------------- */

function entryLines(e, card) {
  const out = [];
  const hits = e.hits ?? [];
  // 타격마다 나눈 카드는 머리에 회차를 보이므로 줄마다 붙이지 않는다
  const multi = !card.group && (card.entries ?? []).reduce((n, x) => n + (x.hits?.length ?? 0), 0) > 1;
  // 부여·강화·확률 실패: 어느 명중에서 생겼는지(seq)가 있으면 그 공격 아래에
  // 억제 판정: 대결이면 양쪽, 고정 목표값이면 방어 쪽 주사위·달성값(07 #47: 모르는 에너미의 값은 ?)
  //   (공격 카드처럼 주사위만 보이고 보정·달성값을 가린다. 보정이 보이면 달성값을 계산할 수 있다)
  const chk = (c, side = "user") => {
    const mask = side === "user" ? `data-mask="${esc(card.kind)}"` : "data-mask-def";
    const mod = c ? c.total - c.sum : 0;
    return `${(c?.used ?? []).join("+")}${mod ? `${mod >= 0 ? "+" : "−"}<span ${mask}>${Math.abs(mod)}</span>` : ""} = <span ${mask}>${c?.total ?? "-"}</span>`;
  };
  const rollText = (i) => (i.contest ? esc(L("contestRoll", { atk: "\u0001", def: "\u0002" })).replace("\u0001", chk(i.contest.atk)).replace("\u0002", chk(i.contest.def, "target"))
    : i.fixed ? esc(L("fixedRoll", { def: "\u0002", target: i.fixed.target })).replace("\u0002", chk(i.fixed.check, "target"))
      : i.forced ? esc(L("forcedRoll", { atk: "\u0001" })).replace("\u0001", chk(i.forced.atk)) : "");
  const inflictLi = (i) => `<li class="${i.resisted || i.broken ? "resist" : "inflict"}">${esc(i.resisted ? L("inflictResisted", { label: condLabel(i.id) }) : i.id === "death" || CONDITIONS[i.id]?.depth === false ? condLabel(i.id) : L("inflictLine", { label: condLabel(i.id), depth: i.depth ?? "-" }))}${i.broken ? ` <em class="woke">${esc(L("brokenAt", { n: i.broken }))}</em>` : ""}${rollText(i) ? `<div class="supp-roll">${rollText(i)}</div>` : ""}</li>`;
  const buffLi = (b) => `<li class="${BUFFS[b.id]?.kind ?? "buff"}">${esc(L("buffLine", { label: buffLabel(b), turns: b.turns }))}</li>`;
  const chanceLi = (x) => `<li class="miss">${esc(L("chanceFailed", { die: x.die }))}</li>`;
  const sub = (seq) => [
    ...(e.inflicts ?? []).filter((i) => i.seq === seq).map(inflictLi),
    ...(e.buffs ?? []).filter((b) => b.seq === seq).map(buffLi),
    ...(e.resource ?? []).filter((x) => x.chanceFailed && x.seq === seq).map(chanceLi)
  ].join("");
  for (const h of hits) {
    const no = multi && h.seq ? `<b class="seq">${esc(L("hitNo", { n: h.seq }))}</b> ` : "";
    if (h.skipped) { out.push(`<li class="miss">${no}${esc(L("skipped"))}</li>`); continue; }
    // 달성값은 모르는 에너미면 ?로 바꾸므로 span에 넣고, 나머지 글자만 이스케이프한다
    const [pre, post] = L(h.hit ? "hitLine" : "missLine", { total: "\u0000", dice: h.dice?.join("+") ?? "" }).split("\u0000");
    let line = `${no}${esc(pre)}<span data-mask="${esc(card.kind)}">${h.total ?? "-"}</span>${esc(post ?? "")}`;
    if (h.hit) line += ` — ${esc(L("damageLine", { n: h.final, count: h.diceCount }))}${h.crit ? ` <b class="crit">${esc(L("crit"))}</b>` : ""}`;
    if (h.woke) line += ` <em class="woke">${esc(L("woke"))}</em>`;
    const inner = h.seq ? sub(h.seq) : "";
    out.push(`<li class="${h.hit ? "hit" : "miss"}">${line}${inner ? `<ul class="per-hit">${inner}</ul>` : ""}</li>`);
  }
  if (e.extra) {
    out.push(`<li class="hit">${esc(L("extraDice", { count: e.extra.count, dice: [...e.extra.dice, ...e.extra.critExtra].join(",") || "-", n: e.extra.add }))}${e.extra.crit ? ` <b class="crit">${esc(L("crit"))}</b>` : ""}</li>`);
  }
  if (e.damage && hits.length > 1) out.push(`<li class="total">${esc(L("damageTotal", { n: e.damage }))}</li>`);
  for (const x of e.resource ?? []) if (x.recoil) out.push(`<li class="hit">${esc(L("recoil", { n: x.recoil }))}</li>`);
  // 자원 변화(《무사의 마음가짐》 【TP】 +1 등). 회복(heal)·반동·확률 실패는 따로
  for (const x of e.resource ?? []) {
    if (!x.resource || x.chanceFailed) continue;
    const res = x.resource === "tp" ? "TP" : "HP";
    if (x.set !== undefined) out.push(`<li class="state">${esc(L("resourceSet", { res, n: x.set }))}</li>`);
    else if (x.delta) out.push(`<li class="${x.delta > 0 ? "heal" : "hit"}">${esc(L("resourceDelta", { res, n: `${x.delta > 0 ? "+" : ""}${x.delta}` }))}</li>`);
  }
  if (e.heal?.hp) out.push(`<li class="heal">${esc(L("healHp", { n: e.heal.hp }))}</li>`);
  if (e.heal?.tp) out.push(`<li class="heal">${esc(L("healTp", { n: e.heal.tp }))}</li>`);
  for (const i of e.inflicts ?? []) if (!i.seq) out.push(inflictLi(i));
  for (const b of e.buffs ?? []) if (!b.seq) out.push(buffLi(b));
  for (const st of e.states ?? []) out.push(`<li class="state">${esc(L("stateLine", { name: st.name, mods: stateModText(st.mods) }))}</li>`);
  for (const st of e.stances ?? []) {
    // wait: false(《도발》·《캐슬링》 등 「그 턴 동안」)는 대기 상태가 아님
    const key = st.waiting === false ? (st.left ? "keepLineCount" : "keepLine") : st.left ? "stanceLineCount" : "stanceLine";
    out.push(`<li class="state">${esc(L(key, { name: st.name, n: st.left }))}</li>`);
  }
  if (e.revive) out.push(`<li class="heal">${esc(L("revive"))}</li>`);
  if (e.command) out.push(`<li class="state">${esc(L(`command.${e.command}`))}</li>`);
  for (const x of e.resource ?? []) {
    if (x.noEffect) out.push(`<li class="miss">${esc(L("noEffect"))}</li>`);
    if (x.forceRow) out.push(`<li class="${x.resisted ? "resist" : "inflict"}">${esc(L(x.resisted ? "forceRowResisted" : "forceRow", { row: game.i18n.localize(`NSSQ.Row.${x.forceRow}`) }))}${x.fixed ? `<div class="supp-roll">${rollText({ fixed: x.fixed })}</div>` : ""}</li>`);
    if (x.spread) out.push(`<li class="${x.spread.won ? "inflict" : "resist"}">${esc(L(x.spread.won ? "spreadWon" : "spreadLost", { label: x.spread.ids.map(condLabel).join("") || "-" }))}<div class="supp-roll">${rollText({ contest: x.spread })}</div></li>`);
  }
  for (const c of e.cures ?? []) out.push(`<li class="cure">${esc(L(`cure.${c.kind ?? "all"}`))}${c.count !== undefined ? ` ${esc(L("cureCount", { n: c.count }))}` : ""}</li>`);
  for (const x of e.resource ?? []) if (x.chanceFailed && !x.seq) out.push(chanceLi(x));
  return out.join("");
}

/** { physAtk: 2 } → 「물리 공격 +2」 */
export const stateModText = (mods) => Object.entries(mods ?? {}).filter(([, v]) => v).map(([k, v]) => `${game.i18n.localize(`NSSQ.Inventory.${k}`)} ${v >= 0 ? "+" : ""}${v}`).join(", ");

export const renderSkillCard = (card) => renderCard(card);

function renderCard(card) {
  const head = `<header class="check-header"><span class="check-label"><img src="${esc(card.img)}" width="20" height="20"/> ${esc(card.name)}${card.sl ? ` <small>SL${card.sl}</small>` : ""}${card.group ? ` <b class="seq">${esc(L("hitOf", { n: card.group.index, count: card.group.count }))}</b>` : ""}${["chase", "counter", "delayed", "repeat"].includes(card.followup?.type) ? ` <b class="seq">${esc(L(`followup.${card.followup.type}`))}</b>` : ""}</span><span class="check-kind">${esc(card.userName)}</span></header>`;
  const act = card.activation ? `<p class="activation ${card.activation.ok ? "ok" : "ng"}">${esc(L(card.activation.ok ? "activationOk" : "activationFail", { dice: card.activation.dice.join("+") }))}</p>` : "";
  const fp = card.fpGain ? `<p class="fp-gain">FP +${card.fpGain}</p>` : "";
  // 해설(데이터의 HTML)은 접어 둔다
  const desc = card.description ? `<details class="sk-desc"><summary>${esc(L("description"))}</summary>${card.description}</details>` : "";
  if (card.failed) return `<div class="nssq-skill-card">${head}${desc}${act}${fp}</div>`;
  const rows = card.entries.map((e, i) => `<section class="sk-target" data-index="${i}"><div class="target-name"><i class="fas fa-bullseye"></i> ${esc(e.name)}</div><ul>${entryLines(e, card)}</ul><div class="sk-status"></div></section>`).join("");
  const gm = [
    ...(card.gm ?? []).map((g) => L("gmNeeded", { what: game.i18n.localize(`NSSQ.SkillUse.type.${String(g).split(":")[0]}`) })),
    ...(card.partial ? [L("gmNeeded", { what: card.partial })] : []),
    ...(card.unknownScope ? [L("gmScope")] : [])
  ];
  return `<div class="nssq-skill-card">${head}${desc}${act}${rows}${fp}${gm.map((g) => `<p class="gm-needed"><i class="fas fa-exclamation-triangle"></i> ${esc(g)}</p>`).join("")}
    <div class="sk-apply"><span class="apply-status"></span><span class="apply-buttons"><button type="button" data-sk-apply><i class="fas fa-check"></i> ${esc(L("apply"))}</button><button type="button" data-sk-undo><i class="fas fa-undo"></i> ${esc(L("undo"))}</button></span></div></div>`;
}

/* ---------------- 적용 ---------------- */

/** 한 대상에 결과를 적용 → 되돌리기용 이전 상태 */
async function applyEntry(actor, e, sourceUuid, meta = {}) {
  const s = actor.system;
  const before = { hp: s.hp?.value, tp: s.tp?.value ?? null, conditions: s.conditions ?? [], buffs: s.buffs ?? [], states: actor.getFlag("nssq", "states") ?? [] };
  let hp = s.hp?.value ?? 0;
  let tp = s.tp?.value ?? null;
  // 부활: 【HP】 0 이하에서 회복량만큼(쓰러진 상태의 음수 HP는 0으로 본다)
  if (e.revive && hp <= 0) hp = 0;
  hp = Math.min(s.hp?.max ?? hp, hp - (e.damage ?? 0) + (e.heal?.hp ?? 0));
  if (tp !== null) tp = Math.min(s.tp?.max ?? tp, tp + (e.heal?.tp ?? 0));
  for (const x of e.resource ?? []) {
    if (x.resource === "hp") hp = x.set !== undefined ? x.set : hp + (x.delta ?? 0);
    if (x.resource === "tp" && tp !== null) tp = x.set !== undefined ? x.set : tp + (x.delta ?? 0);
  }
  // 강제 이동(《떠올리기》): 판정에 실패했고 지금 그 열이 아니면. 파티는 빈 칸이 있을 때만(07 #130)
  let rowMove = null;
  for (const x of e.resource ?? []) {
    if (!x.forceRow || x.resisted || (s.row ?? "front") === x.forceRow) continue;
    if (actor.type === "enemy") rowMove = { row: x.forceRow, order: s.order ?? 0 };
    else {
      const { freePartySlot } = await import("./formation.mjs");
      const cb = combatantOf(actor);
      const idx = freePartySlot(cb?.parent?.scene ?? game.scenes.get(cb?.sceneId), actor, x.forceRow);
      if (idx !== null) rowMove = { row: x.forceRow, order: idx };
    }
  }
  if (rowMove) { before.row = s.row ?? "front"; before.order = s.order ?? 0; }
  let conds = [...(s.conditions ?? [])];
  if (e.sleepBroken) conds = removeCondition(conds, "sleep");
  for (const c of e.cures ?? []) {
    if (c.kind === "debuff" || c.kind === "buff") continue;
    const match = (x) => (c.conditions === "all" || c.conditions?.includes(x.id)) && (!c.kind || CONDITIONS[x.id]?.kind === c.kind);
    // 「(SL)개까지」: 걸린 순서대로 count개
    let left = c.count ?? Infinity;
    conds = conds.filter((x) => !(match(x) && left-- > 0));
  }
  const newly = [];
  const source = sourceUuid ? fromUuidSync(sourceUuid) : null;
  for (const i of e.inflicts ?? []) {
    if (i.resisted || i.broken) continue;
    // 즉사
    if (i.id === "death") { hp = Math.min(hp, 0); continue; }
    const r = addCondition(conds, { id: i.id, depth: i.depth, source: sourceUuid ?? "", sourceSuppAtk: source ? combatProfile(source).suppAtk : 0 });
    conds = r.list;
    if (!["ignored", "blocked"].includes(r.result)) newly.push(i.id);
  }
  let buffs = [...(s.buffs ?? [])];
  // 약화(debuff)·강화(buff) 해제: 걸린 순서대로 count개. buffs가 있으면 그 종류만(《조명탄》 『명중 저하』)
  for (const c of (e.cures ?? []).filter((x) => x.kind === "debuff" || x.kind === "buff")) {
    let left = c.count ?? Infinity;
    buffs = buffs.filter((b) => !(BUFFS[b.id]?.kind === c.kind && (!c.buffs || c.buffs.includes(b.id)) && left-- > 0));
  }
  for (const b of e.buffs ?? []) buffs = addBuff(buffs, b).list;
  const upd = { "system.hp.value": hp, "system.conditions": conds, "system.buffs": buffs };
  if (tp !== null) upd["system.tp.value"] = tp;
  if (rowMove) { upd["system.row"] = rowMove.row; upd["system.order"] = rowMove.order; }
  // 전투 고유 상태(같은 계열은 바꿔 끼움, engine/states.mjs)
  if (e.states?.length) {
    let states = [...before.states];
    for (const st of e.states) states = addState(states, st).list;
    upd["flags.nssq.states"] = states;
  }
  await actor.update(upd);
  for (const id of newly) await onInflicted(actor, id);
  // 《명하노니》: 적용 큐가 끝난 뒤 공격(공격 카드의 적용도 이 큐를 쓴다)
  if (e.command) setTimeout(() => runCommand(actor, e.command), 0);
  // 그 밖의 트리거(단계 8-F): 【HP】 감소·상태 이상·강화
  const ev = await import("./events.mjs");
  // 대미지·자원 감소로 줄었을 때만(회복이 최대치에 맞춰 깎인 것은 아님)
  const lost = (e.damage ?? 0) > 0 || (e.resource ?? []).some((x) => x.resource === "hp" && ((x.delta ?? 0) < 0 || x.set !== undefined));
  if (lost && hp < (before.hp ?? 0)) await ev.onHpChange(actor, before.hp ?? 0, hp, sourceUuid, (e.hits ?? []).some((h) => h.hit));
  for (const id of newly) await ev.onConditionGained(actor, id, sourceUuid, !!meta.main);
  if (e.buffs?.length) await ev.onBuffsGained(actor, e.buffs.map((b) => b.id));
  // 대기 상태(단계 8): 전투원 플래그. 대기 상태가 되면 메인 행동을 하지 않는다(waiting)
  if (e.stances?.length) {
    const cb = combatantOf(actor);
    if (cb) {
      before.combatant = { id: cb.id, stances: cb.getFlag("nssq", "stances") ?? null, waiting: cb.getFlag("nssq", "waiting") ?? null };
      const add = e.stances.map((st) => ({ ...st, id: foundry.utils.randomID() }));
      await cb.update({ "flags.nssq.stances": [...(cb.getFlag("nssq", "stances") ?? []), ...add], ...(add.some((st) => st.waiting) ? { "flags.nssq.waiting": true } : {}) });
    }
  }
  return before;
}

// 적용은 한 번에 하나씩(같은 대상에 여러 카드가 동시에 적용되면 앞 결과를 덮어쓴다)
let queue = Promise.resolve();
const enqueue = (fn) => (queue = queue.then(fn, fn));

/**
 * 카드 결과 적용·되돌리기(활성 GM).
 * 다회 공격의 타격 카드는 순서를 지킨다: 적용하면 앞 타격 중 적용하지 않은 것부터, 되돌리면 뒤 타격 중 적용한 것부터
 */
export function applySkillCard(messageId, undo = false) {
  return enqueue(async () => {
    const message = game.messages.get(messageId);
    const card = message?.getFlag("nssq", "skillCard");
    if (!card?.group) return applyOne(message, undo);
    const list = groupMessages(card);
    const k = card.group.index;
    if (!undo) for (const m of list.filter((x) => x.getFlag("nssq", "skillCard").group.index <= k)) await applyOne(m, false);
    else for (const m of list.filter((x) => x.getFlag("nssq", "skillCard").group.index >= k).reverse()) await applyOne(m, true);
  });
}

async function applyOne(message, undo) {
  const card = message?.getFlag("nssq", "skillCard");
  if (!card || card.failed || card.applied === !undo) return;
  const entries = foundry.utils.deepClone(card.entries);
  for (const e of entries) {
    const actor = e.uuid ? await fromUuid(e.uuid) : null;
    if (!actor) continue;
    if (!undo) e.before = await applyEntry(actor, e, card.userUuid, { main: !!card.main && !card.followup });
    else if (e.before) {
      const upd = { "system.hp.value": e.before.hp, "system.conditions": e.before.conditions, "system.buffs": e.before.buffs };
      if (e.before.states) upd["flags.nssq.states"] = e.before.states;
      if (e.before.tp !== null && e.before.tp !== undefined) upd["system.tp.value"] = e.before.tp;
      if (e.before.row) { upd["system.row"] = e.before.row; upd["system.order"] = e.before.order ?? 0; }
      await actor.update(upd);
      const cb = e.before.combatant && game.combat?.combatants.get(e.before.combatant.id);
      if (cb) {
        const f = e.before.combatant;
        await cb.update({
          ...(f.stances ? { "flags.nssq.stances": f.stances } : { "flags.nssq.-=stances": null }),
          ...(f.waiting ? { "flags.nssq.waiting": f.waiting } : { "flags.nssq.-=waiting": null })
        });
      }
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
    if (!card || card.failed || autoApplyMode() !== "auto" || !isActiveGM()) return;
    // 다회 공격은 마지막 타격 카드가 나온 뒤 한꺼번에(앞 카드부터)
    if (card.group && card.group.index !== card.group.count) return;
    if (!groupPendingReaction(card)) applySkillCard(message.id);
  });
  Hooks.on("renderChatMessage", (message, html) => {
    const card = message.getFlag("nssq", "skillCard");
    if (!card) return;
    const el = html[0];
    // 플레이어가 모르는 에너미가 쓴 스킬의 명중 달성값은 ?(07 #47)
    if (!game.user.isGM) {
      const user = fromUuidSync(card.userUuid);
      if (user && !knowsEnemy(user)) el.querySelectorAll("[data-mask]").forEach((x) => { x.textContent = "?"; });
      // 대상 쪽 억제 방어 달성값: 모르는 에너미면 ?
      el.querySelectorAll(".sk-target").forEach((row) => {
        const t = fromUuidSync(card.entries[Number(row.dataset.index)]?.uuid ?? "");
        if (t && !knowsEnemy(t)) row.querySelectorAll("[data-mask-def]").forEach((x) => { x.textContent = "?"; });
      });
    }
    decorateReactions(el, message, "skill");
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
  const spec = turnScope(combatant, skill, targetSpec(skill.system.target, skill.system.effects));
  // 선언 명칭이 있으면 무작위로 하나
  const n = hasVariants(skill.system.effects) ? skill.system.variants?.length ?? 0 : 0;
  const variant = n ? Math.floor(CONFIG.Dice.randomUniform() * n) : null;
  if (spec.side === "self") return executeAction(combat, combatant, "skill", skill.id, [combatant], { variant });
  let list = candidates(combat, combatant, spec, skill.system.range, { allowKO: revives(skill) });
  // 「적 전열 전원」 등 열을 정한 대상(연계 공격)
  if (spec.row) list = list.filter((c) => (c.actor.system.row ?? "front") === spec.row).length ? list.filter((c) => (c.actor.system.row ?? "front") === spec.row) : list;
  if (!list.length) return null;
  // 연계 공격: 참가자는 그 턴 행동 종료(01 §3.11)
  const { linkPartners } = await import("./enemy-ai.mjs");
  const partners = linkPartners(combat, combatant, skill) ?? [];
  for (const p of partners) await p.setFlag("nssq", "acted", true);
  if (partners.length) await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: combatant.actor }), content: `<div class="nssq-combat-note"><i class="fas fa-link"></i> ${esc(L("linkAttack", { name: combatant.name, skill: skill.name, partners: partners.map((p) => p.name).join(", ") }))}</div>` });
  if (spec.scope === "all" || spec.scope === "random") return executeAction(combat, combatant, "skill", skill.id, list, { variant });
  // 《타기팅》: 이번 턴 이 편의 단일 대상 스킬은 지정한 대상에게(사거리 안일 때)
  const focus = combat.getFlag("nssq", "focus");
  const fc = focus && focus.round === combat.round && focus.side === (combatant.actor.type === "enemy" ? "enemy" : "party") ? list.find((c) => c.id === focus.targetId) : null;
  if (fc && spec.scope === "single") return pickTarget(combat, combatant, "skill", skill.id, fc, { ...spec, variant });
  const pick = pickRandom(list, () => CONFIG.Dice.randomUniform());
  return pickTarget(combat, combatant, "skill", skill.id, pick, { ...spec, variant });
}

