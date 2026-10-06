import { SUB_STATS } from "../../engine/derive.mjs";
import { description, int, resistances, resource, row, str } from "../fields.mjs";

const { SchemaField, ArrayField, BooleanField, NumberField } = foundry.data.fields;

export class EnemyData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      key: str(""),
      level: int(1, { min: 0 }),
      rarity: int(0),
      attackElements: new ArrayField(str("")),
      isFOE: new BooleanField({ initial: false }),
      isRare: new BooleanField({ initial: false }),
      identified: new BooleanField({ initial: false }),
      // 식별 달성값이 【희소도】+2 이상이라 플레이어가 희소종임을 안다
      rareKnown: new BooleanField({ initial: false }),
      hp: resource(1),
      stats: new SchemaField(Object.fromEntries(SUB_STATS.map((k) => [k, int(0)]))),
      resist: resistances(),
      drops: new ArrayField(new SchemaField({
        min: int(2),
        max: new NumberField({ required: true, nullable: true, integer: true, initial: null }),
        item: str(""),
        rank: new NumberField({ required: true, nullable: true, integer: true, initial: null })
      })),
      row: row(),
      order: int(0),
      description: description()
    };
  }
}
