import { describe, expect, it } from "vitest";
import {
  applyAssignment, initialMoney, isValidAssignment, orderedAssignment, randomAssignment, rollAbilityScores
} from "../../src/engine/chargen.mjs";

describe("능력치 굴리기 (캐릭터 작성 §1)", () => {
  it("3D6을 5번, 굴린 순서대로", () => {
    const seq = [1, 2, 3, 6, 6, 6, 4, 4, 4, 1, 1, 1, 5, 5, 2];
    const r = rollAbilityScores(() => seq.shift());
    expect(r.map((x) => x.total)).toEqual([6, 18, 12, 3, 12]);
    expect(r[0].dice).toEqual([1, 2, 3]);
  });

  it("순서대로 배치", () => {
    expect(applyAssignment([14, 12, 10, 8, 6], orderedAssignment())).toEqual({ str: 14, tec: 12, vit: 10, agi: 8, luc: 6 });
  });

  it("랜덤 배치는 값을 옮기지 않고 자리만 바꾼다", () => {
    const totals = [14, 12, 10, 8, 6];
    for (let t = 0; t < 20; t++) {
      const slots = randomAssignment(Math.random);
      expect(isValidAssignment(slots)).toBe(true);
      expect(Object.values(applyAssignment(totals, slots)).sort((a, b) => b - a)).toEqual(totals);
    }
  });

  it("랜덤 배치는 주입한 난수를 쓴다", () => {
    expect(randomAssignment(() => 0)).toEqual([1, 2, 3, 4, 0]);
  });

  it("같은 값을 두 번 쓰는 배정은 거부", () => {
    expect(isValidAssignment([0, 0, 1, 2, 3])).toBe(false);
    expect(isValidAssignment([0, 1, 2, 3])).toBe(false);
    expect(() => applyAssignment([1, 2, 3, 4, 5], [0, 0, 1, 2, 3])).toThrow();
  });

  it("초기 소지금 = (100 − 합계) × 10G", () => {
    expect(initialMoney([14, 12, 10, 8, 6])).toBe(500);
  });
});

describe("작성 검사·경력표 (단계 10)", async () => {
  const { rollCareer, validateCreation, creationReady } = await import("../../src/engine/chargen.mjs");
  const { skillBudget, levelCap, prereqsMet } = await import("../../src/engine/skills.mjs");
  const { canEquip } = await import("../../src/engine/equipment.mjs");
  // 샘플 03 수호의 성기사(팔라딘, 서브 없음): 12/11/13/10/11
  const paladin = { weapons: ["검", "창"], armors: ["중갑", "경갑", "옷", "방패"] };
  const base = () => ({
    rolls: [12, 11, 13, 10, 11], abilities: { str: 12, tec: 11, vit: 13, agi: 10, luc: 11 },
    mainClass: "パラディン", subClass: null,
    skills: [
      { name: "완전 방어", sl: 1, unique: true, classKey: "パラディン" },
      { name: "방패 마스터리", sl: 2, classKey: "パラディン", maxSL: { main: 5 } },
      { name: "프런트 가드", sl: 1, classKey: "パラディン", maxSL: { main: 5 }, prereqs: { all: [{ skill: "방패 마스터리", sl: 1 }] } },
      { name: "백 가드", sl: 1, classKey: "パラディン", maxSL: { main: 5 }, prereqs: { all: [{ skill: "방패 마스터리", sl: 1 }] } },
      { name: "디바이드 가드", sl: 1, classKey: "パラディン", maxSL: { main: 5 }, prereqs: { all: [{ skill: "방패 마스터리", sl: 1 }] } },
      { name: "기승", sl: 1, common: true, classKey: "common", maxSL: { main: 1 } }
    ],
    equipped: [{ name: "검", type: "weapon", system: { weaponType: "검", slot: "weapon" } }, { name: "중갑", type: "armor", system: { armorType: "중갑" } }, { name: "방패", type: "armor", system: { armorType: "방패" } }],
    classes: { main: paladin, sub: null }, carried: 0, capacity: 7, money: 100,
    canEquip, skillRules: { skillBudget, levelCap, prereqsMet }
  });
  const failed = (c) => c.filter((x) => !x.ok).map((x) => x.code);

  it("샘플 03 팔라딘은 통과", () => {
    const c = validateCreation(base());
    expect(failed(c)).toEqual([]);
    expect(creationReady(c)).toBe(true);
  });
  it("능력치 옮기기·커먼 없음·예산 초과·Lv1 상한·전제 없음", () => {
    let p = base(); p.abilities.str = 13; p.abilities.vit = 12;
    expect(failed(validateCreation(p))).toEqual([]);
    p = base(); p.abilities.str = 14;
    expect(failed(validateCreation(p))).toContain("abilities");
    p = base(); p.skills = p.skills.filter((s) => !s.common);
    expect(failed(validateCreation(p))).toContain("common");
    p = base(); p.skills[1].sl = 3;
    expect(failed(validateCreation(p))).toEqual(expect.arrayContaining(["budgetOver", "levelCap"]));
    p = base(); p.skills[1].sl = 0; p.skills.push({ name: "임전 태세", sl: 1, classKey: "パラディン", maxSL: { main: 5 } });
    expect(failed(validateCreation(p))).toContain("prereq");
  });
  it("서브: ★ 없어야, 서브 MaxSL, 방어구는 메인만", () => {
    const p = base();
    p.subClass = "ソードマン";
    p.classes.sub = { weapons: ["검", "도"], armors: ["경갑", "옷"] };
    expect(failed(validateCreation(p))).toContain("unique");
    p.skills = p.skills.filter((s) => !s.unique);
    p.skills[1].sl = 1;
    p.skills.push({ name: "러시", sl: 2, classKey: "ソードマン", maxSL: { main: 5, sub: 1 } });
    expect(failed(validateCreation(p))).toContain("subMax");
    p.skills.at(-1).sl = 1;
    p.classes.main = { weapons: ["검"], armors: ["옷"] };
    expect(failed(validateCreation(p))).toContain("equip");
  });
  it("경력표 D666", () => {
    const entries = [{ roll: "135", text: "가" }];
    const seq = [5, 1, 3];
    const r = rollCareer(() => seq.shift(), entries);
    expect(r.roll).toBe("135");
    expect(r.entry.text).toBe("가");
  });
});
