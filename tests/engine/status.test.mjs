import { describe, expect, it } from "vitest";
import { addCondition, conditionMods, contestInflict, openingRollFails, removeCondition, resistCheck } from "../../src/engine/conditions.mjs";
import { addBuff, applyMods, buffMods, tickBuffs } from "../../src/engine/buffs.mjs";
import { effectiveResist, judgeDamage } from "../../src/engine/combat.mjs";

const SUB = { physHit: 5, elemHit: 4, evasion: 8, physAtk: 9, elemAtk: 3, defense: 3, suppAtk: 4, suppDef: 4, speed: 12 };
const RES = { slash: 3, strike: 3, pierce: 3, fire: 3, ice: 3, volt: 3 };

describe("상태 이상·봉인", () => {
  it("같은 상태 이상은 심도가 높을 때만 갱신(07 #5)", () => {
    let { list } = addCondition([], { id: "poison", depth: 10 });
    expect(addCondition(list, { id: "poison", depth: 9 }).result).toBe("ignored");
    ({ list } = addCondition(list, { id: "poison", depth: 12 }));
    expect(list).toHaveLength(1);
    expect(list[0].depth).toBe(12);
  });

  it("상태 이상은 하나만: 다른 상태 이상은 새 것으로 덧씌운다(07 #35). 봉인은 부위마다 함께", () => {
    let list = addCondition([], { id: "poison", depth: 10 }).list;
    list = addCondition(list, { id: "bindArm", depth: 9 }).list;
    list = addCondition(list, { id: "bindLeg", depth: 7 }).list;
    const r = addCondition(list, { id: "blind", depth: 8 });
    expect(r.result).toBe("replaced");
    expect(r.replaced.id).toBe("poison");
    expect(r.list.map((c) => c.id)).toEqual(["bindArm", "bindLeg", "blind"]);
    // 심도가 낮아도 다른 상태 이상이면 덧씌운다
    expect(addCondition(r.list, { id: "stun" }).list.map((c) => c.id)).toEqual(["bindArm", "bindLeg", "stun"]);
  });

  it("석화·스턴은 심도를 기록하지 않는다", () => {
    const { list } = addCondition([], { id: "stun", depth: 11 });
    expect(list[0].depth).toBeNull();
  });

  it("맹목 −3, [머리] 봉인 명중 −2, [팔] 봉인 물리 공격 −4", () => {
    const list = [{ id: "blind", depth: 8 }, { id: "bindHead", depth: 8 }, { id: "bindArm", depth: 8 }];
    const { sub } = applyMods({ sub: SUB, resist: RES }, [conditionMods(list)]);
    expect(sub.physHit).toBe(0);
    expect(sub.elemHit).toBe(-1);
    expect(sub.evasion).toBe(5);
    expect(sub.physAtk).toBe(5);
  });

  it("[석화]·[수면]·[스턴]·[다리] 봉인은 【회피】 0, 회피 상승이 있어도 0", () => {
    for (const id of ["petrify", "sleep", "stun", "bindLeg"]) {
      const { sub } = applyMods({ sub: SUB, resist: RES }, [conditionMods([{ id, depth: 5 }]), buffMods([{ id: "evasionUp", value: 3, turns: 2 }])]);
      expect(sub.evasion).toBe(0);
    }
  });

  it("[수면] 대상: 〈참〉 내성 −1로 취급 → 모든 눈이 대미지, 공격 처리 후 해제", () => {
    const list = [{ id: "sleep", depth: 9 }];
    const { resist } = applyMods({ sub: SUB, resist: RES }, [conditionMods(list)]);
    expect(resist.slash).toBe(-1);
    expect(resist.fire).toBe(3);
    const r = effectiveResist(resist, ["slash"]);
    expect(judgeDamage([1, 2, 3], r).hits).toBe(3);
    expect(removeCondition(list, "sleep")).toEqual([]);
  });

  it("[마비]·[공포] 판정 실패한 턴은 행동 불가·【회피】 0", () => {
    const m = conditionMods([{ id: "paralyze", depth: 9 }], { disabled: true });
    expect(m.noAction).toBe(true);
    expect(m.zero).toContain("evasion");
    expect(conditionMods([{ id: "paralyze", depth: 9 }]).noAction).toBe(false);
    expect([1, 2, 3, 4, 5, 6].map(openingRollFails)).toEqual([true, true, true, false, false, false]);
  });

  it("고정 목표값 억제 방어 롤: 실패하면 심도 = 목표값", () => {
    expect(resistCheck({ dice: [3, 4], suppDef: 4, target: 12 })).toMatchObject({ resisted: false, depth: 12 });
    expect(resistCheck({ dice: [4, 4], suppDef: 4, target: 12 })).toMatchObject({ resisted: true, depth: null });
  });

  it("대결 판정 부여: 공격자가 이기면 심도 = 공격자 달성값(07 #6), 동점은 막는다", () => {
    expect(contestInflict({ atkDice: [5, 5], suppAtk: 3, defDice: [2, 3], suppDef: 4 })).toMatchObject({ resisted: false, depth: 13 });
    expect(contestInflict({ atkDice: [3, 3], suppAtk: 3, defDice: [2, 3], suppDef: 4 })).toMatchObject({ resisted: true });
  });
});

describe("강화·약화", () => {
  it("『방어 상승: 2』와 『방어 저하: 1』 → 둘 다 소멸", () => {
    const a = addBuff([], { id: "defenseUp", value: 2, turns: 3 });
    const b = addBuff(a.list, { id: "defenseDown", value: 1, turns: 3 });
    expect(b.result).toBe("countered");
    expect(b.list).toEqual([]);
  });

  it("같은 종류는 가장 큰 효과만(같으면 남은 턴이 긴 쪽, 07 #36)", () => {
    let { list } = addBuff([], { id: "physAtkUp", value: 2, turns: 3 });
    expect(addBuff(list, { id: "physAtkUp", value: 1, turns: 5 }).result).toBe("ignored");
    ({ list } = addBuff(list, { id: "physAtkUp", value: 3, turns: 1 }));
    expect(list).toEqual([{ id: "physAtkUp", value: 3, turns: 1, param: "" }]);
    ({ list } = addBuff(list, { id: "physAtkUp", value: 3, turns: 2 }));
    expect(list[0].turns).toBe(2);
  });

  it("강화 4종류째는 거부(07 #7), 약화는 따로 센다", () => {
    let list = [];
    for (const id of ["physAtkUp", "defenseUp", "speedUp"]) list = addBuff(list, { id, value: 1, turns: 2 }).list;
    expect(addBuff(list, { id: "evasionUp", value: 1, turns: 2 }).result).toBe("rejected");
    expect(addBuff(list, { id: "hitDown", value: 1, turns: 2 }).result).toBe("added");
    // 이미 있는 종류의 갱신은 4종류째가 아니다
    expect(addBuff(list, { id: "speedUp", value: 4, turns: 2 }).result).toBe("updated");
  });

  it("내성 부여·약점 부여는 같은 속성끼리만 대항", () => {
    const a = addBuff([], { id: "resistGrant", param: "fire", turns: 3 });
    expect(addBuff(a.list, { id: "weaknessGrant", param: "ice", turns: 3 }).result).toBe("added");
    expect(addBuff(a.list, { id: "weaknessGrant", param: "fire", turns: 3 }).result).toBe("countered");
  });

  it("보정: 상승·저하, 내성 ±1, 속성 부여, 크리티컬 업, 최대 HP, 【속도】 음수는 0", () => {
    const list = [
      { id: "physAtkUp", value: 2, turns: 2 }, { id: "speedDown", value: 20, turns: 2 },
      { id: "resistGrant", param: "fire", turns: 2 }, { id: "weaknessGrant", param: "ice", turns: 2 },
      { id: "elemImbue", param: "volt", turns: 2 }, { id: "critUp", turns: 2 }, { id: "hpMaxUp", value: 5, turns: 2 }
    ];
    const m = buffMods(list);
    const r = applyMods({ sub: SUB, resist: RES, hpMax: 20 }, [m]);
    expect(r.sub.physAtk).toBe(11);
    expect(r.sub.speed).toBe(0);
    expect(r.resist.fire).toBe(4);
    expect(r.resist.ice).toBe(2);
    expect(r.hpMax).toBe(25);
    expect(m.elements).toEqual(["volt"]);
    expect(m.critUp).toBe(true);
  });

  it("종료 페이즈: 남은 턴 −1, 0이면 소멸", () => {
    const { list, expired } = tickBuffs([{ id: "defenseUp", value: 2, turns: 1 }, { id: "speedUp", value: 1, turns: 3 }]);
    expect(list).toEqual([{ id: "speedUp", value: 1, turns: 2 }]);
    expect(expired.map((b) => b.id)).toEqual(["defenseUp"]);
  });
});
