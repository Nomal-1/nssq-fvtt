/**
 * 전투 고유 상태(07 #57): 강화·약화·상태 이상으로 취급하지 않는 클래스 고유 상태.
 * 무사 《상단의 자세》·《청안의 자세》·《발도의 자세》, 모노노후 《나찰》 등.
 * - 해제 스킬(《리프레시》 등)·약화 해제로 지워지지 않고, 전투가 끝나면 사라진다
 * - 같은 group(예: 무사의 자세)은 하나만: 새 것을 쓰면 앞의 것은 사라진다(07 #57)
 * - 같은 id를 다시 쓰면 갱신(SL이 바뀌었으면 새 값). max가 있으면 쌓인다(stacks ≤ max)
 * 모양: { id, name, group?, mods: { path: number }, stacks?, max?, note? }
 * Foundry 비의존.
 */

/**
 * @param {object[]} list
 * @param {object} state
 * @returns {{ list: object[], result: "added"|"updated"|"stacked"|"replaced", removed: object[] }}
 */
export function addState(list, state) {
  const cur = [...(list ?? [])];
  const same = cur.findIndex((s) => s.id === state.id);
  if (same >= 0) {
    const old = cur[same];
    if (state.max) {
      const stacks = Math.min(state.max, (old.stacks ?? 1) + 1);
      cur[same] = { ...old, ...state, stacks };
      return { list: cur, result: "stacked", removed: [] };
    }
    cur[same] = { ...old, ...state };
    return { list: cur, result: "updated", removed: [] };
  }
  const removed = state.group ? cur.filter((s) => s.group === state.group) : [];
  const next = cur.filter((s) => !removed.includes(s));
  next.push({ ...state, ...(state.max ? { stacks: 1 } : {}) });
  return { list: next, result: removed.length ? "replaced" : "added", removed };
}

export const removeState = (list, id) => (list ?? []).filter((s) => s.id !== id);

export const hasState = (list, id) => (list ?? []).some((s) => s.id === id);

/** 부능력치 보정 합계(쌓이는 상태는 값 × stacks) */
export function stateMods(list) {
  const out = {};
  for (const s of list ?? []) {
    const k = s.max ? s.stacks ?? 1 : 1;
    for (const [path, v] of Object.entries(s.mods ?? {})) out[path] = (out[path] ?? 0) + (Number(v) || 0) * k;
  }
  return out;
}
