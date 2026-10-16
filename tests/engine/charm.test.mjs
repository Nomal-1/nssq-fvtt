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
