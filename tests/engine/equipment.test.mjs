import { describe, expect, it } from "vitest";
import tables from "../../src/generated/tables.mjs";
import {
  allocateMaterials, armorStats, isUsable, refinementBadge, useOnce, buyPrice, canEquip, canRefine, carriedCount, checkOverflowPlan, collectEquipment, equipmentMaterialCandidates, splitIncoming, stackKey,
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
  it("아이템: 같은 종류, R이 정확히 같을 것(07 #23), 수량 0은 제외", () => {
    expect(itemMaterialCandidates(inv, { type: "가죽", rank: 5 }).length).toBe(1);
    expect(itemMaterialCandidates(inv, { type: "가죽", rank: 4 })).toEqual([]);
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

  it("서브웨펀은 성능·제련을 더하지 않고, 무기 슬롯이 비었으니 맨손(07 #21·#20)", () => {
    const r = collectEquipment([weapon("세검", 2, { equipped: true, slot: "other" })], tables, { level: 2 });
    expect(r.weapon).toMatchObject({ unarmed: true, weaponType: "주먹", physAtk: 2, element: "strike" });
    expect(r.mods).toEqual({ physHit: 0, elemHit: 0, speed: 0 });
  });

  it("무기가 없으면 주먹: 물공 Lv, 《주먹 마스터리》면 (Lv×3)+4", () => {
    expect(collectEquipment([], tables, { level: 3 }).weapon.physAtk).toBe(3);
    expect(collectEquipment([], tables, { level: 3, skillNames: ["주먹 마스터리"] }).weapon.physAtk).toBe(13);
  });

  it("속성 부여 제련은 imbue로 표시(07 #24)", () => {
    const r = collectEquipment([weapon("검", 1, { equipped: true, refinements: [ref("〈염〉 속성 부여").key] })], tables);
    expect(r.weapon.element).toBe("slash");
    expect(r.weapon.imbue).toBe("fire");
  });
});

describe("창고·소지 수 초과", () => {
  const backpack = { id: "bp", type: "tool", system: { key: "バックパック", quantity: 1, effects: [
    { type: "modifier", path: "carry", value: 4 }, { type: "flag", flag: "noCarryCount", value: true }, { type: "flag", flag: "ownLimit", value: 1 }] } };

  it("창고에 있는 것은 소지 수에 들어가지 않는다", () => {
    const items = [material("풀", 1, 3), { ...material("뼈", 2, 2), system: { materialType: "뼈", rank: 2, quantity: 2, stored: true } }];
    expect(carriedCount(items)).toBe(3);
  });

  it("창고의 백팩은 한도를 늘리지 않고, 소지 개수 제한에도 세지 않는다", () => {
    const stored = { ...backpack, system: { ...backpack.system, stored: true } };
    expect(collectEquipment([stored], tables).mods.carry).toBeUndefined();
    expect(exceedsOwnLimit([stored], backpack)).toBe(false);
  });

  it("창고의 소재는 구입 재료 후보가 아니다", () => {
    const m = { id: "s", type: "material", system: { materialType: "금속", rank: 3, quantity: 1, stored: true } };
    expect(equipmentMaterialCandidates([m], tables.weapons["검"], 1)).toEqual([]);
  });

  it("정리 계획: 버리거나 창고로 보낸 만큼 빠지고, 한도 안이면 ok", () => {
    const items = [{ ...material("풀", 1, 3), id: "a" }, { ...weapon("검"), id: "b" }]; // 소지 4
    expect(checkOverflowPlan(items, 4, 1, {})).toMatchObject({ ok: false, need: 1 });
    expect(checkOverflowPlan(items, 4, 1, { a: { discard: 1 } }).ok).toBe(true);
    expect(checkOverflowPlan(items, 4, 2, { a: { discard: 1 }, b: { store: 1 } }).ok).toBe(true);
    // 가진 것보다 많이 버린다고 해도 가진 만큼만 빠진다
    expect(checkOverflowPlan(items, 4, 3, { b: { discard: 5 } })).toMatchObject({ ok: false, after: 6 });
  });

  it("새로 들어올 것 중 두고 가는 개수만큼 빠진다", () => {
    const items = [{ ...material("풀", 1, 4), id: "a" }]; // 소지 4, 한도 4
    expect(checkOverflowPlan(items, 4, 3, {}, 3).ok).toBe(true);
    expect(checkOverflowPlan(items, 4, 3, { a: { discard: 1 } }, 2).ok).toBe(true);
    expect(checkOverflowPlan(items, 4, 3, {}, 2)).toMatchObject({ ok: false, need: 1 });
  });

  it("splitIncoming: 수량을 쪼개 챙길 것·두고 갈 것으로 나눈다", () => {
    const loot = [material("가죽", 1, 3), weapon("검", 2)];
    const r = splitIncoming(loot, [1, 1]);
    expect(r.take.map((d) => [d.system.materialType ?? d.system.weaponType, d.system.quantity])).toEqual([["가죽", 2]]);
    expect(r.left.map((d) => [d.system.materialType ?? d.system.weaponType, d.system.quantity])).toEqual([["가죽", 1], ["검", 1]]);
    expect(splitIncoming(loot, []).left).toEqual([]);
  });

  it("쌓기 키: 소재는 종류+R, 소모품·기타는 key, 장비는 쌓지 않는다", () => {
    expect(stackKey(material("풀", 2))).toBe("material:풀:2");
    expect(stackKey({ type: "consumable", system: { key: "メディカ" } })).toBe("consumable:メディカ");
    expect(stackKey(weapon("검"))).toBeNull();
  });
});

describe("소재 배정(수량 구입)", () => {
  const m = (id, rank, quantity) => ({ id, type: "material", system: { materialType: "금속", rank, quantity } });
  it("R이 낮은 것부터 필요한 개수만큼", () => {
    const r = allocateMaterials([m("a", 3, 1), m("b", 1, 2), m("c", 2, 5)], 4);
    expect(r.map((x) => [x.item.id, x.n])).toEqual([["b", 2], ["c", 2]]);
  });
  it("모자라면 null", () => {
    expect(allocateMaterials([m("a", 1, 2)], 3)).toBeNull();
  });
  it("이미 배정한 개수는 빼고 센다", () => {
    expect(allocateMaterials([m("a", 1, 2)], 2, { a: 1 })).toBeNull();
    expect(allocateMaterials([m("a", 1, 2)], 1, { a: 1 }).map((x) => x.n)).toEqual([1]);
  });
});

describe("사용(n회분)", () => {
  const nails = (quantity, value) => ({ type: "tool", system: { quantity, consumable: true, uses: { value, max: 5 } } });
  it("못·쐐기 5개 세트: 횟수만 줄고, 다 쓰면 수량 −1·횟수 다시 5", () => {
    expect(useOnce(nails(2, 5))).toEqual({ quantity: 2, usesValue: 4, remove: false });
    expect(useOnce(nails(2, 1))).toEqual({ quantity: 1, usesValue: 5, remove: false });
    expect(useOnce(nails(1, 1))).toEqual({ quantity: 0, usesValue: 0, remove: true });
  });
  it("횟수가 없으면 수량 −1, 0이면 없어진다", () => {
    expect(useOnce({ type: "consumable", system: { quantity: 3 } })).toEqual({ quantity: 2, usesValue: null, remove: false });
    expect(useOnce({ type: "consumable", system: { quantity: 1 } }).remove).toBe(true);
  });
  it("[사용] 대상: 소모품, 「소모품」 기타 아이템, 횟수 있는 것. 로프·창고 안의 것은 아님", () => {
    expect(isUsable({ type: "consumable", system: {} })).toBe(true);
    expect(isUsable({ type: "tool", system: { consumable: true } })).toBe(true);
    expect(isUsable({ type: "tool", system: { consumable: false, uses: { max: 0 } } })).toBe(false);
    expect(isUsable({ type: "consumable", system: { stored: true } })).toBe(false);
  });
  it("데이터: 못·쐐기 5회, 횃불·기름은 소모품, 10m 로프는 아님", async () => {
    const items = (await import("../../data/items.json", { with: { type: "json" } })).default;
    const by = (n) => items.find((i) => i.name === n);
    expect(by("못·쐐기").system.uses).toEqual({ value: 5, max: 5 });
    expect(isUsable(by("횃불"))).toBe(true);
    expect(isUsable(by("기름(작은 병)"))).toBe(true);
    expect(isUsable(by("10m 로프"))).toBe(false);
  });
});

describe("제련 배지", () => {
  it("모든 제련 효과가 배지로 표시된다(other 없음)", () => {
    for (const r of tables.refinements) expect(refinementBadge(r).kind, r.name).not.toBe("other");
  });
  it("종류별", () => {
    expect(refinementBadge(ref("【STR】+1"))).toEqual({ kind: "ability", key: "str", value: 1 });
    expect(refinementBadge(ref("【속도】+2"))).toEqual({ kind: "sub", key: "speed", value: 2 });
    expect(refinementBadge(ref("〈빙〉 내성+1"))).toEqual({ kind: "resist", key: "ice", value: 1 });
    expect(refinementBadge(ref("〈뇌〉 속성 부여"))).toEqual({ kind: "imbue", key: "volt" });
  });
});
