import { describe, expect, it } from "vitest";
import { LAYOUT, assignPartySlots, enemySlotX, formationPositions, partyRowSlots, partySlotX, shuffleFormation } from "../../src/engine/formation.mjs";

describe("파티 칸", () => {
  it("칸 0·1·2는 가운데를 기준으로 좌·중·우", () => {
    expect(partySlotX(1)).toBe(LAYOUT.width / 2);
    expect(partySlotX(0)).toBe(LAYOUT.width / 2 - LAYOUT.spacing);
    expect(partySlotX(2)).toBe(LAYOUT.width / 2 + LAYOUT.spacing);
  });

  it("저장된 칸을 지키고, 겹치면 빈 칸을 준다", () => {
    const r = assignPartySlots([
      { id: "a", row: "front", order: 1 }, { id: "b", row: "front", order: 1 }, { id: "c", row: "back", order: 0 }
    ]);
    expect(r.slots.a).toEqual({ row: "front", index: 1 });
    expect(r.slots.b).toEqual({ row: "front", index: 0 });
    expect(r.slots.c).toEqual({ row: "back", index: 0 });
  });

  it("한 열에 3명을 넘으면 다른 열로, 둘 다 차면 overflow", () => {
    const four = ["a", "b", "c", "d"].map((id, i) => ({ id, row: "front", order: i }));
    const r = assignPartySlots(four);
    expect(r.moved).toEqual(["d"]);
    expect(r.slots.d.row).toBe("back");
    const seven = Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, row: "front", order: i }));
    expect(assignPartySlots(seven).overflow).toEqual(["p6"]);
  });

  it("열의 칸 상태: 자기 자리는 빈 칸으로 본다", () => {
    const units = [{ id: "a", row: "front", order: 0 }, { id: "b", row: "front", order: 2 }];
    expect(partyRowSlots(units, "front", "a")).toEqual([
      { index: 0, occupant: "a", free: true }, { index: 1, occupant: null, free: true }, { index: 2, occupant: "b", free: false }
    ]);
  });
});

describe("에너미 줄", () => {
  it("한 체면 가운데, 여럿이면 가운데 정렬", () => {
    expect(enemySlotX(0, 1)).toBe(LAYOUT.width / 2);
    expect(enemySlotX(0, 2) + enemySlotX(1, 2)).toBe(LAYOUT.width);
  });
  it("많으면 간격을 좁혀 폭 안에 들어간다", () => {
    const n = 20;
    const span = enemySlotX(n - 1, n) - enemySlotX(0, n);
    expect(span).toBeLessThanOrEqual(LAYOUT.maxRowWidth + 1e-9);
  });
});

describe("진형 좌표", () => {
  it("파티는 아래 두 줄, 에너미는 위 두 줄. 에너미는 order 순", () => {
    const pos = formationPositions({
      party: [{ id: "p1", row: "front", order: 0 }, { id: "p2", row: "back", order: 2 }],
      enemies: [{ id: "e2", row: "front", order: 1 }, { id: "e1", row: "front", order: 0 }, { id: "e3", row: "back" }]
    });
    expect(pos.p1).toMatchObject({ y: LAYOUT.lanes.partyFront, index: 0 });
    expect(pos.p2).toMatchObject({ y: LAYOUT.lanes.partyBack, index: 2 });
    expect(pos.e1.x).toBeLessThan(pos.e2.x);
    expect(pos.e3).toMatchObject({ y: LAYOUT.lanes.enemyBack, x: LAYOUT.width / 2 });
  });
});

describe("전후열 섞기", () => {
  const units = [
    { id: "a", row: "front", order: 0 }, { id: "b", row: "front", order: 1 },
    { id: "c", row: "back", order: 0 }, { id: "d", row: "back", order: 1, ko: true }
  ];
  const seq = (...xs) => { let i = 0; return () => xs[i++ % xs.length]; };
  it("flip: 열만 맞바꾸고 칸은 그대로", () => {
    expect(shuffleFormation(units, { mode: "flip" })).toEqual([
      { id: "a", row: "back", order: 0 }, { id: "b", row: "back", order: 1 },
      { id: "c", row: "front", order: 0 }, { id: "d", row: "front", order: 1 }
    ]);
  });
  it("파티(3칸): 칸이 겹치지 않고 열마다 3명 이하", () => {
    for (let k = 0; k < 50; k++) {
      const r = shuffleFormation(units, { slotsPerRow: 3 });
      const keys = r.map((o) => `${o.row}:${o.order}`);
      expect(new Set(keys).size).toBe(units.length);
      expect(r.every((o) => o.order >= 0 && o.order < 3)).toBe(true);
    }
  });
  it("살아 있는 전투원이 있으면 전열이 비지 않는다", () => {
    for (let k = 0; k < 100; k++) {
      const r = shuffleFormation(units, { slotsPerRow: 3 });
      expect(r.some((o) => o.row === "front" && o.id !== "d")).toBe(true);
      const e = shuffleFormation(units);
      expect(e.some((o) => o.row === "front" && o.id !== "d")).toBe(true);
    }
  });
  it("에너미(칸 제한 없음): 모두 후열로 나와도 하나를 전열로", () => {
    const r = shuffleFormation(units, { rng: seq(0.9, 0.9, 0.9, 0.9, 0.9, 0.1) });
    expect(r.filter((o) => o.row === "front").length).toBeGreaterThan(0);
  });
});
