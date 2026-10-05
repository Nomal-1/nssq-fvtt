import { actorModels, itemModels } from "./data/_module.mjs";
import { NssqActor } from "./documents/actor.mjs";
import { NssqItem } from "./documents/item.mjs";
import { NssqActorSheet } from "./sheets/actor-sheet.mjs";
import { NssqItemSheet } from "./sheets/item-sheet.mjs";
import { registerSettings } from "./settings.mjs";
import { TEMPLATES } from "./templates.mjs";

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
});
