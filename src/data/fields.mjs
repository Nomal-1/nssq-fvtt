/** DataModel 공용 필드 생성기 */
const { NumberField, StringField, SchemaField, HTMLField } = foundry.data.fields;

export const int = (initial = 0, opts = {}) =>
  new NumberField({ required: true, nullable: false, integer: true, initial, ...opts });

export const str = (initial = "", opts = {}) => new StringField({ required: true, blank: true, initial, ...opts });

export const resource = (initial = 0) => new SchemaField({ value: int(initial), max: int(initial) });

export const description = () => new HTMLField({ required: true, blank: true });

/** 내성 6종(참 괴 돌 염 빙 뇌), 기본 3 */
export const resistances = () =>
  new SchemaField({
    slash: int(3), strike: int(3), pierce: int(3), fire: int(3), ice: int(3), volt: int(3)
  });

export const row = () => str("front", { choices: ["front", "back"] });
