import { describe, expect, it } from "vitest";
import { resolveEffects } from "../../src/engine/effects/resolve.mjs";

const seq = (list) => { let i = 0; return async (n) => Array.from({ length: n }, () => list[i++ % list.length]); };
const charm = [{ type: "target", side: "enemy", scope: "single" }, { type: "craftRank", materials: ["목재"] }, { type: "attack", kind: "elemental", element: ["fire"], fixedDice: "13+R*2", fixedHit: "6+R" }];
const user = { id: "u", physHit: 0, elemHit: 0, physAtk: 0, elemAtk: 0, elements: ["strike"] };
const foe = { id: "e", name: "e", evasion: 12, defense: 0, resist: { fire: 3 }, hp: 99, hpMax: 99 };

describe("기동부적(07 #168): 소재 R로 고정 명중·대미지 다이스", () => {
  it("R3: 명중 기준 9, 대미지 다이스 19개(사용자 능력치와 무관)", async () => {
    const out = await resolveEffects({ effects: charm, sl: 1, rank: 3, user, targets: [foe], rollDice: seq([2, 2]), rng: () => 0.5, source: "item" });
    const h = out.results.get("e").hits[0];
    expect(h.params.attacker.hit).toBe(9);
    expect(h.params.diceOverride).toBe(19);
    expect(h.hit).toBe(true); // 9 + 4 ≥ 12
    expect(out.gm).toEqual([]);
  });
  it("랭크가 없으면 R1", async () => {
    const out = await resolveEffects({ effects: charm, sl: 1, user, targets: [foe], rollDice: seq([1, 2]), rng: () => 0.5, source: "item" });
    const h = out.results.get("e").hits[0];
    expect(h.params.attacker.hit).toBe(7);
    expect(h.params.diceOverride).toBe(15);
  });
});

describe("향(07 #168): 소재 R로 고정 목표값 부여", () => {
  const incense = [{ type: "target", side: "enemy", scope: "single" }, { type: "craftRank", materials: ["꽃"] }, { type: "inflict", condition: "sleep", check: { type: "fixed", target: "13+R" } }];
  it("R3: 목표값 16, 실패하면 심도 16", async () => {
    const out = await resolveEffects({ effects: incense, sl: 1, rank: 3, user, targets: [{ ...foe, suppDef: 2 }], rollDice: seq([3, 4]), rng: () => 0.5, source: "item" });
    const x = out.results.get("e").inflicts[0];
    expect(x).toMatchObject({ id: "sleep", resisted: false, depth: 16 });
  });
  it("억제 방어 롤이 목표값 이상이면 저항", async () => {
    const out = await resolveEffects({ effects: incense, sl: 1, rank: 1, user, targets: [{ ...foe, suppDef: 5 }], rollDice: seq([5, 4]), rng: () => 0.5, source: "item" });
    expect(out.results.get("e").inflicts[0].resisted).toBe(true);
  });
});

describe("독향: [독] 대미지 5+R", () => {
  it("R3이면 부여 결과에 power 8", async () => {
    const eff = [{ type: "inflict", condition: "poison", check: { type: "fixed", target: "13+R" }, power: "5+R" }];
    const out = await resolveEffects({ effects: eff, sl: 1, rank: 3, user, targets: [{ ...foe, suppDef: 0 }], rollDice: seq([1, 2]), rng: () => 0.5, source: "item" });
    expect(out.results.get("e").inflicts[0]).toMatchObject({ id: "poison", resisted: false, power: 8 });
  });
});

describe("책(07 #168): 목표값 【억제 공격】+4+R", () => {
  it("억제 공격 7, R2 → 목표값 13", async () => {
    const eff = [{ type: "target", side: "enemy", scope: "single" }, { type: "inflict", condition: "bindArm", check: { type: "fixed", target: "@self.suppAtk + 4 + R" } }];
    const out = await resolveEffects({ effects: eff, sl: 1, rank: 2, user: { ...user, suppAtk: 7 }, targets: [{ ...foe, suppDef: 0 }], rollDice: seq([2, 3]), rng: () => 0.5, source: "item" });
    expect(out.results.get("e").inflicts[0]).toMatchObject({ id: "bindArm", resisted: false, depth: 13 });
  });
});
