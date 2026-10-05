import tables from "../generated/tables.mjs";
import { badgeFor } from "./badges.mjs";

const ELEMENTS = ["slash", "strike", "pierce", "fire", "ice", "volt"];

export class NssqItemSheet extends ItemSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["nssq", "sheet", "item"],
      width: 520,
      height: 480
    });
  }

  get template() {
    return "systems/nssq/templates/item/item-sheet.hbs";
  }

  async getData(options) {
    const context = await super.getData(options);
    const system = this.item.system;
    context.system = system;
    // 단계 0: 스키마의 단순 필드(문자열·숫자·불리언)를 자동으로 나열한다
    const { StringField, NumberField, BooleanField, HTMLField } = foundry.data.fields;
    const typeOf = (f) => {
      if (f instanceof HTMLField) return null;
      if (f instanceof BooleanField) return "BooleanField";
      if (f instanceof NumberField) return "NumberField";
      if (f instanceof StringField) return "StringField";
      return null;
    };
    const choices = this.fieldChoices();
    context.fields = Object.entries(system.schema.fields)
      .map(([k, f]) => ({ key: k, name: `system.${k}`, label: `NSSQ.Field.${k}`, value: system[k], type: typeOf(f), choices: choices[k] }))
      .filter((f) => f.type);
    // 무기·방어구: 계산된 성능과 제련 목록
    if (system.stats) {
      context.stats = Object.entries(system.stats)
        .filter(([k, v]) => typeof v === "number" && !(k === "price" && !v))
        .map(([k, v]) => ({ label: `NSSQ.Inventory.${k}`, value: v }));
    }
    if (Array.isArray(system.refinements) && (this.item.type === "weapon" || this.item.type === "armor")) {
      context.refinements = system.refinements.map((k) => {
        const r = tables.refinements.find((x) => x.key === k);
        return { key: k, name: r?.name ?? k, badge: r ? badgeFor(r) : null };
      });
      context.refineSlots = Math.max(0, 2 - system.refinements.length);
      context.isGM = game.user.isGM;
    }
    context.enrichedDescription = await TextEditor.enrichHTML(system.description ?? "", {
      async: true,
      secrets: this.item.isOwner,
      relativeTo: this.item
    });
    return context;
  }

  /** 선택 상자로 보일 필드 */
  fieldChoices() {
    const label = (k) => game.i18n.localize(`NSSQ.Resist.${k}`);
    const c = {};
    if (this.item.type === "weapon") {
      c.weaponType = Object.fromEntries(Object.keys(tables.weapons).map((k) => [k, k]));
      c.element = { "": game.i18n.localize("NSSQ.Field.elementDefault"), ...Object.fromEntries(ELEMENTS.map((e) => [e, label(e)])) };
      c.slot = { weapon: game.i18n.localize("NSSQ.Slot.weapon"), other: game.i18n.localize("NSSQ.Slot.other") };
    }
    if (this.item.type === "armor") c.armorType = Object.fromEntries(Object.keys(tables.armors).map((k) => [k, k]));
    if (this.item.type === "material") c.materialType = Object.fromEntries(tables.materials.map((k) => [k, k]));
    return c;
  }

  activateListeners(html) {
    super.activateListeners(html);
    if (!this.isEditable) return;
    // 제련 지우기(GM): 실수 정정용. 비용·소재는 돌려주지 않는다
    html.on("click", "[data-action=remove-refinement]", (ev) => {
      ev.preventDefault();
      const key = ev.currentTarget.dataset.key;
      this.item.update({ "system.refinements": this.item.system.refinements.filter((k) => k !== key) });
    });
  }
}
