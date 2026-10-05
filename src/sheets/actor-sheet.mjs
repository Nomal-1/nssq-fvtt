import { ABILITIES, RESISTS, SUB_STATS } from "../engine/derive.mjs";
import { promptCheck, rollCheck } from "../chat/check.mjs";
import { rollAbilities } from "../apps/ability-roll.mjs";

export class NssqActorSheet extends ActorSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["nssq", "sheet", "actor"],
      width: 640,
      height: 680,
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "main" }]
    });
  }

  get template() {
    return `systems/nssq/templates/actor/${this.actor.type}-sheet.hbs`;
  }

  async getData(options) {
    const context = await super.getData(options);
    const system = this.actor.system;
    context.system = system;
    context.abilityKeys = ABILITIES;
    context.subKeys = SUB_STATS;
    context.resistKeys = RESISTS;
    context.rowChoices = { front: "NSSQ.Row.front", back: "NSSQ.Row.back" };
    if (this.actor.type === "character") {
      context.abilityRows = ABILITIES.map((k) => ({
        key: k, ...system.abilityParts[k], bonus: system.bonus[k]
      }));
      const { main, sub, all } = system.classItems;
      context.classes = { main, sub };
      context.mainClassChoices = Object.fromEntries(all.map((c) => [c.system.key, c.name]));
      context.subClassChoices = { "": game.i18n.localize("NSSQ.Class.none"), ...Object.fromEntries(all.filter((c) => c !== main).map((c) => [c.system.key, c.name])) };
      context.mainClassKey = main?.system.key ?? "";
      context.subClassKey = sub?.system.key ?? "";
    }
    context.items = this.actor.items.contents.sort((a, b) => (a.sort || 0) - (b.sort || 0));
    context.enrichedDescription = await TextEditor.enrichHTML(system.description ?? "", {
      async: true,
      secrets: this.actor.isOwner,
      relativeTo: this.actor
    });
    return context;
  }

  /** 클래스 아이템: 캐릭터당 2개(메인·서브)까지, 같은 클래스 중복 불가. 처음 놓은 것이 메인 */
  async _onDropItemCreate(itemData, event) {
    const list = Array.isArray(itemData) ? itemData : [itemData];
    if (this.actor.type !== "character") return super._onDropItemCreate(list, event);
    const classes = this.actor.items.filter((i) => i.type === "class");
    const keys = new Set(classes.map((c) => c.system.key));
    const accepted = [];
    let classCount = classes.length;
    for (const d of list) {
      if (d.type === "class") {
        if (keys.has(d.system?.key)) { ui.notifications.warn(game.i18n.format("NSSQ.Class.duplicate", { name: d.name })); continue; }
        if (classCount >= 2) { ui.notifications.warn(game.i18n.localize("NSSQ.Class.tooMany")); continue; }
        keys.add(d.system?.key);
        classCount++;
      }
      accepted.push(d);
    }
    const created = await super._onDropItemCreate(accepted, event);
    const update = {};
    for (const c of created.filter((i) => i.type === "class")) {
      if (!this.actor.system.mainClass && !update["system.mainClass"]) update["system.mainClass"] = c.system.key;
      else if (!this.actor.system.subClass && !update["system.subClass"]) update["system.subClass"] = c.system.key;
    }
    if (Object.keys(update).length) await this.actor.update(update);
    return created;
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.on("click", "[data-action=item-edit]", (ev) => {
      const id = ev.currentTarget.closest("[data-item-id]")?.dataset.itemId;
      this.actor.items.get(id)?.sheet.render(true);
    });
    if (!this.isEditable) return;
    html.on("click", "[data-action=roll-abilities]", (ev) => {
      ev.preventDefault();
      rollAbilities(this.actor);
    });
    // 능력치 판정: 클릭하면 대화창, Shift+클릭하면 바로 굴린다
    html.on("click", "[data-action=roll-ability]", async (ev) => {
      ev.preventDefault();
      const ability = ev.currentTarget.dataset.ability;
      const opts = ev.shiftKey ? { ability } : await promptCheck(this.actor, { ability });
      if (opts) await rollCheck(this.actor, opts);
    });
    html.on("click", "[data-action=item-delete]", (ev) => {
      const id = ev.currentTarget.closest("[data-item-id]")?.dataset.itemId;
      this.actor.items.get(id)?.deleteDialog();
    });
  }
}
