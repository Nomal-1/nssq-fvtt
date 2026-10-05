/**
 * 상점(구입)·매각·제련 (01 §7, 쇼핑과 생활).
 * - 구입: G + 소재(무기·방어구는 대응 소재 R 이상 1개, 아이템은 필요 소재). 캐릭터 작성 중에는 G만
 * - 매각: 구입가의 50%, 소재는 (R의 제곱)×50G
 * - 제련: 2개까지·중복 금지, 대응 소재 R 이상 1개 + 효과별 가격
 * 거래는 채팅에 기록한다.
 */
import {
  MAX_RANK, buyPrice, canRefine, equipmentMaterialCandidates, exceedsOwnLimit, itemMaterialCandidates, refinePrice, sellPrice
} from "../engine/equipment.mjs";
import tables from "../generated/tables.mjs";
import { acquireItems } from "./acquire.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Shop.${k}`, d) : game.i18n.localize(`NSSQ.Shop.${k}`));
const PACKS = ["nssq.equipment", "nssq.items"];
const TABS = [
  ["weapon", "TYPES.Item.weapon"],
  ["armor", "TYPES.Item.armor"],
  ["accessory", "TYPES.Item.accessory"],
  ["consumable", "TYPES.Item.consumable"],
  ["tool", "TYPES.Item.tool"]
];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const materialLabel = (m) => `${m.name} R${m.system.rank}${(m.system.quantity ?? 1) > 1 ? ` ×${m.system.quantity}` : ""}`;

async function log(actor, text) {
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="nssq-trade"><i class="fas fa-coins"></i> ${text}</div>`
  });
}

/** 소재 1개 소모 */
async function consumeMaterial(material) {
  const q = material.system.quantity ?? 1;
  if (q > 1) await material.update({ "system.quantity": q - 1 });
  else await material.delete();
}

/** 후보가 여럿이면 고르게 한다. 없으면 null */
async function pickMaterial(candidates, title) {
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];
  // R이 낮은 것부터(아까운 소재를 덜 쓰도록)
  const sorted = [...candidates].sort((a, b) => a.system.rank - b.system.rank);
  const id = await Dialog.prompt({
    title,
    content: `<form><div class="form-group"><label>${L("material")}</label><select name="m">${sorted.map((m) => `<option value="${m.id}">${esc(materialLabel(m))}</option>`).join("")}</select></div></form>`,
    label: L("use"),
    rejectClose: false,
    callback: (html) => html[0].querySelector("[name=m]").value
  });
  return id ? sorted.find((m) => m.id === id) : undefined;
}

/* ---------------- 상점 ---------------- */

class ShopApp extends Application {
  constructor(actor, options) {
    super(options);
    this.actor = actor;
    this.creation = false;
    this.ranks = {};
    this.docs = null;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["nssq", "nssq-shop"],
      template: "systems/nssq/templates/apps/shop.hbs",
      width: 560,
      height: 620,
      resizable: true,
      tabs: [{ navSelector: ".shop-tabs", contentSelector: ".shop-body", initial: "weapon" }]
    });
  }

  get title() {
    return `${L("title")} — ${this.actor.name}`;
  }

  async loadDocs() {
    if (this.docs) return this.docs;
    const docs = [];
    for (const id of PACKS) {
      const pack = game.packs.get(id);
      if (pack) docs.push(...(await pack.getDocuments()));
    }
    this.docs = docs;
    return docs;
  }

  async getData() {
    const docs = await this.loadDocs();
    const level = this.actor.system.level;
    const rankDefault = Math.min(MAX_RANK, Math.max(1, level));
    const rowFor = (d) => {
      const ranked = (d.type === "weapon" || d.type === "armor") && (d.type === "armor" || tables.weapons[d.system.weaponType]?.price);
      const rank = ranked ? (this.ranks[d.id] ?? rankDefault) : null;
      const probe = { type: d.type, system: { ...d.system, rank } };
      const table = d.type === "weapon" ? tables.weapons[d.system.weaponType] : d.type === "armor" ? tables.armors[d.system.armorType] : null;
      const mats = table ? (table.materials ?? []).join("/") : (d.system.materials ?? []).map((m) => `${m.type} R${m.rank}`).join(", ");
      return {
        id: d.id, name: d.name, img: d.img, ranked, rank,
        price: buyPrice(probe, tables, { level }),
        materials: mats && (table ? `${mats} R${rank}+` : mats),
        info: d.system.effectText ?? ""
      };
    };
    return {
      money: this.actor.system.money,
      creation: this.creation,
      tabs: TABS.map(([type, label]) => ({
        type, label,
        rows: docs.filter((d) => d.type === type && (type !== "weapon" || tables.weapons[d.system.weaponType]?.price)).map(rowFor)
      })),
      noPacks: !docs.length
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.on("change", "[name=creation]", (ev) => { this.creation = ev.currentTarget.checked; this.render(); });
    html.on("change", "[data-rank]", (ev) => {
      const id = ev.currentTarget.dataset.rank;
      this.ranks[id] = Math.clamp(Number(ev.currentTarget.value) || 1, 1, MAX_RANK);
      this.render();
    });
    html.on("click", "[data-buy]", (ev) => this.buy(ev.currentTarget.dataset.buy));
  }

  async buy(id) {
    const doc = this.docs.find((d) => d.id === id);
    if (!doc) return;
    const actor = this.actor;
    const data = doc.toObject();
    delete data._id;
    const level = actor.system.level;
    if (data.type === "weapon" || data.type === "armor") data.system.rank = this.ranks[id] ?? Math.min(MAX_RANK, Math.max(1, level));
    const price = buyPrice(data, tables, { level });
    if (actor.system.money < price) return ui.notifications.warn(L("noMoney", { price }));
    if (exceedsOwnLimit(actor.items.contents, data)) return ui.notifications.warn(L("ownLimit", { name: data.name }));

    // 농기구 등: 입수할 때 기본 속성 선택
    const table = data.type === "weapon" ? tables.weapons[data.system.weaponType] : data.type === "armor" ? tables.armors[data.system.armorType] : null;
    if (table?.elementChoice) {
      const element = await Dialog.prompt({
        title: L("chooseElement"),
        content: `<form><div class="form-group"><select name="e">${["slash", "strike", "pierce"].map((e) => `<option value="${e}">${game.i18n.localize(`NSSQ.Resist.${e}`)}</option>`).join("")}</select></div></form>`,
        rejectClose: false,
        callback: (html) => html[0].querySelector("[name=e]").value
      });
      if (!element) return;
      data.system.element = element;
    }

    // 소재
    const used = [];
    if (!this.creation) {
      const items = actor.items.contents;
      const reqs = table ? [{ table, rank: data.system.rank }] : (data.system.materials ?? []).map((r) => ({ req: r }));
      for (const r of reqs) {
        const cands = r.table ? equipmentMaterialCandidates(items, r.table, r.rank) : itemMaterialCandidates(items, r.req);
        const need = r.table ? `${r.table.materials.join("/")} R${r.rank}+` : `${r.req.type} R${r.req.rank}+`;
        if (!cands.length) return ui.notifications.warn(L("noMaterial", { need }));
        const m = await pickMaterial(cands.filter((c) => !used.includes(c) || (c.system.quantity ?? 1) > 1), L("pickMaterial", { need }));
        if (!m) return;
        used.push(m);
      }
    }

    // 받기(같은 묶음은 합침). 소지 수를 넘으면 정리 창 — 상점에서는 창고로 보낼 수도 있다
    data.system.quantity = 1;
    const reserved = used.reduce((m, x) => ({ ...m, [x.id]: (m[x.id] ?? 0) + 1 }), {});
    const got = await acquireItems(actor, [data], { allowStore: true, delegate: false, reserved });
    if (!got) return;
    for (const m of used) {
      const fresh = actor.items.get(m.id);
      if (fresh) await consumeMaterial(fresh);
    }
    await actor.update({ "system.money": actor.system.money - price });

    const rank = data.system.rank && (data.type === "weapon" || data.type === "armor") ? ` R${data.system.rank}` : "";
    const matText = used.length ? ` · ${L("usedMaterial")}: ${used.map((m) => `${m.name} R${m.system.rank}`).join(", ")}` : this.creation ? ` · ${L("creationMode")}` : "";
    await log(actor, L("bought", { name: `${esc(data.name)}${rank}`, price }) + matText);
    this.render();
  }
}

export function openShop(actor) {
  if (!actor?.isOwner) return;
  new ShopApp(actor).render(true);
}

/* ---------------- 매각 ---------------- */

export async function sellItem(actor, item) {
  const price = sellPrice(item, tables, { level: actor.system.level });
  const qty = item.system.quantity ?? 1;
  const ok = await Dialog.confirm({
    title: L("sellTitle"),
    content: `<p>${L("sellConfirm", { name: esc(item.name), price })}</p>${item.system.equipped ? `<p class="notes">${L("sellEquipped")}</p>` : ""}`,
    rejectClose: false
  });
  if (!ok) return;
  if (qty > 1 && ["consumable", "tool", "material"].includes(item.type)) await item.update({ "system.quantity": qty - 1 });
  else await item.delete();
  await actor.update({ "system.money": actor.system.money + price });
  const rank = ["weapon", "armor", "material"].includes(item.type) ? ` R${item.system.rank}` : "";
  await log(actor, L("sold", { name: `${esc(item.name)}${rank}`, price }));
}

/* ---------------- 제련 ---------------- */

export async function openRefineDialog(actor, item) {
  const rank = item.system.rank;
  const table = item.type === "weapon" ? tables.weapons[item.system.weaponType] : tables.armors[item.system.armorType];
  const options = tables.refinements.map((r) => ({ r, check: canRefine(item, r), price: refinePrice(r, rank) }))
    .filter((o) => o.check.ok || o.check.reason === "refineDuplicate");
  if ((item.system.refinements ?? []).length >= 2) return ui.notifications.warn(L("refineFull", { name: item.name }));
  if (!options.some((o) => o.check.ok)) return ui.notifications.warn(L("refineNone"));
  const content = `
    <form class="nssq-refine">
      <p>${L("refineIntro", { name: esc(item.name), rank, count: (item.system.refinements ?? []).length })}</p>
      <div class="form-group"><label>${L("refineEffect")}</label><select name="r">
        ${options.map((o) => `<option value="${o.r.key}" ${o.check.ok ? "" : "disabled"}>${esc(o.r.name)} — ${o.price}G${o.check.ok ? "" : ` (${L("refineHas")})`}</option>`).join("")}
      </select></div>
      <div class="form-group"><label><input type="checkbox" name="creation"/> ${L("creationMode")}</label></div>
      <p class="notes">${L("refineMaterialNote", { mats: (table?.materials ?? []).join("/"), rank })}</p>
    </form>`;
  const pick = await Dialog.prompt({
    title: L("refineTitle"),
    content,
    label: L("refine"),
    rejectClose: false,
    callback: (html) => ({ key: html[0].querySelector("[name=r]").value, creation: html[0].querySelector("[name=creation]").checked })
  });
  if (!pick) return;
  const opt = options.find((o) => o.r.key === pick.key);
  if (!opt?.check.ok) return;
  if (actor.system.money < opt.price) return ui.notifications.warn(L("noMoney", { price: opt.price }));
  let material = null;
  if (!pick.creation) {
    const cands = equipmentMaterialCandidates(actor.items.contents, table, rank);
    const need = `${(table?.materials ?? []).join("/")} R${rank}+`;
    if (!cands.length) return ui.notifications.warn(L("noMaterial", { need }));
    material = await pickMaterial(cands, L("pickMaterial", { need }));
    if (!material) return;
  }
  await item.update({ "system.refinements": [...(item.system.refinements ?? []), opt.r.key] });
  if (material) await consumeMaterial(material);
  await actor.update({ "system.money": actor.system.money - opt.price });
  const matText = material ? ` · ${L("usedMaterial")}: ${material.name} R${material.system.rank}` : ` · ${L("creationMode")}`;
  await log(actor, L("refined", { name: `${esc(item.name)} R${rank}`, effect: esc(opt.r.name), price: opt.price }) + matText);
}
