/**
 * effects의 적용 조건 `when`과 확률 발동 `chance` (03 §2). Foundry 비의존.
 * ctx: { self, target, attack: { kind, elements }, timeOfDay, allies }
 *  self/target은 전투 프로필 모양 { weaponType, dualWield, skills: [이름], hp, hpMax, row, acted, … }
 */
import { CONDITIONS } from "../conditions.mjs";

const arr = (v) => (Array.isArray(v) ? v : [v]);
const AILMENTS = new Set(Object.entries(CONDITIONS).filter(([, d]) => d.kind === "ailment").map(([k]) => k));
const BINDS = new Set(Object.entries(CONDITIONS).filter(([, d]) => d.kind === "bind").map(([k]) => k));

/** 키 하나 판정. 모르는 키는 false(조용히 통과시키지 않는다) */
const CHECKS = {
  weaponType: (v, c) => arr(v).includes(c.self?.weaponType),
  dualWield: (v, c) => !!c.self?.dualWield === !!v,
  targetHasSkill: (v, c) => (c.target?.skills ?? []).includes(v),
  targetKO: (v, c) => !!c.target?.ko === !!v,
  // 트리거 conditionGained: 막 걸리려는 상태 이상·봉인(c.condition = id)
  condition: (v, c) => arr(v).includes(c.condition),
  conditionKind: (v, c) => CONDITIONS[c.condition]?.kind === v,
  // 자신이 장비한 무기 종류(《퍼니시 모어》 백병 무기, 《체이스 바인드》 사격 무기)
  selfWeapon: (v, c) => arr(v).includes(c.self?.weaponType),
  // 공격 이벤트: 대상이 하나인 공격(《와이드 이펙트》·《페너트레이터》 「단일」), 그 공격의 스킬(《크로스 차지》 「《딜레이 차지》 명중 시」)
  singleTarget: (v, c) => (c.targetCount === 1) === !!v,
  skillKey: (v, c) => arr(v).includes(c.skillKey),
  // 대상이 이 목록(전투원 id)에 있다(《돌격대장》 「자신이 공격한 적」)
  targetIn: (v, c) => arr(v).includes(c.target?.id),
  // 대상의 HP 잔량이 최대치의 절반 미만(공격 전 값, 《디 엔드》)
  targetHpBelowHalf: (v, c) => ((c.target?.hp ?? 0) * 2 < (c.target?.hpMax ?? 0)) === !!v,
  // 대상이 봉인 중
  targetHasBind: (v, c) => (c.target?.conditions ?? []).some((x) => BINDS.has(x.id)) === !!v,
  // 대상의 LV가 자신보다 높다(《자이언트 킬》)
  targetLevelAbove: (v, c) => ((c.target?.level ?? 0) > (c.self?.level ?? 0)) === !!v,
  // 대상이 상태 이상(봉인 제외) 중
  // 《음양검의 힘》: 그 턴 「상태 이상 중인 대상」 조건을 만족한 것으로(c.self.turnFlags.anyAilment)
  targetHasAilment: (v, c) => ((c.target?.conditions ?? []).some((x) => AILMENTS.has(x.id)) || (!!v && !!c.self?.turnFlags?.anyAilment)) === !!v,
  targetNotActedThisTurn: (v, c) => !c.target?.acted === !!v,
  // 대상이 이번 턴 [공포]·[마비] 판정에 실패해 행동 불능(전투원 플래그 disabled = 그 상태 이상 id, 《명하노니》)
  targetDisabled: (v, c) => arr(v).includes(c.target?.disabledBy),
  // 대상이 F.O.E.·보스가 아니다(《참수》)
  targetNotBoss: (v, c) => !c.target?.boss === !!v,
  // 자신이 상태 이상(봉인 제외) 중(《전화위복》)
  selfHasAilment: (v, c) => (c.self?.conditions ?? []).some((x) => AILMENTS.has(x.id)) === !!v,
  // 자신이 봉인 중(《저주 사슬의 은혜》)
  selfHasBind: (v, c) => (c.self?.conditions ?? []).some((x) => BINDS.has(x.id)) === !!v,
  // 자신이 배치한 토큰 중 그 tokenKey 접두사가 있는가(《진 회복》, c.self.tokens = [tokenKey])
  hasToken: (v, c) => (c.self?.tokens ?? []).some((k) => String(k).startsWith(v)),
  selfHpFull: (v, c) => ((c.self?.hp ?? 0) >= (c.self?.hpMax ?? 0)) === !!v,
  selfHpBelowHalf: (v, c) => ((c.self?.hp ?? 0) * 2 < (c.self?.hpMax ?? 0)) === !!v,
  selfHpAtMostHalf: (v, c) => ((c.self?.hp ?? 0) * 2 <= (c.self?.hpMax ?? 0)) === !!v,
  selfRow: (v, c) => c.self?.row === v,
  targetRow: (v, c) => (c.target?.row ?? "front") === v,
  element: (v, c) => arr(v).some((e) => (c.attack?.elements ?? []).includes(e)),
  attackKind: (v, c) => c.attack?.kind === v,
  timeOfDay: (v, c) => c.timeOfDay === v,
  // 사용하는 스킬의 분류(『백병』 등). 통상 공격은 분류 없음
  category: (v, c) => arr(v).includes(c.category),
  allyCountInRow: (v, c) => (c.allies ?? []).filter((a) => a.name === v.name && a.row === c.self?.row && !a.ko).length >= (v.gte ?? 1)
};

/** @returns {boolean} 조건이 없으면 true */
export function whenMatches(when, ctx = {}) {
  if (!when) return true;
  return Object.entries(when).every(([k, v]) => (CHECKS[k] ? CHECKS[k](v, ctx) : false));
}

/** 모르는 when 키(데이터 검사용) */
export const unknownWhenKeys = (when) => Object.keys(when ?? {}).filter((k) => !CHECKS[k]);
