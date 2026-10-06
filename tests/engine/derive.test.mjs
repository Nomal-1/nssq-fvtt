import { describe, expect, it } from "vitest";
import { abilityBreakdown, bonus, deriveCharacter } from "../../src/engine/derive.mjs";

describe("능력치 보너스", () => {
  it("floor(x/5)", () => {
    expect(bonus(4)).toBe(0);
    expect(bonus(5)).toBe(1);
    expect(bonus(14)).toBe(2);
    expect(bonus(18)).toBe(3);
  });
});

describe("부능력치 (01 §1.2)", () => {
  const abilities = { str: 14, tec: 9, vit: 12, agi: 11, luc: 7 }; // B: 2 1 2 2 1
  const d = deriveCharacter({ abilities, level: 1, weapon: { physAtk: 8, elemAtk: 0 }, armor: { defense: 3 } });

  it("HP·TP·소지 한도", () => {
    expect(d.hpMax).toBe(2 * 2 + 1 + 5);
    expect(d.tpMax).toBe(1 + 1 + 3);
    expect(d.carry).toBe(2 + 2 + 3);
  });

  it("명중·회피·공격·방어·억제", () => {
    expect(d.sub.physHit).toBe(2);
    expect(d.sub.elemHit).toBe(1);
    expect(d.sub.evasion).toBe(Math.floor(3 / 2) + 5);
    expect(d.sub.physAtk).toBe(10);
    expect(d.sub.elemAtk).toBe(1);
    expect(d.sub.defense).toBe(3);
    expect(d.sub.suppAtk).toBe(1);
    expect(d.sub.suppDef).toBe(1);
    expect(d.sub.speed).toBe(11);
  });

  it("【속도】가 음수가 되면 0", () => {
    expect(deriveCharacter({ abilities: { agi: 3 }, level: 1, mods: { speed: -5 } }).sub.speed).toBe(0);
  });
});

describe("능력치 출처별 합계", () => {
  const abilities = { str: { base: 15, growth: 1, bonus: -2 }, tec: { base: 13 }, vit: { base: 11 }, agi: { base: 9 }, luc: { base: 8 } };
  const classBonus = { str: 7, tec: 3, vit: 6, agi: 5, luc: 4 }; // 소드맨

  it("Lv1: 굴림 + 클래스 보정 + 성장 + GM 보너스 + 장비", () => {
    const b = abilityBreakdown({ abilities, classBonus, level: 1, equip: { str: 3 } });
    expect(b.str).toEqual({ base: 15, class: 7, growth: 1, bonus: -2, equip: 3, total: 24 });
    expect(b.luc.total).toBe(12);
  });

  it("v0.6.0의 「일시」(temp) 값은 GM 보너스에 합산된다", () => {
    const b = abilityBreakdown({ abilities: { str: { base: 10, bonus: 1, temp: 2 } } });
    expect(b.str.bonus).toBe(3);
    expect(b.str.total).toBe(13);
    expect(b.str).not.toHaveProperty("temp");
  });

  it("클래스 보정은 레벨마다 더해진다(보정 × Lv)", () => {
    expect(abilityBreakdown({ abilities, classBonus, level: 3 }).tec).toMatchObject({ class: 9, total: 22 });
  });

  it("클래스가 없으면 0", () => {
    expect(abilityBreakdown({ abilities, level: 5 }).agi.total).toBe(9);
  });
});

describe("GM 보너스", () => {
  it("보너스도 최종값에 더한다", () => {
    const b = abilityBreakdown({ abilities: { str: { base: 10, bonus: 2 } } });
    expect(b.str).toMatchObject({ bonus: 2, total: 12 });
  });
});

describe("부능력치 계산 내역·성장", () => {
  const abilities = { str: 15, tec: 13, vit: 11, agi: 9, luc: 8 };
  it("내역의 합계는 deriveCharacter와 같고, 장비 보정은 따로 보인다", async () => {
    const { subStatBreakdown } = await import("../../src/engine/derive.mjs");
    const p = { abilities, level: 1, weapon: { physAtk: 14 }, armor: { defense: 5 }, mods: { physHit: 1 } };
    const b = subStatBreakdown(p);
    const d = deriveCharacter(p);
    for (const k of Object.keys(d.sub)) expect(b[k].total, k).toBe(d.sub[k]);
    expect(b.physAtk.parts).toEqual([{ label: "str", value: 3 }, { label: "weapon", value: 14 }]);
    expect(b.physHit.parts.at(-1)).toEqual({ label: "mods", value: 1 });
  });
  it("성장: 경험점 10마다 1회, 이미 올린 만큼 뺀다", async () => {
    const { growthAvailable, growthAbility } = await import("../../src/engine/derive.mjs");
    expect(growthAvailable({ exp: 25, abilities: { str: { growth: 1 } } })).toEqual({ earned: 2, used: 1, left: 1 });
    expect(growthAvailable({ exp: 9, abilities: { str: { growth: 2 } } }).left).toBe(0);
    expect([1, 2, 3, 4, 5, 6].map(growthAbility)).toEqual(["str", "tec", "vit", "agi", "luc", null]);
  });
});
