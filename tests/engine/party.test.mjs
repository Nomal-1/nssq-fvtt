import { describe, expect, it } from "vitest";
import { balanceRows, draftFromUnits, sameDraft, validateFormation } from "../../src/engine/party.mjs";

describe("파티 편성안", () => {
  it("검사: 열 3명 초과·정원 초과·빈 편성·중복", () => {
    expect(validateFormation({ front: ["a", "b", "c"], back: ["d", "e", null] }, 5)).toEqual([]);
    expect(validateFormation({ front: ["a", "b", "c", "d"], back: [] }, 5)).toContain("rowOver.front");
    expect(validateFormation({ front: ["a", "b", "c"], back: ["d", "e", "f"] }, 5)).toContain("overMax");
    expect(validateFormation({ front: ["a", "b", "c"], back: ["d", "e", "f"] }, 6)).toEqual([]);
    expect(validateFormation({ front: [null, null, null], back: [null, null, null] }, 5)).toEqual(["empty"]);
    expect(validateFormation({ front: ["a", "a", null], back: [] }, 5)).toEqual(["duplicate"]);
  });
  it("전위 5명이면 넘치는 둘은 후위로", () => {
    const units = ["a", "b", "c", "d", "e"].map((id, i) => ({ id, row: "front", order: i }));
    const d = draftFromUnits(units);
    expect(d.front).toEqual(["a", "b", "c"]);
    expect(d.back).toEqual(["d", "e", null]);
    const moves = balanceRows(units);
    expect(moves.filter((m) => m.row === "back").map((m) => m.id)).toEqual(["d", "e"]);
    expect(balanceRows([{ id: "a", row: "front", order: 0 }])).toEqual([]);
    expect(sameDraft(d, { front: ["a", "b", "c"], back: ["d", "e", null] })).toBe(true);
  });
});
