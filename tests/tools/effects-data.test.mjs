import { describe, expect, it } from "vitest";
import { checkAll, checkEffects } from "../../tools/lib/effects-check.mjs";

describe("효과 데이터 검사(단계 7)", () => {
  it("모든 데이터의 effects가 스키마와 맞다", () => {
    expect(checkAll().errors).toEqual([]);
  });

  it("잘못된 것을 잡는다", () => {
    const errs = checkEffects([
      { type: "atack" },
      { type: "buff", id: "nope" },
      { type: "debuff", id: "atkUp" },
      { type: "inflict", condition: "poison", check: { type: "fixed", target: "SL+" } },
      { type: "modifier", path: "foo", value: 1 },
      { type: "attack", when: { bogus: true } }
    ], "t");
    expect(errs).toHaveLength(6);
  });
});
