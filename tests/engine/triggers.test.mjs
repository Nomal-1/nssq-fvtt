import { describe, expect, it } from "vitest";
import { autoRuns, canChaseAfter, canCounterAfter, findReactions, spendStance } from "../../src/engine/triggers.mjs";

const trap = { id: "s1", key: "trap", effects: [{ type: "counter", on: "rowAttacked", when: { attackKind: "physical" }, attack: { kind: "physical", diceMod: "-(4-SL)" } }], left: 3 };
const chaser = { id: "s2", key: "rush", effects: [{ type: "chase", on: "anyAttack", when: { attackKind: "physical" }, attack: { kind: "physical" } }], left: 3 };
const pc = (id, x = {}) => ({ id, side: "pc", row: "front", uuid: `A.${id}`, stances: [], buffs: [], ...x });
const foe = { id: "e1", side: "enemy", row: "front", uuid: "A.e1", stances: [], buffs: [] };
const ev = (kind, x = {}) => ({ kind, attackerId: "e1", attackerUuid: "A.e1", attackerSide: "enemy", attackerRow: "front", attackKind: "physical", elements: ["slash"], category: "", targets: [{ id: "p1", side: "pc", row: "front", hit: true }], ...x });

describe("연쇄 금지(01 §3.11, 05 완료 기준)", () => {
  it("반격의 반격 없음, 추격에 대한 반격 있음, 추격의 추격·반격의 추격 없음", () => {
    expect(canCounterAfter("counter")).toBe(false);
    expect(canCounterAfter("chase")).toBe(true);
    expect(canChaseAfter("chase")).toBe(false);
    expect(canChaseAfter("counter")).toBe(false);
    expect(canChaseAfter("normal")).toBe(true);
  });

  it("《트래핑》 대기 중: 에너미 통상 공격·추격에는 반격, 반격에는 반격하지 않음", () => {
    const units = [pc("p1", { stances: [trap] }), foe];
    expect(findReactions(ev("normal"), units)).toEqual([expect.objectContaining({ unitId: "p1", type: "counter", target: "e1" })]);
    expect(findReactions(ev("chase"), units)).toHaveLength(1);
    expect(findReactions(ev("counter"), units)).toHaveLength(0);
  });

  it("같은 열 아군이 맞아도 반격(rowAttacked), 다른 열이면 없음, 속성 공격이면 없음", () => {
    const units = [pc("p1"), pc("p2", { stances: [trap] }), foe];
    expect(findReactions(ev("normal"), units)).toHaveLength(1);
    expect(findReactions(ev("normal"), [pc("p1"), pc("p2", { row: "back", stances: [trap] }), foe])).toHaveLength(0);
    expect(findReactions(ev("skill", { attackKind: "elemental" }), units)).toHaveLength(0);
  });

  it("추격: 아군이 적을 공격하면 추격, 그 추격·반격에는 다시 추격하지 않음", () => {
    const atk = (kind) => ({ kind, attackerId: "p1", attackerUuid: "A.p1", attackerSide: "pc", attackerRow: "front", attackKind: "physical", elements: [], category: "", targets: [{ id: "e1", side: "enemy", row: "front", hit: true }] });
    const units = [pc("p1"), pc("p2", { stances: [chaser] }), foe];
    expect(findReactions(atk("normal"), units)).toEqual([expect.objectContaining({ unitId: "p2", type: "chase", target: "e1" })]);
    expect(findReactions(atk("chase"), units)).toHaveLength(0);
    expect(findReactions(atk("counter"), units)).toHaveLength(0);
  });

  it("『추격: ○』 강화는 ○가 공격하면 선택 추격, 자동 사용을 켜면 자동", () => {
    const atk = { kind: "skill", attackerId: "p1", attackerUuid: "A.p1", attackerSide: "pc", attackerRow: "front", attackKind: "physical", elements: [], category: "", targets: [{ id: "e1", side: "enemy", row: "front", hit: true }] };
    const p2 = pc("p2", { buffs: [{ id: "chase", param: "A.p1" }] });
    const [r] = findReactions(atk, [pc("p1"), p2, foe]);
    expect(r).toEqual(expect.objectContaining({ unitId: "p2", optional: true }));
    expect(autoRuns(r, p2)).toBe(false);
    expect(autoRuns(r, { ...p2, autoTrigger: { chaseBuff: true } })).toBe(true);
  });

  it("대기 상태 횟수: 누적 n회면 끝", () => {
    expect(spendStance([trap], "s1")[0].left).toBe(2);
    expect(spendStance([{ ...trap, left: 1 }], "s1")).toEqual([]);
  });
});
