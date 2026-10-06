import { describe, expect, it } from "vitest";
import {
  damageDiceCount, effectiveResist, escapeSucceeds, fpFromHitChecks, halve, inRange, initiativeValue, judgeDamage,
  identifyResult, pickRandom, resolveAttack, rowFull, rowSwap, sideDefeated, turnOrder, unidentifiedResist
} from "../../src/engine/combat.mjs";

const seq = (...xs) => () => {
  if (!xs.length) throw new Error("주사위 부족");
  return xs.shift();
};

describe("행동 순서", () => {
  it("【속도】 내림차순, 같으면 PC → 아군 NPC → 에너미", () => {
    const order = turnOrder([
      { id: "e1", speed: 15, side: "enemy" }, { id: "p1", speed: 15, side: "pc" },
      { id: "a1", speed: 15, side: "ally" }, { id: "p2", speed: 20, side: "pc" }, { id: "e2", speed: 9, side: "enemy" }
    ]);
    expect(order).toEqual(["p2", "p1", "a1", "e1", "e2"]);
  });
  it("최속 행동이 맨 앞, 후발 행동이 맨 뒤(그 안에서도 PC → 에너미)", () => {
    const order = turnOrder([
      { id: "e1", speed: 30, side: "enemy" }, { id: "pLast", speed: 99, side: "pc", timing: "last" },
      { id: "eFirst", speed: 1, side: "enemy", timing: "first" }, { id: "pFirst", speed: 1, side: "pc", timing: "first" }
    ]);
    expect(order).toEqual(["pFirst", "eFirst", "e1", "pLast"]);
  });
  it("【속도】가 음수면 0", () => {
    expect(initiativeValue({ speed: -5, side: "enemy" })).toBe(0);
  });
});

describe("사거리", () => {
  it("근: 둘 다 전위일 때만, 원: 언제나", () => {
    expect(inRange("근", "front", "front")).toBe(true);
    expect(inRange("근", "back", "front")).toBe(false);
    expect(inRange("근", "front", "back")).toBe(false);
    expect(inRange("원", "back", "back")).toBe(true);
  });
});

describe("내성·대미지 (05 필수 케이스)", () => {
  it("【물리 공격】 9, 【방어】 3, 〈참〉 내성 3 → 6D6 [4,5,6,1,2,3] → 실대미지 3", () => {
    expect(damageDiceCount({ kind: "physical", physAtk: 9, defense: 3 })).toBe(6);
    expect(judgeDamage([4, 5, 6, 1, 2, 3], 3).hits).toBe(3);
  });
  it("무속성은 내성 0, 복합 속성은 최저 내성", () => {
    const resist = { slash: 3, strike: 2, pierce: 4, fire: 1, ice: 3, volt: 5 };
    expect(effectiveResist(resist, ["none"])).toBe(0);
    expect(effectiveResist(resist, [])).toBe(0);
    expect(effectiveResist(resist, ["slash", "fire"])).toBe(1);
    expect(effectiveResist(resist, ["pierce"])).toBe(4);
  });
  it("속성 공격은 【속성 공격】 + 보정, 방어 무시", () => {
    expect(damageDiceCount({ kind: "elemental", elemAtk: 7, defense: 10, diceMod: 2 })).toBe(9);
  });
  it("대미지 다이스 0 이하면 0(07 #1)", () => {
    expect(damageDiceCount({ kind: "physical", physAtk: 3, defense: 8 })).toBe(0);
  });
  it("6이 3개, 1이 1개 → 크리티컬(차이 2) / 『크리티컬 업』이면 차이 1에서도", () => {
    expect(judgeDamage([6, 6, 6, 1, 3], 3).crit).toBe(true);
    expect(judgeDamage([6, 6, 1, 3], 3).crit).toBe(false);
    expect(judgeDamage([6, 6, 1, 3], 3, { critUp: true }).crit).toBe(true);
  });
  it("대미지 절반은 버림", () => {
    expect(halve(5)).toBe(2);
  });
});

describe("공격 롤", () => {
  const attacker = { hit: 2, physAtk: 9, elemAtk: 0, elements: ["slash"] };
  const target = { evasion: 7, defense: 3, resist: { slash: 3 } };

  it("명중 → 대미지", async () => {
    // 명중 [3,4]+2=9 ≥ 7, 대미지 6D6 [4,5,6,1,2,3]
    const r = await resolveAttack({ attacker, target, rng: seq(3, 4, 4, 5, 6, 1, 2, 3) });
    expect(r.hit).toBe(true);
    expect(r).toMatchObject({ resist: 3, diceCount: 6, rawDamage: 3, finalDamage: 3, crit: false });
  });

  it("빗나가면 대미지 없음", async () => {
    const r = await resolveAttack({ attacker, target, rng: seq(1, 3) });
    expect(r.hit).toBe(false);
    expect(r.finalDamage).toBeUndefined();
    expect(r.fpGain).toBe(1);
  });

  it("[1,1]은 절대 실패, [6,6]은 회피와 관계없이 명중", async () => {
    expect((await resolveAttack({ attacker: { ...attacker, hit: 30 }, target, rng: seq(1, 1) })).hit).toBe(false);
    const r = await resolveAttack({ attacker, target: { ...target, evasion: 50 }, rng: seq(6, 6, 1, 1, 1, 1, 1, 1) });
    expect(r.hit).toBe(true);
  });

  it("크리티컬: 4다이스 추가, 추가분으로 다시 크리티컬 판정하지 않음(07 #2)", async () => {
    // 명중 [5,5], 대미지 [6,6,6,1,2,3] 크리 → 추가 [6,6,6,6]
    const r = await resolveAttack({ attacker, target, rng: seq(5, 5, 6, 6, 6, 1, 2, 3, 6, 6, 6, 6) });
    expect(r.crit).toBe(true);
    expect(r.damage.hits).toBe(3);
    expect(r.critExtra.hits).toBe(4);
    // 추가 4다이스가 또 6투성이여도 더 굴리지 않는다(주사위를 더 요구하면 seq가 오류를 낸다)
    expect(r.critExtra.dice).toHaveLength(4);
    expect(r.rawDamage).toBe(7);
  });

  it("방어 전념(대기) 중인 대상은 실대미지 절반", async () => {
    const r = await resolveAttack({ attacker, target: { ...target, guarding: true }, rng: seq(3, 4, 4, 5, 6, 1, 2, 3) });
    expect(r.rawDamage).toBe(3);
    expect(r.finalDamage).toBe(1);
  });

  it("다회 공격에서 1이 여러 번 나와도 【FP】는 주행동당 1번(처음 판정)", () => {
    const results = [{ fpGain: 1 }, { fpGain: 2 }, { fpGain: 1 }];
    expect(fpFromHitChecks(results)).toBe(1);
  });
});

describe("전투 불능·열 교대·전멸", () => {
  it("전위가 전원 전투 불능이면 전위·후위 교대", () => {
    const units = [{ id: "a", row: "front", ko: true }, { id: "b", row: "front", ko: true }, { id: "c", row: "back", ko: false }];
    expect(rowSwap(units)).toEqual([{ id: "a", row: "back" }, { id: "b", row: "back" }, { id: "c", row: "front" }]);
  });
  it("전위에 한 명이라도 살아 있으면, 또는 후위도 전멸이면 교대하지 않는다", () => {
    expect(rowSwap([{ id: "a", row: "front", ko: false }, { id: "c", row: "back", ko: false }])).toEqual([]);
    expect(rowSwap([{ id: "a", row: "front", ko: true }, { id: "c", row: "back", ko: true }])).toEqual([]);
  });
  it("전열이 비어 있어도(섞기·난입 등) 후열에 살아 있는 전투원이 있으면 끌어온다", () => {
    expect(rowSwap([{ id: "c", row: "back", ko: false }, { id: "d", row: "back", ko: true }])).toEqual([{ id: "c", row: "front" }, { id: "d", row: "front" }]);
  });
  it("전원 전투 불능 또는 [석화]면 전멸", () => {
    expect(sideDefeated([{ ko: true }, { petrified: true }])).toBe(true);
    expect(sideDefeated([{ ko: true }, { ko: false }])).toBe(false);
  });
  it("PC는 한 열에 3명까지", () => {
    expect(rowFull([{ row: "front" }, { row: "front" }, { row: "front" }], "front")).toBe(true);
    expect(rowFull([{ row: "front" }, { row: "back" }], "front")).toBe(false);
  });
});

describe("도주", () => {
  it("도주 측 최고가 추격 측 최고보다 높으면 성공, 동점은 실패", () => {
    expect(escapeSucceeds([10, 14], [13])).toBe(true);
    expect(escapeSucceeds([13], [13, 5])).toBe(false);
    expect(escapeSucceeds([], [3])).toBe(false);
  });
});

describe("식별·무작위", () => {
  it("달성값 ≥ 희소도면 식별, 희소종은 +2 이상이어야 간파", () => {
    expect(identifyResult(5, { rarity: 5 })).toEqual({ identified: true, rareRevealed: false });
    expect(identifyResult(4, { rarity: 5 })).toEqual({ identified: false, rareRevealed: false });
    expect(identifyResult(6, { rarity: 5, isRare: true })).toEqual({ identified: true, rareRevealed: false });
    expect(identifyResult(7, { rarity: 5, isRare: true })).toEqual({ identified: true, rareRevealed: true });
    expect(identifyResult("", { rarity: 0 }).identified).toBe(false);
  });
  it("식별 실패 에너미의 내성은 최소 3", () => {
    expect(unidentifiedResist({ slash: 1, fire: 5, ice: 3 })).toEqual({ slash: 3, fire: 5, ice: 3 });
  });
  it("무작위로 하나", () => {
    expect(pickRandom(["a", "b", "c"], () => 0.99)).toBe("c");
    expect(pickRandom(["a", "b", "c"], () => 0)).toBe("a");
    expect(pickRandom([], () => 0.5)).toBe(null);
  });
});
