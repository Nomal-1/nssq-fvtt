import { collectConditionResist } from "../engine/effects/passives.mjs";
import { evaluate } from "../engine/expr.mjs";

/**
 * 전투에 쓰는 값을 액터 종류와 관계없이 한 모양으로 모은다.
 */

/** 진영: 에너미 → enemy, 「동료 NPC」 캐릭터 → ally, 그 밖의 캐릭터 → pc */
export function sideOf(actor) {
  if (!actor) return "enemy";
  if (actor.type === "enemy") return "enemy";
  if (actor.type === "character" && actor.system.npc) return "ally";
  if (actor.type === "token") return "ally";
  return "pc";
}

/** 같은 편인가(PC와 동료 NPC는 같은 편) */
export const friendly = (a, b) => (sideOf(a) === "enemy") === (sideOf(b) === "enemy");

/**
 * @param {Actor} actor
 * @param {Combatant} [combatant] 방어 전념 등 전투 중 상태
 */
/** 스킬에 든 flag 값(특수 타이밍 스킬도). 없으면 undefined(《연기의 끄트머리》 rangeAll 등) */
function itemFlag(actor, flag) {
  for (const i of actor.items) {
    if (i.type !== "skill" || (actor.type === "character" && (i.system.sl ?? 0) <= 0)) continue;
    const e = (i.system.effects ?? []).find((x) => x?.type === "flag" && x.flag === flag);
    if (e) return e.value ?? true;
  }
  return undefined;
}

/**
 * 이번 턴 효과: 전투원의 대기 상태 기록(stances, wait: false인 「그 턴 동안」 효과 포함) 안의
 * modifier(능력치)·attackBonus(공격 보정)·flag·scopeChange(대상 범위 변경)와,
 * 상대 편의 hostileHitFail(《인법: 아지랑이》), 전투 플래그 linkMarks(《링크 이펙트》)
 */
function applyTurnEffects(p, actor, combatant) {
  const combat = combatant?.combat;
  const turnFlags = {};
  const bonuses = [];
  const scopes = [];
  const mods = {};
  // 「다음 턴」 효과(《차지 에지》): 전투원 플래그 nextTurn 중 이번 라운드 것
  const next = (combatant?.getFlag("nssq", "nextTurn") ?? []).filter((x) => x.round === combat?.round);
  for (const st of [...(combatant?.getFlag("nssq", "stances") ?? []), ...next]) {
    const v = (x) => evaluate(x ?? 0, { SL: st.sl ?? 1 });
    for (const e of st.effects ?? []) {
      if (e?.type === "modifier") mods[e.path] = (mods[e.path] ?? 0) + v(e.value);
      else if (e?.type === "attackBonus") bonuses.push({ name: st.name, when: e.when ?? null, hitMod: v(e.hitMod), diceMod: v(e.diceMod), atkMod: v(e.atkMod), critDice: v(e.critDice), critUp: !!e.critUp, resistMod: v(e.resistMod), resistLow: !!e.resistLow, addElement: e.addElement ?? [] });
      else if (e?.type === "flag") turnFlags[e.flag] = e.value ?? true;
      else if (e?.type === "scopeChange") scopes.push({ ...e, sl: st.sl ?? 1, name: st.name });
    }
  }
  if (combat) {
    for (const c of combat.combatants) {
      if (!c.actor || friendly(c.actor, actor)) continue;
      for (const st of c.getFlag("nssq", "stances") ?? []) {
        for (const e of st.effects ?? []) {
          if (e?.type === "hostileHitFail") bonuses.push({ name: st.name, when: e.when ?? null, failAtOrBelow: evaluate(e.value ?? 0, { SL: st.sl ?? 1 }) });
        }
      }
    }
    const lm = combat.getFlag("nssq", "linkMarks");
    if (lm && lm.round === combat.round) {
      for (const [tid, els] of Object.entries(lm.marks ?? {})) bonuses.push({ name: lm.name ?? "", when: { targetIn: [tid] }, addElement: els });
    }
  }
  for (const [k, v] of Object.entries(mods)) if (typeof p[k] === "number") p[k] += v;
  p.attackBonuses = [...(p.attackBonuses ?? []), ...bonuses];
  p.turnFlags = turnFlags;
  p.scopeChanges = scopes;
  return p;
}

export function combatProfile(actor, combatant = null) {
  return applyTurnEffects(baseProfile(actor, combatant), actor, combatant);
}

function baseProfile(actor, combatant = null) {
  const s = actor.system;
  const guarding = !!combatant?.getFlag("nssq", "guarding");
  // 이번 턴 메인 페이즈 행동을 이미 했는가(차례가 지났다)
  const combat = combatant?.combat;
  const acted = !!combat?.started && combat.getFlag("nssq", "phase") === "main"
    && combat.turns.findIndex((c) => c.id === combatant.id) < (combat.turn ?? -1);
  const base = {
    actor, side: sideOf(actor), name: combatant?.name ?? actor.name,
    row: s.row ?? "front",
    hp: s.hp?.value ?? 0, hpMax: s.hp?.max ?? 0,
    guarding, acted,
    // [공포]·[마비] 판정 실패로 이번 턴 행동 불능이면 그 상태 이상 id(《명하노니》 when targetDisabled)
    disabledBy: combatant?.getFlag("nssq", "disabled") ?? null,
    // 이번 턴 「주행동 2회」를 얻었다(《인법: 분신》, 《다원 발도》 when selfExtraAction)
    extraActionTurn: !!combat?.started && combatant?.getFlag("nssq", "extraActionRound") === combat.round,
    // F.O.E.·보스(《참수》 when targetNotBoss)
    boss: actor.type === "enemy" && (!!s.isFOE || !!s.isBoss),
    level: s.level ?? 0,
    ko: (s.hp?.value ?? 0) <= 0,
    // 상태 이상·봉인·강화(단계 5): 부능력치·내성에는 액터 데이터에서 이미 반영됨
    conditions: s.conditions ?? [],
    buffs: s.buffs ?? [],
    petrified: (s.conditions ?? []).some((x) => x.id === "petrify"),
    critUp: !!s.statusMods?.buffs?.critUp,
    // 상시 스킬의 상태 이상별 억제 방어 보정·완전 내성
    ...(() => {
      const r = collectConditionResist(actor.items.filter((i) => i.type === "skill").map((i) => ({ sl: i.system.sl, timing: i.system.timing, effects: i.system.effects })));
      return { condResist: r.resist, immune: r.immune };
    })()
  };
  // [마비]·[공포] 판정에 실패한 턴은 【회피】 0(전투원 플래그, combat/turn-status.mjs)
  const disabled = !!combatant?.getFlag("nssq", "disabled");
  // 속성 부여: 공격의 기본 속성에 더한다(복합 속성 → 내성은 최저, 07 #24)
  const withImbue = (els) => [...new Set([...els.filter((e) => e !== "none"), ...(s.statusMods?.buffs?.elements ?? [])])];
  if (actor.type === "character") {
    const w = s.equipment?.weapon;
    const elements = [w?.element, w?.imbue].filter(Boolean);
    return {
      ...base,
      speed: s.sub.speed,
      physHit: s.sub.physHit, elemHit: s.sub.elemHit, evasion: disabled ? 0 : s.sub.evasion,
      physAtk: s.sub.physAtk, elemAtk: s.sub.elemAtk, defense: s.sub.defense,
      suppAtk: s.sub.suppAtk, suppDef: s.sub.suppDef,
      resist: s.resistTotal ?? s.resist,
      elements: withImbue(elements.length ? elements : ["strike"]),
      weaponType: w?.weaponType ?? null,
      // 상시 스킬의 공격 보정(engine/effects/passives.mjs)
      attackBonuses: s.passives?.attackBonuses ?? [],
      weaponName: w?.item?.name ?? (w?.unarmed ? game.i18n.format("NSSQ.Combat.unarmed", { type: w.weaponType }) : ""),
      // 《연기의 끄트머리》: 모든 무기의 사거리를 『원』으로
      range: itemFlag(actor, "rangeAll") ?? w?.range ?? "근"
    };
  }
  if (actor.type === "enemy") {
    const st = s.combatStats ?? s.stats;
    return {
      ...base,
      speed: Math.max(0, st.speed),
      physHit: st.physHit, elemHit: st.elemHit, evasion: disabled ? 0 : st.evasion,
      physAtk: st.physAtk, elemAtk: st.elemAtk, defense: st.defense,
      suppAtk: st.suppAtk, suppDef: st.suppDef,
      // 식별 실패한 에너미의 내성 최소 3(01 §3.1)은 enemy.mjs에서 반영
      resist: s.resistTotal ?? s.resist,
      elements: (() => { const e = withImbue(s.attackElements ?? []); return e.length ? e : ["none"]; })(),
      weaponName: "",
      // 에너미 통상 공격의 사거리는 데이터에 없다(07 #25)
      range: "근"
    };
  }
  // 토큰: 공격은 단계 8
  return { ...base, speed: 0, physHit: 0, elemHit: 0, evasion: 0, physAtk: 0, elemAtk: 0, defense: 0, suppAtk: 0, suppDef: 0, resist: {}, elements: ["none"], range: "-" };
}
