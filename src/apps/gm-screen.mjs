/**
 * GM 스크린: 파티 현황·빠른 조작·참고표를 한 창에 모은다(GM 전용).
 * 던전(단계 9)·전투(단계 4·5) 탭은 해당 단계에서 붙인다.
 */
import { openRequestDialog } from "./check-request.mjs";
import { ensureShopFolder, hiddenSet, setHidden, shopCatalog, shopOpen, toggleShop } from "./shop.mjs";
import { storageActive } from "./acquire.mjs";
import { battlePresets, createPreset, currentBattle, openEndDialog, openStartDialog } from "./battle.mjs";
import { cleanupEnemies } from "./enemy-library.mjs";
import tables from "../generated/tables.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.GMScreen.${k}`, d) : game.i18n.localize(`NSSQ.GMScreen.${k}`));

const playerOwned = (a) => game.users.some((u) => !u.isGM && a.testUserPermission(u, "OWNER"));

/** 파티: 플레이어가 소유한 캐릭터 + GM이 넣은 동료 NPC. 아무도 없으면 모든 캐릭터 */
export function partyActors() {
  const chars = game.actors.filter((a) => a.type === "character");
  const party = chars.filter((a) => playerOwned(a) || a.system.npc);
  return party.length ? party : chars;
}

/** GM만 가진 캐릭터(동료 NPC 후보) */
export function gmCharacters() {
  return game.actors.filter((a) => a.type === "character" && !playerOwned(a));
}

/** GM 스크린 여는 매크로를 만들어(이미 있으면 그것) 핫바의 빈 칸에 넣는다 */
export async function createGMScreenMacro() {
  if (!game.user.isGM) return;
  let macro = game.macros.find((m) => m.getFlag("nssq", "gmScreen"));
  macro ??= await Macro.create({
    name: L("title"), type: "script", img: "icons/svg/book.svg",
    command: "game.nssq.openGMScreen();", flags: { nssq: { gmScreen: true } }
  });
  const used = Object.entries(game.user.hotbar ?? {}).find(([, id]) => id === macro.id);
  if (used) return ui.notifications.info(L("macroExists", { slot: used[0] }));
  let slot = 1;
  while (slot <= 50 && game.user.hotbar?.[slot]) slot++;
  if (slot > 50) return ui.notifications.warn(L("macroNoSlot"));
  await game.user.assignHotbarMacro(macro, slot);
  ui.notifications.info(L("macroAdded", { slot }));
}

const pct = (v, max) => (max > 0 ? Math.clamp(Math.round((v / max) * 100), 0, 100) : 0);

export class GMScreen extends Application {
  static instance = null;

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "nssq-gm-screen",
      classes: ["nssq", "nssq-gm-screen"],
      template: "systems/nssq/templates/apps/gm-screen.hbs",
      title: game.i18n.localize("NSSQ.GMScreen.title"),
      width: 860,
      height: 680,
      resizable: true,
      tabs: [{ navSelector: ".gm-tabs", contentSelector: ".gm-body", initial: "party" }]
    });
  }

  static open() {
    if (!game.user.isGM) return;
    GMScreen.instance ??= new GMScreen();
    GMScreen.instance.render(true, { focus: true });
  }

  /** 열려 있으면 다시 그린다(액터·아이템·설정이 바뀔 때) */
  static refresh() {
    if (GMScreen.instance?.rendered) GMScreen.instance.render(false);
  }

  async getData() {
    const storageSetting = !!game.settings.get("nssq", "storage");
    const party = partyActors().map((a) => {
      const s = a.system;
      const owners = game.users.filter((u) => !u.isGM && a.testUserPermission(u, "OWNER"));
      return {
        id: a.id, name: a.name, img: a.img, level: s.level,
        owners: owners.map((u) => `${u.name}${u.active ? "" : " ●"}`).join(", ") || "-",
        online: owners.some((u) => u.active),
        hp: { value: s.hp.value, max: s.hp.max, pct: pct(s.hp.value, s.hp.max) },
        tp: { value: s.tp.value, max: s.tp.max, pct: pct(s.tp.value, s.tp.max) },
        fp: s.fp.value,
        carried: s.carried, carry: s.carry, over: s.carried > s.carry,
        money: s.money,
        row: game.i18n.localize(`NSSQ.Row.${s.row}`),
        storageEnabled: !!s.storageEnabled,
        npc: !!s.npc,
        storageActive: storageActive(a)
      };
    });
    const lv = tables.levelExp;
    const hidden = hiddenSet();
    const catalog = await shopCatalog();
    const shopGroups = [
      ["weapon", "TYPES.Item.weapon"], ["armor", "TYPES.Item.armor"], ["accessory", "TYPES.Item.accessory"],
      ["consumable", "TYPES.Item.consumable"], ["tool", "TYPES.Item.tool"]
    ].map(([type, label]) => {
      const items = catalog.filter((d) => d.type === type).map((d) => ({
        uuid: d.uuid, name: d.name, img: d.img, custom: !!d.nssqCustom, selling: !hidden.has(d.uuid)
      }));
      return { type, label, items, selling: items.filter((i) => i.selling).length };
    }).filter((g) => g.items.length);
    const battle = currentBattle();
    const presets = battlePresets().map((s) => ({
      id: s.id, name: s.name, thumb: s.thumb || s.background?.src || "",
      enemies: s.tokens.filter((t) => t.actor?.type === "enemy").map((t) => `${t.name}${t.actor.system.isRare ? "★" : ""}`).join(", ") || L("noEnemies"),
      bgm: s.playlistSound?.name ?? s.playlist?.name ?? L("noBgm"),
      bg: !!s.background?.src
    }));
    const npcCandidates = gmCharacters().map((a) => ({ id: a.id, name: a.name, img: a.img, npc: !!a.system.npc }));
    return {
      presets,
      battle: battle ? { name: battle.getFlag("nssq", "battle").presetName, round: battle.round } : null,
      npcCandidates,
      shopGroups,
      shopFilter: this.shopFilter ?? "",
      party,
      storageSetting,
      shopOpen: shopOpen(),
      fpStart: game.settings.get("nssq", "fpStart"),
      targets: tables.check.targets,
      abilityUses: tables.check.abilityUses,
      levels: lv.levels,
      sessionExp: lv.sessionExp
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.on("click", "[data-open-actor]", (ev) => game.actors.get(ev.currentTarget.dataset.openActor)?.sheet.render(true));
    html.on("change", "[data-npc-actor]", (ev) => {
      game.actors.get(ev.currentTarget.dataset.npcActor)?.update({ "system.npc": ev.currentTarget.checked });
    });
    html.on("change", "[data-storage-actor]", (ev) => {
      game.actors.get(ev.currentTarget.dataset.storageActor)?.update({ "system.storageEnabled": ev.currentTarget.checked });
    });
    html.on("click", "[data-gm=request]", () => openRequestDialog());
    html.on("click", "[data-gm=shop]", () => toggleShop());
    html.on("click", "[data-gm=shop-folder]", () => ensureShopFolder());
    // 판매 품목 설정: 「상점 품목」 탭으로 이동
    html.on("click", "[data-gm=shop-items]", () => this._tabs?.[0]?.activate("shop"));
    html.on("click", "[data-gm=session-start]", () => this.sessionStart());
    html.on("click", "[data-gm=macro]", () => createGMScreenMacro());
    html.on("click", "[data-gm=battle-start]", (ev) => openStartDialog(ev.currentTarget.dataset.preset || null));
    html.on("click", "[data-gm=battle-end]", () => openEndDialog());
    html.on("click", "[data-gm=preset-new]", () => createPreset());
    html.on("click", "[data-gm=enemy-cleanup]", () => cleanupEnemies());
    html.on("click", "[data-preset-view]", (ev) => game.scenes.get(ev.currentTarget.dataset.presetView)?.view());
    html.on("click", "[data-preset-config]", (ev) => game.scenes.get(ev.currentTarget.dataset.presetConfig)?.sheet.render(true));
    // 상점 품목: 체크 = 판매, 해제 = 숨김
    html.on("change", "[data-shop-uuid]", (ev) => setHidden([ev.currentTarget.dataset.shopUuid], !ev.currentTarget.checked));
    html.on("click", "[data-shop-all]", (ev) => {
      const group = ev.currentTarget.closest("[data-shop-group]");
      const uuids = [...group.querySelectorAll("[data-shop-uuid]")].filter((i) => i.closest("li").style.display !== "none").map((i) => i.dataset.shopUuid);
      setHidden(uuids, ev.currentTarget.dataset.shopAll === "hide");
    });
    html.on("input", "[name=shopFilter]", (ev) => {
      this.shopFilter = ev.currentTarget.value;
      this.applyShopFilter(html[0]);
    });
    this.applyShopFilter(html[0]);
  }

  /** 이름 검색: 다시 그리지 않고 줄만 숨긴다 */
  applyShopFilter(root) {
    const q = (this.shopFilter ?? "").trim();
    root.querySelectorAll(".shop-items li").forEach((li) => {
      li.style.display = !q || li.dataset.name.includes(q) ? "" : "none";
    });
  }

  /** 세션 시작: 파티 전원의 【FP】를 설정값(기본 1)으로 */
  async sessionStart() {
    const fp = game.settings.get("nssq", "fpStart");
    const party = partyActors();
    const ok = await Dialog.confirm({
      title: L("sessionStart"),
      content: `<p>${L("sessionStartConfirm", { fp, names: party.map((a) => a.name).join(", ") })}</p>`,
      rejectClose: false
    });
    if (!ok) return;
    for (const a of party) await a.update({ "system.fp.value": fp });
    await ChatMessage.create({ content: `<div class="nssq-trade"><i class="fas fa-flag"></i> ${L("sessionStarted", { fp })}</div>` });
  }
}

export function registerGMScreen() {
  // 열기: 액터 탭 머리 버튼, 토큰 도구
  Hooks.on("renderActorDirectory", (app, html) => {
    if (!game.user.isGM) return;
    const btn = $(`<button type="button" class="nssq-gm-screen-btn"><i class="fas fa-book-open"></i> ${L("title")}</button>`);
    btn.on("click", () => GMScreen.open());
    html.find(".directory-header .header-actions").append(btn);
  });
  Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user.isGM) return;
    controls.find((c) => c.name === "token")?.tools.push({
      name: "nssq-gm-screen", title: "NSSQ.GMScreen.title", icon: "fas fa-book-open", button: true, onClick: () => GMScreen.open()
    });
  });
  // 자동 갱신
  const refresh = foundry.utils.debounce(() => GMScreen.refresh(), 100);
  for (const hook of ["updateActor", "createActor", "deleteActor", "createItem", "updateItem", "deleteItem", "updateUser", "userConnected",
    "createScene", "updateScene", "deleteScene", "createCombat", "deleteCombat", "updateCombat"]) {
    Hooks.on(hook, refresh);
  }
  Hooks.on("updateSetting", (setting) => { if (setting.key?.startsWith("nssq.")) refresh(); });
}
