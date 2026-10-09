import { describe, expect, it } from "vitest";
import { campAmbush, campRecovery, trapDamage } from "../../src/engine/explore.mjs";

describe("캠프·트랩(9-C)", () => {
  it("캠프 회복 = 시간 + Lv + 캠프 마스터, 요리면 2배", () => {
    expect(campRecovery({ hours: 6, level: 3 })).toEqual({ hp: 9, tp: 9 });
    expect(campRecovery({ hours: 8, level: 2, campHeal: 2, cookHp: true })).toEqual({ hp: 24, tp: 12 });
  });
  it("습격: 2D6 ≤ 위험도, 0이면 굴리지 않음", () => {
    expect(campAmbush([2, 2], 4)).toEqual({ rolled: true, ambush: true, total: 4 });
    expect(campAmbush([3, 2], 4).ambush).toBe(false);
    expect(campAmbush([1, 1], 0).rolled).toBe(false);
  });
  it("트랩: HP 레벨×3, TP 레벨×2", () => {
    expect(trapDamage(4, "hp")).toEqual({ hp: 12, tp: 0 });
    expect(trapDamage(4, "tp")).toEqual({ hp: 0, tp: 8 });
  });
});
