import { describe, expect, it } from "vitest";
import { placeToken, removeOldest, tickTokens, tokenTargets } from "../../src/engine/tokens.mjs";

const tk = (id, category = "소환수", left = 3) => ({ id, category, left });

describe("토큰(단계 8-E)", () => {
  it("같은 분류는 max개까지, 넘으면 가장 오래된 것이 소멸. 다른 분류는 따로", () => {
    let r = placeToken([], tk("a"));
    r = placeToken(r.list, tk("b"));
    expect(r.list.map((t) => t.id)).toEqual(["b"]);
    expect(r.removed.map((t) => t.id)).toEqual(["a"]);
    r = placeToken(r.list, tk("c"), 2);
    r = placeToken(r.list, tk("d", "방진"), 1);
    expect(r.list.map((t) => t.id)).toEqual(["b", "c", "d"]);
    r = placeToken(r.list, tk("e"), 2);
    expect(r.list.map((t) => t.id)).toEqual(["c", "d", "e"]);
  });

  it("종료 페이즈마다 1턴씩, 0이면 소멸", () => {
    const r = tickTokens([tk("a", "소환수", 1), tk("b", "방진", 3)]);
    expect(r.list).toEqual([expect.objectContaining({ id: "b", left: 2 })]);
    expect(r.removed.map((t) => t.id)).toEqual(["a"]);
  });

  it("분류의 가장 오래된 토큰 하나 제거", () => {
    expect(removeOldest([tk("a", "방진"), tk("b"), tk("c")], "소환수").list.map((t) => t.id)).toEqual(["a", "c"]);
    expect(removeOldest([tk("a", "방진")], "소환수").removed).toEqual([]);
  });

  it("대상 문구: 전열 단일·전열·관통·열·전체·자신", () => {
    const foes = [{ id: "f1", row: "front", order: 0 }, { id: "f2", row: "front", order: 1 }, { id: "b1", row: "back", order: 1 }];
    const first = () => 0;
    expect(tokenTargets("적 전열 단일", foes, first)).toEqual({ ids: ["f1"], scope: "single" });
    expect(tokenTargets("적 전열", foes, first).ids).toEqual(["f1", "f2"]);
    expect(tokenTargets("적 전체", foes, first).ids).toEqual(["f1", "f2", "b1"]);
    expect(tokenTargets("적 관통", foes, first).ids).toEqual(["f1", "b1"]);
    expect(tokenTargets("적 열", foes, () => 0.9).ids).toEqual(["b1"]);
    expect(tokenTargets("자신", foes).scope).toBe("self");
    expect(tokenTargets("적 전열 단일", [{ id: "b1", row: "back" }], first).ids).toEqual(["b1"]);
  });
});
