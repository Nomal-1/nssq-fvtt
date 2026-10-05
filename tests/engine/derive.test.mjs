import { describe, expect, it } from "vitest";
import { bonus, deriveCharacter } from "../../src/engine/derive.mjs";

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
