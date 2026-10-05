import { ABILITIES, abilityBreakdown, deriveCharacter } from "../../engine/derive.mjs";
import { description, int, resistances, resource, row, str } from "../fields.mjs";

const { SchemaField, ArrayField, StringField } = foundry.data.fields;

/** 능력치 하나의 저장값. 클래스·장비 보정은 저장하지 않고 계산한다 */
const ability = () => new SchemaField({ base: int(0), growth: int(0), temp: int(0) });

export class CharacterData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      abilities: new SchemaField(Object.fromEntries(ABILITIES.map((k) => [k, ability()]))),
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

  /** v0.3.x까지의 abilities.str = 숫자 → { base: 숫자 } */
  static migrateData(source) {
    const a = source.abilities;
    if (a) for (const k of ABILITIES) if (typeof a[k] === "number") a[k] = { base: a[k], growth: 0, temp: 0 };
    return super.migrateData(source);
  }

  /** 메인 클래스: mainClass 키와 같은 클래스 아이템, 없으면 첫 클래스. 서브: subClass 키와 같은 다른 클래스 */
  get classItems() {
    const classes = this.parent?.items?.filter((i) => i.type === "class") ?? [];
    const main = classes.find((c) => c.system.key && c.system.key === this.mainClass) ?? classes[0] ?? null;
    const sub = this.subClass ? classes.find((c) => c !== main && c.system.key === this.subClass) ?? null : null;
    return { main, sub, all: classes };
  }

  prepareDerivedData() {
    const { main } = this.classItems;
    // 장비 보정은 단계 3, 효과에 의한 일시 보정은 단계 5에서 연결한다
    this.abilityParts = abilityBreakdown({
      abilities: this.abilities,
      classBonus: main?.system.abilityBonus ?? {},
      level: this.level
    });
    this.abilityTotal = Object.fromEntries(ABILITIES.map((k) => [k, this.abilityParts[k].total]));
    const d = deriveCharacter({ abilities: this.abilityTotal, level: this.level });
    this.bonus = d.bonus;
    this.sub = d.sub;
    this.carry = d.carry;
    this.hp.max = d.hpMax;
    this.tp.max = d.tpMax;
  }
}
