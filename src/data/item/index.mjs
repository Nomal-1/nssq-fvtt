import { description, int, str } from "../fields.mjs";
import { armorStats, weaponStats } from "../../engine/equipment.mjs";
import tables from "../../generated/tables.mjs";

const { SchemaField, ArrayField, BooleanField, NumberField, ObjectField, StringField } = foundry.data.fields;

const effects = () => new ArrayField(new ObjectField());
const nullableInt = () => new NumberField({ required: true, nullable: true, integer: true, initial: null });
/** 사용 횟수(n회분). max 0이면 횟수 없음 */
const uses = () => new SchemaField({ value: int(0, { min: 0 }), max: int(0, { min: 0 }) });
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
      // 전투/비전투: ""이면 자동 판정(engine skillUsage), GM이 스킬 시트에서 고칠 수 있다
      usage: str("", { choices: ["", "combat", "explore"] }),
      // 에너미 스킬: 식별하면 플레이어에게 공개(끄면 실제로 쓸 때까지 ???, 07 #47)
      reveal: new BooleanField({ initial: true }),
      effects: effects(),
      review: new StringField({ required: true, blank: true, initial: "" }),
      // 효과 데이터로 다 적지 못한 처리(카드에 「GM 판단 필요」로 표시, 03 §5)
      effectsNote: new StringField({ required: true, blank: true, initial: "" })
    };
  }
}

export class WeaponData extends NssqItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      weaponType: str(""),
      rank: int(1, { min: 1, max: 15 }),
      element: str(""),
      refinements: refinements(),
      slot: str("weapon", { choices: ["weapon", "other"] }),
      equipped: new BooleanField({ initial: false }),
      stored: new BooleanField({ initial: false })
    };
  }

  /** 종류 표의 R식으로 계산한 성능(주먹은 소유자 Lv) */
  prepareDerivedData() {
    const table = tables.weapons[this.weaponType];
    const actor = this.parent?.actor;
    const level = actor?.system?.level ?? 1;
    const altSkill = table?.physAtkAlt?.requires;
    const hasAltSkill = !!altSkill && !!actor?.items?.some((i) => i.type === "skill" && i.name === altSkill);
    this.stats = table ? weaponStats(table, { rank: this.rank, level, hasAltSkill }) : null;
    this.elementChoice = !!table?.elementChoice;
    this.effectiveElement = this.element || table?.element || "";
  }
}

export class ArmorData extends NssqItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      armorType: str(""),
      rank: int(1, { min: 1, max: 15 }),
      refinements: refinements(),
      equipped: new BooleanField({ initial: false }),
      stored: new BooleanField({ initial: false })
    };
  }

  prepareDerivedData() {
    const table = tables.armors[this.armorType];
    this.stats = table ? armorStats(table, { rank: this.rank }) : null;
  }
}

export class AccessoryData extends NssqItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      effects: effects(),
      price: int(0),
      equipped: new BooleanField({ initial: false }),
      stored: new BooleanField({ initial: false })
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
      uses: uses(),
      stored: new BooleanField({ initial: false }),
      foodstuff: new BooleanField({ initial: false })
    };
  }
}

export class ToolData extends NssqItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(), effects: effects(), price: int(0), quantity: int(1, { min: 0 }),
      consumable: new BooleanField({ initial: false }), uses: uses(), stored: new BooleanField({ initial: false })
    };
  }
}

export class MaterialData extends NssqItemData {
  static defineSchema() {
    return { ...super.defineSchema(), materialType: str(""), rank: int(1, { min: 1 }), quantity: int(1, { min: 0 }), stored: new BooleanField({ initial: false }) };
  }
}
