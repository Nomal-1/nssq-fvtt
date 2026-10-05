/**
 * 상점(구입)·매각·제련 (01 §7, 쇼핑과 생활).
 * - 구입: G + 소재(무기·방어구는 대응 소재 R 이상 1개, 아이템은 필요 소재). 캐릭터 작성 중에는 G만
 * - 매각: 구입가의 50%, 소재는 (R의 제곱)×50G
 * - 제련: 2개까지·중복 금지, 대응 소재 R 이상 1개 + 효과별 가격
 * 거래는 채팅에 기록한다.
 */
import {
  MAX_RANK, allocateMaterials, buyPrice, canRefine, equipmentMaterialCandidates, exceedsOwnLimit, itemMaterialCandidates,
  refinePrice, sellPrice, stackKey
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

/** 소재 n개 소모 */
async function consumeMaterial(material, n = 1) {
  const q = material.system.quantity ?? 1;
  if (q > n) await material.update({ "system.quantity": q - n });
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

const SHOP_FOLDER_NAME = () => L("folderName");

/** 상점이 열려 있는가(GM이 여닫는다). GM은 언제나 열 수 있다 */
export function shopOpen() {
  return !!game.settings.get("nssq", "shopOpen");
}

/** 「상점 추가 품목」 폴더(하위 폴더 포함)의 월드 아이템 */
function customItems() {
  const folder = game.folders.get(game.settings.get("nssq", "shopFolder"));
  if (!folder) return [];
  const ids = new Set([folder.id, ...folder.getSubfolders(true).map((f) => f.id)]);
  return game.items.filter((i) => i.folder && ids.has(i.folder.id));
}

/** GM: 「상점 추가 품목」 폴더를 찾거나 만든다 */
export async function ensureShopFolder() {
  if (!game.user.isGM) return null;
  let folder = game.folders.get(game.settings.get("nssq", "shopFolder"));
  if (!folder) {
    folder = await Folder.create({ name: SHOP_FOLDER_NAME(), type: "Item", sorting: "a" });
    await game.settings.set("nssq", "shopFolder", folder.id);
    ui.notifications.info(L("folderCreated", { name: folder.name }));
  } else ui.notifications.info(L("folderExists", { name: folder.name }));
  ui.sidebar.activateTab("items");
  return folder;
}

/** GM: 상점 열기·닫기 */
export async function toggleShop(open = !shopOpen()) {
  if (!game.user.isGM) return;
  await game.settings.set("nssq", "shopOpen", open);
}

const isRanked = (d) => d.type === "armor" || (d.type === "weapon" && !!tables.weapons[d.system.weaponType]?.price);
const tableOf = (d) => (d.type === "weapon" ? tables.weapons[d.system.weaponType] : d.type === "armor" ? tables.armors[d.system.armorType] : null);

class ShopApp extends Application {
  constructor(actor, options) {
    super(options);
    this.actor = actor;
    this.creation = false;
    this.ranks = {};
    this.qty = {};
    this.docs = null;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["nssq", "nssq-shop"],
      template: "systems/nssq/templates/apps/shop.hbs",
      width: 620,
      height: 640,
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
      // 시스템 품목: 소재는 팔지 않고, 가격 식이 없는 무기(주먹)도 팔지 않는다
      if (pack) docs.push(...(await pack.getDocuments()).filter((d) => d.type !== "material" && (d.type !== "weapon" || isRanked(d))));
    }
    // 추가 품목: 소재는 가격이 없으므로 팔지 않는다
    for (const d of customItems()) if (d.type !== "material" && TABS.some(([t]) => t === d.type)) docs.push(Object.assign(d, { nssqCustom: true }));
    this.docs = docs;
    return docs;
  }

  async getData() {
    const docs = await this.loadDocs();
    const level = this.actor.system.level;
    const rankDefault = Math.min(MAX_RANK, Math.max(1, level));
    const rowFor = (d) => {
      const ranked = isRanked(d);
      const rank = ranked ? (this.ranks[d.id] ?? (d.nssqCustom ? d.system.rank : rankDefault)) : null;
      const probe = { type: d.type, system: { ...d.system, rank } };
      const table = tableOf(d);
      const mats = table ? (table.materials ?? []).join("/") : (d.system.materials ?? []).map((m) => `${m.type} R${m.rank}`).join(", ");
      const qty = this.qty[d.id] ?? 1;
      const unit = buyPrice(probe, tables, { level });
      return {
        id: d.id, name: d.name, img: d.img, ranked, rank, qty, unit,
        price: unit * qty,
        custom: !!d.nssqCustom,
        materials: mats && (table ? `${mats} R${rank}+` : mats),
        info: d.system.effectText ?? ""
      };
    };
    return {
      money: this.actor.system.money,
      creation: this.creation,
      isGM: game.user.isGM,
      open: shopOpen(),
      tabs: TABS.map(([type, label]) => ({ type, label, rows: docs.filter((d) => d.type === type).map(rowFor) })),
      noPacks: !docs.length
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.on("change", "[name=creation]", (ev) => { this.creation = ev.currentTarget.checked; this.render(); });
    html.on("change", "[data-rank]", (ev) => {
      this.ranks[ev.currentTarget.dataset.rank] = Math.clamp(Number(ev.currentTarget.value) || 1, 1, MAX_RANK);
      this.render();
    });
    html.on("change", "[data-qty]", (ev) => {
      this.qty[ev.currentTarget.dataset.qty] = Math.clamp(Number(ev.currentTarget.value) || 1, 1, 99);
      this.render();
    });
    html.on("click", "[data-buy]", (ev) => this.buy(ev.currentTarget.dataset.buy));
  }

  async buy(id) {
    if (!shopOpen() && !game.user.isGM) return ui.notifications.warn(L("closed"));
    const doc = this.docs.find((d) => d.id === id);
    if (!doc) return;
    const actor = this.actor;
    const qty = this.qty[id] ?? 1;
    const data = doc.toObject();
    delete data._id;
    delete data.folder;
    const level = actor.system.level;
    const ranked = isRanked(doc);
    if (ranked) data.system.rank = this.ranks[id] ?? (doc.nssqCustom ? doc.system.rank : Math.min(MAX_RANK, Math.max(1, level)));
    const unit = buyPrice(data, tables, { level });
    const total = unit * qty;
    if (actor.system.money < total) return ui.notifications.warn(L("noMoney", { price: total }));
    if (exceedsOwnLimit(actor.items.contents, { ...data, system: { ...data.system, quantity: qty } })) {
      return ui.notifications.warn(L("ownLimit", { name: data.name }));
    }

    // 농기구 등: 입수할 때 기본 속성 선택(여러 개면 같은 속성)
    const table = tableOf(doc);
    if (table?.elementChoice && !data.system.element) {
      const element = await Dialog.prompt({
        title: L("chooseElement"),
        content: `<form><div class="form-group"><select name="e">${["slash", "strike", "pierce"].map((e) => `<option value="${e}">${game.i18n.localize(`NSSQ.Resist.${e}`)}</option>`).join("")}</select></div></form>`,
        rejectClose: false,
        callback: (html) => html[0].querySelector("[name=e]").value
      });
      if (!element) return;
      data.system.element = element;
    }

    // 소재 배정: 개당 1개씩(무기·방어구는 대응 소재 R 이상, 아이템은 필요 소재와 같은 R). R이 낮은 것부터
    const allocation = [];
    if (!this.creation) {
      const items = actor.items.contents;
      const reqs = table ? [{ table, rank: data.system.rank }] : (data.system.materials ?? []).map((r) => ({ req: r }));
      const used = {};
      for (const r of reqs) {
        const cands = r.table ? equipmentMaterialCandidates(items, r.table, r.rank) : itemMaterialCandidates(items, r.req);
        const need = r.table ? `${r.table.materials.join("/")} R${r.rank}+` : `${r.req.type} R${r.req.rank}`;
        const a = allocateMaterials(cands, qty, used);
        if (!a) return ui.notifications.warn(L("noMaterial", { need: `${need} ×${qty}` }));
        for (const x of a) used[x.item.id] = (used[x.item.id] ?? 0) + x.n;
        allocation.push(...a);
      }
    }

    // 확인
    const name = `${esc(data.name)}${ranked ? ` R${data.system.rank}` : ""}`;
    const matText = allocation.length ? allocation.map((x) => `${esc(x.item.name)} R${x.item.system.rank} ×${x.n}`).join(", ") : this.creation ? L("creationMode") : L("noMaterialNeeded");
    const ok = await Dialog.confirm({
      title: L("confirmTitle"),
      content: `<p>${L("confirmBody", { name, qty, unit, total })}</p><p>${L("usedMaterial")}: ${matText}</p><p class="notes">${L("confirmMoney", { before: actor.system.money, after: actor.system.money - total })}</p>`,
      rejectClose: false
    });
    if (!ok) return;

    // 받기: 쌓이는 것은 한 묶음, 무기·방어구 등은 개수만큼. 넘치면 정리 창(창고 가능, 전부 아니면 취소)
    const stackable = !!stackKey(data);
    const dataList = stackable
      ? [{ ...data, system: { ...data.system, quantity: qty } }]
      : Array.from({ length: qty }, () => ({ ...data, system: { ...data.system, quantity: 1 } }));
    const reserved = allocation.reduce((m, x) => ({ ...m, [x.item.id]: (m[x.item.id] ?? 0) + x.n }), {});
    const { taken } = await acquireItems(actor, dataList, { source: "shop", delegate: false, reserved });
    if (!taken.length) return;
    for (const x of allocation) {
      const fresh = actor.items.get(x.item.id);
      if (fresh) await consumeMaterial(fresh, x.n);
    }
    await actor.update({ "system.money": actor.system.money - total });
    await log(actor, L("bought", { name: `${name}${qty > 1 ? ` ×${qty}` : ""}`, price: total }) + ` · ${L("usedMaterial")}: ${matText}`);
    this.render();
  }
}

/** 상점 열기: 플레이어는 GM이 상점을 열었을 때만 */
export function openShop(actor) {
  if (!actor?.isOwner) return;
  if (!shopOpen() && !game.user.isGM) return ui.notifications.warn(L("closed"));
  const existing = Object.values(ui.windows).find((w) => w instanceof ShopApp && w.actor === actor);
  if (existing) return existing.render(true, { focus: true });
  new ShopApp(actor).render(true);
}

/** 상점이 닫히면 플레이어의 상점 창을 닫고, 시트의 버튼 상태를 갱신한다 */
export function onShopToggle(open) {
  for (const w of Object.values(ui.windows)) {
    if (w instanceof ShopApp && !open && !game.user.isGM) w.close();
    else if (w.actor?.type === "character" || w instanceof ShopApp) w.render(false);
  }
  ui.notifications.info(open ? L("openedNotice") : L("closedNotice"));
  ui.actors?.render();
}

export function registerShopHooks() {
  // GM 도구: 토큰 컨트롤의 상점 토글
  Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user.isGM) return;
    controls.find((c) => c.name === "token")?.tools.push({
      name: "nssq-shop",
      title: "NSSQ.Shop.toggle",
      icon: "fas fa-store",
      toggle: true,
      active: shopOpen(),
      onClick: (toggled) => toggleShop(toggled)
    });
  });
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
