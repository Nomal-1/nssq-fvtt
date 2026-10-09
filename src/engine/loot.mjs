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
 * @returns {{ range: number, rangeBy: string[], doubleUp: string[], extras: { uuid, name, skill, count, choices: string[] }[] }}
 */
export function partyDropSkills(party) {
  let range = 0;
  let rangeBy = [];
  const doubleUp = [];
  const extras = [];
  for (const p of party ?? []) {
    for (const s of p.skills ?? []) {
      if (!(s.sl > 0)) continue;
      for (const e of s.effects ?? []) {
        if (e?.type === "dropAdjust") {
          const n = Math.max(0, evaluate(e.range ?? 1, { SL: s.sl }));
          if (n > range) { range = n; rangeBy = [`${p.name}《${s.name}》`]; } else if (n === range && n > 0) rangeBy.push(`${p.name}《${s.name}》`);
        } else if (e?.type === "dropDoubleUp") doubleUp.push(`${p.name}《${s.name}》`);
        else if (e?.type === "dropExtra") extras.push({ uuid: p.uuid, name: p.name, skill: s.name, count: Math.max(1, evaluate(e.count ?? 1, { SL: s.sl })), choices: e.choices ?? [] });
      }
    }
  }
  return { range, rangeBy, doubleUp, extras };
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
