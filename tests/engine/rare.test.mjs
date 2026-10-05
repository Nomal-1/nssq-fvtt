import { describe, expect, it } from "vitest";
import { rareTransform, sameEnemyData } from "../../src/engine/rare.mjs";

const rat = {
  hp: { value: 5, max: 5 },
  stats: { physHit: 3, elemHit: 0, evasion: 7, physAtk: 10, elemAtk: 0, defense: 3, suppAtk: 2, suppDef: 2, speed: 15 },
  resist: { slash: 3, strike: 3, pierce: 3, fire: 0, ice: 1, volt: 2 }
};

describe("희소종 (01 §3.14)", () => {
  it("【HP】 배수, 내성 0→1·1→2(그 밖은 그대로)", () => {
    const r = rareTransform(rat, { multiplier: 3 });
    expect(r.hp).toEqual({ value: 15, max: 15 });
    expect(r.resist).toEqual({ slash: 3, strike: 3, pierce: 3, fire: 1, ice: 2, volt: 2 });
    expect(r.stats).toEqual(rat.stats);
  });
  it("GM 재량 강화는 항목별로 고른다", () => {
    const r = rareTransform(rat, { boost: ["evasion", "defense"] });
    expect(r.stats).toMatchObject({ physHit: 3, evasion: 8, physAtk: 10, defense: 5 });
  });

  it("GM 재량 강화 전부: 명중·회피 +1, 공격·방어 +2", () => {
    const r = rareTransform(rat, { multiplier: 2, boost: true });
    expect(r.hp.max).toBe(10);
    expect(r.stats).toMatchObject({ physHit: 4, elemHit: 1, evasion: 8, physAtk: 12, elemAtk: 2, defense: 5, suppAtk: 2, speed: 15 });
  });
});

describe("중복 판정", () => {
  const a = { name: "숲쥐", img: "x", system: { level: 1, hp: { max: 5, value: 5 } } };
  it("이름·이미지·system이 같으면 중복(키 순서 무관)", () => {
    expect(sameEnemyData(a, { name: "숲쥐", img: "x", system: { hp: { value: 5, max: 5 }, level: 1 } })).toBe(true);
  });
  it("이름이나 값이 다르면 변형", () => {
    expect(sameEnemyData(a, { ...a, name: "숲쥐 보스" })).toBe(false);
    expect(sameEnemyData(a, { ...a, system: { level: 1, hp: { max: 15, value: 15 } } })).toBe(false);
  });
});
