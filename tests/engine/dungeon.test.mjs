import { describe, expect, it } from "vitest";
import { eventFor, timeOfDayAt } from "../../src/engine/dungeon.mjs";

describe("랜덤 던전(9-D)", () => {
  it("이벤트표", () => {
    expect(eventFor(3)).toMatchObject({ kind: "battle", foe: true, levelPlus: 4 });
    expect(eventFor(10)).toMatchObject({ kind: "gather", rankPlus: 1 });
    expect(eventFor(12).kind).toBe("gold");
  });
  it("낮·밤", () => {
    expect([timeOfDayAt(6), timeOfDayAt(17), timeOfDayAt(18), timeOfDayAt(5), timeOfDayAt(24)]).toEqual(["day", "day", "night", "night", "night"]);
  });
});
