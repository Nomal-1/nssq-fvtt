/**
 * 상점(구입)·매각·제련 (01 §7, 쇼핑과 생활).
 * - 구입: G + 소재(무기·방어구는 대응 소재 R 이상 1개, 아이템은 필요 소재). 캐릭터 작성 중에는 G만
 * - 매각: 구입가의 50%, 소재는 (R의 제곱)×50G
 * - 제련: 2개까지·중복 금지, 대응 소재 R 이상 1개 + 효과별 가격
 * 거래는 채팅에 기록한다.
 */
import {
  MAX_RANK, allocateMaterials, buyPrice, canRefine, equipmentMaterialCandidates, exceedsOwnLimit, itemMaterialCandidates,
  isPhysical, isStored, refinePrice, sellPrice, stackKey
} from "../engine/equipment.mjs";
import tables from "../generated/tables.mjs";
import { refinementBadges } from "../sheets/badges.mjs";
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

/**
 * 상점 카탈로그: 시스템 품목(장비·아이템 팩) + 「상점 추가 품목」 폴더.
 * 소재와 가격 식이 없는 무기(주먹)는 팔지 않는다. 숨김 여부와 관계없이 전부 돌려준다.
 */
export async function shopCatalog() {
  const docs = [];
  for (const id of PACKS) {
    const pack = game.packs.get(id);
    if (pack) docs.push(...(await pack.getDocuments()).filter((d) => d.type !== "material" && (d.type !== "weapon" || isRanked(d))));
  }
  for (const d of customItems()) if (d.type !== "material" && TABS.some(([t]) => t === d.type)) docs.push(Object.assign(d, { nssqCustom: true }));
  return docs;
}

/** 파티가 있는 마을(07 #167: 판매 품목·랭크 상한은 마을마다) */
function townHere() {
  const loc = game.settings.get("nssq", "location") ?? {};
  return loc.kind === "town" ? (game.settings.get("nssq", "towns") ?? {})[loc.townId] ?? null : null;
}

/** 숨긴 품목(uuid). 마을에 있으면 그 마을의 목록(따로 정하지 않았으면 기본), townId를 주면 그 마을 */
export function hiddenSet(townId = undefined) {
  const t = townId === undefined ? townHere() : (game.settings.get("nssq", "towns") ?? {})[townId] ?? null;
  return new Set(Array.isArray(t?.shopHidden) ? t.shopHidden : game.settings.get("nssq", "shopHidden") ?? []);
}

/** 이 마을에서 살 수 있는 장비 랭크 상한(정하지 않았으면 15) */
export function shopMaxRank() {
  const n = Number(townHere()?.maxRank);
  return n > 0 ? Math.min(MAX_RANK, n) : MAX_RANK;
}

/** GM: 품목 숨김·판매 전환 */
export async function setHidden(uuids, hidden) {
  if (!game.user.isGM) return;
  const set = hiddenSet();
  for (const u of uuids) hidden ? set.add(u) : set.delete(u);
  await game.settings.set("nssq", "shopHidden", [...set]);
}

class ShopApp extends Application {
  /** @param {{ creation?: boolean }} options creation: 캐릭터 작성 마법사에서 연 상점(GM이 닫아 놨어도 열리고 작성 모드 고정) */
  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;
    this.forced = !!options.creation;
    this.creation = this.forced;
    this.ranks = {};
    this.qty = {};
    this.docs = null;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["nssq", "nssq-shop"],
      template: "systems/nssq/templates/apps/shop.hbs",
      width: 700,
      height: 680,
      resizable: true,
      tabs: [{ navSelector: ".shop-tabs", contentSelector: ".shop-body", initial: "weapon" }]
    });
  }

  get title() {
    return `${L("title")} — ${this.actor.name}`;
  }

  async loadDocs() {
    this.docs ??= await shopCatalog();
    return this.docs;
  }

  async getData() {
    // 숨긴 품목: 플레이어에게는 안 보이고, GM에게는 「숨김」 표시
    const hidden = hiddenSet();
    // 랭크 상한(마을): 플레이어는 그 위로 살 수 없다. 고정 랭크 추가 품목이 넘으면 숨김
    const cap = game.user.isGM ? MAX_RANK : shopMaxRank();
    const docs = (await this.loadDocs()).filter((d) => game.user.isGM || (!hidden.has(d.uuid) && !(d.nssqCustom && isRanked(d) && (d.system.rank ?? 1) > cap)));
    const level = this.actor.system.level;
    const rankDefault = Math.min(cap, Math.max(1, level));
    const rowFor = (d) => {
      const ranked = isRanked(d);
      const rank = ranked ? Math.min(cap, this.ranks[d.id] ?? (d.nssqCustom ? d.system.rank : rankDefault)) : null;
      const probe = { type: d.type, system: { ...d.system, rank } };
      const table = tableOf(d);
      const mats = table ? (table.materials ?? []).join("/") : (d.system.materials ?? []).map((m) => `${m.type} R${m.rank}`).join(", ");
      const qty = this.qty[d.id] ?? 1;
      const unit = buyPrice(probe, tables, { level });
      return {
        id: d.id, name: d.name, img: d.img, ranked, rank, qty, unit, maxRank: cap,
        price: unit * qty,
        custom: !!d.nssqCustom,
        hidden: hidden.has(d.uuid),
        materials: mats && (table ? `${mats} R${rank}+` : mats),
        info: d.system.effectText ?? ""
      };
    };
    const actor = this.actor;
    const rankLabel = (i) => (["weapon", "armor", "material"].includes(i.type) && (i.type !== "weapon" || isRanked(i)) ? `R${i.system.rank}` : "");
    // 매각: 창고에 없는 물건. 장비 중인 것은 표시만 하고 팔 수 있다
    const sellRows = actor.items.contents.filter((i) => isPhysical(i) && !isStored(i))
      .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name, "ko"))
      .map((i) => ({
        id: i.id, name: i.name, img: i.img, type: i.type, rank: rankLabel(i),
        unit: sellPrice(i, tables, { level }),
        quantity: i.system.quantity ?? 1,
        multi: (i.system.quantity ?? 1) > 1,
        equipped: !!i.system.equipped,
        refine: refinementBadges(i)
      }));
    // 제련: 창고에 없는 무기(가격 식이 있는 것)·방어구
    const refineRows = actor.items.contents.filter((i) => !isStored(i) && (i.type === "armor" || (i.type === "weapon" && isRanked(i))))
      .map((i) => ({
        id: i.id, name: i.name, img: i.img, rank: i.system.rank, equipped: !!i.system.equipped,
        refine: refinementBadges(i),
        canRefine: (i.system.refinements ?? []).length < 2,
        materials: `${(tableOf(i)?.materials ?? []).join("/")} R${i.system.rank}+`
      }));
    this.syncCreation();
    return {
      sellRows, refineRows,
      money: this.actor.system.money,
      creation: this.creation,
      forced: this.forced,
      // 작성 모드 체크는 작성이 끝나지(잠기지) 않은 캐릭터만, 잠긴 뒤에는 GM만
      canCreation: game.user.isGM || !this.actor.system.creation?.locked,
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
      this.ranks[ev.currentTarget.dataset.rank] = Math.clamp(Number(ev.currentTarget.value) || 1, 1, game.user.isGM ? MAX_RANK : shopMaxRank());
      this.render();
    });
    html.on("change", "[data-qty]", (ev) => {
      this.qty[ev.currentTarget.dataset.qty] = Math.clamp(Number(ev.currentTarget.value) || 1, 1, 99);
      this.render();
    });
    html.on("click", "[data-buy]", (ev) => this.buy(ev.currentTarget.dataset.buy));
    // 매각 탭: 고른 것의 합계를 다시 그리지 않고 갱신
    const root = html[0];
    const refreshTotal = () => {
      let total = 0;
      let count = 0;
      root.querySelectorAll("[data-sell-row]").forEach((li) => {
        if (!li.querySelector(".sell-check").checked) return;
        const n = Number(li.querySelector(".sell-qty")?.value ?? 1) || 0;
        total += n * Number(li.dataset.unit);
        count += n;
      });
      const t = root.querySelector(".sell-total b");
      if (t) t.textContent = String(total);
      const btn = root.querySelector("[data-sell-selected]");
      if (btn) btn.disabled = count === 0;
    };
    html.on("change input", ".sell-check, .sell-qty", (ev) => {
      const q = ev.currentTarget.classList.contains("sell-qty") ? ev.currentTarget : null;
      if (q) {
        q.value = String(Math.clamp(Number(q.value) || 1, 1, Number(q.max)));
        q.closest("li").querySelector(".sell-check").checked = true;
      }
      refreshTotal();
    });
    html.on("click", "[data-sell-select]", (ev) => {
      ev.preventDefault();
      const type = ev.currentTarget.dataset.sellSelect;
      const rows = this.actor.items;
      root.querySelectorAll("[data-sell-row]").forEach((li) => {
        if (rows.get(li.dataset.sellRow)?.type === type) li.querySelector(".sell-check").checked = true;
      });
      refreshTotal();
    });
    html.on("click", "[data-sell-selected]", () => {
      const picks = [...root.querySelectorAll("[data-sell-row]")]
        .filter((li) => li.querySelector(".sell-check").checked)
        .map((li) => ({ item: this.actor.items.get(li.dataset.sellRow), n: Number(li.querySelector(".sell-qty")?.value ?? 1) || 1 }))
        .filter((p) => p.item);
      sellItems(this.actor, picks).then(() => this.render());
    });
    html.on("click", "[data-refine]", (ev) => {
      const item = this.actor.items.get(ev.currentTarget.dataset.refine);
      if (item) openRefineDialog(this.actor, item, { creation: this.creation, forced: this.forced }).then(() => this.render());
    });
  }

  /** 작성이 잠기면(완료) 작성 모드를 끈다(GM 제외) */
  syncCreation() {
    if (game.user.isGM || !this.actor.system.creation?.locked) return;
    this.forced = false;
    this.creation = false;
  }

  async buy(id) {
    this.syncCreation();
    if (!shopOpen() && !game.user.isGM && !this.forced) return ui.notifications.warn(L("closed"));
    const doc = this.docs.find((d) => d.id === id);
    if (!doc || (!game.user.isGM && hiddenSet().has(doc.uuid))) return;
    const actor = this.actor;
    const qty = this.qty[id] ?? 1;
    const data = doc.toObject();
    delete data._id;
    delete data.folder;
    const level = actor.system.level;
    const ranked = isRanked(doc);
    const cap = game.user.isGM ? MAX_RANK : shopMaxRank();
    if (ranked) data.system.rank = Math.min(cap, this.ranks[id] ?? (doc.nssqCustom ? doc.system.rank : Math.max(1, level)));
    if (ranked && doc.nssqCustom && (doc.system.rank ?? 1) > cap) return ui.notifications.warn(L("overRank", { n: cap }));
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

    // 확인. 무기·방어구는 이름을 정할 수 있다(비워 두면 원래 이름)
    const named = data.type === "weapon" || data.type === "armor";
    const baseName = data.name;
    const shown = `${esc(baseName)}${ranked ? ` R${data.system.rank}` : ""}`;
    const matText = allocation.length ? allocation.map((x) => `${esc(x.item.name)} R${x.item.system.rank} ×${x.n}`).join(", ") : this.creation ? L("creationMode") : L("noMaterialNeeded");
    const confirmed = await Dialog.prompt({
      title: L("confirmTitle"),
      content: `<form class="nssq-buy-confirm">
        <p>${L("confirmBody", { name: shown, qty, unit, total })}</p>
        ${named ? `<div class="form-group"><label>${L("itemName")}</label><input type="text" name="name" value="${esc(baseName)}" placeholder="${esc(baseName)}"/></div><p class="notes">${L("itemNameHint")}</p>` : ""}
        <p>${L("usedMaterial")}: ${matText}</p>
        <p class="notes">${L("confirmMoney", { before: actor.system.money, after: actor.system.money - total })}</p>
      </form>`,
      label: L("buy"),
      rejectClose: false,
      callback: (html) => ({ name: html[0].querySelector("[name=name]")?.value.trim() || baseName })
    });
    if (!confirmed) return;
    data.name = confirmed.name;
    const name = `${esc(data.name)}${ranked ? ` R${data.system.rank}` : ""}`;

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

/** 상점 열기: 플레이어는 GM이 상점을 열었을 때만. creation: 작성 마법사(작성이 잠기지 않은 캐릭터만, 상점이 닫혀 있어도) */
export function openShop(actor, { creation = false } = {}) {
  if (!actor?.isOwner) return;
  const forced = creation && !actor.system.creation?.locked;
  if (!shopOpen() && !game.user.isGM && !forced) return ui.notifications.warn(L("closed"));
  const existing = Object.values(ui.windows).find((w) => w instanceof ShopApp && w.actor === actor);
  if (existing && existing.forced === forced) return existing.render(true, { focus: true });
  if (existing) existing.close();
  new ShopApp(actor, { creation: forced }).render(true);
}

/** 상점이 닫히면 플레이어의 상점 창을 닫고, 시트의 버튼 상태를 갱신한다 */
export function onShopToggle(open) {
  for (const w of Object.values(ui.windows)) {
    if (w instanceof ShopApp && !open && !game.user.isGM && !w.forced) w.close();
    else if (w.actor?.type === "character" || w instanceof ShopApp) w.render(false);
  }
  ui.notifications.info(open ? L("openedNotice") : L("closedNotice"));
  ui.actors?.render();
}

export function onShopHiddenChange() {
  for (const w of Object.values(ui.windows)) if (w instanceof ShopApp) w.render(false);
}

export function registerShopHooks() {
  const reload = () => { for (const w of Object.values(ui.windows)) if (w instanceof ShopApp) { w.docs = null; w.render(false); } };
  for (const hook of ["createItem", "updateItem", "deleteItem", "updateFolder"]) Hooks.on(hook, (doc) => { if (!doc.parent) reload(); });
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

/**
 * 여러 물건을 한 번에 판다(상점 「매각」 탭)
 * @param {Actor} actor
 * @param {{item: Item, n: number}[]} picks
 */
export async function sellItems(actor, picks) {
  if (!shopOpen() && !game.user.isGM) return ui.notifications.warn(L("closed"));
  const level = actor.system.level;
  const lines = picks.map(({ item, n }) => {
    const qty = item.system.quantity ?? 1;
    const count = Math.clamp(n, 1, qty);
    return { item, count, price: sellPrice(item, tables, { level }) * count };
  });
  if (!lines.length) return;
  const total = lines.reduce((a, l) => a + l.price, 0);
  const label = (l) => `${esc(l.item.name)}${["weapon", "armor", "material"].includes(l.item.type) ? ` R${l.item.system.rank}` : ""}${l.count > 1 ? ` ×${l.count}` : ""}`;
  const equipped = lines.some((l) => l.item.system.equipped);
  const ok = await Dialog.confirm({
    title: L("sellTitle"),
    content: `<ul class="nssq-sell-list">${lines.map((l) => `<li>${label(l)} — ${l.price}G</li>`).join("")}</ul>
      <p><b>${L("sellTotal")} ${total}G</b> (${actor.system.money}G → ${actor.system.money + total}G)</p>
      ${equipped ? `<p class="notes warn">${L("sellEquipped")}</p>` : ""}`,
    rejectClose: false
  });
  if (!ok) return;
  for (const l of lines) {
    const qty = l.item.system.quantity ?? 1;
    if (l.count < qty) await l.item.update({ "system.quantity": qty - l.count });
    else await l.item.delete();
  }
  await actor.update({ "system.money": actor.system.money + total });
  await log(actor, L("sold", { name: lines.map(label).join(", "), price: total }));
}

/* ---------------- 제련 ---------------- */

export async function openRefineDialog(actor, item, { creation = false, forced = false } = {}) {
  if (!shopOpen() && !game.user.isGM && !forced) return ui.notifications.warn(L("closed"));
  const canCreation = game.user.isGM || !actor.system.creation?.locked;
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
      ${canCreation ? `<div class="form-group"><label><input type="checkbox" name="creation" ${creation ? "checked" : ""} ${forced ? "disabled" : ""}/> ${L("creationMode")}</label></div>` : ""}
      <p class="notes">${L("refineMaterialNote", { mats: (table?.materials ?? []).join("/"), rank })}</p>
    </form>`;
  const pick = await Dialog.prompt({
    title: L("refineTitle"),
    content,
    label: L("refine"),
    rejectClose: false,
    callback: (html) => ({ key: html[0].querySelector("[name=r]").value, creation: forced || !!html[0].querySelector("[name=creation]")?.checked })
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
