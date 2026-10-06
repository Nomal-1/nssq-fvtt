import { describe, expect, it } from "vitest";
import { MAX_SCALE, cropCss, dragCrop, zoomCrop } from "../../src/engine/art.mjs";

describe("일러스트 프레임", () => {
  it("CSS로 바꾼다", () => {
    expect(cropCss({ x: 50, y: 0, s: 1 })).toBe("background-size: 100% auto; background-position: 50% 0%;");
  });
  it("그림이 틀보다 크면 오른쪽으로 끌수록 왼쪽 부분이 보인다(x가 줄어든다)", () => {
    // 틀 100×100, 그림 200×200 → 틀 − 그림 = −100, 오른쪽으로 10px → x −10
    const c = dragCrop({ x: 50, y: 50, s: 2 }, { dx: 10, dy: -20, boxW: 100, boxH: 100, ratio: 1 });
    expect(c.x).toBeCloseTo(40);
    expect(c.y).toBeCloseTo(70);
  });
  it("0~100을 넘지 않고, 틀과 그림 크기가 같으면 그 축은 그대로", () => {
    expect(dragCrop({ x: 5, y: 50, s: 2 }, { dx: 50, boxW: 100, boxH: 100 }).x).toBe(0);
    expect(dragCrop({ x: 50, y: 30, s: 1 }, { dx: 30, dy: 30, boxW: 100, boxH: 100, ratio: 1 })).toEqual({ x: 50, y: 30, s: 1 });
  });
  it("확대·축소는 범위 안에서", () => {
    expect(zoomCrop({ x: 50, y: 50, s: 2 }, 1.1).s).toBeCloseTo(2.2);
    expect(zoomCrop({ x: 50, y: 50, s: 7.9 }, 2).s).toBe(MAX_SCALE);
  });
});
