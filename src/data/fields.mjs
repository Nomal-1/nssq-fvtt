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

/** 상태 이상·봉인(engine/conditions.mjs): 심도, 건 자(독 대미지용 【억제 공격】) */
export const conditions = () => new foundry.data.fields.ArrayField(new SchemaField({
  id: str(""),
  depth: new NumberField({ required: true, nullable: true, integer: true, initial: null }),
  source: str(""),
  sourceSuppAtk: int(0)
}));

/** 강화·약화(engine/buffs.mjs): 수치, 남은 턴, 속성 등 */
export const buffs = () => new foundry.data.fields.ArrayField(new SchemaField({
  id: str(""),
  value: int(0),
  turns: int(1),
  param: str("")
}));
