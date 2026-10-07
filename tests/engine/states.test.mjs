import { describe, expect, it } from "vitest";
import { addState, removeState, stateMods } from "../../src/engine/states.mjs";
import { resolveEffects } from "../../src/engine/effects/resolve.mjs";
import { canUseSkill } from "../../src/engine/effects/usage.mjs";

const jodan = { id: "bushido.jodan", name: "상단의 자세", group: "bushido.stance", mods: { physAtk: 3 } };
const seigan = { id: "bushido.seigan", name: "청안의 자세", group: "bushido.stance", mods: { defense: 2 } };

describe("전투 고유 상태(07 #57)", () => {
  it("같은 계열은 하나만: 새 자세가 앞의 자세를 바꾼다", () => {
    const a = addState([], jodan);
    const b = addState(a.list, seigan);
    expect(b.result).toBe("replaced");
    expect(b.list.map((s) => s.id)).toEqual(["bushido.seigan"]);
    expect(stateMods(b.list)).toEqual({ defense: 2 });
  });
  it("같은 상태는 갱신, max가 있으면 쌓인다", () => {
    expect(addState([jodan], { ...jodan, mods: { physAtk: 5 } }).list[0].mods.physAtk).toBe(5);
    const spear = { id: "shogun.spear", name: "피에 물든 창", mods: { physAtk: 1 }, max: 3 };
    let l = addState([], spear).list;
    for (let i = 0; i < 4; i++) l = addState(l, spear).list;
    expect(l[0].stacks).toBe(3);
    expect(stateMods(l)).toEqual({ physAtk: 3 });
    expect(removeState(l, "shogun.spear")).toEqual([]);
  });
  it("state 효과: SL로 보정을 계산", async () => {
    const effects = [{ type: "state", id: "bushido.iai", group: "bushido.stance", label: "발도의 자세", mods: [{ path: "speed", value: "SL*2" }] }];
    const me = { id: "u", name: "나", conditions: [] };
    const r = await resolveEffects({ effects, sl: 3, user: me, targets: [me], rollDice: () => [] });
    expect(r.results.get("u").states).toEqual([expect.objectContaining({ id: "bushido.iai", mods: { speed: 6 } })]);
  });
  it("「○○ 상태 한정」: requireState가 없으면 못 쓴다, requireState만 있으면 효과 없음", () => {
    const skill = { timing: "주행동", cost: { tp: 1 }, effects: [{ type: "requireState", state: "bushido.seigan" }, { type: "attack" }] };
    const user = { tp: 5, conditions: [] };
    expect(canUseSkill(skill, user, { phase: "main", myTurn: true }).reason).toBe("state");
    expect(canUseSkill(skill, { ...user, states: ["bushido.seigan"] }, { phase: "main", myTurn: true }).ok).toBe(true);
    expect(canUseSkill({ ...skill, effects: [skill.effects[0]] }, user, { phase: "main", myTurn: true }).reason).toBe("noEffects");
  });
  it("개막 페이즈는 1행동", () => {
    const skill = { timing: "개막", cost: { tp: 1 }, effects: [{ type: "buff" }] };
    expect(canUseSkill(skill, { tp: 5 }, { phase: "opening", openingDone: true }).reason).toBe("openingDone");
  });
});

import { expForLevel, levelFromExp } from "../../src/engine/derive.mjs";
import tables from "../../src/generated/tables.mjs";

describe("레벨 = 누적 경험점(01 §8)", () => {
  const L = tables.levelExp.levels;
  it("표대로", () => {
    expect(levelFromExp(0, L)).toBe(1);
    expect(levelFromExp(14, L)).toBe(1);
    expect(levelFromExp(15, L)).toBe(2);
    expect(levelFromExp(664, L)).toBe(14);
    expect(levelFromExp(9999, L)).toBe(15);
    expect(expForLevel(15, L)).toBe(665);
  });
});
