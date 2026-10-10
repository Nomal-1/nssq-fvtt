import { registerArt } from "./apps/art-config.mjs";
import { registerUpload } from "./apps/upload.mjs";
import { registerTransfer } from "./apps/transfer.mjs";
import { registerFieldScene } from "./apps/field-scene.mjs";
import { registerUniqueSkillHooks } from "./apps/unique-skill.mjs";
import { migrateEnemyArt } from "./apps/enemy-art.mjs";
import { actorModels, itemModels } from "./data/_module.mjs";
import { NssqActor } from "./documents/actor.mjs";
import { NssqItem } from "./documents/item.mjs";
import { NssqActorSheet } from "./sheets/actor-sheet.mjs";
import { NssqItemSheet } from "./sheets/item-sheet.mjs";
import { registerSettings } from "./settings.mjs";
import { TEMPLATES } from "./templates.mjs";
import { promptCheck, registerCheckHooks, rollCheck } from "./chat/check.mjs";
import { openRequestDialog, registerCheckRequest } from "./apps/check-request.mjs";
import { registerSocket } from "./socket.mjs";
import { registerAbilityRollHooks, rollAbilities } from "./apps/ability-roll.mjs";
import { acquireItems, registerAcquire } from "./apps/acquire.mjs";
import { openShop, registerShopHooks, toggleShop } from "./apps/shop.mjs";
import { GMScreen, registerGMScreen } from "./apps/gm-screen.mjs";
import { NssqCombat } from "./documents/combat.mjs";
import { NssqToken } from "./canvas/token.mjs";
import { registerApply } from "./combat/apply.mjs";
import { registerTurnStatus } from "./combat/turn-status.mjs";
import { registerSkillUse } from "./combat/skill-use.mjs";
import { registerReaction } from "./combat/reaction.mjs";
import { registerChase } from "./combat/chase.mjs";
import { registerLate } from "./combat/late.mjs";
import { registerOpening } from "./combat/opening.mjs";
import { registerBestiary } from "./combat/bestiary.mjs";
import { BestiaryApp, registerBestiaryApp } from "./apps/bestiary.mjs";
import { registerEffectsSync, syncEffects } from "./apps/effects-sync.mjs";
import { attackerFromContext, normalAttack, registerAttackHooks } from "./combat/attack.mjs";
import { registerTracker, rollEscape } from "./combat/tracker.mjs";
import { registerFormation } from "./combat/formation.mjs";
import { registerHud } from "./combat/hud.mjs";
import { registerSpecial } from "./combat/special.mjs";
import { registerLoot } from "./apps/loot.mjs";
import { registerExplore } from "./apps/explore.mjs";
import { registerCheckMods } from "./chat/check-mods.mjs";
import { registerDungeon } from "./apps/dungeon.mjs";
import { EncounterApp, registerEncounters } from "./apps/encounters.mjs";
import { TownApp, registerTown, returnToTown, requestReturnToTown } from "./apps/town.mjs";
import { GuildApp, registerGuild } from "./apps/guild.mjs";
import { registerDefaults, reseedDefaults } from "./apps/defaults.mjs";
import { FieldMapApp, registerFieldMap } from "./apps/fieldmap.mjs";
import { ChargenWizard, newCharacter, registerChargen } from "./apps/chargen-wizard.mjs";
import { cleanupEnemies, registerEnemyLibrary } from "./apps/enemy-library.mjs";
import { createPreset, openEndDialog, openStartDialog, registerBattle } from "./apps/battle.mjs";

Hooks.once("init", () => {
  // 단축키: GM 스크린(설정 → 조작 설정에서 바꿀 수 있다)
  game.keybindings.register("nssq", "openGMScreen", {
    name: "NSSQ.GMScreen.keybinding",
    editable: [{ key: "KeyG", modifiers: ["Shift"] }],
    restricted: true,
    onDown: () => {
      GMScreen.open();
      return true;
    }
  });
  CONFIG.Actor.documentClass = NssqActor;
  CONFIG.Item.documentClass = NssqItem;
  CONFIG.Combat.documentClass = NssqCombat;
  CONFIG.Token.objectClass = NssqToken;
  Object.assign(CONFIG.Actor.dataModels, actorModels);
  Object.assign(CONFIG.Item.dataModels, itemModels);

  CONFIG.Actor.trackableAttributes = {
    character: { bar: ["hp", "tp"], value: ["fp.value"] },
    enemy: { bar: ["hp"], value: [] },
    token: { bar: ["hp"], value: [] }
  };

  Actors.unregisterSheet("core", ActorSheet);
  Actors.registerSheet("nssq", NssqActorSheet, { makeDefault: true, label: "NSSQ.Sheet.actor" });
  Items.unregisterSheet("core", ItemSheet);
  Items.registerSheet("nssq", NssqItemSheet, { makeDefault: true, label: "NSSQ.Sheet.item" });

  registerSettings();

  loadTemplates(TEMPLATES);

  Handlebars.registerHelper("nssqLabel", (prefix, key) => game.i18n.localize(`${prefix}.${key}`));
  Handlebars.registerHelper("nssqEq", (a, b) => a === b);
  Handlebars.registerHelper("nssqGt", (a, b) => a > b);
  Handlebars.registerHelper("nssqSigned", (n) => (n > 0 ? `+${n}` : n === 0 ? "0" : `${n}`));

  registerCheckHooks();
  registerCheckRequest();
  registerAbilityRollHooks();
  registerAcquire();
  registerShopHooks();
  registerGMScreen();
  registerBestiary();
  registerBestiaryApp();
  registerEffectsSync();
  registerApply();
  registerTurnStatus();
  registerSkillUse();
  registerReaction();
  registerChase();
  registerLate();
  registerOpening();
  registerAttackHooks();
  registerTracker();
  registerBattle();
  registerFormation();
  registerHud();
  registerSpecial();
  registerLoot();
  registerExplore();
  registerCheckMods();
  registerDungeon();
  registerEncounters();
  registerTown();
  registerGuild();
  registerDefaults();
  registerFieldMap();
  registerChargen();
  registerEnemyLibrary();
  // 매크로·모듈용 API
  game.nssq = {
    openEncounters: (opts) => EncounterApp.open(opts),
    openTown: (id) => TownApp.open(id),
    openGuild: () => GuildApp.open(),
    reseedDefaults,
    returnToTown: (id, o) => (game.user.isGM ? returnToTown(id, o) : requestReturnToTown()),
    promptCheck, rollCheck, openRequestDialog, rollAbilities, acquireItems, openShop, toggleShop,
    openGMScreen: () => GMScreen.open(),
    openBestiary: () => BestiaryApp.open(),
    openFieldMap: () => FieldMapApp.open(),
    openChargen: (actor) => (actor ? ChargenWizard.open(actor) : newCharacter()),
    syncEffects: () => syncEffects(),
    normalAttack: (actor) => normalAttack(attackerFromContext(actor)),
    rollEscape: () => rollEscape(game.combat),
    startBattle: openStartDialog,
    endBattle: openEndDialog,
    skillMaker: async (o) => (await import("./apps/custom-maker.mjs")).openSkillMaker(o),
    enemyMaker: async (o) => (await import("./apps/custom-maker.mjs")).openEnemyMaker(o),
    classMaker: async (o) => (await import("./apps/custom-maker.mjs")).openClassMaker(o),
    dungeon: async () => (await import("./apps/dungeon.mjs")).openDungeonDialog(),
    nextEvent: async () => (await import("./apps/dungeon.mjs")).nextEvent(),
    gather: async (o) => (await import("./apps/loot.mjs")).openGatherDialog(o),
    createBattlePreset: createPreset,
    cleanupEnemies
  };
});

Hooks.once("ready", () => {
  registerSocket();
  registerUniqueSkillHooks();
  registerArt();
  registerUpload();
  registerTransfer();
  registerFieldScene();
  migrateEnemyArt();
});

// 시스템 카드가 든 채팅 메시지는 메시지 틀(양피지 테두리)까지 NSSQ 테마로
Hooks.on("renderChatMessage", (message, html) => {
  if (html[0]?.querySelector("[class*='nssq-']")) html[0].classList.add("nssq-msg");
});

// 시스템 대화창(내용에 nssq 클래스가 있는 것)은 창틀도 NSSQ 테마로
Hooks.on("renderDialog", (app) => {
  const el = app.element?.[0];
  if (!el || el.classList.contains("nq-window")) return;
  if (app.options.classes?.includes("nssq") || el.querySelector("[class*='nssq']")) el.classList.add("nssq", "dialog", "nq-window");
});
