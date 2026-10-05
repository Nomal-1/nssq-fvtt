import { describe, expect, it } from "vitest";
import {
  applyAssignment, initialMoney, isValidAssignment, orderedAssignment, randomAssignment, rollAbilityScores
} from "../../src/engine/chargen.mjs";

describe("능력치 굴리기 (캐릭터 작성 §1)", () => {
  it("3D6을 5번, 굴린 순서대로", () => {
    const seq = [1, 2, 3, 6, 6, 6, 4, 4, 4, 1, 1, 1, 5, 5, 2];
    const r = rollAbilityScores(() => seq.shift());
    expect(r.map((x) => x.total)).toEqual([6, 18, 12, 3, 12]);
    expect(r[0].dice).toEqual([1, 2, 3]);
  });

  it("순서대로 배치", () => {
    expect(applyAssignment([14, 12, 10, 8, 6], orderedAssignment())).toEqual({ str: 14, tec: 12, vit: 10, agi: 8, luc: 6 });
  });

  it("랜덤 배치는 값을 옮기지 않고 자리만 바꾼다", () => {
    const totals = [14, 12, 10, 8, 6];
    for (let t = 0; t < 20; t++) {
      const slots = randomAssignment(Math.random);
      expect(isValidAssignment(slots)).toBe(true);
      expect(Object.values(applyAssignment(totals, slots)).sort((a, b) => b - a)).toEqual(totals);
    }
  });

  it("랜덤 배치는 주입한 난수를 쓴다", () => {
    expect(randomAssignment(() => 0)).toEqual([1, 2, 3, 4, 0]);
  });

  it("같은 값을 두 번 쓰는 배정은 거부", () => {
    expect(isValidAssignment([0, 0, 1, 2, 3])).toBe(false);
    expect(isValidAssignment([0, 1, 2, 3])).toBe(false);
    expect(() => applyAssignment([1, 2, 3, 4, 5], [0, 0, 1, 2, 3])).toThrow();
  });

  it("초기 소지금 = (100 − 합계) × 10G", () => {
    expect(initialMoney([14, 12, 10, 8, 6])).toBe(500);
  });
});
