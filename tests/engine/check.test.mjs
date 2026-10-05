import { describe, expect, it } from "vitest";
import { canAddDice, canReroll, contestWinner, defaultSelection, evaluateCheck, rollDice } from "../../src/engine/check.mjs";

describe("일반 행위 판정 (01 §2, 05 필수 케이스)", () => {
  it("2D6 + 수정 = 달성값, 목표값 이상이면 성공", () => {
    const r = evaluateCheck({ dice: [3, 4], modifier: 2, target: 9 });
    expect(r.total).toBe(9);
    expect(r.success).toBe(true);
    expect(evaluateCheck({ dice: [3, 4], modifier: 1, target: 9 }).success).toBe(false);
  });

  it("목표값이 없으면 성공 여부를 정하지 않는다", () => {
    expect(evaluateCheck({ dice: [3, 4] }).success).toBeNull();
  });

  it("[1,1] → 절대 실패 + 【FP】+2", () => {
    const r = evaluateCheck({ dice: [1, 1], modifier: 30, target: 7 });
    expect(r.absFailure).toBe(true);
    expect(r.success).toBe(false);
    expect(r.fpGain).toBe(2);
  });

  it("[6,6] + 수정 0, 목표값 20 → 절대 성공", () => {
    const r = evaluateCheck({ dice: [6, 6], modifier: 0, target: 20 });
    expect(r.absSuccess).toBe(true);
    expect(r.success).toBe(true);
  });

  it("1이 하나면 【FP】+1", () => {
    expect(evaluateCheck({ dice: [1, 5] }).fpGain).toBe(1);
  });

  it("【FP】 2로 주사위 추가 → 4D6 중 2개 선택, 【FP】 획득 없음", () => {
    const r = evaluateCheck({ dice: [1, 5, 1, 3], added: 2 });
    expect(r.used).toEqual([5, 3]);
    expect(r.sum).toBe(8);
    expect(r.fpGain).toBe(0);
  });

  it("고른 2개를 쓴다", () => {
    const r = evaluateCheck({ dice: [6, 2, 5, 4], selected: [1, 3], added: 2 });
    expect(r.used).toEqual([2, 4]);
  });

  it("주사위를 늘린 판정의 절대 성공·실패는 고른 2개 기준 (07 #4)", () => {
    expect(evaluateCheck({ dice: [6, 1, 6], added: 1 }).absSuccess).toBe(true);
    expect(evaluateCheck({ dice: [6, 1, 1], selected: [1, 2], added: 1 }).absFailure).toBe(true);
    expect(evaluateCheck({ dice: [6, 6, 1], selected: [0, 2], added: 1 }).absSuccess).toBe(false);
  });

  it("다시 굴린 판정은 1이 나와도 【FP】를 얻지 않고, 늘린 개수는 유지 (FAQ 4)", () => {
    const r = evaluateCheck({ dice: [1, 1, 4, 2], added: 2, rerolled: true });
    expect(r.fpGain).toBe(0);
    expect(r.used).toEqual([4, 2]);
    expect(evaluateCheck({ dice: [1, 3], rerolled: true }).fpGain).toBe(0);
  });

  it("defaultSelection: 높은 2개, 같은 눈은 앞의 것", () => {
    expect(defaultSelection([3, 5, 5, 1])).toEqual([1, 2]);
    expect(defaultSelection([2, 4])).toEqual([0, 1]);
  });

  it("rollDice는 주입한 RNG를 쓴다", () => {
    const seq = [2, 6, 3];
    expect(rollDice(3, () => seq.shift())).toEqual([2, 6, 3]);
  });

  it("【FP】 사용 가능 여부", () => {
    expect(canReroll({ rerolled: false }, 1)).toBe(true);
    expect(canReroll({ rerolled: true }, 5)).toBe(false);
    expect(canReroll({ rerolled: false }, 0)).toBe(false);
    expect(canAddDice(2, 2)).toBe(true);
    expect(canAddDice(1, 2)).toBe(false);
  });
});

describe("대항 판정", () => {
  const r = (total, o = {}) => ({ total, absSuccess: false, absFailure: false, ...o });

  it("높은 쪽이 이긴다", () => {
    expect(contestWinner(r(10), r(9))).toBe("active");
    expect(contestWinner(r(9), r(10))).toBe("passive");
  });

  it("동점이면 수동 측", () => {
    expect(contestWinner(r(10), r(10))).toBe("passive");
  });

  it("양쪽 절대 성공이면 수동 측", () => {
    expect(contestWinner(r(15, { absSuccess: true }), r(12, { absSuccess: true }))).toBe("passive");
  });

  it("한쪽만 절대 성공이면 그쪽", () => {
    expect(contestWinner(r(12, { absSuccess: true }), r(20))).toBe("active");
    expect(contestWinner(r(20), r(12, { absSuccess: true }))).toBe("passive");
  });

  it("절대 실패는 달성값과 관계없이 진다", () => {
    expect(contestWinner(r(20, { absFailure: true }), r(3))).toBe("passive");
    expect(contestWinner(r(3), r(20, { absFailure: true }))).toBe("active");
  });

  it("양쪽 절대 실패면 수동 측 (07 #19)", () => {
    expect(contestWinner(r(5, { absFailure: true }), r(5, { absFailure: true }))).toBe("passive");
  });
});
