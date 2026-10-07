import { describe, expect, it } from "vitest";
import { resolveEffects, resolveTriggers } from "../../src/engine/effects/resolve.mjs";
import { collectPassives } from "../../src/engine/effects/passives.mjs";
import { activationRoll, canUseSkill } from "../../src/engine/effects/usage.mjs";
import { whenMatches } from "../../src/engine/effects/when.mjs";

/** 고정 주사위: 요청한 개수만큼 앞에서 꺼낸다 */
const dice = (...xs) => (n) => {
  if (xs.length < n) throw new Error(`주사위 부족(${n})`);
  return xs.splice(0, n);
};
const R3 = { slash: 3, strike: 3, pierce: 3, fire: 3, ice: 3, volt: 3 };
const user = { id: "u", name: "나", physHit: 5, elemHit: 4, physAtk: 9, elemAtk: 5, suppAtk: 4, suppDef: 3, elements: ["slash"], weaponType: "도", conditions: [], hp: 10, hpMax: 20, tp: 10, tpMax: 10 };
const foe = { id: "e", name: "적", evasion: 8, defense: 3, resist: R3, suppDef: 2, hp: 15, hpMax: 15, skills: [], conditions: [] };

describe("03 §4 예시", () => {
  it("《도 마스터리》 상시: 도 공격의 물리 명중 +(SL/2), 다른 무기면 없음", () => {
    const skill = { name: "도 마스터리", sl: 5, timing: "상시", effects: [{ type: "modifier", path: "physHit", value: "SL/2", when: { weaponType: ["도"] } }] };
    expect(collectPassives([skill], { self: { weaponType: "도" } }).mods).toEqual({ physHit: 2 });
    expect(collectPassives([skill], { self: { weaponType: "검" } }).mods).toEqual({});
  });

  it("《등치기》 〈괴〉 물리 공격 롤, 명중하면 목표값 (억제 공격+7+SL) 억제 방어 롤 실패 시 [마비]", async () => {
    const effects = [{ type: "attack", kind: "physical", element: ["strike"], onHit: [{ type: "inflict", condition: "paralyze", check: { type: "fixed", target: "@self.suppAtk + 7 + SL" } }] }];
    // 명중 [4,5]+5=14 ≥ 8, 대미지 6D6 [4,5,6,1,2,3] → 3, 억제 방어 [3,3]+2=8 < 4+7+2=13 → [마비] 심도 13
    const r = await resolveEffects({ effects, sl: 2, user, targets: [foe], rollDice: dice(4, 5, 4, 5, 6, 1, 2, 3, 3, 3) });
    const e = r.results.get("e");
    expect(e.damage).toBe(3);
    expect(e.hits[0].elements).toEqual(["strike"]);
    expect(e.inflicts).toEqual([expect.objectContaining({ id: "paralyze", depth: 13, resisted: false })]);
  });

  it("《샛별》 대미지 다이스 +(SL+1), 대상이 《야행성》이면 +(SL×2) 추가", async () => {
    const effects = [{ type: "attack", kind: "physical", diceMod: "SL+1", bonuses: [{ when: { targetHasSkill: "야행성" }, diceMod: "SL*2" }] }];
    const night = { ...foe, id: "n", skills: ["야행성"] };
    // (9−3)+3 = 9개 / 야행성 +4 = 13개
    const a = await resolveEffects({ effects, sl: 2, user, targets: [foe], rollDice: dice(5, 5, ...Array(9).fill(2)) });
    expect(a.results.get("e").hits[0].diceCount).toBe(9);
    const b = await resolveEffects({ effects, sl: 2, user, targets: [night], rollDice: dice(5, 5, ...Array(13).fill(2)) });
    expect(b.results.get("n").hits[0].diceCount).toBe(13);
  });

  it("《오륜의 검》 3회, 매회 무작위 대상, 대미지 다이스 −(5−SL)", async () => {
    const effects = [{ type: "attack", kind: "physical", times: 3, random: true, diceMod: "-(5-SL)" }];
    const a = { ...foe, id: "a" };
    const b = { ...foe, id: "b" };
    const picks = [0.1, 0.9, 0.1];
    // 대미지 다이스 (9−3)−(5−3) = 4개. 회차마다 명중 2개 + 대미지 4개
    const r = await resolveEffects({ effects, sl: 3, user, pool: [a, b], rng: () => picks.shift(), rollDice: dice(...Array(18).fill(5)) });
    expect(r.results.get("a").hits).toHaveLength(2);
    expect(r.results.get("b").hits).toHaveLength(1);
    expect(r.results.get("a").hits[0].diceCount).toBe(4);
  });

  it("《이 악물기》 전투 불능이 될 때 1D6 ≤ SL이면 HP 1로 버팀", async () => {
    const effects = [{ type: "trigger", on: "beforeKO", chance: { roll: "1d6", lte: "SL" }, effects: [{ type: "resource", resource: "hp", set: 1 }] }];
    const ok = await resolveTriggers({ effects, on: "beforeKO", sl: 3, user, rollDice: dice(2) });
    expect(ok[0].ok).toBe(true);
    expect(ok[0].result.results.get("u").resource).toEqual([{ resource: "hp", delta: undefined, set: 1 }]);
    const ng = await resolveTriggers({ effects, on: "beforeKO", sl: 3, user, rollDice: dice(5) });
    expect(ng[0].ok).toBe(false);
  });

  it("《힐링》 회복 롤: 발동 2D6 뒤 【속성 공격】+((SL+1)×3)개 중 4 이상 개수", async () => {
    const effects = [{ type: "heal", mode: "roll", bonus: "(SL+1)*3" }];
    // 발동 [3,4], 5+6 = 11개
    const r = await resolveEffects({ effects, sl: 1, user, targets: [user], mainAction: true, rollDice: dice(3, 4, 4, 4, 4, 1, 1, 1, 6, 6, 2, 2, 5) });
    expect(r.activation.ok).toBe(true);
    expect(r.results.get("u").heal.hp).toBe(6);
  });

  it("발동 판정 [1,1]이면 실패, 효과 없음", async () => {
    const r = await resolveEffects({ effects: [{ type: "heal", mode: "fixed", amount: 5 }], user, targets: [user], mainAction: true, rollDice: dice(1, 1) });
    expect(r.failed).toBe(true);
    expect(r.fpGain).toBe(2);
    expect(r.results.size).toBe(0);
  });

  it("《공격의 호령》 『물리 공격 상승: (SL×2)』『속성 공격 상승: (SL×2)』 3턴", async () => {
    const effects = [{ type: "buff", id: "physAtkUp", value: "SL*2", turns: 3 }, { type: "buff", id: "elemAtkUp", value: "SL*2", turns: 3 }];
    const ally = { ...user, id: "a" };
    const r = await resolveEffects({ effects, sl: 2, user, targets: [ally], rollDice: dice() });
    expect(r.results.get("a").buffs).toEqual([{ id: "physAtkUp", value: 4, turns: 3, param: "" }, { id: "elemAtkUp", value: 4, turns: 3, param: "" }]);
  });

  it("《트래핑》 대기 상태·반격, 《사지타리우스의 화살》 지연 공격은 기록만(단계 8, GM 판단)", async () => {
    const trap = [{ type: "stance", until: "count", count: 3, effects: [{ type: "counter", when: { attackKind: "physical" }, on: "rowAttacked", attack: { kind: "physical", diceMod: "-(4-SL)" } }] }];
    const r = await resolveEffects({ effects: trap, user, targets: [user], rollDice: dice() });
    expect(r.deferred).toEqual(trap);
    expect(r.gm).toEqual(["stance"]);
    const arrow = [{ type: "delayed", at: "nextTurnLate", turns: 1, effects: [{ type: "attack", kind: "physical", diceMod: "(SL+1)*3" }] }];
    const r2 = await resolveEffects({ effects: arrow, user, targets: [foe], rollDice: dice() });
    expect(r2.deferred[0].at).toBe("nextTurnLate");
  });

  it("《어설트 드라이브》 【물리 공격】+((SL−1)×2) 후 2배, 오버히트 7턴", async () => {
    const effects = [{ type: "attack", kind: "physical", atkMod: "(SL-1)*2", atkMultiplier: 2 }, { type: "overheat", turns: 7 }];
    // SL3: (9+4)×2 = 26, 방어 3 → 23개
    const r = await resolveEffects({ effects, sl: 3, user, targets: [foe], rollDice: dice(5, 5, ...Array(23).fill(2)) });
    expect(r.results.get("e").hits[0].diceCount).toBe(23);
    expect(r.overheat).toBe(7);
  });

  it("에너미 《거슬리는 날갯소리》 대결 판정(억제 공격 vs 억제 방어), 이기면 [머리] 봉인", async () => {
    const effects = [{ type: "inflict", condition: "bindHead", check: { type: "contest" } }];
    const win = await resolveEffects({ effects, user, targets: [foe], rollDice: dice(5, 5, 2, 2) });
    expect(win.results.get("e").inflicts[0]).toMatchObject({ id: "bindHead", resisted: false, depth: 14 });
    const lose = await resolveEffects({ effects, user, targets: [foe], rollDice: dice(1, 2, 6, 6) });
    expect(lose.results.get("e").inflicts[0].resisted).toBe(true);
  });

  it("장식 「지식의 서」 에너미 식별 판정 +1(상시 보정 경로)", () => {
    const r = collectPassives([{ name: "지식의 서", sl: 1, timing: "상시", effects: [{ type: "modifier", path: "checks.identify", value: 1 }] }]);
    expect(r.mods["checks.identify"]).toBe(1);
  });
});

describe("사용 가능·발동·조건", () => {
  const skill = { name: "등치기", timing: "주행동", part: "팔", weaponReq: ["망치"], cost: { tp: 2, fp: 0 }, effects: [{ type: "attack" }] };
  const me = { tp: 5, fp: 1, weaponType: "망치", conditions: [] };
  it("타이밍·차례·봉인·무기·TP·효과 없음", () => {
    expect(canUseSkill(skill, me, { phase: "main", myTurn: true }).ok).toBe(true);
    expect(canUseSkill(skill, me, { phase: "opening" }).reason).toBe("notMain");
    expect(canUseSkill(skill, me, { phase: "main", myTurn: false }).reason).toBe("notTurn");
    expect(canUseSkill(skill, { ...me, conditions: [{ id: "bindArm" }] }, { phase: "main", myTurn: true }).reason).toBe("bound");
    expect(canUseSkill(skill, { ...me, weaponType: "검" }, { phase: "main", myTurn: true }).reason).toBe("weapon");
    expect(canUseSkill(skill, { ...me, tp: 1 }, { phase: "main", myTurn: true }).reason).toBe("tp");
    expect(canUseSkill({ ...skill, effects: [] }, me, { phase: "main", myTurn: true }).reason).toBe("noEffects");
    expect(canUseSkill({ ...skill, timing: "상시" }, me, { phase: "main" }).reason).toBe("timing");
  });
  it("발동 판정: 1쌍 실패, 1 하나는 FP 1", () => {
    expect(activationRoll([1, 1])).toMatchObject({ ok: false, fpGain: 2 });
    expect(activationRoll([1, 4])).toMatchObject({ ok: true, fpGain: 1 });
  });
  it("모르는 when 키는 통과시키지 않는다", () => {
    expect(whenMatches({ unknownKey: 1 }, {})).toBe(false);
    expect(whenMatches({ selfHpAtMostHalf: true }, { self: { hp: 5, hpMax: 10 } })).toBe(true);
  });
  it("다회 공격: 명중 판정의 1로 얻는 FP는 처음 판정 하나만", async () => {
    const r = await resolveEffects({ effects: [{ type: "attack", times: 2 }], user, targets: [foe], rollDice: dice(1, 6, 1, 6, ...Array(6).fill(1), 1, 6, 1, 6) });
    expect(r.fpGain).toBe(1);
  });
});
