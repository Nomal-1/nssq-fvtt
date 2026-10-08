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
  "toSelf": true                // 대상과 관계없이 사용자 자신에게 한 번(《임팩트 애로》 사용 후 자신 [마비])(선택)
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
| `selfHasBind: true` | 자신이 봉인 중 |
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
| `inflict` | `condition`, `check: {type: fixed, target} | {type: contest, atkMod?} | {type: forced}` | 상태 이상·봉인 부여. forced: 저항 없이 반드시 걸고 심도만 사용자의 【억제 공격】 판정 달성값(07 #61) |
| `drain` | `resource`(hp/tp), `mode`(half: 준 대미지 절반 / sixes: 대미지 다이스의 6 개수) | onHit 안에서: 그 명중으로 자신 회복(《음양검: 영흡명참》) |
| `recoil` | `mode`(ones) | `toSelf`와 함께: 이 행동에서 굴린 대미지 다이스의 '1' 개수만큼 자신이 대미지(《싱글 스러스트》) |
| `kill` | `check: {type: fixed, target, defMod?} | {type: contest, atkMod?}` | 즉사: 억제 방어 롤 실패면 【HP】 0(카드에 \[즉사\]) |
| `cure` | `conditions[]` 또는 `"all"`, `kind`(ailment/bind/debuff/buff), `count`, `buffs[]`(그 강화·약화 id만) | 해제. `count`가 있으면 걸린 순서대로 그 개수까지(「(SL)개까지」) |
| `buff` / `debuff` | `id`, `value`, `turns`, `param`(속성 등) | 01 §3.10의 강화·약화 |
| `modifier` | `path`, `value` | 상시 보정. 타이밍 「상시」 스킬, 장식, 제련. path: `physAtk elemAtk physHit elemHit defense evasion speed suppAtk suppDef hpMax tpMax carry healDice(『회복』 스킬 회복 롤 다이스) itemHeal(아이템 회복량 +) guardCount(방어 스킬 횟수 +) tokenHit(『소환수』 토큰 공격 명중 +) overheatTurns(오버히트 턴 +) abilities.<능력치> resist.<속성> checks.<판정>` |
| `resource` | `resource`(hp/tp/fp), `delta` 또는 `set` | 직접 증감 |
| `stance` | `effects[]`, `until`(endOfTurn/count), `count` | 대기 상태가 되며 대기 중 효과 부여 |
| `trigger` | `on`, `effects[]`, `limit`(perAction/perTurn/perBattle) | 반응형. `on`: crit / beforeKO / attacked / allyAttacked / rowAttacked / endPhase / openingPhase / battleStart / selfHit(자신의 공격이 명중했을 때 선언) / mainPhaseStart(메인 페이즈 개시 시 선언) / escapeCheck(도주 판정 때 선언) / hpLost(자신의 HP가 줄었을 때) / enemyKO(자신의 공격으로 적을 쓰러뜨렸을 때) / buffGained(강화 효과를 얻었을 때) / battleWon(전투에 승리했을 때) / damaged(적의 공격 롤로 대미지를 받았을 때) / conditionGained(자신에게 상태 이상·봉인이 걸리는 순간. when `condition`·`conditionKind`) |
| `counter` / `chase` | `when`, `attack{…}`, `count`, `on`, `onlyIfEvaded`(반격만) | 반격·추격(01 §3.11의 연쇄 금지 규칙은 엔진이 강제). `attack.copyElement`: 계기가 된 공격의 속성으로 |
| `guard` | `mode`(half: 받는 대미지 반감 / cover: 대신 받기 / defense: 대상의 【방어】를 사용자 값으로 / redirect: 자신이 받는 공격을 대상에게 넘김 / reflect: 그 공격을 공격자에게 반사, 범위 공격은 1회분만 반사하고 나머지 무효 / nullify: 공격 완전 무효(턴당 1회)), `scope`(front/back/row: 자신이 있는 열/all/target/owner: 토큰의 배치자), `optional`(그때마다 할지 고름), `when` | 방어 스킬(대기 상태 안). 대기 상태의 `count`가 「누적 n회」, 《방패 마스터리》는 modifier `guardCount`로 그 횟수 + |
| `aura` | `path`, `value`, `scope` | 대기 상태 동안 아군에게 주는 보정(《삼색 가드》 내성 +SL 등) |
| `provoke` | `count` | 그 턴 동안 단일 대상 공격을 누적 count회까지 자신으로(《도발》) |
| `delayed` | `at`(endPhase/nextTurnLate), `turns`, `effects[]` | 지연 공격. 스킬마다 발동 시점이 달라 `at`으로 지정 |
| `token` | `tokenKey`, `turns`(지속 턴), `action{target, stats?, effects[]}`, `maxCount` | 토큰 배치. `action.target`은 대상 칸 문구, `action.stats`는 배치자의 어느 수치로 공격하는가(physical/elemental), `action.effects`는 매 턴 하는 행동 |
| `overheat` | `turns` | 드라이브 계열(상시 modifier `overheatTurns`로 증감) |
| `overheatReduce` | `turns` | 자신의 오버히트 단축(《샤프 에지》·《강제 배기》) |
| `attackBonus` | `hitMod`, `diceMod`, `atkMod`, `critDice`(크리티컬 추가 다이스 +), `critUp`(『크리티컬 업』 취급), `when` | 타이밍 「상시」: 공격할 때마다 붙는 보정. `when`은 공격 시점(대상·공격 속성)으로 판정(《선봉의 공명》 「아직 행동하지 않은 적에 대한 공격」). 통상 공격·스킬 공격 모두 |
| `useBonus` | `buffTurns`, `debuffTurns`, `healHp`, `when` | 타이밍 「상시」: 스킬을 쓸 때 붙는 보정. `buffTurns`·`debuffTurns`: 그 스킬로 주는 강화·약화의 지속 턴 +(《무용 마스터리》·《주언 마스터리》), `healHp`: 대상 HP 회복이 따라붙음(《리인포스》). 보통 `when.category` |
| `target` | `side`(enemy/ally/self), `scope`(single/row/all/random), `count?` | 대상 칸 대신 쓸 대상 지정(대상이 「특수」인 스킬). `count`(n명)는 아직 한 명씩 |
| `actionTiming` | `value`(first/last) | 「그 턴 최속/후발 행동」(대상에게. 자신이면 target 자신). 개막 페이즈에 쓰면 메인 페이즈 행동 순서에 반영(전투원 플래그 timing, 라운드마다 지움). 메인 페이즈 중 선언하는 것은 partial |
| `state` | `id`, `label`, `group?`, `mods[{path, value}]`, `max?`, `note?` | 전투 고유 상태(강화가 아님, 해제되지 않음, 전투 끝까지). 무사의 자세·《나찰》 등. 같은 `group`은 하나만, `max`가 있으면 쌓임(07 #57) |
| `requireState` | `state` | 「《○○》 상태 한정」. 그 상태가 없으면 쓸 수 없다(사용 시 해석하지 않음) |
| `flag` | `flag`, `value` | 규칙 스위치(타이밍 「상시」). `itemRevive`: 그 캐릭터가 쓰는 HP 회복 아이템에 부활 효과(《간이 소생》), `tokenMax`: 『소환수』 토큰 동시 유지 수(《백수의 왕기》) |
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
