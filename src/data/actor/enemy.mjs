import { RESISTS, SUB_STATS } from "../../engine/derive.mjs";
import { unidentifiedResist } from "../../engine/combat.mjs";
import { conditionMods } from "../../engine/conditions.mjs";
import { applyMods, buffMods } from "../../engine/buffs.mjs";
import { buffs, conditions, description, int, resistances, resource, row, str } from "../fields.mjs";

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
      conditions: conditions(),
      buffs: buffs(),
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

  /**
   * 전투에 쓰는 값: combatStats(부능력치)·resistTotal(내성)·hp.max에 상태·강화 보정(단계 5).
   * 식별 실패한 에너미는 내성을 최소 3으로 본 뒤(01 §3.1) 보정한다.
   */
  prepareDerivedData() {
    const base = Object.fromEntries(RESISTS.map((k) => [k, this.resist[k] ?? 0]));
    this.statusMods = { conditions: conditionMods(this.conditions), buffs: buffMods(this.buffs) };
    const m = applyMods(
      { sub: { ...this.stats }, resist: this.identified ? base : unidentifiedResist(base), hpMax: this.hp.max },
      [this.statusMods.conditions, this.statusMods.buffs]
    );
    this.combatStats = m.sub;
    this.resistTotal = m.resist;
    this.hp.max = m.hpMax;
  }
}
