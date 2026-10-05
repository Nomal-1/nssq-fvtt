/**
 * 전투 진형: (진영, 열, 칸)으로만 위치를 관리하고 좌표는 계산한다.
 * - 파티: 전위·후위 각 3칸 고정(01 §3.2 「PC는 전위·후위 각 3명까지」)
 * - 에너미: 열마다 수만큼 가운데 정렬, 많으면 간격을 좁힌다
 */

export const PARTY_SLOTS = 3;
export const LAYOUT = {
  width: 3000,
  grid: 100,
  spacing: 250,
  maxRowWidth: 2600,
  lanes: { enemyBack: 400, enemyFront: 750, partyFront: 1250, partyBack: 1600 }
};

/** 파티 칸 i(0~2)의 중심 x */
export function partySlotX(i, layout = LAYOUT) {
  return layout.width / 2 + (i - (PARTY_SLOTS - 1) / 2) * layout.spacing;
}

/** 에너미 n체 중 i번째 중심 x(가운데 정렬, 폭이 넘치면 간격 축소) */
export function enemySlotX(i, n, layout = LAYOUT) {
  const spacing = n > 1 ? Math.min(layout.spacing, layout.maxRowWidth / (n - 1)) : 0;
  return layout.width / 2 + (i - (n - 1) / 2) * spacing;
}

/**
 * 파티 칸 배정: 저장된 칸(order)을 존중하고, 겹치거나 범위 밖이면 빈 칸을 준다.
 * 한 열에 3명을 넘으면 넘친 사람은 다른 열의 빈 칸으로 보낸다(그래도 없으면 overflow).
 * @param {{id, row: "front"|"back", order: number}[]} units
 * @returns {{ slots: Record<string, {row, index}>, moved: string[], overflow: string[] }}
 */
export function assignPartySlots(units) {
  const taken = { front: new Array(PARTY_SLOTS).fill(null), back: new Array(PARTY_SLOTS).fill(null) };
  const slots = {};
  const moved = [];
  const overflow = [];
  const pending = [];
  // 1) 저장된 칸을 먼저(앞의 사람 우선)
  for (const u of units) {
    const row = u.row === "back" ? "back" : "front";
    const i = Number.isInteger(u.order) ? u.order : -1;
    if (i >= 0 && i < PARTY_SLOTS && !taken[row][i]) {
      taken[row][i] = u.id;
      slots[u.id] = { row, index: i };
    } else pending.push({ ...u, row });
  }
  // 2) 남은 사람은 같은 열의 빈 칸, 없으면 다른 열
  for (const u of pending) {
    const tryRow = (row) => {
      const i = taken[row].indexOf(null);
      if (i < 0) return false;
      taken[row][i] = u.id;
      slots[u.id] = { row, index: i };
      return true;
    };
    if (tryRow(u.row)) continue;
    const other = u.row === "front" ? "back" : "front";
    if (tryRow(other)) moved.push(u.id);
    else overflow.push(u.id);
  }
  return { slots, moved, overflow };
}

/** 열 안의 빈 칸(자기 자리 제외)과 차지한 사람 */
export function partyRowSlots(units, row, selfId = null) {
  const r = assignPartySlots(units).slots;
  return Array.from({ length: PARTY_SLOTS }, (_, i) => {
    const who = Object.entries(r).find(([, s]) => s.row === row && s.index === i)?.[0] ?? null;
    return { index: i, occupant: who, free: !who || who === selfId };
  });
}

/**
 * 진형 전체의 토큰 중심 좌표
 * @param {{party: {id,row,order}[], enemies: {id,row,order}[]}} f
 * @returns {Record<string, {x, y, row, index}>}
 */
export function formationPositions({ party = [], enemies = [] }, layout = LAYOUT) {
  const out = {};
  const { slots } = assignPartySlots(party);
  for (const [id, s] of Object.entries(slots)) {
    out[id] = { x: partySlotX(s.index, layout), y: s.row === "front" ? layout.lanes.partyFront : layout.lanes.partyBack, row: s.row, index: s.index };
  }
  for (const row of ["front", "back"]) {
    const list = enemies.filter((e) => (e.row === "back" ? "back" : "front") === row)
      .map((e, i) => ({ ...e, i }))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.i - b.i);
    list.forEach((e, i) => {
      out[e.id] = { x: enemySlotX(i, list.length, layout), y: row === "front" ? layout.lanes.enemyFront : layout.lanes.enemyBack, row, index: i };
    });
  }
  return out;
}
