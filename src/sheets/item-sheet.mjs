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
    context.fields = Object.entries(system.schema.fields)
      .map(([k, f]) => ({ key: k, name: `system.${k}`, label: `NSSQ.Field.${k}`, value: system[k], type: typeOf(f) }))
      .filter((f) => f.type);
    context.enrichedDescription = await TextEditor.enrichHTML(system.description ?? "", {
      async: true,
      secrets: this.item.isOwner,
      relativeTo: this.item
    });
    return context;
  }
}
