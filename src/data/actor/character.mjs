import { ABILITIES, RESISTS, abilityBreakdown, deriveCharacter } from "../../engine/derive.mjs";
import { carriedCount, collectEquipment } from "../../engine/equipment.mjs";
import tables from "../../generated/tables.mjs";
import { buffs, conditions, description, int, resistances, resource, row, str } from "../fields.mjs";
import { conditionMods } from "../../engine/conditions.mjs";
import { applyMods, buffMods } from "../../engine/buffs.mjs";

const { SchemaField, ArrayField, StringField } = foundry.data.fields;

const { NumberField } = foundry.data.fields;
/** 일러스트 프레임: x·y = 보일 위치(%), s = 틀 너비 대비 배율. 비어 있으면 기본값(engine/art.mjs) */
const crop = () => new SchemaField({
  x: new NumberField({ required: false, nullable: true, initial: null }),
  y: new NumberField({ required: false, nullable: true, initial: null }),
  s: new NumberField({ required: false, nullable: true, initial: null })
});

/**
 * 능력치 하나의 저장값. 클래스·장비 보정은 저장하지 않고 계산한다.
 * temp: v0.6.0까지의 「일시」. 이제 쓰지 않고 GM 보너스에 합산해 보인다(편집 창에서 저장하면 bonus로 옮겨지고 0이 된다)
 */
const ability = () => new SchemaField({ base: int(0), growth: int(0), bonus: int(0), temp: int(0) });

export class CharacterData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      abilities: new SchemaField(Object.fromEntries(ABILITIES.map((k) => [k, ability()]))),
      abilityRolls: new ArrayField(int(0)),
      // 캐릭터 작성 기록(GM 열람): 능력치 굴리기 결과·배정·GM 수정. 잠그면 「굴림」은 GM만 고친다
      creation: new SchemaField({
        locked: new foundry.data.fields.BooleanField({ initial: false }),
        log: new ArrayField(new foundry.data.fields.ObjectField())
      }),
      level: int(1, { min: 1 }),
      exp: int(0, { min: 0 }),
      hp: resource(0),
      tp: resource(0),
      fp: new SchemaField({ value: int(1, { min: 0 }) }),
      mainClass: str(""),
      subClass: new StringField({ required: true, nullable: true, initial: null }),
      resist: resistances(),
      conditions: conditions(),
      buffs: buffs(),
      row: row(),
      order: int(0),
      money: int(0, { min: 0 }),
      // 일러스트: 전신(비우면 액터 이미지)·얼굴(비우면 전신에서 자름)·프레임(apps/art-config.mjs)
      art: new SchemaField({
        full: str(""),
        face: str(""),
        bustCrop: crop(),
        tokenCrop: crop(),
        faceCrop: crop(),
        // 만들어 둔 필드 토큰 그림(전열·후열 테두리)
        token: new SchemaField({ front: str(""), back: str("") })
      }),
      // GM이 보상으로 주는 스킬 보너스 SL(합계 SL 예산에 더한다)
      skillBonus: int(0),
      storageEnabled: new foundry.data.fields.BooleanField({ initial: false }),
      // GM이 파티에 넣는 동료 NPC(전투에서 아군 NPC로 행동)
      npc: new foundry.data.fields.BooleanField({ initial: false }),
      history: new ArrayField(new StringField()),
      description: description()
    };
  }

  /** v0.3.x까지의 abilities.str = 숫자 → { base: 숫자 } */
  static migrateData(source) {
    const a = source.abilities;
    if (a) for (const k of ABILITIES) if (typeof a[k] === "number") a[k] = { base: a[k], growth: 0, bonus: 0, temp: 0 };
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
    const items = this.parent?.items?.contents ?? [];
    // 장비(무기·방어구·장식·제련)와 소지만 해도 되는 기타 아이템의 보정. 효과에 의한 일시 보정은 단계 5
    const eq = collectEquipment(items, tables, {
      level: this.level,
      skillNames: items.filter((i) => i.type === "skill").map((i) => i.name)
    });
    this.equipment = eq;
    this.abilityParts = abilityBreakdown({
      abilities: this.abilities,
      classBonus: main?.system.abilityBonus ?? {},
      level: this.level,
      equip: Object.fromEntries(ABILITIES.map((k) => [k, eq.mods[`abilities.${k}`] ?? 0]))
    });
    this.abilityTotal = Object.fromEntries(ABILITIES.map((k) => [k, this.abilityParts[k].total]));
    const d = deriveCharacter({
      abilities: this.abilityTotal,
      level: this.level,
      weapon: eq.weapon ?? {},
      armor: { defense: eq.armorDefense },
      mods: eq.mods
    });
    // 내성: 저장값(기본 3, GM 지시로 변경) + 장비
    const resist = Object.fromEntries(RESISTS.map((k) => [k, (this.resist[k] ?? 0) + (eq.mods[`resist.${k}`] ?? 0)]));
    // 상태 이상·봉인·강화·약화(단계 5): 장비까지 더한 값 위에 적용. subBase는 시트 비교용
    this.subBase = d.sub;
    this.statusMods = { conditions: conditionMods(this.conditions), buffs: buffMods(this.buffs) };
    const m = applyMods({ sub: d.sub, resist, hpMax: d.hpMax }, [this.statusMods.conditions, this.statusMods.buffs]);
    this.resistTotal = m.resist;
    this.carried = carriedCount(items);
    this.bonus = d.bonus;
    this.sub = m.sub;
    this.carry = d.carry;
    this.hp.max = m.hpMax;
    this.tp.max = d.tpMax;
  }
}
