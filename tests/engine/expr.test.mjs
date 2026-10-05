import { describe, expect, it } from "vitest";
import { evaluate } from "../../src/engine/expr.mjs";
import weapons from "../../data/weapons.json" with { type: "json" };
import armors from "../../data/armors.json" with { type: "json" };
import refinements from "../../data/refinements.json" with { type: "json" };

describe("수식 평가기 (03 §1)", () => {
  it("사칙연산과 우선순위", () => {
    expect(evaluate("1+2*3")).toBe(7);
    expect(evaluate("(1+2)*3")).toBe(9);
    expect(evaluate("-4")).toBe(-4);
    expect(evaluate("-(5-SL)", { SL: 2 })).toBe(-3);
  });

  it("나눗셈은 항상 버림", () => {
    expect(evaluate("SL/2", { SL: 3 })).toBe(1);
    expect(evaluate("(R+1)/2", { R: 2 })).toBe(1);
    expect(evaluate("-3/2")).toBe(-2);
  });

  it("변수는 대소문자를 가리지 않는다(Lv, LV)", () => {
    expect(evaluate("(Lv*3)+4", { LV: 2 })).toBe(10);
    expect(evaluate("(LV*3)+4", { Lv: 2 })).toBe(10);
  });

  it("함수", () => {
    expect(evaluate("max(1, SL*2, 3)", { SL: 4 })).toBe(8);
    expect(evaluate("min(5, abs(-7))")).toBe(5);
    expect(evaluate("floor(7/2)")).toBe(3);
  });

  it("@경로", () => {
    expect(evaluate("@self.suppAtk + 7 + SL", { SL: 1, self: { suppAtk: 4 } })).toBe(12);
  });

  it("숫자·빈 값", () => {
    expect(evaluate(5)).toBe(5);
    expect(evaluate(null)).toBe(0);
    expect(evaluate("")).toBe(0);
  });

  it("잘못된 수식·없는 변수는 오류", () => {
    expect(() => evaluate("1 +")).toThrow();
    expect(() => evaluate("R*2")).toThrow(/R/);
    expect(() => evaluate("alert(1)")).toThrow();
  });

  it("장비·제련 표의 모든 식을 R 1~15에서 계산할 수 있다", () => {
    const formulas = [
      ...weapons.flatMap((w) => Object.entries(w.system.table).filter(([k]) => !["category", "range", "elementChoice", "materials", "physAtkAlt"].includes(k)).map(([, v]) => v)),
      ...weapons.filter((w) => w.system.table.physAtkAlt).map((w) => w.system.table.physAtkAlt.formula),
      ...armors.flatMap((a) => Object.entries(a.system.table).filter(([k]) => k !== "materials").map(([, v]) => v)),
      ...refinements.map((r) => r.price)
    ];
    for (const f of formulas) for (let R = 1; R <= 15; R++) expect(Number.isInteger(evaluate(f, { R, LV: R })), f).toBe(true);
  });

  it("원문 예시 값", () => {
    expect(evaluate("(R*3)+5", { R: 3 })).toBe(14); // 검 R3 물리 공격
    expect(evaluate("(R*R)*100", { R: 3 })).toBe(900); // 검 R3 가격
  });
});
