import { describe, expect, it } from "vitest";
import { LAYOUT, assignPartySlots, enemySlotX, formationPositions, partyRowSlots, partySlotX } from "../../src/engine/formation.mjs";

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
