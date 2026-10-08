import { describe, expect, it } from "vitest";
import { autoRuns, canChaseAfter, canCounterAfter, findHitTriggers, findReactions, spendStance } from "../../src/engine/triggers.mjs";
import { extendDamage } from "../../src/engine/combat.mjs";

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

  it("《삼색 체이스》: 속성별 효과가 여럿이어도 공격 하나에 추격 1번", () => {
    const tri = { id: "s3", key: "tri", left: 3, effects: ["fire", "ice"].map((el) => ({ type: "chase", when: { element: [el] }, attack: { kind: "physical" } })) };
    const atk = { kind: "skill", attackerId: "p1", attackerSide: "pc", attackKind: "elemental", elements: ["fire", "ice"], category: "술식", targets: [{ id: "e1", side: "enemy", row: "front", hit: true }] };
    expect(findReactions(atk, [pc("p1"), pc("p2", { stances: [tri] }), foe])).toHaveLength(1);
  });

  it("《링크 오더》: 선언한 적에게 〈염〉〈빙〉〈뇌〉 공격이 가해지면 같은 속성으로 추격", () => {
    const link = { id: "s4", key: "link", left: 1, guardTargets: ["e1"], effects: [{ type: "chase", on: "targetAttacked", when: { element: ["fire", "ice", "volt"] }, attack: { kind: "elemental", copyElement: true, diceMod: "SL" } }] };
    const atk = (target, elements) => ({ kind: "skill", attackerId: "p1", attackerSide: "pc", attackKind: "elemental", elements, category: "술식", targets: [{ id: target, side: "enemy", row: "front", hit: true }] });
    const units = [pc("p1"), pc("p2", { stances: [link] }), foe];
    expect(findReactions(atk("e1", ["ice", "slash"]), units)).toEqual([expect.objectContaining({ unitId: "p2", target: "e1", attack: expect.objectContaining({ element: ["ice"] }) })]);
    expect(findReactions(atk("e2", ["ice"]), units)).toHaveLength(0);
    expect(findReactions(atk("e1", ["slash"]), units)).toHaveLength(0);
  });

  it("명중·크리티컬 시 발동: 크리티컬 대상마다, perAction은 1번, 추격에서는 추격형 없음", () => {
    const me = { id: "p1", side: "pc", triggers: [
      { key: "stun", name: "스턴 어택", on: "crit", effects: [{ type: "inflict", condition: "stun" }] },
      { key: "ryu", name: "아류 살법", on: "crit", limit: "perAction", effects: [{ type: "attack", kind: "physical" }] },
      { key: "tp", name: "무사의 마음가짐", on: "selfHit", when: { category: "" }, effects: [{ type: "resource", resource: "tp", delta: 1, toSelf: true }] },
      { key: "gain", name: "풀 게인", on: "selfHit", optional: true, when: { attackKind: "physical" }, effects: [{ type: "attackBonus", diceMod: 10 }] }
    ] };
    const t = (id, x) => ({ id, side: "enemy", row: "front", hit: true, crit: false, ...x });
    const ev2 = (kind, category) => ({ kind, attackerId: "p1", attackerSide: "pc", attackKind: "physical", elements: [], category, targets: [t("e1", { crit: true }), t("e2", { crit: true }), t("e3", { hit: false })] });
    const names = (l) => l.map((x) => `${x.name}:${x.target}`);
    expect(names(findHitTriggers(ev2("normal", ""), me))).toEqual(["스턴 어택:e1", "스턴 어택:e2", "아류 살법:e1", "무사의 마음가짐:e1", "풀 게인:e1", "풀 게인:e2"]);
    expect(names(findHitTriggers(ev2("chase", "-"), me))).toEqual(["스턴 어택:e1", "스턴 어택:e2", "풀 게인:e1", "풀 게인:e2"]);
  });

  it("대미지 다이스 추가: 더한 눈도 크리티컬을 다시 보고, 절반이면 절반", async () => {
    const seq = [[6, 2, 3], [5, 5, 5, 5]];
    const roll = async () => seq.shift();
    const r = await extendDamage({ dice: [6, 4], resist: 3, crit: false, raw: 2, halves: 1 }, 3, roll);
    expect(r).toEqual(expect.objectContaining({ crit: true, raw: 2 + 1 + 4, final: 3, add: 3 - 1 }));
  });
});
