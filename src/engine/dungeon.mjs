/**
 * 랜덤 던전 이벤트표(data/raw/rules/랜덤-던전.md, 단계 9-D). Foundry 비의존.
 * kind: squirrel(아리아드네의 실 도난) / battle / item(장비 R=레벨) / gather / trap / gold
 * battle: levelPlus(던전 레벨 +), foe(★ F.O.E.), rare(희소종), groups(종류 수), single(1마리)
 */
export const DUNGEON_EVENTS = {
  2: { kind: "squirrel" },
  3: { kind: "battle", foe: true, levelPlus: 4, groups: 1, single: true },
  4: { kind: "item" },
  5: { kind: "battle", groups: 2 },
  6: { kind: "gather", rankPlus: 0 },
  7: { kind: "battle", groups: 1 },
  8: { kind: "trap" },
  9: { kind: "battle", rare: true, levelPlus: 1, groups: 1, single: true },
  10: { kind: "gather", rankPlus: 1 },
  11: { kind: "battle", foe: true, levelPlus: 2, groups: 1, single: true },
  12: { kind: "gold" }
};

export const eventFor = (total) => ({ ...(DUNGEON_EVENTS[total] ?? { kind: "none" }), roll: total });

/** 6:00~17:59 낮, 18:00~5:59 밤 */
export const timeOfDayAt = (hour) => ((hour % 24) >= 6 && (hour % 24) < 18 ? "day" : "night");
