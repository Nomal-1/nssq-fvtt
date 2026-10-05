import { describe, expect, it } from "vitest";
import { formula, makeId, normalizeKey, parseTables, unescape } from "../../tools/lib/util.mjs";

describe("변환 유틸", () => {
  it("makeId는 16자 영숫자이고 입력이 같으면 같다", () => {
    const a = makeId("Item", "skill:ソードマン", "剣マスタリー");
    expect(a).toMatch(/^[A-Za-z0-9]{16}$/);
    expect(makeId("Item", "skill:ソードマン", "剣マスタリー")).toBe(a);
    expect(makeId("Item", "skill:ブシドー", "剣マスタリー")).not.toBe(a);
  });

  it("normalizeKey: NFKC 후 공백·기호 제거", () => {
    expect(normalizeKey("HPリジェネ：●")).toBe("HPリジェネ");
    expect(normalizeKey("ＴＲＰＧ 執政院")).toBe("TRPG執政院");
  });

  it("formula: 원문 R식 → 평가기 식", () => {
    expect(formula("(R의 제곱)×100")).toBe("(R*R)*100");
    expect(formula("(Lv×3)+4")).toBe("(LV*3)+4");
    expect(formula("+1")).toBe("1");
    expect(formula("-4")).toBe("-4");
    expect(formula("-")).toBeNull();
  });

  it("unescape: Notion 이스케이프 제거", () => {
    expect(unescape("4\\~7 R1 \\[독\\]")).toBe("4~7 R1 [독]");
  });

  it("parseTables: 머리글·행·직전 제목", () => {
    const md = "## 무기\n<table header-row=\"true\">\n<tr>\n<td>A</td>\n<td>B</td>\n</tr>\n<tr>\n<td>**x**</td>\n<td>\\[y\\]</td>\n</tr>\n</table>";
    const [t] = parseTables(md);
    expect(t.heading).toBe("무기");
    expect(t.header).toEqual(["A", "B"]);
    expect(t.rows).toEqual([["x", "[y]"]]);
  });
});
