import { describe, expect, it } from "vitest";
import { endPhaseFor } from "../../src/engine/end-phase.mjs";

const rolls = (...pairs) => () => {
  if (!pairs.length) throw new Error("주사위 부족");
  return pairs.shift();
};

describe("종료 페이즈", () => {
  it("순서: 독 → 리젠 → 자연 회복 → 강화 턴 감소 → 심도 감소", async () => {
    const r = await endPhaseFor({
      hp: { value: 10, max: 14 }, tp: { value: 2, max: 7 }, suppDef: 3,
      conditions: [{ id: "poison", depth: 12, sourceSuppAtk: 4 }, { id: "bindArm", depth: 5 }],
      buffs: [{ id: "hpRegen", value: 2, turns: 1 }, { id: "tpRegen", value: 1, turns: 2 }]
    }, rolls([2, 3], [1, 2]));
    expect(r.log.map((l) => l.step)).toEqual(["poison", "effects", "effects", "recovery", "recovery", "buffs", "depth"]);
    // 독 4 → 6, 리젠 2 → 8
    expect(r.hp).toBe(8);
    expect(r.tp).toBe(3);
    // 독: 2+3+3=8 < 12 실패, [팔] 봉인: 1+2+3=6 ≥ 5 성공 → 소멸
    expect(r.conditions).toEqual([{ id: "poison", depth: 11, sourceSuppAtk: 4 }]);
    expect(r.buffs).toEqual([{ id: "tpRegen", value: 1, turns: 1 }]);
  });

  it("독 대미지는 건 자의 현재 【억제 공격】(있으면)", async () => {
    const r = await endPhaseFor({ hp: { value: 10, max: 10 }, suppDef: 0, conditions: [{ id: "poison", depth: 20, sourceSuppAtk: 4 }], buffs: [], poisonPower: () => 7 }, rolls([1, 1]));
    expect(r.hp).toBe(3);
  });

  it("[석화]는 자연 회복·심도 감소 없음, [스턴]은 그 턴에 소멸, 심도는 0에서 멈춤", async () => {
    const r = await endPhaseFor({
      hp: { value: 5, max: 5 }, suppDef: -10,
      conditions: [{ id: "petrify", depth: null }, { id: "stun", depth: null }, { id: "bindLeg", depth: 0 }], buffs: []
    }, rolls([1, 2]));
    expect(r.conditions).toEqual([{ id: "petrify", depth: null }, { id: "bindLeg", depth: 0 }]);
    expect(r.log.filter((l) => l.step === "recovery")).toHaveLength(1);
  });

  it("독으로 쓰러지면 리젠으로 회복하지 않는다, 리젠은 최대값까지", async () => {
    const r = await endPhaseFor({
      hp: { value: 2, max: 9 }, suppDef: 0,
      conditions: [{ id: "poison", depth: 30, sourceSuppAtk: 3 }], buffs: [{ id: "hpRegen", value: 5, turns: 3 }]
    }, rolls([1, 1]));
    expect(r.hp).toBe(-1);
    const r2 = await endPhaseFor({ hp: { value: 8, max: 9 }, suppDef: 0, conditions: [], buffs: [{ id: "hpRegen", value: 5, turns: 3 }] }, rolls());
    expect(r2.hp).toBe(9);
  });
});
