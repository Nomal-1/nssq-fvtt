# 03. 효과 스키마 (effects DSL)

스킬·아이템·장식·제련·에너미 스킬의 효과는 모두 `effects` 배열로 적는다. 엔진은 이 데이터만 보고 처리한다. **해설 문장은 사람이 읽는 용도**이고 런타임에 해석하지 않는다.

## 1. 수식

- 문자열 수식. `engine/expr.mjs`가 직접 파싱한다(`eval`·`Function` 금지).
- 연산자 `+ - * /`, 괄호, 함수 `floor min max abs`. **나눗셈은 결과를 항상 버림.**
- 변수
  - `SL` — 그 스킬의 유효 SL
  - `R`, `Lv` — 장비 랭크, 캐릭터 레벨(장비 표의 식에도 같은 평가기를 쓴다)
  - `@self.<path>`, `@target.<path>`, `@owner.<path>`(토큰의 배치자) — 파생치. 예 `@self.suppAtk`, `@target.hp.value`
  - `@roll.<name>` — 같은 효과 처리 안에서 앞서 굴린 결과
  - `@self.bonus.agi` 등 — 능력치 보너스(【AGI】B). 에너미는 0
  - `@target.bindCount`, `@target.ailmentCount` — 걸린 봉인·상태 이상 수
  - `@self.allyCount` — 같은 편 인원수(자신 포함, 쓰러진 사람 제외)
- 데이터 쪽 원문 표기 `(SL×2)`, `(R의 제곱)×100`은 변환기가 `SL*2`, `R*R*100`으로 바꾼다.

## 2. 공통 필드

```jsonc
{
  "type": "attack",            // 아래 §3 중 하나
  "when": { … },               // 적용 조건 (생략 시 항상)
  "chance": { "roll": "1d6", "lte": "SL" },   // 확률 발동
  "label": "…",                // 채팅 카드에 표시할 짧은 이름(선택)
  "variant": 0,                 // 선언 명칭 번호(스킬의 variants 순서). 쓸 때 고른 명칭의 효과만 적용(선택)
  "toSelf": true,               // 대상과 관계없이 사용자 자신에게 한 번(《임팩트 애로》 사용 후 자신 [마비])(선택)
  "whenNote": true              // when이 안 맞으면 카드에 「효과 없음」(《명하노니》)(선택)
}
```

`when` 키 목록(새 키가 필요하면 여기에 먼저 추가하고 엔진 `effects/conditions.mjs`도 갱신한다)
| 키 | 뜻 |
|---|---|
| `weaponType: [..]` | 현재 사용 무기 종류 |
| `dualWield: true` | 무기·기타 슬롯 모두 무기 장비 |
| `targetHasSkill: "이름"` | 대상이 그 스킬 보유(예 《야행성》) |
| `targetHpBelowHalf: true` | 대상 HP 잔량이 최대치의 절반 미만(그 공격의 대미지 전) |
| `targetHasBind: true` | 대상이 봉인 중 |
| `targetLevelAbove: true` | 대상의 LV가 자신보다 높다 |
| `targetHasAilment: true` | 대상이 상태 이상(봉인 제외) 중 |
| `condition: [..]`, `conditionKind` | (트리거 conditionGained) 걸리려는 상태 이상·봉인 id / 종류(ailment·bind) |
| `targetKO: true` | 대상이 \[전투 불능\](부활 효과용) |
| `targetNotActedThisTurn` | 대상이 이번 턴 메인 행동 전 |
| `selfHpAtMostHalf` | 자기 HP가 최대의 절반 이하 |
| `selfRow: "front"/"back"` | 자기 위치 |
| `selfHpFull: true` | 자기 HP가 만전 |
| `selfHpBelowHalf: true` | 자기 HP가 최대의 절반 미만 |
| `selfHasBind: true` | 자신이 봉인 중 |
| `hasToken: "접두사"` | 자신이 배치한 토큰 중 그 tokenKey로 시작하는 것이 있다(단계 8) |
| `targetRow: "front"/"back"` | 대상 위치 |
| `element: [..]` | 처리 중인 공격의 속성 포함 |
| `attackKind: "physical"/"elemental"` | 처리 중인 공격의 종류 |
| `timeOfDay: "day"/"night"` | 탐색 시간대 |
| `category: [..]` | 사용 중인 스킬의 분류(『백병』 등). 통상 공격은 분류 없음(07 #58) |
| `allyCountInRow: {name, gte}` | 같은 열에 특정 에너미 n체 이상(연계 공격) |

## 3. 효과 타입

| type | 필드 | 설명 |
|---|---|---|
| `attack` | `kind`(physical/elemental), `element`(생략 시 무기 기본 속성), `addElement`(무기 속성에 더함, 「〈염〉 속성을 부가한」), `failAtOrBelow`(명중 눈 합이 n 이하면 절대 실패), `randomFrom`(무작위 대상을 그 열에서만: front/back), `times`, `hitMod`, `diceMod`, `atkMod`, `atkMultiplier`, `random`, `uniqueTarget`, `onHit[]`, `bonuses[{when, hitMod?, diceMod?, atkMod?, element?}]`, `halfDamage` | 공격 롤 1회분(또는 times회) |
| `heal` | `mode`(roll/fixed/full/percent), `bonus`/`amount`, `resource`(hp/tp), `revive` | 회복 롤 또는 고정 회복. \[전투 불능\] 대상은 `revive: true`인 효과만 회복(부활). 부활 효과가 있으면 쓰러진 아군도 대상으로 고를 수 있다. 『회복』 분류 스킬의 회복 롤에는 사용자의 `healDice` 보정이 더해진다 |
| `inflict` | `condition`, `check: {type: fixed, target} | {type: contest, atkMod?} | {type: forced}` | 상태 이상·봉인 부여. forced: 저항 없이 반드시 걸고 심도만 사용자의 【억제 공격】 판정 달성값(07 #61). `condition`이 목록이면 `choose`(사용할 때 고르는 개수, 《스티그마》)·`randomPick`(무작위 1개, 《신기한 씨앗》), `selfSame: "atk"`(성공하면 자신도 같은 것을 자신의 달성값 심도로) |
| `drain` | `resource`(hp/tp), `mode`(half: 준 대미지 절반 / quarter: 1/4 / sixes: 대미지 다이스의 6 개수) | onHit 안에서: 그 명중으로 자신 회복(《음양검: 영흡명참》) |
| `recoil` | `mode`(ones) | `toSelf`와 함께: 이 행동에서 굴린 대미지 다이스의 '1' 개수만큼 자신이 대미지(《싱글 스러스트》) |
| `kill` | `check: {type: fixed, target, defMod?} | {type: contest, atkMod?}` | 즉사: 억제 방어 롤 실패면 【HP】 0(카드에 \[즉사\]) |
| `cure` | `conditions[]` 또는 `"all"`, `kind`(ailment/bind/debuff/buff), `count`, `buffs[]`(그 강화·약화 id만) | 해제. `count`가 있으면 걸린 순서대로 그 개수까지(「(SL)개까지」) |
| `buff` / `debuff` | `id`, `value`, `turns`, `param`(속성 등) | 01 §3.10의 강화·약화 |
| `modifier` | `path`, `value` | 상시 보정. 타이밍 「상시」 스킬, 장식, 제련. path: `physAtk elemAtk physHit elemHit defense evasion speed suppAtk suppDef hpMax tpMax carry healDice(『회복』 스킬 회복 롤 다이스) itemHeal(아이템 회복량 +) guardCount(방어 스킬 횟수 +) tokenHit(『소환수』 토큰 공격 명중 +) campHeal(캠프 회복량 +) tokenTurns(『방진』 토큰 지속 턴 +) overheatTurns(오버히트 턴 +) abilities.<능력치> resist.<속성> checks.<판정> gather.<felling·mining·picking>(채집 판정 추가 횟수) condResist.<상태 이상 id>(그 상태 이상·봉인에 대한 억제 방어 ±, 부여 판정과 자연 회복 판정 모두)` |
| `immune` | `condition` | 타이밍 「상시」: 그 상태 이상·봉인에 걸리지 않음(「완전 내성: 독」). forced는 예외 |
| `resource` | `resource`(hp/tp/fp), `delta` 또는 `set` | 직접 증감 |
| `stance` | `effects[]`, `until`(endOfTurn/count), `count`, `holder`("target"이면 대상이 받음), `wait`(false면 대기 상태가 아닌 「그 턴 동안」 효과: 메인 행동을 한다, 《도발》·《캐슬링》). 안의 modifier·attackBonus(`resistMod`·`addElement` 포함)·flag·scopeChange는 그 턴 그 전투원에게 적용(combat/profile.mjs `applyTurnEffects`) | 대기 상태가 되며 대기 중 효과 부여. 사용자에게 한 번 저장(전투원 플래그 `stances`, `combat/` 쪽), 사용자는 메인 행동을 하지 않음(waiting). 턴 종료·횟수 소진·[스턴]·행동 불가 판정으로 해제. 『방어』 분류면 `guardCount` 만큼 횟수 + |
| `trigger` | `on`, `effects[]`, `limit`(perAction/perTurn/perBattle), `optional`(「사용을 선언한다」: 버튼, 시트의 「자동」 토글이면 자동) | 반응형. 8-B에서 crit·selfHit 실행: crit은 크리티컬이 난 대상마다(`limit: perAction`이면 1번, 안의 `attack`은 추격 카드), 의무 selfHit은 공격 하나에 1번, 선언(optional) selfHit은 명중한 대상마다 버튼. 안의 `attackBonus.diceMod`는 그 명중에 다이스를 더 굴려 추가 대미지(07 #65). 자신에게 거는 효과는 `toSelf`. 판정 없는 확정 즉사는 `inflict` `condition: "death"`(《참수》). `bindInflicted`: 자신의 주행동 스킬로 적에게 봉인을 새로 걸었을 때(대상 = 그 적). when 키 `selfWeapon`(무기 종류 목록)·`singleTarget`·`skillKey`·`targetIn`. `useSkill`: 스킬을 고를 때 선언(when `category`, 안의 modifier를 그 사용에만, 《저주의 방울 소리》). attack 필드 `fixedDice`(대미지 다이스 수 직접). flag `openingCategory`(그 분류 주행동 스킬을 개막에, 《명군의 재능》)·`vanguard`(《돌격대장》). target 효과 `excludeSelf`(자신 이외 아군). 8-F: 그 밖의 on은 `combat/events.mjs`(enemyKO·damaged·hpLost·beforeKO는 카드 적용 뒤, conditionGained·buffGained는 적용 때, endPhase·openingPhase·battleWon은 페이즈, escapeCheck는 도주 창). `limit: perBattle`은 전투원 플래그 `usedTriggers`. `on`: crit / beforeKO / attacked / allyAttacked / rowAttacked / endPhase / openingPhase / battleStart / selfHit(자신의 공격이 명중했을 때 선언) / mainPhaseStart(메인 페이즈 개시 시 선언) / escapeCheck(도주 판정 때 선언) / hpLost(자신의 HP가 줄었을 때) / enemyKO(자신의 공격으로 적을 쓰러뜨렸을 때) / buffGained(강화 효과를 얻었을 때) / battleWon(전투에 승리했을 때) / damaged(적의 공격 롤로 대미지를 받았을 때) / conditionGained(자신에게 상태 이상·봉인이 걸리는 순간. when `condition`·`conditionKind`) / tokenGone(자신의 토큰이 사라졌을 때) |
| `counter` / `chase` | `when`, `attack{…}`, `count`, `on`, `onlyIfEvaded`(반격만), `optional` | 반격·추격(01 §3.11의 연쇄 금지 규칙은 엔진이 강제). `attack.copyElement`: 계기가 된 공격의 속성으로(`when.element`가 있으면 그중 공격에 든 것). 반격 `on`: attacked(자신) / rowAttacked(자신과 같은 열 아군) / frontRowAttacked(아군 전열). 추격 `on`: anyAttack(기본, 적에게 공격 롤) / allyAttack / rowAllyAttack / targetAttacked(대기 상태를 만든 스킬의 대상에게 공격, 《링크 오더》). 대기 상태 하나는 공격 하나에 추격·반격 각 1번. 상시 스킬에 직접 적으면 끝나지 않는 대기 상태처럼 본다(에너미 《바늘 지옥》). 실행: `combat/chase.mjs`(단계 8-B) |
| `guard` | `mode`(half: 받는 대미지 반감 / cover: 대신 받기 / defense: 대상의 【방어】를 사용자 값으로 / redirect: 자신이 받는 공격을 대상에게 넘김 / reflect: 그 공격을 공격자에게 반사, 범위 공격은 1회분만 반사하고 나머지 무효 / nullify: 공격 완전 무효(턴당 1회)), `scope`(front/back/row: 자신이 있는 열/all/target/owner: 토큰의 배치자), `optional`(그때마다 할지 고름), `when` | 방어 스킬(대기 상태 안). 대기 상태의 `count`가 「누적 n회」, 《방패 마스터리》는 modifier `guardCount`로 그 횟수 +. 8-C 구현: `engine/guards.mjs`(`planGuards`) → `combat/guard.mjs`. scope target·row는 스킬을 쓸 때의 대상(`guardTargets`). 횟수는 07 #69·70 |
| `aura` | `path`, `value`, `scope` | 대기 상태 동안 아군에게 주는 보정(《삼색 가드》 내성 +SL 등) |
| `provoke` | `count`, `to`("target"이면 스킬 대상 아군에게) | 그 턴 동안 단일 대상 공격을 누적 count회까지 자신으로(《도발》). 8-C부터 `stance`(`wait: false`, `until: count`) 안에 적는다 |
| `delayed` | `at`(endPhase/nextTurnLate), `turns`, `effects[]` | 지연 공격. 스킬마다 발동 시점이 달라 `at`으로 지정. 8-D: 쓰면 코스트를 내고 전투원 플래그 `delayed`에 예약(턴을 넘어 남음), nextTurnLate는 turns턴 뒤 메인 페이즈 끝(후발 행동과 함께), endPhase는 종료 페이즈 처음. 예약 중엔 새 지연 공격 불가(`combat/late.mjs`) |
| `token` | `tokenKey`, `turns`(지속 턴), `action{target, stats?, effects[]}`, `maxCount` | 토큰 배치. `action.target`은 대상 칸 문구, `action.stats`는 배치자의 어느 수치로 공격하는가(physical/elemental), `action.effects`는 매 턴 하는 행동 8-E: `combat/tokens.mjs`(배치자 전투원 플래그 `tokens`, 07 #77~81) |
| `overheat` | `turns` | 드라이브 계열(상시 modifier `overheatTurns`로 증감) |
| `overheatReduce` | `turns` | 자신의 오버히트 단축(《샤프 에지》·《강제 배기》) |
| `attackBonus` | `hitMod`, `diceMod`, `atkMod`, `critDice`(크리티컬 추가 다이스 +), `critUp`(『크리티컬 업』 취급), `when` | 타이밍 「상시」: 공격할 때마다 붙는 보정. `when`은 공격 시점(대상·공격 속성)으로 판정(《선봉의 공명》 「아직 행동하지 않은 적에 대한 공격」). 통상 공격·스킬 공격 모두 |
| `useBonus` | `buffTurns`, `debuffTurns`, `healHp`, `when` | 타이밍 「상시」: 스킬을 쓸 때 붙는 보정. `buffTurns`·`debuffTurns`: 그 스킬로 주는 강화·약화의 지속 턴 +(《무용 마스터리》·《주언 마스터리》), `healHp`: 대상 HP 회복이 따라붙음(《리인포스》). 보통 `when.category` |
| `target` | `side`(enemy/ally/self), `scope`(single/row/all/random), `count?` | 대상 칸 대신 쓸 대상 지정(대상이 「특수」인 스킬). `count`(n명)는 아직 한 명씩 |
| `tokenRemove` | `category`(소환수/방진) | 사용자의 그 분류 토큰 1개(가장 오래된 것)를 없앤다(《비스트 귀환》·《야수의 우정》·《파진》). 토큰이 없으면 사용 불가 |
| `repeat` | `scope`(same/row/back), `cost` | trigger on crit 안에서: 같은 공격을 다시(same 같은 대상·row 대상과 같은 열의 다른 적·back 후위 1체). cost면 그 스킬 코스트를 한 번 더. 반복·추격·반격에서는 안 남(《더블 액션》·《와이드 이펙트》·《페너트레이터》) |
| `rallyChase` | `count`, `weapons`(무기 종류 목록) | 사용자 이외 아군 count명이 대상에게 통상 공격 추격(《일제 사격》·《난룡의 진》, 07 #88) |
| `requireAllies` | `name`, `count`, `sameRow` | 연계 공격 조건(같은 열에 이름에 name이 든 동료 count마리 이상). 에너미 [랜덤 행동] 후보 판정, 참가자는 그 턴 행동 종료(07 #93) |
| `focus` | - | 그 턴 같은 편 단일 대상 스킬을 이 대상에게(《타기팅》, 전투 플래그 `focus`) |
| `revenge` | - | 대기 상태 안에서: 받은 대미지를 세고 메인 페이즈 끝에 후발 공격(《리벤지 스마이트》, 07 #95) |
| `lateRepeat` | `diceMod` | onHit 안에서: 메인 페이즈 끝까지 대미지를 받지 않으면 같은 대상에 후발 공격(《딜레이 스탭》) |
| `scopeChange` | `category`, `fromSide`, `fromScope`, `scope`, `side` | (「그 턴 동안」 stance 안) 그 분류 스킬의 대상 범위를 바꾼다(거너 폼·《아름다운 춤》·《스프레드 스로》·《승리의 맹세》·《일제 구호》) |
| `hostileHitFail` | `value`, `when` | (stance 안) 상대 진영의 명중 판정 눈 value 이하 절대 실패(《인법: 아지랑이》) |
| `extraAction` | `count` | 그 턴 주행동 +count회(《인법: 분신》). 메인 페이즈 그 전투원 차례에서 [턴 종료]를 누르면 한 번 더 그 전투원(전투원 플래그 `extraAction`) |
| `actionTiming` | `value`(first/last) | 「그 턴 최속/후발 행동」(대상에게. 자신이면 target 자신). 개막 페이즈에 쓰면 메인 페이즈 행동 순서에 반영(전투원 플래그 timing, 라운드마다 지움). 주행동 스킬에 `last`가 있으면 메인 페이즈에 쓸 때 후발 행동 예약(전투원 플래그 `late`, 코스트는 실행할 때), 모든 전투원 행동 뒤 【속도】 순 실행. 실행할 때 이 효과는 뺀다(8-D) |
| `state` | `id`, `label`, `group?`, `mods[{path, value}]`, `max?`, `note?` | 전투 고유 상태(강화가 아님, 해제되지 않음, 전투 끝까지). 무사의 자세·《나찰》 등. 같은 `group`은 하나만, `max`가 있으면 쌓임(07 #57) |
| `requireState` | `state` | 「《○○》 상태 한정」. 그 상태가 없으면 쓸 수 없다(사용 시 해석하지 않음) |
| `requireSelf` | `when` | 「자신이 ○○일 때만 사용 가능」. when을 자신으로 판정(`selfHasAilment` 등, 《전화위복》) |
| `command` | `mode` | (`when: {targetDisabled: "fear"}`와 함께) 《명하노니》: `stop`(안내만)·`enemyAttack`(다른 에너미를 통상 공격)·`selfAttack`(자신을 통상 공격). 결과를 적용할 때 실행 |
| `spreadAilment` | `from`, `count`, `check` | 상태 이상 옮기기. 기본: 대결에서 이기면 대상의 상태 이상을 같은 열의 다른 적에게(《인법: 수경》). `from: "self"`: 자신의 상태 이상 최대 count개를 대상에게(《전화위복》) |
| `emitImbue` | `kind` | 대상의 『속성 부여』를 해제하고 그 속성으로 적 전체 공격(《이밋 웨펀》) |
| `multiUse` | `category`, `count` | 그 분류의 주행동 스킬 최대 count개를 TP 없이 한 번에(《최종 결전의 군가》, 고르는 창) |
| `grantLateAction` | | 대상 아군이 후발 행동 뒤 한 번 더 행동(《끝없는 원무곡》, 전투 플래그 `bonusTurns`) |
| `redirectAlly` | | (수동) 아직 행동 전에 단일 대상 공격을 받으면 선언해 대상을 아군으로, 자신은 주행동을 잃는다(《모나야 맞을 수 있다》, combat/guard.mjs) |
| `anytime` | `action`(swapRow/retarget), `skillKey` | 『특수』 스킬을 전투 중 아무 때나: 파티 카드 ★ 버튼(combat/special.mjs). swapRow 배치 변경·맞바꾸기(《체인지 스텝》), retarget 그 대기 상태의 대상 바꾸기(《디바이드 체인지》) |
| `healFromDamage` | (`toSelf`와 함께) | 이 행동에서 대미지를 준 다이스 수(대상 합)만큼 아군 전체 【HP】 회복(《블랙 사바스》) |
| `nextTurn` | `effects[]` | (`toSelf`와 함께) 다음 라운드에만 쓰는 「그 턴 동안」 효과(전투원 플래그 `nextTurn`, 《차지 에지》) |

C1 보강: `recoil.to: "allies"`(자신 외 아군 전원, 《레기온 스러스트》), attack `ignoreBuffs`(["defenseUp", "resistUp:pierce"], 《실버 애로》)·`addTurnElements`(그 턴 나온 속성 부가, 《스피어 인볼브》), attackBonus `resistLow`(【내성】 1·2를 하나 낮춤, 《특이점 정리》), target `count`(단일이면 n명을 한 번에, 열이면 그 열에서 n체), when `targetNotBoss`(에너미 `isFOE`·`isBoss`).
| `flag` | `flag`, `value` | 규칙 스위치(타이밍 「상시」). `itemRevive`: 그 캐릭터가 쓰는 HP 회복 아이템에 부활 효과(《간이 소생》), `tokenMax`: 『소환수』 토큰 동시 유지 수(《백수의 왕기》), `campCookHp`·`campCookTp`·`campCookCure`: 캠프 때 HP·TP 회복 2배·상태 이상 회복(커먼 요리 스킬, 『조리기구 세트』 필요) |
| `custom` | `handler` | 스키마 밖. `src/engine/custom/<handler>.mjs` |
| `activeEvade` | `ability`(str/tec/vit/agi/luc), `bonus`, `vs`(physical/elemental, 생략 시 둘 다) | 타이밍 「수동」: 능동 회피. 대상 2D6+능력치 보너스+bonus vs 공격자 명중 달성값, 동점 회피(07 #51) |
| `nullify` | — | 타이밍 「수동」: 그 공격의 대미지 0·추가 효과 무효(《완전 방어》), 반응한 캐릭터의 같은 편 대상 전부 |

`attack.element`의 `"none"`은 무속성(내성 0). 대상 칸 「관통」은 고른 대상 + 다른 열에서 순서가 가장 가까운 1체, 가장 가까운 적이 여럿이면 그중에서 다시 고른다(07 #60). 데이터 검사: `node tools/effects-check.mjs` → `build/effects-report.md`(오류·todo/auto/partial/ok 집계·partial 목록·단계 8 대기 목록). `npm test`에도 들어 있다.

## 4. 변환 예시 (현재 데이터 기준)

```jsonc
// 《도 마스터리》 상시 — 도 공격의 물리 명중 +(SL/2)
[{ "type": "modifier", "path": "physHit", "value": "SL/2", "when": { "weaponType": ["도"] } }]

// 《등치기》 〈괴〉 물리 공격 롤. 명중 시 목표값 (【억제 공격】+(7+SL)) 억제 방어 롤, 실패하면 [마비]
[{ "type": "attack", "kind": "physical", "element": ["strike"],
   "onHit": [{ "type": "inflict", "condition": "paralyze",
               "check": { "type": "fixed", "target": "@self.suppAtk + 7 + SL" } }] }]

// 《샛별》 대미지 다이스 +(SL+1). 대상이 《야행성》이면 +(SL×2) 추가
[{ "type": "attack", "kind": "physical", "diceMod": "SL+1",
   "bonuses": [{ "when": { "targetHasSkill": "야행성" }, "diceMod": "SL*2" }] }]

// 《오륜의 검》 물리 공격 롤 3회, 매회 무작위 대상, 대미지 다이스 −(5−SL)
[{ "type": "attack", "kind": "physical", "times": 3, "random": true, "diceMod": "-(5-SL)" }]

// 《이 악물기》 전투 불능이 될 때 1D6 ≤ SL이면 HP 1로 버팀
[{ "type": "trigger", "on": "beforeKO", "chance": { "roll": "1d6", "lte": "SL" },
   "effects": [{ "type": "resource", "resource": "hp", "set": 1 }] }]

// 《힐링》 회복 롤, 회복량 다이스 +((SL+1)×3)
[{ "type": "heal", "mode": "roll", "bonus": "(SL+1)*3" }]

// 《공격의 호령》 아군 열에 『물리 공격 상승: (SL×2)』『속성 공격 상승: (SL×2)』 3턴
[{ "type": "buff", "id": "physAtkUp", "value": "SL*2", "turns": 3 },
 { "type": "buff", "id": "elemAtkUp", "value": "SL*2", "turns": 3 }]

// 《트래핑》 대기 상태. 자신을 포함한 열에 물리 공격이 오면 공격자에게 물리 공격으로 반격(다이스 −(4−SL)), 누적 3회 또는 턴 종료로 해제
[{ "type": "stance", "until": "count", "count": 3, "effects": [
   { "type": "counter", "when": { "attackKind": "physical" }, "on": "rowAttacked",
     "attack": { "kind": "physical", "diceMod": "-(4-SL)" } } ] }]

// 《사지타리우스의 화살》 다음 턴 후발 행동 타이밍에 지연 공격(통상 공격 + 다이스 ((SL+1)×3))
[{ "type": "delayed", "at": "nextTurnLate", "turns": 1, "effects": [
   { "type": "attack", "kind": "physical", "diceMod": "(SL+1)*3" } ] }]

// 《어설트 드라이브》 【물리 공격】+((SL−1)×2) 후 2배, 사용 후 오버히트 7턴
[{ "type": "attack", "kind": "physical", "atkMod": "(SL-1)*2", "atkMultiplier": 2 },
 { "type": "overheat", "turns": 7 }]

// 에너미 《거슬리는 날갯소리》 대결 판정(억제 공격 vs 억제 방어), 승리하면 [머리] 봉인
[{ "type": "inflict", "condition": "bindHead", "check": { "type": "contest" } }]

// 《삼색 세이버》 선언 명칭(variants: 플레임/프리즈/쇼크)별 속성
[{ "type": "attack", "kind": "physical", "addElement": ["fire"], "diceMod": "SL", "variant": 0 }, …]

// 《리저렉션》 [전투 불능] 회복, HP 1
[{ "type": "heal", "mode": "fixed", "amount": 1, "revive": true, "when": { "targetKO": true } }]

// 장식 「지식의 서」 에너미 식별 판정 +1
[{ "type": "modifier", "path": "checks.identify", "value": 1 }]
```

## 5. 작성 절차 (05의 단계 7)

1. 변환기가 만든 `data/skills/*.json`에는 `effects: []`, `review: "todo"`가 들어 있다.
2. 클래스 단위로 effects를 채운다. 자동으로 채운 것은 `review: "auto"`, 사람이 확인한 것은 `"ok"`.
2-1. 규칙상 효과가 없는 것(로프·물통 같은 설명용 도구, 식료품)은 `review: "none"`, effects는 빈 배열.
2-2. 전투 밖 연출·지형·NPC 반응처럼 자동화할 수 없어 **GM 개입이 반드시 필요한 것**은 `review: "gm"`, `effectsNote`에 GM이 할 일. 캐릭터 시트 스킬 줄에 「GM」 표시가 붙는다(리포트 「gm」 절).
3. 완전히 표현하지 못하면 가능한 만큼 쓰고 `review: "partial"`, `effectsNote: "남은 처리 설명"`을 남긴다. 런타임에서는 채팅 카드에 「GM 판단 필요: …」로 표시한다.
4. 커밋은 클래스 하나씩. `build/report.md`에 클래스별 todo/auto/partial/ok 수를 집계한다.
5. 에너미 스킬(66종 페이지의 스킬 목록), 아이템, 장식, 제련도 같은 방식으로.

## 6. 엔진 처리 순서 (스킬 1회 사용)

1. 사용 가능 확인: 타이밍, 부위 봉인, 무기 조건, 오버히트, 코스트(TP/FP), 지연 공격 대기 여부
2. 코스트 지불
3. 「주행동」이면 발동 2D6(1쌍이면 실패. 코스트는 이미 소모, 07 참조), 1이면 FP(주행동 1회당 1번)
4. 대상 결정(사거리·대상 범위·무작위)
5. effects를 순서대로 해석: 대상별로 명중 → 수동 반응 기회 → 대미지/회복/부여 → onHit → 트리거(추격·반격·크리티컬)
6. 결과를 채팅 카드로 출력하고, `autoApply` 설정에 따라 적용하거나 [적용] 버튼을 남긴다.
