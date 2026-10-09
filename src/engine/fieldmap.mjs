/**
 * 필드 지도(베이직 던전, 단계 9.5). Foundry 비의존. data/raw/rules/베이직-던전.md
 * - 지도 정의 map: { id, name, start, startHour, areas[], passages[], foes[], triggers[] }
 *   area: { id, name, x, y, terrain, gmNote, secret, gather, tags[], triggers[] }
 *   passage: { id, a, b, oneWay(a→b만), state: open|locked|hidden, label }
 *   foe: { id, actorUuid, name, route[], mode: stay|loop|pingpong, every, nightOnly, active }
 *   trigger: { id, on, n, once, text, playerText, actions[] }
 *     에어리어 on: enter(들어올 때마다) · visit(n번째 방문) · search(조사) · leave(떠날 때)
 *     지도 on: move(이동할 때마다) · segment(n세그먼트마다)
 * - 진행 상태 state: { mapId, active, current, segment, hour, visited{id:n}, revealed{areas[],passages[]}, passageState{id:state},
 *   foePos{id:area}, foeStep{id:{i,dir}}, foeGone[], fired{triggerId:n}, log[] }
 * 함수는 상태를 바꾸지 않고 새 상태를 돌려준다.
 */
import { timeOfDayAt } from "./dungeon.mjs";

export const PASSAGE_STATES = ["open", "locked", "hidden"];
export const FOE_MODES = ["stay", "loop", "pingpong", "chase"];
export const AREA_TRIGGERS = ["enter", "visit", "search", "leave"];
export const MAP_TRIGGERS = ["move", "segment"];

const clone = (o) => JSON.parse(JSON.stringify(o ?? {}));
const otherEnd = (p, id) => (p.a === id ? p.b : p.b === id ? p.a : null);
const areaOf = (map, id) => (map.areas ?? []).find((a) => a.id === id) ?? null;

export const passageState = (state, p) => state?.passageState?.[p.id] ?? p.state ?? "open";
const revealedHas = (state, kind, id) => (state?.revealed?.[kind] ?? []).includes(id);

/** 플레이어가 그 에어리어의 존재를 알 수 있는가(비밀이면 공개 뒤에만) */
export const areaKnown = (map, state, id) => {
  const a = areaOf(map, id);
  return !!a && (!a.secret || revealedHas(state, "areas", id));
};

/** 통로가 플레이어에게 보이는가: 숨김(비밀 통로)이 아니고 양 끝 에어리어를 알 수 있다 */
export const passageKnown = (map, state, p) => passageState(state, p) !== "hidden" && areaKnown(map, state, p.a) && areaKnown(map, state, p.b);

/** from에서 이 통로로 지금 지나갈 수 있는가 */
export function usable(map, state, p, from) {
  if (!passageKnown(map, state, p) || passageState(state, p) !== "open") return false;
  return from === p.a || (!p.oneWay && from === p.b);
}

/** 두 에어리어 사이 통로(아무 상태) */
export const passageBetween = (map, x, y) => (map.passages ?? []).find((p) => (p.a === x && p.b === y) || (p.a === y && p.b === x)) ?? null;

/** 지금 갈 수 있는 에어리어 */
export const reachableFrom = (map, state, from) =>
  [...new Set((map.passages ?? []).filter((p) => usable(map, state, p, from)).map((p) => otherEnd(p, from)))];

/** 플레이어가 아는 통로로 이어진 이웃(상태 무관) */
const knownNeighbors = (map, state, id) =>
  (map.passages ?? []).filter((p) => (p.a === id || p.b === id) && passageKnown(map, state, p)).map((p) => otherEnd(p, id));

/**
 * 플레이어 화면에 그릴 것
 * explored: 한 번이라도 밟은 에어리어 / reachable: 현재 위치에서 지금 갈 수 있는 곳
 * frontier: 밟은 에어리어의 인접(아는 통로로) 중 아직 안 밟은 곳(이론상 갈 수 있는 곳)
 * passages: 밟은 에어리어에 닿는 아는 통로 / foes: 현재 위치·인접에 있는 F.O.E.
 */
export function playerView(map, state) {
  const visited = state?.visited ?? {};
  const explored = (map.areas ?? []).filter((a) => visited[a.id] > 0 && areaKnown(map, state, a.id)).map((a) => a.id);
  const current = state?.current ?? null;
  const reachable = current ? reachableFrom(map, state, current) : [];
  const frontier = [...new Set(explored.flatMap((id) => knownNeighbors(map, state, id)))].filter((id) => !(visited[id] > 0));
  const shown = new Set([...explored, ...frontier, ...(current ? [current] : [])]);
  const passages = (map.passages ?? []).filter((p) => passageKnown(map, state, p) && (explored.includes(p.a) || explored.includes(p.b))).map((p) => ({ ...p, state: passageState(state, p) }));
  const near = new Set(current ? [current, ...knownNeighbors(map, state, current)] : []);
  const foes = activeFoes(map, state).filter((f) => near.has(state.foePos?.[f.id])).map((f) => ({ id: f.id, name: f.name, actorUuid: f.actorUuid, area: state.foePos[f.id] }));
  return { current, explored, reachable, frontier, shown: [...shown], passages, foes };
}

const activeFoes = (map, state) => (map.foes ?? []).filter((f) => f.active !== false && !(state?.foeGone ?? []).includes(f.id) && state?.foePos?.[f.id]);

/** 진행 시작 상태 */
export function startState(map, { hour } = {}) {
  const start = map.start ?? map.areas?.[0]?.id ?? null;
  const foePos = {};
  const foeStep = {};
  for (const f of map.foes ?? []) {
    if (!f.route?.length) continue;
    foePos[f.id] = f.route[0];
    foeStep[f.id] = { i: 0, dir: 1 };
  }
  return {
    mapId: map.id, active: true, current: start, segment: 0, hour: hour ?? map.startHour ?? 8,
    visited: start ? { [start]: 1 } : {}, revealed: { areas: [], passages: [] }, passageState: {},
    foePos, foeStep, foeGone: [], fired: {}, log: []
  };
}

/** F.O.E. 한 세그먼트 이동(동시). 반환 { foePos, foeStep, used{id: passageId|null} } */
export function stepFoes(map, state, segment, hour) {
  const foePos = { ...(state.foePos ?? {}) };
  const foeStep = clone(state.foeStep);
  const used = {};
  const night = timeOfDayAt(hour) === "night";
  for (const f of activeFoes(map, state)) {
    const route = f.route ?? [];
    const every = Math.max(1, Number(f.every) || 1);
    if (segment % every !== 0 || (f.nightOnly && !night)) continue;
    // 추적: 파티가 range칸(통로 기준) 안이면 파티 쪽으로 한 칸(07 임시). 아니면 루트를 순회
    if (f.mode === "chase" && state.current) {
      const next = chaseStep(map, state, foePos[f.id], state.current, Math.max(1, Number(f.range) || 1));
      if (next) {
        used[f.id] = passageBetween(map, foePos[f.id], next)?.id ?? null;
        foePos[f.id] = next;
        continue;
      }
    }
    if (f.mode === "stay" || route.length < 2) continue;
    const st = foeStep[f.id] ?? { i: 0, dir: 1 };
    let i = st.i;
    let dir = st.dir || 1;
    if (f.mode === "pingpong") {
      if (i + dir >= route.length || i + dir < 0) dir = -dir;
      i += dir;
    } else i = (i + 1) % route.length;
    const from = foePos[f.id];
    const to = route[i];
    foeStep[f.id] = { i, dir };
    foePos[f.id] = to;
    used[f.id] = from !== to ? passageBetween(map, from, to)?.id ?? null : null;
  }
  return { foePos, foeStep, used };
}

/** F.O.E.가 지나갈 수 있는 통로: 열린 통로(비밀·잠김 제외), 한 방향은 그 방향만 */
const foeNeighbors = (map, state, id) => (map.passages ?? [])
  .filter((p) => passageState(state, p) === "open" && (p.a === id || (!p.oneWay && p.b === id)))
  .map((p) => otherEnd(p, id));

/** from에서 to까지 최단 경로의 첫 칸(거리가 maxDist 이하일 때만). 같은 칸이면 null */
export function chaseStep(map, state, from, to, maxDist = 1) {
  if (!from || !to || from === to) return null;
  const prev = new Map([[from, null]]);
  let frontier = [from];
  for (let d = 1; d <= maxDist && frontier.length; d++) {
    const next = [];
    for (const n of frontier) {
      for (const m of foeNeighbors(map, state, n)) {
        if (prev.has(m)) continue;
        prev.set(m, n);
        if (m === to) {
          let cur = m;
          while (prev.get(cur) !== from) cur = prev.get(cur);
          return cur;
        }
        next.push(m);
      }
    }
    frontier = next;
  }
  return null;
}

/**
 * 조우: 같은 칸에 있거나, 같은 세그먼트에 같은 통로를 서로 반대로 지났다(칸만 맞바꾼 건 통로가 다르면 조우 아님)
 * @param {{from, to, passage}} party 파티 이동(머물렀으면 from === to, passage null)
 */
export function encounters(map, state, party, foeMove) {
  const out = [];
  for (const f of activeFoes({ ...map }, { ...state, foePos: foeMove.foePos })) {
    const fFrom = state.foePos?.[f.id];
    const fTo = foeMove.foePos[f.id];
    const same = fTo === party.to;
    const crossed = party.passage && foeMove.used[f.id] === party.passage && fFrom === party.to && fTo === party.from;
    if (same || crossed) out.push({ foeId: f.id, name: f.name, actorUuid: f.actorUuid, area: party.to, how: same ? "same" : "passage" });
  }
  return out;
}

/** 이 사건에 발동할 트리거(once로 이미 발동한 것 제외) */
export function triggersFor(list, on, { visitN = 0, segment = 0 } = {}, fired = {}) {
  return (list ?? []).filter((t) => {
    if (t.on !== on) return false;
    if (t.once && fired[t.id] > 0) return false;
    const n = Number(t.n) || 0;
    if (on === "visit") return n ? visitN === n : visitN === 1;
    if (on === "segment") return n > 0 && segment > 0 && segment % n === 0;
    return true;
  });
}

/**
 * 세그먼트 진행. to가 있으면 이동(통로 사용), 없으면 그 자리에서 행동(채집·조사·캠프 등)
 * @returns {{ state, encounters, triggers: {scope, areaId, trigger}[], error? }}
 */
export function advance(map, state, { to = null, segments = 1, hours = null } = {}) {
  let s = clone(state);
  const from = s.current;
  let passage = null;
  if (to && to !== from) {
    const p = (map.passages ?? []).find((x) => usable(map, s, x, from) && otherEnd(x, from) === to);
    if (!p) return { state, encounters: [], triggers: [], error: "notReachable" };
    passage = p.id;
  }
  const found = [];
  const trig = [];
  const n = Math.max(1, segments);
  const perHour = hours ?? n;
  for (let k = 0; k < n; k++) {
    const segment = s.segment + 1;
    const hour = (s.hour + Math.round(perHour / n)) % 24;
    const moving = k === 0 && passage;
    const foeMove = stepFoes(map, s, segment, hour);
    const party = moving ? { from, to, passage } : { from: s.current, to: s.current, passage: null };
    found.push(...encounters(map, s, party, foeMove));
    s = { ...s, segment, hour, foePos: foeMove.foePos, foeStep: foeMove.foeStep };
    for (const t of triggersFor(map.triggers, "segment", { segment }, s.fired)) trig.push({ scope: "map", trigger: t });
    if (moving) {
      for (const t of triggersFor(areaOf(map, from)?.triggers, "leave", {}, s.fired)) trig.push({ scope: "area", areaId: from, trigger: t });
      s.current = to;
      s.visited = { ...s.visited, [to]: (s.visited?.[to] ?? 0) + 1 };
      for (const t of triggersFor(map.triggers, "move", {}, s.fired)) trig.push({ scope: "map", trigger: t });
      trig.push(...arrivalTriggers(map, s, to));
    }
  }
  return { state: s, encounters: found, triggers: trig, passage };
}

/** 도착 트리거(enter·visit n). 강제 이동(세그먼트 없음)에도 쓴다 */
export function arrivalTriggers(map, state, areaId) {
  const a = areaOf(map, areaId);
  const visitN = state.visited?.[areaId] ?? 0;
  return [
    ...triggersFor(a?.triggers, "enter", {}, state.fired),
    ...triggersFor(a?.triggers, "visit", { visitN }, state.fired)
  ].map((t) => ({ scope: "area", areaId, trigger: t }));
}

/** 시간이 흐르지 않는 이동(트리거 move 액션 등): 방문 횟수만 올리고 도착 트리거 */
export function teleport(map, state, to) {
  const s = clone(state);
  s.current = to;
  s.visited = { ...s.visited, [to]: (s.visited?.[to] ?? 0) + 1 };
  return { state: s, triggers: arrivalTriggers(map, s, to) };
}

/** 조사: 그 에어리어의 search 트리거 */
export const searchTriggers = (map, state, areaId = state.current) =>
  triggersFor(areaOf(map, areaId)?.triggers, "search", {}, state.fired).map((t) => ({ scope: "area", areaId, trigger: t }));

/** 트리거 발동 기록 */
export function markFired(state, triggerId) {
  const s = clone(state);
  s.fired = { ...s.fired, [triggerId]: (s.fired?.[triggerId] ?? 0) + 1 };
  return s;
}

/** 공개(비밀 에어리어·통로). 숨김 통로는 열린 통로가 된다 */
export function reveal(map, state, { area, passage } = {}) {
  const s = clone(state);
  s.revealed = { areas: [...(s.revealed?.areas ?? [])], passages: [...(s.revealed?.passages ?? [])] };
  if (area && !s.revealed.areas.includes(area)) s.revealed.areas.push(area);
  if (passage) {
    if (!s.revealed.passages.includes(passage)) s.revealed.passages.push(passage);
    const p = (map.passages ?? []).find((x) => x.id === passage);
    if (p && passageState(s, p) === "hidden") s.passageState = { ...s.passageState, [passage]: "open" };
  }
  return s;
}

/** 통로 상태 바꾸기(잠김 해제 등) */
export const setPassage = (state, passage, st) => ({ ...clone(state), passageState: { ...(state.passageState ?? {}), [passage]: st } });

/** F.O.E. 제거(쓰러뜨림·떠남) */
export const removeFoe = (state, foeId) => ({ ...clone(state), foeGone: [...new Set([...(state.foeGone ?? []), foeId])] });

/** 지도 검사: 오류(진행 불가)와 경고 */
export function validateMap(map) {
  const errors = [];
  const warnings = [];
  const ids = new Set((map.areas ?? []).map((a) => a.id));
  if (!ids.size) errors.push({ code: "noAreas" });
  if (ids.size && !ids.has(map.start)) errors.push({ code: "noStart" });
  for (const p of map.passages ?? []) if (!ids.has(p.a) || !ids.has(p.b) || p.a === p.b) errors.push({ code: "badPassage", id: p.id });
  for (const a of map.areas ?? []) if (ids.size > 1 && !(map.passages ?? []).some((p) => p.a === a.id || p.b === a.id)) warnings.push({ code: "isolated", id: a.id, name: a.name });
  for (const f of map.foes ?? []) {
    if (!(f.route ?? []).length) { warnings.push({ code: "foeNoRoute", id: f.id, name: f.name }); continue; }
    if (f.route.some((r) => !ids.has(r))) errors.push({ code: "foeBadRoute", id: f.id, name: f.name });
    const hops = f.route.map((r, i) => [r, f.route[i + 1] ?? (f.mode === "loop" ? f.route[0] : null)]).filter(([x, y]) => y && x !== y);
    if (hops.some(([x, y]) => !passageBetween(map, x, y))) warnings.push({ code: "foeNoPassage", id: f.id, name: f.name });
  }
  return { errors, warnings };
}

/**
 * 이동 제안 투표 결과. proposal: { voters: [userId|"gm"], answers: { userId|"gm": true|false } }
 * 한 명이라도 거절 → rejected, 모두 승낙 → accepted, 그 밖 → pending
 */
export function voteResult(proposal) {
  const ans = proposal?.answers ?? {};
  const voters = proposal?.voters ?? [];
  if (voters.some((v) => ans[v] === false)) return "rejected";
  return voters.every((v) => ans[v] === true) ? "accepted" : "pending";
}
