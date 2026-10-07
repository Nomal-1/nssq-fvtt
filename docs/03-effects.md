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
- 데이터 쪽 원문 표기 `(SL×2)`, `(R의 제곱)×100`은 변환기가 `SL*2`, `R*R*100`으로 바꾼다.

## 2. 공통 필드

```jsonc
{
  "type": "attack",            // 아래 §3 중 하나
  "when": { … },               // 적용 조건 (생략 시 항상)
  "chance": { "roll": "1d6", "lte": "SL" },   // 확률 발동
  "label": "…"                 // 채팅 카드에 표시할 짧은 이름(선택)
}
```

`when` 키 목록(새 키가 필요하면 여기에 먼저 추가하고 엔진 `effects/conditions.mjs`도 갱신한다)
| 키 | 뜻 |
|---|---|
| `weaponType: [..]` | 현재 사용 무기 종류 |
| `dualWield: true` | 무기·기타 슬롯 모두 무기 장비 |
| `targetHasSkill: "이름"` | 대상이 그 스킬 보유(예 《야행성》) |
| `targetNotActedThisTurn` | 대상이 이번 턴 메인 행동 전 |
| `selfHpAtMostHalf` | 자기 HP가 최대의 절반 이하 |
| `selfRow: "front"/"back"` | 자기 위치 |
| `element: [..]` | 처리 중인 공격의 속성 포함 |
| `attackKind: "physical"/"elemental"` | 처리 중인 공격의 종류 |
| `timeOfDay: "day"/"night"` | 탐색 시간대 |
| `allyCountInRow: {name, gte}` | 같은 열에 특정 에너미 n체 이상(연계 공격) |

## 3. 효과 타입

| type | 필드 | 설명 |
|---|---|---|
| `attack` | `kind`(physical/elemental), `element`(생략 시 무기 기본 속성), `times`, `hitMod`, `diceMod`, `atkMod`, `atkMultiplier`, `random`, `uniqueTarget`, `onHit[]`, `bonuses[{when, hitMod?, diceMod?}]`, `halfDamage` | 공격 롤 1회분(또는 times회) |
| `heal` | `mode`(roll/fixed/full/percent), `bonus`/`amount`, `resource`(hp/tp) | 회복 롤 또는 고정 회복 |
| `inflict` | `condition`, `check: {type: fixed, target} | {type: contest}` | 상태 이상·봉인 부여 |
| `cure` | `conditions[]` 또는 `"all"`, `kind`(ailment/bind/debuff) | 해제 |
| `buff` / `debuff` | `id`, `value`, `turns`, `param`(속성 등) | 01 §3.10의 강화·약화 |
| `modifier` | `path`, `value` | 상시 보정. 타이밍 「상시」 스킬, 장식, 제련 |
| `resource` | `resource`(hp/tp/fp), `delta` 또는 `set` | 직접 증감 |
| `stance` | `effects[]`, `until`(endOfTurn/count), `count` | 대기 상태가 되며 대기 중 효과 부여 |
| `trigger` | `on`, `effects[]`, `limit`(perAction/perTurn/perBattle) | 반응형. `on`: crit / beforeKO / attacked / allyAttacked / rowAttacked / endPhase / openingPhase / battleStart |
| `counter` / `chase` | `when`, `attack{…}`, `count` | 반격·추격(01 §3.11의 연쇄 금지 규칙은 엔진이 강제) |
| `delayed` | `at`(endPhase/nextTurnLate), `turns`, `effects[]` | 지연 공격. 스킬마다 발동 시점이 달라 `at`으로 지정 |
| `token` | `tokenKey`, `action{…}`, `maxCount` | 토큰 배치 |
| `overheat` | `turns` | 드라이브 계열 |
| `flag` | `flag`, `value` | 규칙 스위치. 예 쌍수 스킬 공격 허용, 토큰 동시 유지 수 |
| `custom` | `handler` | 스키마 밖. `src/engine/custom/<handler>.mjs` |
| `activeEvade` | `ability`(str/tec/vit/agi/luc), `bonus`, `vs`(physical/elemental, 생략 시 둘 다) | 타이밍 「수동」: 능동 회피. 대상 2D6+능력치 보너스+bonus vs 공격자 명중 달성값, 동점 회피(07 #51) |
| `nullify` | — | 타이밍 「수동」: 그 공격의 대미지 0·추가 효과 무효(《완전 방어》), 반응한 캐릭터의 같은 편 대상 전부 |

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
