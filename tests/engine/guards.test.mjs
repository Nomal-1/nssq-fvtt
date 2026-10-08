import { describe, expect, it } from "vitest";
import { applySpends, planGuards } from "../../src/engine/guards.mjs";

const pc = (id, x = {}) => ({ id, side: "pc", row: "front", ko: false, defense: 5, stances: [], ...x });
const foe = { id: "e1", side: "enemy", row: "front", ko: false, defense: 0, stances: [] };
const st = (id, name, effects, x = {}) => ({ id, name, key: name, sl: 3, left: 3, guardTargets: [], effects, ...x });
const phys = { kind: "physical", elements: ["slash"], single: true };
const plan = (units, targets, attack = phys, decide) => planGuards({ attack, attacker: { id: "e1", side: "enemy" }, targets, units: [...units, foe], decide });

describe("가드·도발(단계 8-C)", () => {
  it("《도발》: 단일 대상 공격의 대상을 자신으로, 범위 공격은 그대로", async () => {
    const units = [pc("p1"), pc("p2", { stances: [st("s", "도발", [{ type: "provoke" }])] })];
    const r = await plan(units, ["p1"]);
    expect(r.targets).toEqual(["p2"]);
    expect(r.spendNow).toEqual([{ unitId: "p2", stanceId: "s" }]);
    expect((await plan(units, ["p1", "p2"], { ...phys, single: false })).targets).toEqual(["p1", "p2"]);
  });

  it("《인법: 새 부르기》: 선언한 아군에게로(to: target)", async () => {
    const units = [pc("p1"), pc("p2"), pc("p3", { stances: [st("s", "새 부르기", [{ type: "provoke", to: "target" }], { guardTargets: ["p2"] })] })];
    expect((await plan(units, ["p1"])).targets).toEqual(["p2"]);
  });

  it("《캐슬링》: 사용자가 대상이 되면 선언한 아군으로", async () => {
    const units = [pc("p1", { stances: [st("s", "캐슬링", [{ type: "guard", mode: "redirect" }], { left: null, guardTargets: ["p2"] })] }), pc("p2")];
    expect((await plan(units, ["p1"])).targets).toEqual(["p2"]);
  });

  it("《디바이드 가드》 대신 받기, 횟수가 다 되면 그대로. 《디바이드 모드》는 고른 때만", async () => {
    const units = [pc("p1"), pc("p2", { stances: [st("s", "디바이드 가드", [{ type: "guard", mode: "cover", scope: "target" }], { left: 1, guardTargets: ["p1"] })] })];
    expect((await plan(units, ["p1", "p1"], { ...phys, single: false })).targets).toEqual(["p2", "p1"]);
    const mode = [pc("p1"), pc("p2", { stances: [st("s", "디바이드 모드", [{ type: "guard", mode: "cover", scope: "all", optional: true }])] })];
    expect((await plan(mode, ["p1"], phys, () => false)).targets).toEqual(["p1"]);
    expect((await plan(mode, ["p1"], phys, () => true)).targets).toEqual(["p2"]);
    expect((await plan([mode[0], { ...mode[1], autoTrigger: { "디바이드 모드": true } }], ["p1"])).targets).toEqual(["p2"]);
  });

  it("선견술: 해당 속성 공격을 공격자에게 반사(범위면 나머지 무효)", async () => {
    const units = [pc("p1"), pc("p2", { stances: [st("s", "불꽃의 선견술", [{ type: "guard", mode: "reflect", scope: "all", when: { attackKind: "elemental", element: ["fire"] } }])] })];
    const r = await plan(units, ["p1", "p2"], { kind: "elemental", elements: ["fire"], single: false });
    expect(r).toEqual(expect.objectContaining({ targets: ["e1"], reflected: true }));
    expect(r.notes[0]).toEqual(expect.objectContaining({ type: "reflect", nullified: 1 }));
    expect((await plan(units, ["p1"], { kind: "elemental", elements: ["ice"], single: true })).targets).toEqual(["p1"]);
  });

  it("《프런트 가드》 반감은 전위만·물리만, 횟수만큼. 《센티널 가드》 【방어】, 《룬의 장벽》 【내성】", async () => {
    const half = st("h", "프런트 가드", [{ type: "guard", mode: "half", scope: "front", when: { attackKind: "physical" } }], { left: 1 });
    const senti = st("d", "센티널 가드", [{ type: "guard", mode: "defense", scope: "target" }], { guardTargets: ["p3"] });
    const rune = st("r", "룬의 장벽", ["fire", "ice"].map((k) => ({ type: "aura", path: `resist.${k}`, value: "SL", scope: "all" })), { left: null });
    const units = [pc("p1"), pc("p2"), pc("p3", { row: "back" }), pc("p4", { defense: 12, stances: [half, senti, rune] })];
    const r = await plan(units, ["p1", "p2", "p3"], { ...phys, single: false });
    expect(r.mods.p1.half).toBeTruthy();
    expect(r.mods.p2.half).toBeUndefined();
    expect(r.mods.p3).toEqual(expect.objectContaining({ defense: expect.objectContaining({ value: 12 }), resist: { fire: 3, ice: 3 } }));
    expect(r.spendOnHit.p1).toEqual([{ unitId: "p4", stanceId: "h" }]);
    expect((await plan(units, ["p1"], { kind: "elemental", elements: ["fire"], single: true })).mods.p1.half).toBeUndefined();
  });

  it("횟수 차감: 0이 되면 대기 상태가 빠진다", () => {
    const m = applySpends([{ unitId: "p", stanceId: "a" }, { unitId: "p", stanceId: "a" }], () => [{ id: "a", left: 2 }, { id: "b", left: null }]);
    expect(m.get("p")).toEqual([{ id: "b", left: null }]);
  });
});
