import { describe, expect, it } from "vitest";
import tables from "../../src/generated/tables.mjs";
import {
  armorStats, buyPrice, canEquip, canRefine, carriedCount, collectEquipment, equipmentMaterialCandidates,
  equippedSlot, exceedsOwnLimit, itemMaterialCandidates, refinePrice, sellPrice, slotOccupant, slotsFor, weaponStats
} from "../../src/engine/equipment.mjs";

const weapon = (weaponType, rank = 1, extra = {}) => ({ id: `w${weaponType}${rank}`, type: "weapon", system: { weaponType, rank, slot: "weapon", equipped: false, refinements: [], element: "", ...extra } });
const armor = (armorType, rank = 1, extra = {}) => ({ id: `a${armorType}${rank}`, type: "armor", system: { armorType, rank, equipped: false, refinements: [], ...extra } });
const material = (materialType, rank, quantity = 1) => ({ id: `m${materialType}${rank}`, type: "material", system: { materialType, rank, quantity } });
const SWORDMAN = { weapons: ["단검", "검", "세검", "도끼"], armors: ["중갑", "경갑", "옷", "방패"] };
const MEDIC = { weapons: ["지팡이", "망치"], armors: ["경갑", "옷"] };
const ref = (name) => tables.refinements.find((r) => r.name === name);

describe("무기·방어구 성능 (R식)", () => {
  it("검 R3: 물리 공격 (R×3)+5 = 14, 가격 R²×100 = 900", () => {
    expect(weaponStats(tables.weapons["검"], { rank: 3 })).toMatchObject({ physAtk: 14, price: 900, physHit: 0, speed: 0 });
  });

  it("세검 R2: 물리 명중 +1, 속도 +3", () => {
    expect(weaponStats(tables.weapons["세검"], { rank: 2 })).toMatchObject({ physHit: 1, speed: 3, physAtk: 10 });
  });

  it("지팡이 R4: 속성 공격 R+3 = 7", () => {
    expect(weaponStats(tables.weapons["지팡이"], { rank: 4 }).elemAtk).toBe(7);
  });

  it("주먹은 Lv 기준, 《주먹 마스터리》면 (Lv×3)+4", () => {
    expect(weaponStats(tables.weapons["주먹"], { level: 3 }).physAtk).toBe(3);
    expect(weaponStats(tables.weapons["주먹"], { level: 3, hasAltSkill: true }).physAtk).toBe(13);
  });

  it("중갑 R2: 방어 9, 회피 −2, 속도 −6, 가격 480 / 방패 R2: 방어 (R+1)/2 = 1", () => {
    expect(armorStats(tables.armors["중갑"], { rank: 2 })).toMatchObject({ defense: 9, evasion: -2, speed: -6, price: 480 });
    expect(armorStats(tables.armors["방패"], { rank: 2 }).defense).toBe(1);
  });
});

describe("장비 가능 판정", () => {
  it("무기는 메인 또는 서브 클래스", () => {
    expect(canEquip(weapon("검"), { main: SWORDMAN, sub: null }).ok).toBe(true);
    expect(canEquip(weapon("지팡이"), { main: SWORDMAN, sub: null }).ok).toBe(false);
    expect(canEquip(weapon("지팡이"), { main: SWORDMAN, sub: MEDIC }).ok).toBe(true);
  });

  it("갑옷은 메인 클래스만", () => {
    expect(canEquip(armor("중갑"), { main: MEDIC, sub: SWORDMAN }).ok).toBe(false);
    expect(canEquip(armor("경갑"), { main: MEDIC, sub: null }).ok).toBe(true);
  });

  it("방패는 메인 또는 서브", () => {
    expect(canEquip(armor("방패"), { main: MEDIC, sub: null }).reason).toBe("shieldNotAllowed");
    expect(canEquip(armor("방패"), { main: MEDIC, sub: SWORDMAN }).ok).toBe(true);
  });

  it("장식은 클래스와 관계없이 가능, 클래스가 없으면 무기·방어구 불가", () => {
    expect(canEquip({ type: "accessory", system: {} }, { main: null, sub: null }).ok).toBe(true);
    expect(canEquip(weapon("검"), { main: null, sub: null }).reason).toBe("noClass");
  });

  it("슬롯: 무기→무기/기타, 방패·장식→기타, 갑옷→갑옷", () => {
    expect(slotsFor(weapon("검"))).toEqual(["weapon", "other"]);
    expect(slotsFor(armor("방패"))).toEqual(["other"]);
    expect(slotsFor(armor("옷"))).toEqual(["armor"]);
    expect(slotsFor({ type: "accessory", system: {} })).toEqual(["other"]);
    expect(slotsFor({ type: "consumable", system: {} })).toEqual([]);
  });

  it("기타 슬롯의 무기는 서브웨펀", () => {
    const items = [weapon("검", 1, { equipped: true }), weapon("단검", 1, { equipped: true, slot: "other" })];
    expect(equippedSlot(items[1])).toBe("other");
    expect(slotOccupant(items, "other")).toBe(items[1]);
    expect(slotOccupant(items, "armor")).toBeNull();
  });
});

describe("소지 수", () => {
  const backpack = { type: "tool", system: { key: "バックパック", quantity: 1, effects: [
    { type: "modifier", path: "carry", value: 4 }, { type: "flag", flag: "noCarryCount", value: true }, { type: "flag", flag: "ownLimit", value: 1 }] } };

  it("장비 중인 것은 세지 않고, 장비 안 한 무기·방어구는 센다. 수량만큼 센다", () => {
    const items = [weapon("검", 1, { equipped: true }), weapon("단검"), armor("옷"), material("풀", 1, 3),
      { type: "consumable", system: { quantity: 2 } }, { type: "skill", system: {} }, { type: "class", system: {} }];
    expect(carriedCount(items)).toBe(1 + 1 + 3 + 2);
  });

  it("백팩은 세지 않고, 2개째는 가질 수 없다", () => {
    expect(carriedCount([backpack])).toBe(0);
    expect(exceedsOwnLimit([backpack], backpack)).toBe(true);
    expect(exceedsOwnLimit([], backpack)).toBe(false);
  });

  it("백팩의 소지 한도 +4는 보정으로 모인다", () => {
    expect(collectEquipment([backpack], tables).mods.carry).toBe(4);
  });

  it("데이터의 백팩 효과가 위와 같다", async () => {
    const items = (await import("../../data/items.json", { with: { type: "json" } })).default;
    const bp = items.find((i) => i.name === "백팩");
    expect(carriedCount([bp])).toBe(0);
    expect(collectEquipment([bp], tables).mods.carry).toBe(4);
  });
});

describe("가격·매각", () => {
  it("무기·방어구는 R식, 매각은 50% 버림", () => {
    expect(buyPrice(weapon("검", 2), tables)).toBe(400);
    expect(sellPrice(weapon("검", 2), tables)).toBe(200);
    expect(buyPrice(armor("방패", 3), tables)).toBe(630);
    expect(sellPrice({ type: "consumable", system: { price: 25 } }, tables)).toBe(12);
  });

  it("소재 매각은 (R의 제곱)×50G", () => {
    expect(sellPrice(material("뼈", 3), tables)).toBe(450);
  });
});

describe("구입 소재", () => {
  const inv = [material("금속", 2), material("금속", 1), material("가죽", 5), material("풀", 4, 0)];
  it("무기: 대응 소재 중 R 이상", () => {
    expect(equipmentMaterialCandidates(inv, tables.weapons["검"], 2).map((m) => m.id)).toEqual(["m금속2"]);
    expect(equipmentMaterialCandidates(inv, tables.weapons["검"], 3)).toEqual([]);
  });
  it("아이템: 같은 종류 R 이상, 수량 0은 제외", () => {
    expect(itemMaterialCandidates(inv, { type: "가죽", rank: 4 }).length).toBe(1);
    expect(itemMaterialCandidates(inv, { type: "풀", rank: 4 })).toEqual([]);
  });
});

describe("제련", () => {
  it("2개까지, 같은 효과 중복 금지, 종류가 맞을 것", () => {
    const strUp = ref("【STR】+1");
    expect(canRefine(weapon("검"), strUp).ok).toBe(true);
    expect(canRefine(weapon("검", 1, { refinements: [strUp.key] }), strUp).reason).toBe("refineDuplicate");
    expect(canRefine(weapon("검", 1, { refinements: [strUp.key, ref("【물리 명중】+1").key] }), ref("〈염〉 속성 부여")).reason).toBe("refineFull");
    expect(canRefine(weapon("검"), ref("【방어】+1")).reason).toBe("refineKind");
    expect(canRefine(armor("옷"), ref("【방어】+1")).ok).toBe(true);
  });

  it("제련 가격은 R식", () => {
    expect(refinePrice(ref("【STR】+1"), 3)).toBe(450);
  });
});

describe("장비 보정 합산", () => {
  it("무기·갑옷·방패·장식·제련", () => {
    const items = [
      weapon("세검", 2, { equipped: true, refinements: [ref("【STR】+1").key] }),
      armor("경갑", 2, { equipped: true }),
      armor("방패", 3, { equipped: true }),
      { type: "accessory", system: { equipped: true, effects: [{ type: "modifier", path: "physHit", value: 2 }] } },
      { type: "accessory", system: { equipped: false, effects: [{ type: "modifier", path: "physHit", value: 9 }] } }
    ];
    const r = collectEquipment(items, tables);
    expect(r.weapon.physAtk).toBe(10);
    expect(r.armorDefense).toBe(6 + 2);
    expect(r.mods).toMatchObject({ physHit: 1 + 2, speed: 3 - 3 - 4, evasion: -1, "abilities.str": 1 });
  });

  it("서브웨펀은 성능·제련을 더하지 않는다(07 #21)", () => {
    const r = collectEquipment([weapon("세검", 2, { equipped: true, slot: "other" })], tables);
    expect(r.weapon).toBeNull();
    expect(r.mods).toEqual({});
  });

  it("속성 부여 제련은 imbue로 표시(07 #24)", () => {
    const r = collectEquipment([weapon("검", 1, { equipped: true, refinements: [ref("〈염〉 속성 부여").key] })], tables);
    expect(r.weapon.element).toBe("slash");
    expect(r.weapon.imbue).toBe("fire");
  });
});
