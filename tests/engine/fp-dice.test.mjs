import { describe, expect, it } from "vitest";
import { resolveAttack } from "../../src/engine/combat.mjs";
import { resolveEffects } from "../../src/engine/effects/resolve.mjs";

const seq = (list) => { let i = 0; return async (n) => Array.from({ length: n }, () => list[i++ % list.length]); };
const attacker = { hit: 0, physAtk: 10, elemAtk: 0, elements: ["slash"] };
const target = { evasion: 9, defense: 0, resist: { slash: 3 } };

describe("명중 판정 【FP】(01 #26)", () => {
  it("주사위를 늘리면 높은 2개를 쓰고 【FP】를 얻지 않는다", async () => {
    const r = await resolveAttack({ attacker, target, fpDice: 1, rollDice: seq([1, 3, 6, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4]) });
    expect(r.hitCheck.rolled).toEqual([1, 3, 6]);
    expect(r.hitCheck.used).toEqual([3, 6]);
    expect(r.hit).toBe(true);
    expect(r.fpGain).toBe(0);
  });
  it("다시 굴린 판정도 【FP】를 얻지 않는다", async () => {
    const r = await resolveAttack({ attacker, target, rerolled: true, rollDice: seq([1, 2]) });
    expect(r.fpGain).toBe(0);
    expect(r.hitCheck.rerolled).toBe(true);
  });
  it("여러 판정: 판정마다 n개, 남은 【FP】까지만(fpSpent)", async () => {
    const user = { id: "u", physHit: 0, elemHit: 0, physAtk: 10, elemAtk: 0, elements: ["slash"], fpDice: 1, fpAvail: 2 };
    const t = (id) => ({ id, name: id, evasion: 30, defense: 0, resist: { slash: 3 }, hp: 10, hpMax: 10 });
    const out = await resolveEffects({ effects: [{ type: "attack", kind: "physical" }], sl: 1, user, targets: [t("a"), t("b"), t("c")], rollDice: seq([2, 2, 2]), rng: () => 0.5 });
    expect(out.fpSpent).toBe(2);
    const hits = [...out.results.values()].map((x) => x.hits[0]);
    expect(hits.map((h) => h.hitCheck.fpDice)).toEqual([1, 1, 0]);
    expect(hits[0].params?.target?.evasion).toBe(30);
  });
});
