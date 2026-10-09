import { describe, expect, it } from "vitest";
import { brokenByLowering, canRaise, levelCap, prereqsMet, skillBudget, skillUsage, treeLayout, uniqueSkillPlan } from "../../src/engine/skills.mjs";

describe("전투/비전투 분류", () => {
  it("GM이 정한 값이 우선", () => {
    expect(skillUsage({ usage: "explore", timing: "주행동" })).toBe("explore");
  });
  it("커먼 스킬은 비전투", () => {
    expect(skillUsage({ classKey: "common", timing: "상시", description: "HP를 회복" })).toBe("explore");
  });
  it("주행동·개막·수동은 전투", () => {
    expect(skillUsage({ timing: "개막", description: "판정 +3" })).toBe("combat");
  });
  it("특수는 해설로 판정: 탐색 판정이면 비전투, 도주면 전투", () => {
    expect(skillUsage({ timing: "특수", description: "로프나 사슬을 사용한 판정 전반에 +3" })).toBe("explore");
    expect(skillUsage({ timing: "특수", description: "도주 판정 달성값 +3" })).toBe("combat");
  });
  it("상시라도 전투 관련 말이 있으면 전투", () => {
    expect(skillUsage({ timing: "상시", description: "<p>【물리 공격】 +(SL)</p>" })).toBe("combat");
    expect(skillUsage({ timing: "상시", description: "분류 『방어』의 스킬" })).toBe("combat");
  });
  it("상시이고 탐색 판정뿐이면 비전투", () => {
    expect(skillUsage({ timing: "상시", description: "<p>아이템 소지 수 +4.</p>" })).toBe("explore");
  });
});

const A = { name: "A", prereqs: { all: [] } };
const B = { name: "B", prereqs: { all: [{ skill: "A", sl: 2 }] } };
const C = { name: "C", prereqs: { all: [{ skill: "B", sl: 1 }, { any: [{ skill: "A", sl: 3 }, { skill: "X", sl: 1 }] }] } };
const D = { name: "D", prereqs: { all: [] } };

describe("스킬 트리 배치", () => {
  const t = treeLayout([A, B, C, D]);
  const node = (id) => t.nodes.find((n) => n.id === id);
  it("전제 사슬 깊이별로 열을 나눈다", () => {
    expect(node("A").col).toBe(0);
    expect(node("B").col).toBe(1);
    expect(node("C").col).toBe(2);
    expect(t.cols).toBe(3);
  });
  it("전제도 없고 전제로도 쓰이지 않는 스킬은 독립 스킬", () => {
    expect(t.independent).toEqual(["D"]);
  });
  it("트리 안 후보가 하나뿐인 「또는」은 바로 잇고(any), 트리 밖 후보는 outside", () => {
    expect(t.edges.find((e) => e.from === "A" && e.to === "C")).toEqual({ from: "A", to: "C", sl: 3, any: true });
    expect(t.outside.C).toEqual([{ skill: "X", sl: 1 }]);
  });
  it("같은 열에서 행이 겹치지 않는다", () => {
    const seen = new Set(t.nodes.map((n) => `${n.col}:${n.row}`));
    expect(seen.size).toBe(t.nodes.length);
  });
  it("같은 「또는」 묶음은 분기점 하나를 함께 쓰고, 필요한 SL은 분기점→스킬 선에", () => {
    const or = (sl) => ({ all: [{ any: [{ skill: "검", sl }, { skill: "채찍", sl }] }] });
    const u = treeLayout([
      { name: "검", prereqs: { all: [] } }, { name: "채찍", prereqs: { all: [] } },
      { name: "P", prereqs: or(1) }, { name: "Q", prereqs: or(3) }
    ]);
    const ors = u.nodes.filter((n) => n.kind === "or");
    expect(ors).toHaveLength(1);
    expect(ors[0].col).toBe(1);
    expect(u.edges.filter((e) => e.to === ors[0].id).map((e) => [e.from, e.sl])).toEqual([["검", null], ["채찍", null]]);
    expect(u.edges.filter((e) => e.from === ors[0].id).map((e) => [e.to, e.sl])).toEqual([["P", 1], ["Q", 3]]);
    expect(u.nodes.find((n) => n.id === "P").col).toBe(2);
  });
});

describe("습득 규칙", () => {
  const sl = (m) => (n) => m[n] ?? 0;
  it("전제 조건(그리고·또는)", () => {
    expect(prereqsMet(C.prereqs, sl({ B: 1, A: 3 }))).toBe(true);
    expect(prereqsMet(C.prereqs, sl({ B: 1, X: 1 }))).toBe(true);
    expect(prereqsMet(C.prereqs, sl({ B: 1, A: 2 }))).toBe(false);
  });
  it("한 스킬 최대 SL: Lv1은 2, 레벨마다 +1", () => {
    expect(levelCap(1)).toBe(2);
    expect(levelCap(4)).toBe(5);
  });
  it("합계 SL: 작성 5 + 레벨업마다 3, 커먼 1SL과 고유 스킬은 예산 밖", () => {
    const b = skillBudget({ level: 2, skills: [{ sl: 2 }, { sl: 1, common: true }, { sl: 1, unique: true }, { sl: 3 }] });
    expect(b).toEqual({ total: 8, spent: 5, left: 3 });
    expect(skillBudget({ level: 1, skills: [{ sl: 1, common: true }, { sl: 1, common: true }] }).spent).toBe(1);
  });
  const base = { skill: { name: "B", maxSL: { main: 3, sub: 2 }, prereqs: B.prereqs }, role: "main", slOf: sl({ A: 2 }), level: 1, budgetLeft: 5 };
  it("조건을 채우면 올릴 수 있다", () => {
    expect(canRaise(base)).toEqual({ ok: true, max: 3 });
  });
  it("전제 미충족·예산 없음·레벨 상한·MaxSL", () => {
    expect(canRaise({ ...base, slOf: sl({ A: 1 }) }).reason).toBe("prereq");
    expect(canRaise({ ...base, budgetLeft: 0 }).reason).toBe("budget");
    expect(canRaise({ ...base, current: 2 }).reason).toBe("levelCap");
    expect(canRaise({ ...base, current: 3, level: 5 }).reason).toBe("maxed");
  });
  it("이미 가진 스킬을 올릴 때는 전제를 다시 보지 않는다", () => {
    expect(canRaise({ ...base, current: 1, slOf: sl({}) }).ok).toBe(true);
  });
  it("서브 클래스: MaxSL 서브 값, - 이면 불가, 메인에 같은 스킬이 있으면 불가", () => {
    expect(canRaise({ ...base, role: "sub", current: 2, level: 5 }).reason).toBe("maxed");
    expect(canRaise({ ...base, role: "sub", skill: { ...base.skill, maxSL: { main: 1, sub: null } } }).reason).toBe("subNotAllowed");
    expect(canRaise({ ...base, role: "sub", mainHasSame: true }).reason).toBe("sameInMain");
  });
  it("고유 스킬은 손으로 찍지 않는다(자동 습득)", () => {
    const u = { ...base, skill: { name: "U", maxSL: { main: 1, sub: null }, unique: true, prereqs: { all: [] } }, budgetLeft: 0 };
    expect(canRaise(u).reason).toBe("uniqueAuto");
    expect(canRaise({ ...u, hasSub: true }).reason).toBe("uniqueWithSub");
  });
  it("GM 보너스 SL은 예산에 더해진다", () => {
    expect(skillBudget({ level: 1, skills: [{ sl: 5 }], bonus: 2 })).toEqual({ total: 7, spent: 5, left: 2 });
  });
  it("고유 스킬 자동 습득: 서브 없으면 메인 것을 더하고, 서브가 생기거나 메인이 바뀌면 지운다", () => {
    const uniques = [{ classKey: "M", skillKey: "u1" }, { classKey: "N", skillKey: "u2" }];
    expect(uniqueSkillPlan({ mainKey: "M", hasSub: false, uniques, owned: [] })).toEqual({ remove: [], add: [uniques[0]] });
    const owned = [{ id: "i1", classKey: "M", skillKey: "u1", unique: true }, { id: "i2", classKey: "M", skillKey: "x", unique: false }];
    expect(uniqueSkillPlan({ mainKey: "M", hasSub: false, uniques, owned })).toEqual({ remove: [], add: [] });
    expect(uniqueSkillPlan({ mainKey: "M", hasSub: true, uniques, owned })).toEqual({ remove: ["i1"], add: [] });
    expect(uniqueSkillPlan({ mainKey: "N", hasSub: false, uniques, owned })).toEqual({ remove: ["i1"], add: [uniques[1]] });
  });
  it("SL을 내리면 깨지는 전제", () => {
    const owned = [{ name: "A", sl: 2, prereqs: A.prereqs }, { name: "B", sl: 1, prereqs: B.prereqs }];
    expect(brokenByLowering("A", 1, owned)).toEqual(["B"]);
    expect(brokenByLowering("B", 0, owned)).toEqual([]);
  });
});

describe("커스텀 직업 정의 검사", async () => {
  const { validateClassDef, renamePrereqs } = await import("../../src/engine/skills.mjs");
  const sk = (name, prereqs = [], extra = {}) => ({ name, maxSL: { main: 5, sub: 3 }, prereqs: { all: prereqs }, ...extra });
  const codes = (r) => r.errors.map((e) => e.code);
  it("정상", () => {
    const r = validateClassDef({ skills: [sk("A"), sk("B", [{ skill: "A", sl: 1 }]), sk("C", [{ any: [{ skill: "A", sl: 1 }, { skill: "B", sl: 2 }] }]), sk("U", [], { unique: true, maxSL: { main: null } })] });
    expect(r.errors).toEqual([]);
  });
  it("없는 선행·SL 초과·순환·★ 2개·이름 중복·서브>메인", () => {
    expect(codes(validateClassDef({ skills: [sk("A", [{ skill: "X", sl: 1 }])] }))).toContain("missingPrereq");
    expect(codes(validateClassDef({ skills: [sk("A"), sk("B", [{ skill: "A", sl: 6 }])] }))).toContain("prereqOverMax");
    const cyc = validateClassDef({ skills: [sk("R"), sk("A", [{ skill: "B", sl: 1 }]), sk("B", [{ skill: "A", sl: 1 }])] });
    expect(codes(cyc)).toContain("cycle");
    expect(codes(validateClassDef({ skills: [sk("U1", [], { unique: true }), sk("U2", [], { unique: true })] }))).toContain("manyUnique");
    expect(codes(validateClassDef({ skills: [sk("A"), sk("A")] }))).toContain("dupName");
    expect(codes(validateClassDef({ skills: [sk("A", [], { maxSL: { main: 2, sub: 3 } })] }))).toContain("subOverMain");
  });
  it("이름 바꾸기는 선행조건도", () => {
    const out = renamePrereqs([sk("A"), sk("B", [{ skill: "A", sl: 1 }]), sk("C", [{ any: [{ skill: "A", sl: 1 }] }])], "A", "Z");
    expect(out[1].prereqs.all[0].skill).toBe("Z");
    expect(out[2].prereqs.all[0].any[0].skill).toBe("Z");
  });
});
