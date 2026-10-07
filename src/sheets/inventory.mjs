/**
 * 캐릭터 시트의 장비·소지품 탭: 표시 데이터와 동작(장비·해제·매각·제련·상점)
 */
import { canEquip, equippedSlot, isUsable, slotOccupant, slotsFor, useOnce } from "../engine/equipment.mjs";
import tables from "../generated/tables.mjs";
import { openShop, shopOpen } from "../apps/shop.mjs";
import { refinementBadges } from "./badges.mjs";
import { retrieveItem, storageActive, storeItem } from "../apps/acquire.mjs";
import { skillUsage } from "../engine/skills.mjs";

const GROUPS = [
  ["weapon", "TYPES.Item.weapon"],
  ["armor", "TYPES.Item.armor"],
  ["accessory", "TYPES.Item.accessory"],
  ["consumable", "TYPES.Item.consumable"],
  ["tool", "TYPES.Item.tool"],
  ["material", "TYPES.Item.material"]
];
const SLOT_LABEL = { weapon: "NSSQ.Slot.weapon", armor: "NSSQ.Slot.armor", other: "NSSQ.Slot.other" };
const ELEMENT_LABEL = (e) => (e ? game.i18n.localize(`NSSQ.Resist.${e}`) : "");

/** 한 줄 요약: 무기 「〈참〉 물공 14 / 물명 +1 / 속도 +3」, 방어구 「방어 9 / 회피 −2」 */
function summary(item) {
  const s = item.system.stats;
  const sg = (n) => (n > 0 ? `+${n}` : `${n}`);
  const parts = [];
  if (item.type === "weapon" && s) {
    parts.push(ELEMENT_LABEL(item.system.effectiveElement) || game.i18n.localize("NSSQ.Inventory.elementChoose"));
    parts.push(`${game.i18n.localize("NSSQ.Inventory.physAtk")} ${s.physAtk}`);
    if (s.elemAtk) parts.push(`${game.i18n.localize("NSSQ.Inventory.elemAtk")} ${s.elemAtk}`);
    if (s.physHit) parts.push(`${game.i18n.localize("NSSQ.Inventory.physHit")} ${sg(s.physHit)}`);
    if (s.elemHit) parts.push(`${game.i18n.localize("NSSQ.Inventory.elemHit")} ${sg(s.elemHit)}`);
    if (s.speed) parts.push(`${game.i18n.localize("NSSQ.Inventory.speed")} ${sg(s.speed)}`);
  } else if (item.type === "armor" && s) {
    parts.push(`${game.i18n.localize("NSSQ.Inventory.defense")} ${s.defense}`);
    if (s.evasion) parts.push(`${game.i18n.localize("NSSQ.Inventory.evasion")} ${sg(s.evasion)}`);
    if (s.speed) parts.push(`${game.i18n.localize("NSSQ.Inventory.speed")} ${sg(s.speed)}`);
  } else if (item.type === "accessory") {
    parts.push(item.system.effectText || "");
  }
  return parts.filter(Boolean).join(" · ");
}

function rankLabel(item) {
  // 가격 식이 없는 무기(주먹)는 R이 아니라 Lv 기준
  if (item.type === "weapon" && !tables.weapons[item.system.weaponType]?.price) return "";
  return ["weapon", "armor", "material"].includes(item.type) ? `R${item.system.rank}` : "";
}

/**
 * 스킬 탭: 클래스별 구역(메인 → 서브 → 커먼 → 그 밖). 스킬 트리 보기를 붙일 수 있도록
 * 각 스킬에 key·전제(prereqs)·MaxSL을 함께 넘긴다.
 */
function skillGroups(actor, items, filter = "all") {
  const { main, sub } = actor.system.classItems ?? {};
  const skills = items.filter((i) => i.type === "skill" && (filter === "all" || skillUsage(i.system) === filter));
  const timingCls = { 상시: "passive", 주행동: "action", 개막: "opening", 수동: "reaction", 특수: "special" };
  const row = (s) => ({
    id: s.id, name: s.name, img: s.img, sl: s.system.sl,
    max: s.system.classKey === sub?.system.key && s.system.classKey !== main?.system.key ? s.system.maxSL.sub : s.system.maxSL.main,
    timing: s.system.timing, timingCls: timingCls[s.system.timing] ?? "other",
    cost: s.system.cost?.tp ? `TP ${s.system.cost.tp}` : s.system.cost?.fp ? `FP ${s.system.cost.fp}` : "",
    unique: !!s.system.unique, skillKey: s.system.skillKey, usage: skillUsage(s.system),
    prereq: (s.system.prereqs?.all ?? []).map((p) => (p.any ? p.any.map((q) => `${q.skill} ${q.sl}`).join(" / ") : `${p.skill} ${p.sl}`)).join(" + ")
  });
  const groups = [];
  const take = (pred, title, cls) => {
    const list = skills.filter(pred).sort((a, b) => a.name.localeCompare(b.name, "ko")).map(row);
    if (list.length) groups.push({ title, cls, skills: list });
  };
  const used = new Set();
  const mark = (pred) => (s) => { if (used.has(s.id) || !pred(s)) return false; used.add(s.id); return true; };
  if (main) take(mark((s) => s.system.classKey === main.system.key), `${main.name} · ${game.i18n.localize("NSSQ.Class.main")}`, "main");
  if (sub) take(mark((s) => s.system.classKey === sub.system.key), `${sub.name} · ${game.i18n.localize("NSSQ.Class.sub")}`, "sub");
  take(mark((s) => s.system.classKey === "common"), game.i18n.localize("NSSQ.Skill.common"), "common");
  take(mark(() => true), game.i18n.localize("NSSQ.Skill.other"), "other");
  return groups;
}

/**
 * @param {Actor} actor
 * @param {{skillFilter?: "all"|"combat"|"explore"}} [opts] 스킬 탭 분류(보는 사람마다, 시트 인스턴스에 기억)
 */
export function inventoryContext(actor, { skillFilter = "all" } = {}) {
  const all = actor.items.contents;
  const items = all.filter((i) => !i.system.stored);
  const storage = storageActive(actor);
  const row = (i) => ({
    id: i.id, name: i.name, img: i.img, type: i.type,
    rank: rankLabel(i),
    quantity: i.system.quantity ?? 1,
    stackable: ["consumable", "tool", "material"].includes(i.type),
    usable: isUsable(i),
    uses: (i.system.uses?.max ?? 0) > 0 ? `${i.system.uses.value}/${i.system.uses.max}` : "",
    summary: summary(i),
    equippable: slotsFor(i).length > 0,
    canSub: i.type === "weapon",
    refine: refinementBadges(i),
    canStore: storage && !i.system.equipped,
  });
  const slots = ["weapon", "armor", "other"].map((slot) => {
    const it = slotOccupant(items, slot);
    return { slot, label: SLOT_LABEL[slot], item: it ? { ...row(it), sub: slot === "other" && it.type === "weapon" } : null };
  });
  const groups = GROUPS.map(([type, label]) => ({
    type, label,
    items: items.filter((i) => i.type === type && !equippedSlot(i)).sort((a, b) => (a.sort || 0) - (b.sort || 0)).map(row)
  })).filter((g) => g.items.length);
  const weapon = actor.system.equipment?.weapon;
  const stored = all.filter((i) => i.system.stored).sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name, "ko")).map(row);
  return {
    storage, stored,
    shopAvailable: shopOpen() || game.user.isGM,
    // 창고 기능이 꺼져 있으면 구역 자체를 숨긴다(물건은 그대로 보관, 소지 수에는 안 들어감)
    showStorage: storage,
    storageSetting: !!game.settings.get("nssq", "storage"),
    storageEnabled: !!actor.system.storageEnabled,
    slots, groups,
    carried: actor.system.carried,
    carry: actor.system.carry,
    over: actor.system.carried > actor.system.carry,
    weaponLine: weapon?.item ? summary(weapon.item)
      : weapon?.unarmed ? game.i18n.format("NSSQ.Inventory.unarmed", { type: weapon.weaponType, atk: weapon.physAtk })
        : game.i18n.localize("NSSQ.Inventory.noWeapon"),
    classes: items.filter((i) => i.type === "class"),
    skillGroups: skillGroups(actor, items, skillFilter),
    skillFilter,
    skillCount: items.filter((i) => i.type === "skill").length,
    skillFilters: ["all", "combat", "explore"].map((k) => ({
      key: k, active: k === skillFilter,
      label: game.i18n.localize(`NSSQ.Skill.filter${k[0].toUpperCase()}${k.slice(1)}`),
      count: k === "all" ? items.filter((i) => i.type === "skill").length : items.filter((i) => i.type === "skill" && skillUsage(i.system) === k).length
    }))
  };
}

/** [사용]: 효과 데이터가 있으면 대상을 고르고 효과를 해석해 결과 카드(적용은 자동 적용 설정대로), 없으면 해설만 */
async function useItem(actor, item) {
  const hasEffects = !!item.system.effects?.length;
  let targets = null;
  if (hasEffects) {
    targets = await pickItemTargets(actor, item);
    if (!targets) return;
  }
  const next = useOnce(item);
  const name = item.name;
  const desc = item.system.description ?? "";
  // 지우기 전에 효과를 해석한다(카드가 아이템 그림·해설을 쓴다)
  if (hasEffects) {
    const { useItemOutside } = await import("../combat/skill-use.mjs");
    await useItemOutside(actor, item, targets);
  }
  if (next.remove) await item.delete();
  else {
    const u = { "system.quantity": next.quantity };
    if (next.usesValue !== null) u["system.uses.value"] = next.usesValue;
    await item.update(u);
  }
  const left = next.remove ? game.i18n.localize("NSSQ.Inventory.usedUp")
    : next.usesValue !== null ? game.i18n.format("NSSQ.Inventory.usesLeft", { value: next.usesValue, max: item.system.uses.max, qty: next.quantity })
      : game.i18n.format("NSSQ.Inventory.qtyLeft", { qty: next.quantity });
  if (hasEffects) return ui.notifications.info(`${game.i18n.format("NSSQ.Inventory.usedItem", { name })} (${left})`);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="nssq-use"><b><i class="fas fa-hand-sparkles"></i> ${game.i18n.format("NSSQ.Inventory.usedItem", { name })}</b> <span class="left">(${left})</span>${desc}<p class="notes">${game.i18n.localize("NSSQ.Inventory.useManual")}</p></div>`
  });
}

/** 전투 밖 소모품의 대상: 자신 / 아군 전체(파티) / 아군 단일(파티에서 고르기, 기본은 자신) */
async function pickItemTargets(actor, item) {
  const { targetSpec } = await import("../combat/skill-use.mjs");
  const { partyActors } = await import("../apps/gm-screen.mjs");
  const spec = targetSpec(item.system.target || "아군 단일");
  if (spec.side === "self") return [actor];
  const party = partyActors().filter((a) => a.type === "character");
  if (!party.includes(actor)) party.unshift(actor);
  if (spec.scope === "all" || spec.scope === "row") return party;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const options = party.map((a) => `<option value="${a.id}" ${a === actor ? "selected" : ""}>${esc(a.name)} (HP ${a.system.hp?.value ?? 0}/${a.system.hp?.max ?? 0})</option>`).join("");
  return Dialog.prompt({
    title: game.i18n.format("NSSQ.Inventory.useTargetTitle", { name: item.name }),
    content: `<form><div class="form-group"><label>${game.i18n.localize("NSSQ.Inventory.useTarget")}</label><select name="target">${options}</select></div></form>`,
    label: game.i18n.localize("NSSQ.Inventory.use"),
    callback: (html) => [game.actors.get(html[0].querySelector("[name=target]").value)].filter(Boolean),
    rejectClose: false
  });
}

/** 장비: 장비 가능 판정 → 같은 슬롯 비우기 → 장비. GM은 Shift로 판정 무시 */
async function equip(actor, item, slot, force = false) {
  const { main, sub } = actor.system.classItems;
  const check = canEquip(item, { main: main?.system ?? null, sub: sub?.system ?? null });
  if (!check.ok && !(force && game.user.isGM)) {
    return ui.notifications.warn(game.i18n.format(`NSSQ.Inventory.reason.${check.reason}`, { name: item.name }));
  }
  const target = slot ?? slotsFor(item)[0];
  const updates = [];
  const occupant = slotOccupant(actor.items.contents, target);
  if (occupant && occupant.id !== item.id) updates.push({ _id: occupant.id, "system.equipped": false });
  const u = { _id: item.id, "system.equipped": true };
  if (item.type === "weapon") u["system.slot"] = target;
  updates.push(u);
  await actor.updateEmbeddedDocuments("Item", updates);
}

export function activateInventoryListeners(sheet, html) {
  const actor = sheet.actor;
  const itemOf = (ev) => actor.items.get(ev.currentTarget.closest("[data-item-id]")?.dataset.itemId);
  html.on("click", "[data-action=equip]", (ev) => {
    ev.preventDefault();
    const item = itemOf(ev);
    if (item) equip(actor, item, ev.currentTarget.dataset.slot || null, ev.shiftKey);
  });
  html.on("click", "[data-action=unequip]", (ev) => {
    ev.preventDefault();
    itemOf(ev)?.update({ "system.equipped": false });
  });
  html.on("click", "[data-action=use]", (ev) => {
    ev.preventDefault();
    const item = itemOf(ev);
    if (item) useItem(actor, item);
  });
  html.on("click", "[data-action=store]", (ev) => {
    ev.preventDefault();
    const item = itemOf(ev);
    if (item) storeItem(actor, item);
  });
  html.on("click", "[data-action=retrieve]", (ev) => {
    ev.preventDefault();
    const item = itemOf(ev);
    if (item) retrieveItem(actor, item);
  });
  html.on("click", "[data-action=shop]", (ev) => {
    ev.preventDefault();
    openShop(actor);
  });
  html.on("change", "[data-action=quantity]", (ev) => {
    const item = itemOf(ev);
    const q = Math.max(0, Number(ev.currentTarget.value) || 0);
    if (item) item.update({ "system.quantity": q });
  });
}
