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
  // 길드에서 「대기」로 둔 캐릭터는 빼고(07 #167)
  const party = chars.filter((a) => (playerOwned(a) && !a.getFlag("nssq", "benched")) || a.system.npc);
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
      resizable: true
    });
  }

  /**
   * 상황별 화면: 전투 중 → 전투, 필드 지도·랜덤 던전 진행 중 → 던전 안, 플레이어가 접속해 있으면 → 던전 진입 전, GM 혼자면 → 준비.
   * GM이 다른 화면을 고르면 상황이 바뀔 때까지 그대로 둔다(상황이 바뀌면 그 화면으로)
   */
  static autoMode() {
    if (currentBattle() || game.combat?.started) return "battle";
    if (game.settings.get("nssq", "fieldMapState")?.active || game.settings.get("nssq", "dungeon")?.active) return "dungeon";
    if (game.users.some((u) => u.active && !u.isGM)) return "town";
    return "prep";
  }

  get mode() {
    const auto = GMScreen.autoMode();
    if (this.manual && this.manual.from === auto) return this.manual.mode;
    this.manual = null;
    return auto;
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
    // 판매 품목: 기본 또는 고른 마을(07 #167)
    const towns = game.settings.get("nssq", "towns") ?? {};
    if (this.shopTown && !towns[this.shopTown]) this.shopTown = null;
    const hidden = hiddenSet(this.shopTown ?? null);
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
    // 상태 한 줄: 시각(필드 지도·랜덤 던전), 시간대, 어둠, 누적 전투 턴
    const fm = game.settings.get("nssq", "fieldMapState") ?? {};
    const dg = game.settings.get("nssq", "dungeon") ?? {};
    const hour = fm.active ? fm.hour : dg.active ? dg.hour : null;
    const tod = game.settings.get("nssq", "timeOfDay");
    const status = {
      clock: hour === null || hour === undefined ? "" : L("statusClock", { h: hour }),
      tod: tod && tod !== "none" ? game.i18n.localize(`NSSQ.Settings.timeOfDay.${tod}`) : "",
      night: tod === "night",
      dark: !!battle?.getFlag("nssq", "battle")?.dark,
      exploring: !!(fm.active || dg.active),
      turns: game.settings.get("nssq", "battleTurns") ?? 0
    };
    const mode = this.mode;
    const auto = GMScreen.autoMode();
    const modes = [["prep", "fa-tools"], ["town", "fa-home"], ["dungeon", "fa-dungeon"], ["battle", "fa-skull-crossbones"], ["reference", "fa-book"]]
      .map(([id, icon]) => ({ id, icon, label: L(`mode.${id}`), hint: L(`modeHint.${id}`), active: id === mode, auto: id === auto && id !== "reference" }));
    // 던전 안: 지금 에어리어의 조우표(필드 지도 진행 중)
    const encs = game.settings.get("nssq", "encounters") ?? {};
    const liveMap = fm.active ? (game.settings.get("nssq", "fieldMaps") ?? {})[fm.mapId] : null;
    const hereArea = liveMap?.areas?.find((a) => a.id === fm.current);
    const rows = (hereArea?.encounters ?? []).filter((r) => encs[r.id]);
    const sum = rows.reduce((n, r) => n + (Number(r.weight) || 0), 0);
    const here = { name: hereArea?.name ?? "", encounters: rows.map((r) => ({ id: r.id, name: encs[r.id].name, pct: sum ? Math.round(((Number(r.weight) || 0) / sum) * 100) : 0 })) };
    const loc = game.settings.get("nssq", "location") ?? {};
    return {
      shopTowns: Object.values(towns).map((t) => ({ id: t.id, name: t.name, selected: t.id === this.shopTown })),
      townName: loc.kind === "town" ? towns[loc.townId]?.name ?? "" : "",
      encounterCount: Object.keys(encs).length,
      here,
      mode,
      modes,
      status,
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
    html.on("click", "[data-mode]", (ev) => {
      const m = ev.currentTarget.dataset.mode;
      const auto = GMScreen.autoMode();
      this.manual = m === auto ? null : { mode: m, from: auto };
      this.render(false);
    });
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
    html.on("click", "[data-gm=session-start]", () => this.sessionStart());
    html.on("click", "[data-gm=macro]", () => createGMScreenMacro());
    // ⚙ 메뉴는 고르면 닫는다
    html.on("click", ".gm-admin .menu button", (ev) => ev.currentTarget.closest("details")?.removeAttribute("open"));
    html.on("click", "[data-gm=battle-start]", (ev) => openStartDialog(ev.currentTarget.dataset.preset || null));
    html.on("click", "[data-gm=battle-end]", () => openEndDialog());
    html.on("click", "[data-gm=skill-maker]", async () => (await import("./custom-maker.mjs")).openSkillMaker());
    html.on("click", "[data-gm=class-maker]", async () => (await import("./custom-maker.mjs")).openClassMaker());
    html.on("click", "[data-gm=enemy-maker]", async () => (await import("./custom-maker.mjs")).openEnemyMaker());
    html.on("click", "[data-gm=living]", async () => (await import("./session.mjs")).openLivingCost());
    html.on("click", "[data-gm=session-end]", async () => (await import("./session.mjs")).openSessionEnd());
    html.on("click", "[data-gm=fieldmap]", async () => (await import("./fieldmap.mjs")).FieldMapApp.open());
    // 던전 나가기: 랜덤 던전 진행 중이면 그것을, 아니면 필드 지도 진행을 끝낸다
    html.on("click", "[data-gm=leave-dungeon]", async () => (await import("./town.mjs")).returnToTown(null, { reason: game.i18n.localize("NSSQ.Town.leftByGM") }));
    html.on("click", "[data-gm=town]", async () => (await import("./town.mjs")).TownApp.open());
    html.on("click", "[data-gm=dungeon]", async () => (await import("./dungeon.mjs")).openDungeonDialog());
    html.on("click", "[data-gm=camp]", async () => (await import("./explore.mjs")).openCampDialog());
    html.on("click", "[data-gm=trap]", async () => (await import("./explore.mjs")).openTrapDialog());
    html.on("click", "[data-gm=gather]", async () => (await import("./loot.mjs")).openGatherDialog());
    html.on("click", "[data-gm=preset-new]", () => createPreset());
    html.on("click", "[data-gm=encounters]", async () => (await import("./encounters.mjs")).EncounterApp.open());
    html.on("click", "[data-gm=enc-start]", async (ev) => (await import("./encounters.mjs")).startEncounter(ev.currentTarget.dataset.id));
    html.on("click", "[data-gm=enc-random]", async () => {
      const fm = game.settings.get("nssq", "fieldMapState") ?? {};
      const map = (game.settings.get("nssq", "fieldMaps") ?? {})[fm.mapId];
      const area = map?.areas?.find((a) => a.id === fm.current);
      return (await import("./encounters.mjs")).randomEncounter(area?.encounters ?? [], { map, name: area?.name ?? "" });
    });
    html.on("click", "[data-gm=enemy-cleanup]", () => cleanupEnemies());
    html.on("click", "[data-gm=effects-sync]", () => game.nssq.syncEffects());
    html.on("click", "[data-preset-view]", (ev) => game.scenes.get(ev.currentTarget.dataset.presetView)?.view());
    html.on("click", "[data-preset-config]", (ev) => game.scenes.get(ev.currentTarget.dataset.presetConfig)?.sheet.render(true));
    // 상점 품목: 체크 = 판매, 해제 = 숨김
    const hide = async (uuids, h) => (this.shopTown ? (await import("./town.mjs")).setTownHidden(this.shopTown, uuids, h) : setHidden(uuids, h));
    html.on("change", "[data-shop-town]", (ev) => { this.shopTown = ev.currentTarget.value || null; this.render(false); });
    html.on("change", "[data-shop-uuid]", (ev) => hide([ev.currentTarget.dataset.shopUuid], !ev.currentTarget.checked));
    html.on("click", "[data-shop-all]", (ev) => {
      const group = ev.currentTarget.closest("[data-shop-group]");
      const uuids = [...group.querySelectorAll("[data-shop-uuid]")].filter((i) => i.closest("li").style.display !== "none").map((i) => i.dataset.shopUuid);
      hide(uuids, ev.currentTarget.dataset.shopAll === "hide");
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
    // 《핫 스타트》 등 세션 시작 【FP】 보너스(효과 sessionFp)
    const { sessionFpBonus } = await import("./session.mjs");
    const extra = [];
    for (const a of party) {
      const b = sessionFpBonus(a);
      const n = b.reduce((x, y) => x + y.value, 0);
      await a.update({ "system.fp.value": fp + n });
      if (n) extra.push(L("sessionFpBonus", { name: a.name, skills: b.map((x) => `《${x.name}》`).join(""), n }));
    }
    await ChatMessage.create({ content: `<div class="nssq-trade"><i class="fas fa-flag"></i> ${L("sessionStarted", { fp })}${extra.length ? `<br>${extra.join("<br>")}` : ""}</div>` });
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
