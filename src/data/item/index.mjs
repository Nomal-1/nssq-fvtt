import { description, int, str } from "../fields.mjs";

const { SchemaField, ArrayField, BooleanField, NumberField, ObjectField, StringField } = foundry.data.fields;

const effects = () => new ArrayField(new ObjectField());
const nullableInt = () => new NumberField({ required: true, nullable: true, integer: true, initial: null });
const refinements = () => new ArrayField(str(""), { validate: (v) => v.length <= 2 });

/** 모든 아이템 공통: 불변 키와 해설 */
class NssqItemData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return { key: str(""), description: description() };
  }
}

export class ClassData extends NssqItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      abilityBonus: new SchemaField({ str: int(0), tec: int(0), vit: int(0), agi: int(0), luc: int(0) }),
      weapons: new ArrayField(str("")),
      armors: new ArrayField(str("")),
      role: new ArrayField(str("")),
      position: str("")
    };
  }
}

export class SkillData extends NssqItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      skillKey: str(""),
      classKey: str(""),
      weaponReq: new ArrayField(str("")),
      part: str("-"),
      category: str("-"),
      timing: str(""),
      range: str("-"),
      target: str("-"),
      cost: new SchemaField({ tp: int(0), fp: int(0) }),
      maxSL: new SchemaField({ main: int(1), sub: nullableInt() }),
      unique: new BooleanField({ initial: false }),
      prereqs: new ObjectField(),
      variants: new ArrayField(str("")),
      sl: int(1, { min: 0 }),
      effects: effects(),
      review: new StringField({ required: true, blank: true, initial: "" })
    };
  }
}

export class WeaponData extends NssqItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      weaponType: str(""),
      rank: int(1, { min: 1 }),
      element: str(""),
      refinements: refinements(),
      slot: str("weapon", { choices: ["weapon", "other"] }),
      equipped: new BooleanField({ initial: false })
    };
  }
}

export class ArmorData extends NssqItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      armorType: str(""),
      rank: int(1, { min: 1 }),
      refinements: refinements(),
      equipped: new BooleanField({ initial: false })
    };
  }
}

export class AccessoryData extends NssqItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      effects: effects(),
      price: int(0),
      equipped: new BooleanField({ initial: false })
    };
  }
}

export class ConsumableData extends NssqItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      price: int(0),
      materials: new ArrayField(new SchemaField({ type: str(""), rank: int(1) })),
      effects: effects(),
      quantity: int(1, { min: 0 }),
      foodstuff: new BooleanField({ initial: false })
    };
  }
}

export class ToolData extends NssqItemData {
  static defineSchema() {
    return { ...super.defineSchema(), effects: effects(), price: int(0), quantity: int(1, { min: 0 }) };
  }
}

export class MaterialData extends NssqItemData {
  static defineSchema() {
    return { ...super.defineSchema(), materialType: str(""), rank: int(1, { min: 1 }), quantity: int(1, { min: 0 }) };
  }
}
