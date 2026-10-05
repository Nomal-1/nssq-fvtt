import { ABILITIES, RESISTS, SUB_STATS } from "../engine/derive.mjs";
import { promptCheck, rollCheck } from "../chat/check.mjs";

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
    context.items = this.actor.items.contents.sort((a, b) => (a.sort || 0) - (b.sort || 0));
    context.enrichedDescription = await TextEditor.enrichHTML(system.description ?? "", {
      async: true,
      secrets: this.actor.isOwner,
      relativeTo: this.actor
    });
    return context;
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.on("click", "[data-action=item-edit]", (ev) => {
      const id = ev.currentTarget.closest("[data-item-id]")?.dataset.itemId;
      this.actor.items.get(id)?.sheet.render(true);
    });
    if (!this.isEditable) return;
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
