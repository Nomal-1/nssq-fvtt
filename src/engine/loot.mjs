/**
 * 드롭 판정(01 §3.12 전투 종료, 단계 9-A). Foundry 비의존.
 * 쓰러뜨린 에너미 1체마다 2D6 → 에너미 DROP 표({ min, max|null, item, rank }). 1이 나와도 FP 없음(FAQ 5).
 * 파티의 조작 스킬: 달성값 ±n(《스캐빈저》·《해부학》 1, 《사략의 규율》·《해체 마스터》 SL) → 가장 넓은 것 하나(07 #134),
 * 같은 눈(더블)이면 입수 랭크 +1(《풍작 기원》), 드롭 뒤 식재 추가(《사냥꾼의 후각》)
 */
import { evaluate } from "./expr.mjs";

/** 달성값 → 드롭 줄(없으면 null). max가 null이면 그 이상 전부 */
export function dropFor(drops, total) {
  return (drops ?? []).find((d) => total >= (d.min ?? 0) && (d.max === null || d.max === undefined || total <= d.max)) ?? null;
}

/**
 * 파티의 드롭 관련 상시·특수 스킬(효과 dropAdjust·dropDoubleUp·dropExtra)
 * @param {{ uuid, name, skills: { name, sl, effects }[] }[]} party
 * prefix "gather"면 채집용(gatherAdjust 《홀리 기프트》·《야생의 후각》, gatherDoubleUp 《보물의 후각》·《풍작 기원》,
 * gatherDoubleExtra 《이모작》, gatherExtra 《수확자의 후각》)
 * @returns {{ range: number, rangeBy: string[], doubleUp: string[], doubleExtra: string[], extras: { uuid, name, skill, count, choices: string[] }[] }}
 */
export function partyDropSkills(party, prefix = "drop") {
  let range = 0;
  let rangeBy = [];
  const doubleUp = [];
  const doubleExtra = [];
  const extras = [];
  for (const p of party ?? []) {
    for (const s of p.skills ?? []) {
      if (!(s.sl > 0)) continue;
      for (const e of s.effects ?? []) {
        if (e?.type === `${prefix}Adjust`) {
          const n = Math.max(0, evaluate(e.range ?? 1, { SL: s.sl }));
          if (n > range) { range = n; rangeBy = [`${p.name}《${s.name}》`]; } else if (n === range && n > 0) rangeBy.push(`${p.name}《${s.name}》`);
        } else if (e?.type === `${prefix}DoubleUp`) doubleUp.push(`${p.name}《${s.name}》`);
        else if (e?.type === `${prefix}DoubleExtra`) doubleExtra.push(`${p.name}《${s.name}》`);
        else if (e?.type === `${prefix}Extra`) extras.push({ uuid: p.uuid, name: p.name, skill: s.name, count: Math.max(1, evaluate(e.count ?? 1, { SL: s.sl })), choices: e.choices ?? [] });
      }
    }
  }
  return { range, rangeBy, doubleUp, doubleExtra, extras };
}

/**
 * 한 에너미의 결과
 * @param {{ drops, dice: number[], adjust?: number, doubleUp?: boolean }} p
 * @returns {{ total: number, drop: object|null, rank: number|null, doubled: boolean }}
 */
export function judgeDrop({ drops, dice, adjust = 0, doubleUp = false }) {
  const total = dice.reduce((n, d) => n + d, 0) + adjust;
  const drop = dropFor(drops, total);
  const doubled = dice.length === 2 && dice[0] === dice[1];
  const rank = drop ? (drop.rank ?? null) === null ? null : drop.rank + (doubleUp && doubled ? 1 : 0) : null;
  return { total, drop, rank, doubled };
}

/* ---------------- 채집(9-B) ---------------- */

/** 채집 방법별 채집 개수·아앗! 값(던전 탐색 룰) */
export const GATHER_AMOUNT = { little: { count: 1, ahh: 3 }, some: { count: 2, ahh: 4 }, lots: { count: 3, ahh: 5 } };

/** 랜덤 던전 채집표(눈 6·10 공통): ~5 / 6~8 / 9~ */
export const RANDOM_GATHER = {
  felling: [{ max: 5, item: "목재" }, { max: 8, item: "덩굴" }, { max: null, item: "가지" }],
  mining: [{ max: 5, item: "석재" }, { max: 8, item: "금속" }, { max: null, item: "보석" }],
  picking: [{ max: 5, item: "풀" }, { max: 8, item: "꽃" }, { max: null, item: "열매" }]
};

/**
 * 결과표 글(「~6: R1 풀 / 7~10: R1 꽃 / 11~: R2 풀」, 베이직 던전 형식) → [{ max, item, rank? }]. 못 읽으면 null
 */
export function parseGatherTable(text) {
  const rows = [];
  for (const part of String(text ?? "").split(/[/\n;]+/).map((x) => x.trim()).filter(Boolean)) {
    const m = part.match(/^(\d*)\s*[~〜∼]\s*(\d*)\s*[:：]\s*(?:R(\d+)\s*)?(.+)$/);
    if (!m) return null;
    rows.push({ max: m[2] ? Number(m[2]) : null, item: m[4].trim(), ...(m[3] ? { rank: Number(m[3]) } : {}) });
  }
  return rows.length ? rows : null;
}

/**
 * 채집 판정 1회
 * @param {{ table: {max, item, rank?}[], dice: number[], adjust?: number, rank: number, ahh?: number, doubleUp?: boolean, doubleExtra?: boolean }} p
 *   ahh: 아앗! 값(추가분은 0). 굴린 눈(조작 전)이 그 이하면 기습(07 #138)
 * @returns {{ total, item: string|null, rank: number, qty: number, doubled: boolean, ambush: boolean }}
 */
export function judgeGather({ table, dice, adjust = 0, rank = 1, ahh = 0, doubleUp = false, doubleExtra = false }) {
  const raw = dice.reduce((n, d) => n + d, 0);
  const total = raw + adjust;
  const row = (table ?? []).find((r) => r.max === null || r.max === undefined || total <= r.max) ?? null;
  const doubled = dice.length === 2 && dice[0] === dice[1];
  return {
    total, item: row?.item ?? null, rank: (row?.rank ?? rank) + (doubleUp && doubled ? 1 : 0),
    qty: doubleExtra && doubled ? 2 : 1, doubled, ambush: raw <= ahh
  };
}
