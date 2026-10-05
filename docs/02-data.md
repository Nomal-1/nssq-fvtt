# 02. 데이터: 원천, 변환, 모델

## 1. 원천 데이터 (`data/raw/`)

Notion 한국어판을 그대로 내보낸 마크다운이다(표는 HTML `<table>`). **수정하지 않는다.** 번역이 바뀌면 통째로 다시 내보낸다.

| 폴더 | 내용 |
|---|---|
| `rules/` | 플레이 룰(세션 진행, 일반 행위 판정, 전투, 던전 탐색, 베이직·랜덤 던전, 결과와 성장, 쇼핑과 생활) |
| `character/` | 캐릭터 작성, 샘플 캐릭터 목록과 12종 상세 |
| `classes/NN-이름.md` | 클래스 31종. 맨 위 JSON 블록이 클래스 속성 |
| `data/` | 커먼 스킬, 무기·방어구(제련 포함), 아이템, 소재 |
| `enemies/` | 에너미 개요 + Lv1 / Lv2 / Lv3~4 / F.O.E. (총 66개 블록, 원문 65종) |
| `gm/` | GM 지침, 샘플 시나리오 2개 |
| `misc/` | 들어가며, FAQ, 갱신 이력 등 |
| `glossary-page.md` | 번역 대조표 설명 페이지(표기 원칙·변경 기록) |

각 파일 첫 줄의 `<!-- notion: … -->`에 원본 페이지 ID가 있다. 이미지는 `(이미지 생략)`으로 바뀌어 있다(클래스 스킬 트리 SVG 등).

## 2. 파싱 규칙

### 2.1 클래스 (`classes/*.md`)
- 맨 위 JSON: `{"STR","TEC","VIT","AGI","LUC"(능력치 보정), "무기"("단검/검/세검/도끼" 형식), "방어구", "번호", "역할"[], "원문", "원문 링크", "위치", "클래스"}`.
  - 몽크의 무기 `망치(주먹)`처럼 괄호 주석이 붙는 경우가 있다 → `build/report.md`에 남기고 의미는 클래스 본문 기준으로 처리.
- 본문: 클래스 설명 → `### 스킬 트리`(이미지) → `### 스킬` → 표.
- 스킬 표 열: `스킬 | 해설 | 무기 | 부위 | 분류 | 타이밍 | 사거리 | 대상 | 코스트 | MaxSL` (31클래스 + 커먼, 합계 약 755행).

### 2.2 커먼 스킬 (`data/커먼-스킬.md`)
- 열 순서가 다르다: `스킬명 | 해설 | 무기 | 부위 | 분류 | 타이밍 | 사거리 | 대상 | TP | MaxSL`.

### 2.3 스킬 셀 규칙
- 이름 셀: `《스킬명》`. 고유 스킬은 `《★스킬명》` → `unique: true`, 이름에서 ★ 제거.
- 해설 끝의 `전제: …` → `prereqs`. 해설 본문은 그대로 둔다.
  - `+`는 AND, `or`는 OR다. 예: `전제: 《검 마스터리》 SL3 or 《세검 마스터리》 SL3 or 《채찍 마스터리》 SL3`.
  - 구조: `{ "all": [ {skill, sl} | { "any": [ … ] } ] }`.
- 일부 해설에 `\[ \]`, `\~` 같은 Notion 이스케이프가 있다 → 변환 시 역슬래시 제거.
- 「선언 명칭」: 《삼색 체이스》처럼 한 스킬이 여러 이름 중 하나로 선언되는 경우가 있다(glossary 비고에 "선언 명칭"). 하나의 스킬 아이템에 `variants`로 담는다.

### 2.4 열거형 (밖의 값이 나오면 리포트)
| 필드 | 값 |
|---|---|
| 무기 | 빈칸, 또는 `/`로 이은 무기 종류: 단검 검 세검 창 도끼 지팡이 망치 채찍 도 포검 농기구 활 쇠뇌 총 주먹 방패 |
| 부위 | `-` 머리 팔 다리 |
| 분류 | `-` 백병 사격 술식 회복 주언 주가 소환수 무용 호령 방어 인법 방진 투인 |
| 타이밍 | 상시 주행동 개막 수동 특수 |
| 사거리 | `-` 근 원 |
| 대상 | 자신 / 적 단일·열·전체·관통 / 아군 단일·열·전체 / 임의 단일 / 특수 / `-` |
| 코스트 | `-` / `TP: n` / `FP: n` |
| MaxSL | `메인/서브`(3/2, 5/3, 4/2, 2/1, 1/1, 3/-, 2/-, 1/-, 1/0), `★`=고유 스킬 |
| 속성 | 물리 〈참〉〈괴〉〈돌〉, 속성 〈염〉〈빙〉〈뇌〉, 무속성 |
| 방어구 종류 | 중갑 경갑 옷 방패 |
| 소재 | 이빨 가죽 모피 뿔 발톱 뼈 날개·깃털 껍질 가시 칼날 실 비늘 등딱지 결정 목재 덩굴 가지 석재 금속 보석 풀 꽃 열매 (23종) |

`1/0`(커먼 스킬)과 `-`(서브 불가)의 차이는 07에서 확정한다.

### 2.5 에너미 (`enemies/*.md`)
```
### 이름 (原文)              ← ★로 시작하면 F.O.E.
Lv1 · HP 5 · 물명 3 · 속명 0 · 회피 7 · 물공 10 · 속공 0 · 방어 3 · 억공 2 · 억방 2 · 속도 15 · 희소도 9 · 공격 속성 괴
내성: 참3 괴3 돌3 염2 빙3 뇌3
- 《스킬》(부위/분류/타이밍/사거리/대상): 해설
DROP: 4\~7 R1 이빨 / 8\~ R1 가죽     ← 2D6 범위, R, 소재. "8 고기"처럼 R 없는 것도 있다
> 배경 설명(요약)
[원문](…)
```
- DROP의 소재명 '날개'와 '깃털'은 같은 소재 종류(날개·깃털)다. 새 계열은 '깃털'로 표기돼 있을 뿐이다.
- 연계 공격 스킬은 해설에 연계자 조건이 있다("같은 열에 괴물두리안이 2마리 이상 있을 때").
- 공격 속성은 참·괴·돌 중 하나, 또는 `무`(무속성)다.
- 각 에너미 페이지 맨 위의 "스탯 순서: …" 안내 문단은 데이터가 아니므로 건너뛴다.

### 2.6 장비 (`data/무기·방어구.md`)
- 무기 표: `무기 종류 | 분류 | 사거리 | 기본 속성 | 물리 명중 | 속성 명중 | 물리 공격 | 속성 공격 | 속도 | 가격 | 대응 소재`.
  수치 칸에 **R(또는 Lv)의 식**이 들어 있다: `(R×3)+5`, `R+3`, `(R의 제곱)×100`, `(Lv×3)+4`, `+1`, `-4`.
  → 문자열 그대로 보관하고 엔진의 수식 평가기(03 §1)로 계산한다. `R의 제곱` → `R*R`, `×` → `*`.
- 농기구의 기본 속성 `(※)`: 입수할 때 〈참〉〈괴〉〈돌〉 중 선택.
- 방어구 표: `방어구 종류 | 방어 | 회피 | 속도 | 가격 | 대응 소재`.
- 장식 표: `장식 명칭 | 효과 | 가격`. 효과는 `【STR】+1`, `에너미 식별 판정에 +1` 등 → effects로 변환.
- 제련 표: `효과 | 종류(무기/방어구) | 가격(R식)`.

### 2.7 아이템·소재
- 아이템 표: `아이템 명칭 | 해설 | 가격 | 필요 소재`(소모품 / 기타 아이템 두 표). 필요 소재 예: `풀 R4`.
- 식료품 분류(생선·곡류·채소·과일·알·고기 등)는 캠프에 쓰인다. 분류 표기는 glossary 카테고리 「소모품 아이템」과 본문 '식료품' 기준.
- 소재 표: 소재 종류 이름만 있다. 소재 아이템은 `{type, rank}`로 표현한다.

### 2.8 `docs/glossary.json`
```json
{ "ko": "표기", "jp": "원문", "category": "클래스 스킬", "classes": ["소드맨"],
  "source": "정식 한글판(게임 화면) | 정식 한글판(공식 자료) | 자체 번역",
  "forbidden": ["이전 표기", "…"], "note": "비고" }
```
- 변환기는 스킬·에너미·아이템 이름이 glossary의 `ko`와 일치하는지 검사하고, 불일치하거나 `forbidden`에 걸리면 리포트한다.
- `jp`는 ID 생성(§3)에 쓴다.

## 3. ID와 키
- 각 문서에 `system.key`(불변 키)를 둔다. **glossary의 `jp`(원어)** 를 정규화해서 만든다(NFKC → 공백·기호 제거). glossary에 없으면 한국어명으로 만들고 리포트한다.
- 컴펜디움 `_id` = `sha1(type + ":" + scope + ":" + key)`를 base62로 바꾼 앞 16자. 빌드할 때마다 같아야 한다(번역명이 바뀌어도 링크가 깨지지 않도록).
- 같은 이름의 스킬은 같은 스킬로 취급한다(전제 조건). 스킬 아이템은 `skillKey`(클래스 공통)와 `classKey`(커먼은 `common`)를 둘 다 갖는다.

## 4. 데이터 모델 (TypeDataModel)

### 4.1 Actor
**character**
```
abilities: { str: { base, growth, bonus, temp }, … }   # 굴림·성장·GM 보너스·일시. v0.3.x의 숫자 값은 migrateData가 base로 옮긴다
creation: { locked, log[] }                  # 캐릭터 작성 잠금(잠그면 굴림은 GM만), 작성 기록(능력치 굴리기·배정·GM 수정·잠금)
abilityRolls: [n×5]                          # 작성 시 3D6 결과(초기 소지금 계산)
level, exp
hp: { value, max }, tp: { value, max }, fp: { value }
mainClass: classKey, subClass: classKey | null
resist: { slash, strike, pierce, fire, ice, volt }   # 참 괴 돌 염 빙 뇌, 기본 3
row: "front" | "back", order
money                                       # G
history: [string]                           # 경력표
```
파생치는 `prepareDerivedData`에서 엔진 `derive.mjs`를 호출해 계산한다(01 §1.2).
- 능력치 최종값 = 굴림 + 클래스(메인 클래스 보정 × Lv) + 성장 + GM 보너스 + 장비 + 일시 (`abilityBreakdown`). 클래스·장비는 저장하지 않고 계산하며, 결과는 `system.abilityParts`·`system.abilityTotal`.
- 메인·서브 클래스는 캐릭터가 가진 클래스 아이템(최대 2개)이다. `mainClass`·`subClass`에는 그 아이템의 `system.key`를 둔다. `mainClass`가 맞는 아이템이 없으면 첫 클래스 아이템을 메인으로 본다.

**enemy**
```
level, rarity, attackElements: [], isFOE, isRare, identified
hp: { value, max }
stats: { physHit, elemHit, evasion, physAtk, elemAtk, defense, suppAtk, suppDef, speed }   # 고정값
resist: { … }
drops: [{ min, max | null, item, rank | null }]
row, order
```

**token**(토큰 스킬로 배치되는 유사 NPC): `ownerUuid`, `action`(effects), `speedFrom: owner`.

### 4.2 Item
| 타입 | 주요 필드 |
|---|---|
| `class` | key, abilityBonus{…}, weapons[], armors[], role[], position, description |
| `skill` | key, skillKey, classKey, weaponReq[], part, category, timing, range, target, cost{tp,fp}, maxSL{main, sub|null}, unique, prereqs[], variants[], sl, description, **effects[]**, review |
| `weapon` | weaponType, rank, element(농기구는 선택값), refinements[≤2], slot("weapon"/"other") — 수치는 종류 표의 R식으로 계산 |
| `armor` | armorType, rank, refinements[≤2] |
| `accessory` | effects[], price |
| `consumable` | price, materials[], description, effects[], quantity, uses{value,max}, stored, foodstuff(bool) |
| `tool` | 기타 아이템. effects[], price, quantity, consumable(bool: 해설이 「소모품.」으로 시작), uses{value,max}(「n개 세트」→ n회), stored |
| `material` | materialType, rank, quantity |

- 장비 가능 판정: 무기·방패는 메인 또는 서브 클래스, 갑옷은 메인 클래스.
- 소지 수 계산에서 장비 중인 것은 제외. 백팩은 1개만, 소지 수에 안 센다.

## 5. 변환 산출물 (`data/*.json`)
```
data/classes.json
data/skills/<classKey>.json, data/skills/common.json
data/weapons.json, armors.json, accessories.json, refinements.json
data/items.json (consumables + tools), materials.json
data/enemies/<lv1|lv2|lv3-4|foe>.json
data/tables/random-dungeon.json, gathering.json, history-d666.json, level-exp.json
```
`build/report.md`에는 열거형 위반, 파싱 실패, glossary 불일치, effects 미작성·partial 수(클래스별)를 남긴다.

### 5.1 산출물 형식 (단계 1에서 확정)
- 각 항목은 `{ id, name, type, img, system }`. `id`가 컴펜디움 `_id`다. 에너미는 `items`(임베디드 스킬, `_id`·`_key` 포함)를 가진다.
- `data/*.json`은 저장소에 커밋한다. **효과(`effects`·`review`·`effectsNote`)는 이 파일에 직접 작성한다.** `convert.mjs`는 다시 돌려도 같은 id(없으면 `key`)의 효과 값을 기존 파일에서 옮겨 오므로 지워지지 않는다.
- 무기·방어구의 `system.table`(R식 표 값)과 장식의 `system.effectText`는 변환 보조 필드다. 컴펜디움에는 넣지 않고(`pack.mjs`가 제거), 런타임은 릴리스 zip에 들어가는 `data/weapons.json` 등을 읽는다.
- 스킬 키: `skillKey` = glossary `jp` 정규화, `system.key` = `<classKey>.<skillKey>`. 에너미 스킬은 `enemy.<enemyKey>.<skillKey>`이고, 《약점: 머리》처럼 인자가 있는 것은 `弱点.bindHead`처럼 인자를 상태·속성 ID로 붙인다.
- 스킬 `review` 초깃값은 `"todo"`. 단계 7에서 `auto`(자동 작성·검수 필요)/`done`/`partial`/`custom`으로 바꾼다.
- CI(`test.yml`)는 `build:data` 뒤 `git diff --exit-code -- data src/generated`로 산출물이 원천과 어긋나지 않았는지 확인한다.
- 장식·제련·기타 아이템의 단순한 효과 문장(「【STR】+1」「아이템 소지 수 +4를 얻는다」 등)은 변환기가 `effects`로 자동 작성하고 `review: "auto"`, `effectsSource: "convert"`를 붙인다. 이 표시가 있는 효과는 재변환 때 새로 만든다. 손으로 고치면 `effectsSource`를 지운다(지우지 않으면 덮어쓰인다).
- `src/generated/tables.mjs`: 무기·방어구 종류 표, 제련 표(효과 포함), 소재 종류. 런타임(DataModel)과 테스트가 동기로 import한다. 변환기가 만들며 직접 고치지 않는다.

### 5.2 modifier 경로 (단계 3에서 확정)
| path | 뜻 |
|---|---|
| `abilities.<str…luc>` | 능력치(시트 「장비」 열) |
| `physHit` `elemHit` `evasion` `physAtk` `elemAtk` `defense` `suppAtk` `suppDef` `speed` | 부능력치 |
| `hpMax` `tpMax` | 【HP】【TP】 최대 |
| `carry` | 아이템 소지 수 한도 |
| `resist.<slash…volt>` | 내성 |
| `checks.<identify\|escape\|campDanger>` | 특정 판정 보정(사용처는 각 단계에서 연결) |

flag: `weaponElement`(제련 속성 부여), `noCarryCount`(소지 수에 안 셈), `ownLimit`(최대 소지 개수).
