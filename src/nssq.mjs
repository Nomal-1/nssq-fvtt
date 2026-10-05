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

Hooks.once("init", () => {
  CONFIG.Actor.documentClass = NssqActor;
  CONFIG.Item.documentClass = NssqItem;
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
  // 매크로·모듈용 API
  game.nssq = { promptCheck, rollCheck, openRequestDialog, rollAbilities, acquireItems, openShop, toggleShop };
});

Hooks.once("ready", () => registerSocket());
