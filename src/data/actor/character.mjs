import { ABILITIES, deriveCharacter } from "../../engine/derive.mjs";
import { description, int, resistances, resource, row, str } from "../fields.mjs";

const { SchemaField, ArrayField, StringField } = foundry.data.fields;

export class CharacterData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      abilities: new SchemaField(Object.fromEntries(ABILITIES.map((k) => [k, int(0)]))),
      abilityRolls: new ArrayField(int(0)),
      level: int(1, { min: 1 }),
      exp: int(0, { min: 0 }),
      hp: resource(0),
      tp: resource(0),
      fp: new SchemaField({ value: int(1, { min: 0 }) }),
      mainClass: str(""),
      subClass: new StringField({ required: true, nullable: true, initial: null }),
      resist: resistances(),
      row: row(),
      order: int(0),
      money: int(0, { min: 0 }),
      history: new ArrayField(new StringField()),
      description: description()
    };
  }

  prepareDerivedData() {
    // 장비·스킬·효과 보정은 단계 3·5에서 연결한다
    const d = deriveCharacter({ abilities: this.abilities, level: this.level });
    this.bonus = d.bonus;
    this.sub = d.sub;
    this.carry = d.carry;
    this.hp.max = d.hpMax;
    this.tp.max = d.tpMax;
  }
}
