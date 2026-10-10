import { describe, expect, it } from "vitest";
import { enemiesFromTokens, expandEnemies, parseBgm, pickWeighted, resolveStage, validateEncounter } from "../../src/engine/encounters.mjs";

describe("전투 구성", () => {
  it("무대: 구성 → 비어 있으면 던전(지도) 기본", () => {
    const map = { battleBg: "forest.webp", battleBgm: "pl1.s1" };
    expect(resolveStage({ bg: "", bgm: "" }, map)).toEqual({ bg: "forest.webp", bgm: "pl1.s1" });
    expect(resolveStage({ bg: "boss.webp", bgm: "" }, map)).toEqual({ bg: "boss.webp", bgm: "pl1.s1" });
    expect(resolveStage({ bg: "", bgm: "" }, null)).toEqual({ bg: "", bgm: "" });
    expect(parseBgm("pl1.s1")).toEqual({ playlist: "pl1", sound: "s1" });
    expect(parseBgm("pl1")).toEqual({ playlist: "pl1", sound: null });
  });
  it("조우표 가중치 뽑기", () => {
    const t = [{ id: "a", weight: 3 }, { id: "b", weight: 1 }, { id: "c", weight: 0 }];
    expect(pickWeighted(t, 0)).toBe("a");
    expect(pickWeighted(t, 0.74)).toBe("a");
    expect(pickWeighted(t, 0.76)).toBe("b");
    expect(pickWeighted(t, 0.99, (id) => id !== "b")).toBe("a");
    expect(pickWeighted([], 0.5)).toBeNull();
  });
  it("마리 수 펼치기·씬 프리셋 변환·검사", () => {
    const enc = { name: "숲 조우", enemies: [{ uuid: "x", count: 2, row: "front" }, { uuid: "y", count: 1, row: "back" }] };
    expect(expandEnemies(enc)).toEqual([{ uuid: "x", row: "front" }, { uuid: "x", row: "front" }, { uuid: "y", row: "back" }]);
    expect(validateEncounter(enc)).toEqual([]);
    expect(validateEncounter({ name: " ", enemies: [{ uuid: "x", count: 0 }] })).toEqual(["noName", "noEnemies"]);
    const tokens = [{ uuid: "x", name: "X", img: "", y: 900 }, { uuid: "x", name: "X", img: "", y: 900 }, { uuid: "y", name: "Y", img: "", y: 300 }];
    expect(enemiesFromTokens(tokens, 600)).toEqual([{ uuid: "x", name: "X", img: "", count: 2, row: "front" }, { uuid: "y", name: "Y", img: "", count: 1, row: "back" }]);
  });
});
