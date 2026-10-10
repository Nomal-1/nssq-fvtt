/**
 * 캠프·트랩 도구(단계 9-C, GM 스크린). 계산은 engine/explore.mjs
 * 결과는 채팅 카드(nssq.explore): 사람마다 【HP】·【TP】 변화. 자동 적용 「즉시」면 바로, 아니면 GM [적용]/[되돌리기]
 */
import { campAmbush, campRecovery, trapDamage } from "../engine/explore.mjs";
import { CONDITIONS, isPetrified } from "../engine/conditions.mjs";
import { autoApplyMode, isActiveGM } from "../combat/apply.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Explore.${k}`, d) : game.i18n.localize(`NSSQ.Explore.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const carried = (a) => a.items.filter((i) => !i.system.stored);
const flagOf = (a, f) => !!a.system.passives?.flags?.[f];
const hasTool = (a, key) => carried(a).some((i) => i.type === "tool" && i.system.key === key);
/** 《회복 요리》 등에 필요한 『조리기구 세트』(아이템 key) */
const COOK_TOOL = "調理器具セット";

async function party() {
  return (await import("./gm-screen.mjs")).partyActors();
}

/* ---------------- 캠프 ---------------- */

/** 이번 캠프에서 《약효 요리》를 할 수 있나(그 스킬을 가진 사람과 『조리기구 세트』) */
export async function canCookCure(members = null) {
  const list = (members ?? (await party())).filter((a) => !isPetrified(a));
  return list.some((a) => hasTool(a, COOK_TOOL)) && list.some((a) => flagOf(a, "campCookCure"));
}

export async function openCampDialog(defaults = {}) {
  if (!game.user.isGM) return;
  const members = await party();
  const foods = members.flatMap((a) => carried(a).filter((i) => i.system.foodstuff && (i.system.quantity ?? 1) > 0).map((i) => ({ id: `${a.id}.${i.id}`, label: `${a.name}: ${i.name} ×${i.system.quantity ?? 1}` })));
  // [석화] 중인 캐릭터의 도구는 쓰지 않는다(07 #164)
  const tent = Math.min(0, ...members.filter((a) => !isPetrified(a)).map((a) => Number(a.system.equipment?.mods?.["checks.campDanger"]) || 0));
  const content = `<form class="nssq-camp">
    <div class="form-group"><label>${esc(L("hours"))}</label><input type="number" name="hours" min="6" value="${Math.max(6, Number(defaults.hours) || 6)}" ${defaults.timePassed ? "readonly" : ""}/></div>
    <div class="form-group"><label>${esc(L("danger"))}</label><input type="number" name="danger" min="0" max="6" value="0"/></div>
    ${tent ? `<p class="notes">${esc(L("tentNote", { n: -tent }))}</p>` : ""}
    <div class="form-group"><label>${esc(L("food"))}</label><select name="food">${foods.map((f) => `<option value="${esc(f.id)}">${esc(f.label)}</option>`).join("")}<option value="">${esc(L("noFood"))}</option></select></div>
    <p class="notes">${esc(L("campHint"))}</p></form>`;
  const got = await Dialog.prompt({
    title: L("campTitle"), content, label: L("campGo"), rejectClose: false,
    callback: (html) => { const f = html[0].querySelector("form"); return { hours: Math.max(6, Number(f.hours.value) || 6), danger: Math.max(0, Number(f.danger.value) || 0), food: f.food.value }; }
  }, { classes: ["nssq", "dialog"] });
  if (!got) return;
  if (!got.food) return ui.notifications.warn(L("needFood"));
  return camp({ ...got, members, tent, timePassed: !!defaults.timePassed });
}

/**
 * @param {{ hours, danger, food: "actorId.itemId", members: Actor[], tent: number, timePassed?: boolean }} p
 *   timePassed: 시각·오버히트는 이미 지남(필드 지도의 캠프 세그먼트). 상태 이상은 여기서 처리한다
 */
export async function camp({ hours, danger, food, members, tent = 0, timePassed = false }) {
  // 식료품 1개(캠프 1번에 1개, 07 #141)
  const [aid, iid] = String(food).split(".");
  const fa = game.actors.get(aid);
  const fi = fa?.items.get(iid);
  if (!fi) return ui.notifications.warn(L("needFood"));
  const q = fi.system.quantity ?? 1;
  if (q > 1) await fi.update({ "system.quantity": q - 1 }); else await fi.delete();
  const rolls = [];
  let amb = { rolled: false, ambush: false };
  const eff = Math.max(0, danger + tent);
  if (danger > 0) {
    const r = await new Roll("2d6").evaluate();
    rolls.push(r);
    amb = campAmbush(r.dice[0].results.map((x) => x.result), eff);
  }
  // 요리는 그 스킬을 가진 사람과 조리기구 세트가 파티에 있으면 모두에게, 《캠프 마스터》는 파티에서 가장 큰 것(07 #142)
  // [석화] 중인 캐릭터의 탐색 스킬·도구는 쓰지 않는다(07 #164)
  const able = members.filter((a) => !isPetrified(a));
  const cookTool = able.some((a) => hasTool(a, COOK_TOOL));
  const cookHp = cookTool && able.some((a) => flagOf(a, "campCookHp"));
  const cookTp = cookTool && able.some((a) => flagOf(a, "campCookTp"));
  const cookCure = cookTool && able.some((a) => flagOf(a, "campCookCure"));
  // 야영하면 누적 전투 턴을 비운다(07 #165)
  await (await import("./time-pass.mjs")).resetBattleTurns();
  // 캠프 시간만큼 탐색 시간이 지난다(07 #164). 《약효 요리》로 고치면(습격당하지 않았을 때) 상태 이상은 진행하지 않는다.
  // 필드 지도의 캠프는 시각·오버히트가 이미 지났다(timePassed)
  await (await import("./time-pass.mjs")).timePasses(hours, { noAilments: cookCure && !amb.ambush, noOverheat: timePassed });
  const campHeal = Math.max(0, ...able.map((a) => Number(a.system.equipment?.mods?.campHeal) || 0));
  const rows = amb.ambush ? [] : members.map((a) => {
    const rec = campRecovery({ hours, level: a.system.level, campHeal, cookHp, cookTp });
    return { uuid: a.uuid, name: a.name, hp: rec.hp, tp: rec.tp, cure: cookCure, overheat: !!a.getFlag("nssq", "overheat"), before: null };
  });
  const card = { kind: "camp", hours, danger, eff, ambush: amb.ambush, roll: amb.total ?? null, food: `${fa.name}: ${fi.name}`, cook: { hp: cookHp, tp: cookTp, cure: cookCure }, campHeal, rows, applied: false };
  return post(card, rolls);
}

/* ---------------- 트랩 ---------------- */

export async function openTrapDialog() {
  if (!game.user.isGM) return;
  const members = await party();
  const boxes = members.map((a) => `<label class="choice"><input type="checkbox" name="m" value="${a.uuid}" checked/> ${esc(a.name)}</label>`).join("");
  const content = `<form class="nssq-trap">
    <div class="form-group"><label>${esc(L("level"))}</label><input type="number" name="level" min="1" value="1"/></div>
    <div class="form-group"><label>${esc(L("trapKind"))}</label><select name="kind"><option value="random">${esc(L("kind.random"))}</option><option value="hp">${esc(L("kind.hp"))}</option><option value="tp">${esc(L("kind.tp"))}</option></select></div>
    <div class="form-group"><label>${esc(L("targets"))}</label><div>${boxes}</div></div>
    <p class="notes">${esc(L("trapHint"))}</p></form>`;
  const got = await Dialog.prompt({
    title: L("trapTitle"), content, label: L("trapGo"), rejectClose: false,
    callback: (html) => { const f = html[0].querySelector("form"); return { level: Number(f.level.value) || 1, kind: f.kind.value, uuids: [...f.querySelectorAll("[name=m]:checked")].map((x) => x.value) }; }
  }, { classes: ["nssq", "dialog"] });
  if (!got) return;
  return trap(got);
}

export async function trap({ level, kind, uuids }) {
  const rolls = [];
  let k = kind;
  let die = null;
  if (kind === "random") {
    const r = await new Roll("1d6").evaluate();
    rolls.push(r);
    die = r.total;
    k = die <= 3 ? "hp" : "tp";
  }
  const dmg = trapDamage(level, k);
  const rows = [];
  for (const u of uuids) {
    const a = await fromUuid(u);
    if (a) rows.push({ uuid: a.uuid, name: a.name, hp: -dmg.hp, tp: -dmg.tp, before: null });
  }
  return post({ kind: "trap", level, trapKind: k, die, rows, applied: false }, rolls);
}

/* ---------------- 카드·적용 ---------------- */

function render(card) {
  const sign = (n) => (n > 0 ? `+${n}` : `${n}`);
  const rows = card.rows.map((r) => `<li><b>${esc(r.name)}</b> ${r.hp ? `【HP】 ${sign(r.hp)}` : ""} ${r.tp ? `【TP】 ${sign(r.tp)}` : ""}${r.cure ? ` ${esc(L("cured"))}` : ""}${r.overheat ? ` ${esc(L("overheatClear"))}` : ""}</li>`).join("");
  let head;
  let info = "";
  if (card.kind === "camp") {
    head = `<i class="fas fa-campground"></i> ${esc(L("campHead", { h: card.hours }))}`;
    info = `<p>${esc(L("foodUsed", { food: card.food }))}</p>`
      + (card.roll !== null ? `<p>${esc(L("ambushRoll", { n: card.roll, d: card.eff }))}</p>` : "")
      + (card.ambush ? `<p class="ambush"><b>${esc(L("campAmbush"))}</b></p>` : "")
      + ([card.cook.hp && L("cookHp"), card.cook.tp && L("cookTp"), card.cook.cure && L("cookCure"), card.campHeal && L("campHeal", { n: card.campHeal })].filter(Boolean).map((x) => `<p class="notes">${esc(x)}</p>`).join(""));
  } else {
    head = `<i class="fas fa-exclamation-triangle"></i> ${esc(L("trapHead", { lv: card.level }))}`;
    if (card.die) info = `<p>${esc(L("trapDie", { n: card.die }))}</p>`;
  }
  const btn = card.rows.length ? `<div class="apply-buttons"><span class="apply-status">${esc(L(card.applied ? "applied" : "notApplied"))}</span>
    ${card.applied ? `<button type="button" data-explore="undo">${esc(game.i18n.localize("NSSQ.SkillUse.undo"))}</button>` : `<button type="button" data-explore="apply">${esc(game.i18n.localize("NSSQ.SkillUse.apply"))}</button>`}</div>` : "";
  return `<div class="nssq-explore"><header class="check-header"><span class="check-label">${head}</span></header>${info}<ul>${rows}</ul>${btn}</div>`;
}

async function post(card, rolls) {
  const m = await ChatMessage.create({ speaker: { alias: L(card.kind === "camp" ? "campTitle" : "trapTitle") }, content: render(card), rolls, sound: rolls.length ? CONFIG.sounds.dice : undefined, flags: { nssq: { explore: card } } });
  if (autoApplyMode() === "auto" && card.rows.length) await applyCard(m.id, false);
  return m;
}

let queue = Promise.resolve();
async function applyCard(messageId, undo) {
  queue = queue.then(async () => {
    const m = game.messages.get(messageId);
    const card = foundry.utils.deepClone(m?.getFlag("nssq", "explore"));
    if (!card || card.applied === !undo) return;
    for (const r of card.rows) {
      const a = await fromUuid(r.uuid);
      if (!a) continue;
      const s = a.system;
      if (undo) {
        if (!r.before) continue;
        await a.update({ "system.hp.value": r.before.hp, "system.tp.value": r.before.tp, "system.conditions": r.before.conditions });
        if (r.before.overheat) await a.setFlag("nssq", "overheat", r.before.overheat);
        r.before = null;
        continue;
      }
      r.before = { hp: s.hp.value, tp: s.tp.value, conditions: s.conditions ?? [], overheat: a.getFlag("nssq", "overheat") ?? null };
      // 캠프는 [전투 불능](HP 0 이하)에서도 회복(음수는 0부터)
      const hp0 = card.kind === "camp" ? Math.max(0, s.hp.value) : s.hp.value;
      const upd = { "system.hp.value": Math.min(s.hp.max, hp0 + r.hp), "system.tp.value": Math.max(0, Math.min(s.tp.max, s.tp.value + r.tp)) };
      if (r.cure) upd["system.conditions"] = (s.conditions ?? []).filter((c) => CONDITIONS[c.id]?.kind !== "ailment");
      await a.update(upd);
      if (r.overheat) await a.unsetFlag("nssq", "overheat");
    }
    card.applied = !undo;
    await m.update({ content: render(card), "flags.nssq.explore": card });
  });
  return queue;
}

export function registerExplore() {
  Hooks.on("renderChatMessage", (message, html) => {
    if (!message.getFlag("nssq", "explore")) return;
    html[0].querySelectorAll("[data-explore]").forEach((b) => {
      if (!game.user.isGM || !isActiveGM()) return b.remove();
      b.addEventListener("click", () => applyCard(message.id, b.dataset.explore === "undo"));
    });
  });
}
