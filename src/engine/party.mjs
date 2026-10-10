/**
 * 파티 편성안(순수 JS, 편성판). 원문 전투 룰: PC는 전위·후위 각 3명까지(4명 이상 불가), 전투는 최대 6 대 6.
 * 파티 정원은 기본 5명, GM 설정으로 6명까지(사용자 결정).
 * 편성 초안 draft = { front: [id|null ×3], back: [id|null ×3] }
 */
export const ROW_LIMIT = 3;
export const ROWS = ["front", "back"];

const ids = (draft) => ROWS.flatMap((r) => (draft?.[r] ?? []).filter(Boolean));

/** 편성 검사 → 오류 코드 배열(비면 유효) */
export function validateFormation(draft, max = 5) {
  const errors = [];
  for (const r of ROWS) if ((draft?.[r] ?? []).filter(Boolean).length > ROW_LIMIT) errors.push(`rowOver.${r}`);
  const all = ids(draft);
  if (!all.length) errors.push("empty");
  if (all.length > max) errors.push("overMax");
  if (new Set(all).size !== all.length) errors.push("duplicate");
  return errors;
}

/** 지금 캐릭터들의 열·순서 → 편성 초안(넘치면 남는 칸이 있는 열로, 그래도 넘치면 빠짐) */
export function draftFromUnits(units, limit = ROW_LIMIT) {
  const draft = { front: [null, null, null], back: [null, null, null] };
  const sorted = [...units].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  const leftover = [];
  for (const u of sorted) {
    const row = u.row === "back" ? "back" : "front";
    const i = Number.isInteger(u.order) && u.order >= 0 && u.order < limit && !draft[row][u.order] ? u.order : draft[row].indexOf(null);
    if (i >= 0) draft[row][i] = u.id;
    else leftover.push(u);
  }
  for (const u of leftover) {
    const other = u.row === "back" ? "front" : "back";
    const i = draft[other].indexOf(null);
    if (i >= 0) draft[other][i] = u.id;
  }
  return draft;
}

/**
 * 전투 시작 안전장치: 한 열이 3명을 넘으면 넘치는 사람을 다른 열로.
 * @returns {{id, row, order}[]} 바꿀 것(바꿀 게 없으면 빈 배열)
 */
export function balanceRows(units, limit = ROW_LIMIT) {
  const draft = draftFromUnits(units, limit);
  const out = [];
  for (const r of ROWS) draft[r].forEach((id, order) => {
    if (!id) return;
    const u = units.find((x) => x.id === id);
    if (u && (u.row !== r || u.order !== order)) out.push({ id, row: r, order });
  });
  return out;
}

/** 두 초안이 같은가 */
export const sameDraft = (a, b) => ROWS.every((r) => (a?.[r] ?? []).every((x, i) => (x ?? null) === (b?.[r]?.[i] ?? null)));
