/**
 * 토큰(소환수·방진, 단계 8-E, 01 §3.11). Foundry 비의존.
 * 토큰: { id, key, name, category: "소환수"|"방진"|…, left(남은 턴), sl, action: { target, effects }, placedRound }
 * - 같은 분류는 동시에 max개(기본 1, 《백수의 왕기》·《다중 방진》 2). 넘으면 가장 오래된 것부터 소멸(07 #77)
 * - 종료 페이즈마다 left −1, 0이면 소멸. 배치자가 쓰러지면 모두 소멸
 */

/** 배치 → { list, removed } */
export function placeToken(list, token, max = 1) {
  const same = (list ?? []).filter((t) => t.category === token.category);
  const over = Math.max(0, same.length + 1 - Math.max(1, max));
  const removed = same.slice(0, over);
  return { list: [...(list ?? []).filter((t) => !removed.includes(t)), token], removed };
}

/** 종료 페이즈: 남은 턴 −1 → { list, removed } */
export function tickTokens(list) {
  const next = (list ?? []).map((t) => ({ ...t, left: (t.left ?? 1) - 1 }));
  return { list: next.filter((t) => t.left > 0), removed: next.filter((t) => t.left <= 0) };
}

/** 분류의 가장 오래된 토큰 하나를 없앤다(《비스트 귀환》·《파진》) → { list, removed } */
export function removeOldest(list, category) {
  const t = (list ?? []).find((x) => !category || x.category === category);
  return { list: (list ?? []).filter((x) => x !== t), removed: t ? [t] : [] };
}

/**
 * 토큰 행동의 대상(무작위로 정한다, 07 #78)
 * @param {string} text 대상 문구(「적 전열 단일」「적 단일」「적 열」「적 관통」「적 전열」「적 전체」「자신」)
 * @param {{id, row, order}[]} foes 살아 있는 적(배치자의 상대 진영)
 * @param {() => number} rng
 * @returns {{ ids: string[], scope: "self"|"single"|"row"|"all" }}
 */
export function tokenTargets(text, foes, rng = Math.random) {
  const t = String(text ?? "");
  const pick = (list) => (list.length ? list[Math.floor(rng() * list.length)] : null);
  if (/자신/.test(t)) return { ids: [], scope: "self" };
  if (/전체/.test(t)) return { ids: foes.map((f) => f.id), scope: "all" };
  const front = foes.filter((f) => f.row === "front");
  // 전열이 비었으면 후열이 전열(전위 전멸 교대 전이라도 남은 적)
  const frontRow = front.length ? front : foes;
  if (/전열/.test(t) && /단일/.test(t)) {
    const f = pick(frontRow);
    return { ids: f ? [f.id] : [], scope: "single" };
  }
  if (/전열/.test(t)) return { ids: frontRow.map((f) => f.id), scope: "row" };
  if (/관통/.test(t)) {
    const first = pick(foes);
    if (!first) return { ids: [], scope: "single" };
    const others = foes.filter((f) => f.row !== first.row);
    const best = Math.min(...others.map((f) => Math.abs((f.order ?? 0) - (first.order ?? 0))));
    const second = pick(others.filter((f) => Math.abs((f.order ?? 0) - (first.order ?? 0)) === best));
    return { ids: second ? [first.id, second.id] : [first.id], scope: "row" };
  }
  if (/열/.test(t)) {
    const f = pick(foes);
    return { ids: f ? foes.filter((x) => x.row === f.row).map((x) => x.id) : [], scope: "row" };
  }
  const f = pick(foes);
  return { ids: f ? [f.id] : [], scope: "single" };
}
