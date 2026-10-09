import { describe, expect, it } from "vitest";
import { dropFor, judgeDrop, partyDropSkills } from "../../src/engine/loot.mjs";

const drops = [{ min: 4, max: 7, item: "이빨", rank: 1 }, { min: 8, max: null, item: "가죽", rank: 1 }];

describe("드롭 판정(9-A)", () => {
  it("달성값으로 줄을 고른다(3 이하는 없음, max null은 그 이상)", () => {
    expect(dropFor(drops, 3)).toBeNull();
    expect(dropFor(drops, 4).item).toBe("이빨");
    expect(dropFor(drops, 12).item).toBe("가죽");
  });
  it("조작 ±·더블 랭크 +1", () => {
    expect(judgeDrop({ drops, dice: [1, 2], adjust: 1 }).drop.item).toBe("이빨");
    const r = judgeDrop({ drops, dice: [4, 4], doubleUp: true });
    expect([r.drop.item, r.rank, r.doubled]).toEqual(["가죽", 2, true]);
    expect(judgeDrop({ drops, dice: [4, 4] }).rank).toBe(1);
  });
  it("파티 스킬: 범위는 가장 넓은 것 하나, 사냥꾼의 후각은 사람마다", () => {
    const party = [
      { uuid: "a", name: "가", skills: [{ name: "스캐빈저", sl: 1, effects: [{ type: "dropAdjust", range: 1 }] }, { name: "사냥꾼의 후각", sl: 2, effects: [{ type: "dropExtra", count: "SL", choices: ["고기", "생선", "알"] }] }] },
      { uuid: "b", name: "나", skills: [{ name: "해체 마스터", sl: 3, effects: [{ type: "dropAdjust", range: "SL" }] }, { name: "풍작 기원", sl: 1, effects: [{ type: "dropDoubleUp" }] }] }
    ];
    const r = partyDropSkills(party);
    expect(r.range).toBe(3);
    expect(r.rangeBy).toEqual(["나《해체 마스터》"]);
    expect(r.doubleUp).toEqual(["나《풍작 기원》"]);
    expect(r.extras).toEqual([{ uuid: "a", name: "가", skill: "사냥꾼의 후각", count: 2, choices: ["고기", "생선", "알"] }]);
  });
});
