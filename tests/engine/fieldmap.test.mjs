import { describe, expect, it } from "vitest";
import { advance, playerView, reveal, searchTriggers, setPassage, startState, stepFoes, teleport, markFired, removeFoe, validateMap } from "../../src/engine/fieldmap.mjs";

// 입구 - 숲 - 늪 - 바위 - 숲(고리), 숲 → 꽃밭(한 방향), 늪 - 야영지(잠김), 바위 - 비석(비밀 통로), 동굴(비밀 에어리어, 꽃밭과 연결)
const map = () => ({
  id: "m", start: "gate", startHour: 8,
  areas: ["gate", "forest", "swamp", "rock", "flower", "camp", "stone", "cave"].map((id) => ({ id, name: id, secret: id === "cave", triggers: [] })),
  passages: [
    { id: "p1", a: "gate", b: "forest" },
    { id: "p2", a: "forest", b: "swamp" },
    { id: "p3", a: "swamp", b: "rock" },
    { id: "p4", a: "rock", b: "forest" },
    { id: "p5", a: "forest", b: "flower", oneWay: true },
    { id: "p6", a: "swamp", b: "camp", state: "locked" },
    { id: "p7", a: "rock", b: "stone", state: "hidden" },
    { id: "p8", a: "flower", b: "cave" }
  ],
  foes: [],
  triggers: []
});

describe("필드 지도: 표시 집합", () => {
  it("시작: 현재·탐색·지금 갈 수 있음·이론상", () => {
    const m = map();
    const v = playerView(m, startState(m));
    expect(v.current).toBe("gate");
    expect(v.explored).toEqual(["gate"]);
    expect(v.reachable).toEqual(["forest"]);
    expect(v.frontier).toEqual(["forest"]);
  });
  it("한 방향·잠김·비밀", () => {
    const m = map();
    let s = advance(m, startState(m), { to: "forest" }).state;
    let v = playerView(m, s);
    expect(v.reachable.sort()).toEqual(["flower", "gate", "rock", "swamp"]);
    s = advance(m, s, { to: "swamp" }).state;
    v = playerView(m, s);
    // 잠긴 야영지는 이론상엔 있지만 지금은 못 감, 한 방향 꽃밭은 숲의 이웃이라 이론상
    expect(v.reachable.sort()).toEqual(["forest", "rock"]);
    expect(v.frontier.sort()).toEqual(["camp", "flower", "gate", "rock"].filter((x) => x !== "gate"));
    expect(v.passages.find((p) => p.id === "p6").state).toBe("locked");
    // 꽃밭에서 숲으로는 못 돌아간다
    s = advance(m, advance(m, s, { to: "forest" }).state, { to: "flower" }).state;
    expect(playerView(m, s).reachable).toEqual([]);
    expect(advance(m, s, { to: "forest" }).error).toBe("notReachable");
    // 비밀 통로·비밀 에어리어는 공개 전에 안 보인다
    s = advance(m, startState(m), { to: "forest" }).state;
    s = advance(m, s, { to: "rock" }).state;
    expect(playerView(m, s).frontier).not.toContain("stone");
    s = reveal(m, s, { passage: "p7" });
    expect(playerView(m, s).reachable).toContain("stone");
    const s2 = { ...s, current: "flower", visited: { ...s.visited, flower: 1 } };
    expect(playerView(m, s2).frontier).not.toContain("cave");
    expect(playerView(m, reveal(m, s2, { area: "cave" })).frontier).toContain("cave");
  });
  it("잠김 해제", () => {
    const m = map();
    let s = { ...startState(m), current: "swamp", visited: { swamp: 1 } };
    expect(playerView(m, s).reachable).not.toContain("camp");
    s = setPassage(s, "p6", "open");
    expect(playerView(m, s).reachable).toContain("camp");
  });
  it("세그먼트·시각", () => {
    const m = map();
    const r = advance(m, startState(m, { hour: 17 }), { to: "forest" });
    expect([r.state.segment, r.state.hour]).toEqual([1, 18]);
    const camp = advance(m, r.state, { segments: 6 });
    expect([camp.state.segment, camp.state.hour, camp.state.current]).toEqual([7, 0, "forest"]);
  });
});

describe("필드 지도: F.O.E.", () => {
  const withFoe = (f) => ({ ...map(), foes: [{ id: "f", name: "F", mode: "loop", every: 1, ...f }] });
  it("순회·every 2·왕복·밤에만", () => {
    let m = withFoe({ route: ["rock", "swamp", "forest"], every: 2 });
    let s = startState(m);
    const pos = [];
    for (let i = 0; i < 6; i++) { s = advance(m, s, {}).state; pos.push(s.foePos.f); }
    expect(pos).toEqual(["rock", "swamp", "swamp", "forest", "forest", "rock"]);
    m = withFoe({ route: ["gate", "forest", "swamp"], mode: "pingpong" });
    s = startState(m);
    const pp = [];
    for (let i = 0; i < 5; i++) { pp.push(stepFoes(m, s, s.segment + 1, 8).foePos.f); s = advance(m, s, {}).state; }
    expect(pp).toEqual(["forest", "swamp", "forest", "gate", "forest"]);
    m = withFoe({ route: ["rock", "swamp"], nightOnly: true });
    s = startState(m, { hour: 8 });
    expect(advance(m, s, {}).state.foePos.f).toBe("rock");
    expect(advance(m, { ...s, hour: 20 }, {}).state.foePos.f).toBe("swamp");
  });
  it("조우: 같은 칸·같은 통로, 맞바꾸기는 아님", () => {
    // 파티 숲→늪(p2), F.O.E. 늪→숲(p2): 같은 통로 → 조우
    let m = withFoe({ route: ["swamp", "forest"] });
    let s = { ...startState(m), current: "forest", visited: { forest: 1 } };
    expect(advance(m, s, { to: "swamp" }).encounters).toMatchObject([{ foeId: "f", how: "passage" }]);
    // 파티 숲→바위(p4), F.O.E. 바위→늪(p3): 다른 칸 → 조우 없음
    m = withFoe({ route: ["rock", "swamp"] });
    expect(advance(m, s, { to: "rock" }).encounters).toEqual([]);
    // F.O.E.가 파티가 들어갈 칸으로 → 같은 칸
    m = withFoe({ route: ["rock", "swamp"] });
    expect(advance(m, s, { to: "swamp" }).encounters).toMatchObject([{ how: "same" }]);
    // 보이는 F.O.E.: 현재·인접만
    m = withFoe({ route: ["rock"], mode: "stay" });
    expect(playerView(m, s).foes.map((f) => f.id)).toEqual(["f"]);
    expect(playerView(m, { ...s, current: "gate" }).foes).toEqual([]);
    expect(playerView(m, removeFoe(s, "f")).foes).toEqual([]);
  });
});

describe("필드 지도: 트리거·검사", () => {
  it("n번째 방문·매번·once·조사·이동·떠날 때", () => {
    const m = map();
    m.areas.find((a) => a.id === "forest").triggers = [
      { id: "t1", on: "visit", n: 2, text: "2번째" },
      { id: "t2", on: "enter", once: true },
      { id: "t3", on: "search" },
      { id: "t4", on: "leave" }
    ];
    m.triggers = [{ id: "g1", on: "move" }, { id: "g2", on: "segment", n: 2 }];
    let s = startState(m);
    let r = advance(m, s, { to: "forest" });
    expect(r.triggers.map((t) => t.trigger.id).sort()).toEqual(["g1", "t2"]);
    s = markFired(r.state, "t2");
    r = advance(m, s, { to: "gate" });
    expect(r.triggers.map((t) => t.trigger.id).sort()).toEqual(["g1", "g2", "t4"]);
    r = advance(m, r.state, { to: "forest" });
    expect(r.triggers.map((t) => t.trigger.id).sort()).toEqual(["g1", "t1"]);
    expect(searchTriggers(m, r.state).map((t) => t.trigger.id)).toEqual(["t3"]);
    expect(teleport(m, r.state, "forest").triggers.map((t) => t.trigger.id)).toEqual([]);
  });
  it("지도 검사", () => {
    const m = map();
    expect(validateMap(m).errors).toEqual([]);
    expect(validateMap({ ...m, start: "x" }).errors[0].code).toBe("noStart");
    expect(validateMap({ ...m, passages: [...m.passages, { id: "z", a: "gate", b: "nope" }] }).errors[0].code).toBe("badPassage");
    expect(validateMap({ ...m, foes: [{ id: "f", route: ["gate", "swamp"], mode: "loop" }] }).warnings[0].code).toBe("foeNoPassage");
  });
});
