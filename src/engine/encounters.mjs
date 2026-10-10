/**
 * 전투 구성(적 구성) — 「무대(배경·BGM)」와 「에너미 목록」을 나눈 전투 프리셋. Foundry 비의존 순수 함수.
 * 구성: { id, name, group, bg, bgm, enemies: [{ uuid, name, img, count, row: "front"|"back" }], fav }
 *   group: "map:<지도 id>" | "" (미분류)
 *   bg: 배경 그림 경로("" = 던전 기본), bgm: "재생목록id" 또는 "재생목록id.곡id"("" = 던전 기본)
 * 지도: battleBg·battleBgm(던전 기본 무대), 에어리어 encounters: [{ id, weight }](조우표)
 */

/** 이 전투의 무대: 구성의 배경·BGM, 비어 있으면 던전(지도) 기본 */
export function resolveStage(enc, map = null) {
  return {
    bg: enc?.bg || map?.battleBg || "",
    bgm: enc?.bgm || map?.battleBgm || ""
  };
}

/** "재생목록id.곡id" → { playlist, sound } */
export function parseBgm(v) {
  const [playlist, sound] = String(v ?? "").split(".");
  return { playlist: playlist || null, sound: sound || null };
}

/** 조우표에서 가중치대로 하나(없는 구성·가중치 0은 뺀다). rnd: 0~1 */
export function pickWeighted(table, rnd, exists = () => true) {
  const rows = (table ?? []).filter((r) => r?.id && exists(r.id) && (Number(r.weight) || 0) > 0);
  const total = rows.reduce((n, r) => n + Number(r.weight), 0);
  if (!total) return null;
  let x = rnd * total;
  for (const r of rows) {
    x -= Number(r.weight);
    if (x < 0) return r.id;
  }
  return rows.at(-1).id;
}

/** 구성의 에너미를 마리 수만큼 펼친 배치 목록(열마다 왼쪽부터) */
export function expandEnemies(enc) {
  const out = [];
  for (const e of enc?.enemies ?? []) {
    const n = Math.max(0, Math.floor(Number(e.count) || 0));
    for (let i = 0; i < n; i++) out.push({ uuid: e.uuid, row: e.row === "back" ? "back" : "front" });
  }
  return out;
}

/**
 * 씬 프리셋의 에너미 토큰 → 구성의 에너미 목록(같은 에너미·같은 열은 묶는다)
 * @param {{ uuid, name, img, y }[]} tokens y는 토큰 중심 높이
 * @param {number} mid 이보다 위(작으면) 후열
 */
export function enemiesFromTokens(tokens, mid) {
  const out = [];
  for (const t of tokens ?? []) {
    const row = t.y < mid ? "back" : "front";
    const same = out.find((e) => e.uuid === t.uuid && e.row === row);
    if (same) same.count += 1;
    else out.push({ uuid: t.uuid, name: t.name, img: t.img, count: 1, row });
  }
  return out;
}

/** 저장 전 검사: 이름·에너미 1마리 이상 */
export function validateEncounter(enc) {
  const errors = [];
  if (!String(enc?.name ?? "").trim()) errors.push("noName");
  if (!expandEnemies(enc).length) errors.push("noEnemies");
  return errors;
}
