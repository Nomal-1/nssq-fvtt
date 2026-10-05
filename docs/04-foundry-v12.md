# 04. Foundry VTT v12.331 구현 지침

대상은 **v12.331 하나**다. Claude는 최신(v13) API를 섞어 쓰기 쉬우므로 이 문서의 「쓰지 않는 것」을 반드시 지킨다. 확신이 없는 API는 「확인 필요」에 적고, v12.331 설치본의 `resources/app/client`·`resources/app/common` 소스로 확인한 뒤 이 문서를 고친다.

## 1. 저장소 구조

```
nssq/
├─ system.json
├─ lang/ko.json
├─ src/
│  ├─ nssq.mjs                # 진입점: CONFIG 등록, 훅, 소켓, 설정
│  ├─ engine/                 # ★ Foundry 비의존 순수 JS (vitest 대상)
│  │  ├─ dice.mjs             #   판정·대미지·회복·억제 방어 (RNG 주입)
│  │  ├─ derive.mjs           #   능력치 보너스·부능력치
│  │  ├─ expr.mjs             #   수식 평가기
│  │  ├─ effects/             #   효과 타입별 해석기 + conditions.mjs
│  │  ├─ conditions.mjs       #   상태 이상·봉인·강화/약화 규칙(중첩·대항·3종 제한)
│  │  ├─ combat.mjs           #   행동 순서, 사거리, 대상 범위
│  │  ├─ endphase.mjs         #   종료 페이즈 6단계
│  │  ├─ explore.mjs          #   채집·캠프·랜덤 던전 이벤트
│  │  ├─ growth.mjs           #   경험점·레벨업
│  │  └─ custom/              #   스키마 밖 스킬 핸들러
│  ├─ data/                   # TypeDataModel (actor/, item/)
│  ├─ documents/              # NssqActor, NssqItem, NssqCombat, NssqCombatant, NssqActiveEffect
│  ├─ sheets/                 # ActorSheet / ItemSheet (v1)
│  ├─ apps/                   # 캐릭터 작성 마법사, 채집·캠프 대화창, 세션 결과 도구 (FormApplication)
│  ├─ chat/                   # 채팅 카드 렌더링·버튼
│  └─ socket.mjs
├─ templates/ (.hbs)   styles/nssq.css
├─ data/raw/ (원천, 수정 금지)   data/*.json (변환 결과)
├─ tools/convert.mjs   tools/pack.mjs
├─ packs/ (빌드 산출물)   tests/   docs/
```

## 2. 매니페스트 (`system.json`)

```jsonc
{
  "id": "nssq",
  "title": "SRS가 아닌 세계수의 미궁 TRPG",
  "version": "0.1.0",
  "compatibility": { "minimum": "12", "verified": "12.331", "maximum": "12" },
  "esmodules": ["src/nssq.mjs"],
  "styles": ["styles/nssq.css"],
  "languages": [{ "lang": "ko", "name": "한국어", "path": "lang/ko.json" }],
  "documentTypes": {
    "Actor": { "character": {}, "enemy": {}, "token": {} },
    "Item": { "class": {}, "skill": {}, "weapon": {}, "armor": {}, "accessory": {},
              "consumable": {}, "tool": {}, "material": {} }
  },
  "socket": true,
  "grid": { "distance": 1, "units": "칸" },
  "primaryTokenAttribute": "hp",
  "secondaryTokenAttribute": "tp",
  "packs": [ /* 05 단계 1에서 채움 */ ]
}
```
- `documentTypes`에 서식 텍스트 필드가 있으면 `htmlFields`를 지정한다.
- `manifest`는 `releases/latest/download/system.json`, `download`는 `releases/download/v<버전>/nssq.zip`. 손으로 고치지 말고 `npm run package <버전>`(릴리스 워크플로가 호출)에 맡긴다.
- `documentTypes`의 각 타입에 `htmlFields: ["description"]`을 지정했다.

## 3. 쓰는 것 (v12)

| 영역 | API |
|---|---|
| 데이터 모델 | `foundry.abstract.TypeDataModel`, `foundry.data.fields.*`(`NumberField`, `StringField`, `SchemaField`, `ArrayField`, `HTMLField`, `BooleanField`, `ObjectField`), `CONFIG.Actor.dataModels`, `CONFIG.Item.dataModels` |
| 문서 클래스 | `CONFIG.Actor.documentClass` 등에 `Actor`/`Item`/`Combat`/`Combatant`/`ActiveEffect` 서브클래스 |
| 시트 | `ActorSheet`, `ItemSheet`(Handlebars). `getData()`, `activateListeners(html)` — html은 **jQuery**. 등록: `Actors.unregisterSheet("core", ActorSheet)`, `Actors.registerSheet("nssq", NssqCharacterSheet, { types: ["character"], makeDefault: true })` |
| 대화창 | `Dialog`, `FormApplication` |
| 주사위 | `new Roll("6d6cs>3")` + **`await roll.evaluate()`**(v12는 비동기가 기본). `kh2`, `cs>=4` 사용. `roll.dice[0].results`에서 눈 확인 |
| 채팅 | `ChatMessage.create({ content, speaker, rolls, flags })`, 훅 `renderChatMessage(message, html, data)` — html은 jQuery |
| 상태 아이콘 | `CONFIG.statusEffects` 배열 `{ id, name, img }`(v12 키. 구버전 `label`/`icon` 아님) |
| 효과 | `ActiveEffect`(`changes[]`, `statuses`, `flags.nssq.*`) |
| 소켓 | `game.socket.on("system.nssq", handler)`, `game.socket.emit("system.nssq", payload)` |
| 설정 | `game.settings.register("nssq", key, { scope, config, type, choices, default })` |
| 다국어 | `game.i18n.localize`, `game.i18n.format` |
| 컴펜디움 빌드 | `@foundryvtt/foundryvtt-cli`의 `compilePack(srcDir, destDir)`(LevelDB) |
| 토큰 바 | `CONFIG.Actor.trackableAttributes` |

## 4. 쓰지 않는 것 (v13 이후, 또는 v12에서 미성숙)

- `foundry.applications.sheets.ActorSheetV2` / `ItemSheetV2` 및 `HandlebarsApplicationMixin` 기반 문서 시트
- 훅 `renderChatMessageHTML`
- `foundry.applications.ux.*` 네임스페이스(TextEditor 등 v13 이동판)
- `template.json` 방식의 타입 선언(쓰지 말고 `documentTypes` + DataModel로)
- 동기 `roll.evaluate({async:false})`

## 5. 구현 방침

### 5.1 파생치와 보정
- `prepareDerivedData`에서 엔진 `derive.mjs` 호출. 보정 출처: 장비 R식 → 제련 → 장식 → 상시 스킬 `modifier` → ActiveEffect(강화·약화·상태 이상·봉인).
- ActiveEffect의 `changes`로 직접 수치를 바꾸지 말고, 효과 목록을 엔진에 넘겨 계산한다(중첩·대항·3종 제한을 엔진이 판정해야 하므로).

### 5.2 상태 이상·강화/약화
- `CONFIG.statusEffects`: petrify, curse, poison, sleep, confuse, paralyze, fear, blind, stun, bindHead, bindArm, bindLeg, ko, waiting. 이름은 `lang/ko.json`에서 glossary 표기 그대로.
- 심도는 `flags.nssq.depth`, 독 대미지값은 `flags.nssq.poisonDamage`(부여자의 억제 공격).
- 강화·약화는 ActiveEffect + `flags.nssq.buff = { id, value, turns, kind }`. Foundry 기본 duration 자동 만료를 쓰지 말고 종료 페이즈에서 직접 감소(확인 필요 #3).

### 5.3 전투 (NssqCombat)
- `flags.nssq.phase`: `opening` / `main` / `end`. 컴뱃 트래커에 페이즈 표시와 [다음 페이즈] 버튼.
- 이니셔티브 굴림 없음: 이니셔티브 = 【속도】(최속 +1000, 후발 −1000). 동률 정렬 PC → 아군 NPC → 에너미.
- 개막 페이즈: 전투원별 개막 행동 선택 UI → GM의 [개막 처리]로 일괄 해결. 혼란·마비·공포의 1D6을 자동 판정.
- 메인 페이즈: 순서대로 진행, 대기 상태·행동 불가는 자동 건너뜀.
- 종료 페이즈: 엔진 `endphase.mjs` 결과를 순서대로 적용하고 요약 채팅 카드 1장 출력.
- 진영(`flags.nssq.side`)·열(`system.row`)로 범위 대상(열·전체·관통)을 계산한다.

### 5.4 채팅 카드
- 스킬 사용 카드: 코스트, 발동 2D6, 대상별 명중/대미지 다이스(눈 표시, 내성 초과 강조, 크리티컬 표시)/부여·저항 결과, [적용] [되돌리기] 버튼.
- 판정 카드: 달성값, 절대 성공·실패 표시, 【FP】 획득. 【FP】 주사위 추가는 **판정 전 대화창에서만**(굴린 뒤 추가 불가). 3개 이상 굴렸으면 사용할 2개를 고르는 UI(기본은 높은 2개).
- 【FP】 획득 흐름: 1이 나왔고 다시 굴릴 【FP】가 있으면 1로 얻을 【FP】를 **보류**하고 [확정]/[다시 굴리기]를 보인다. [확정]하면 지급, [다시 굴리기]하면 비용만 내고 보류분은 없어진다. 다시 굴릴 수 없으면 바로 지급한다. 같은 캐릭터가 다음 판정을 굴리면 보류 중인 이전 판정은 자동 확정된다(`engine/check.mjs`의 `settleOnRoll`·`confirmCheck`).
- 수동 행동: 공격 대상의 소유자에게 "수동 스킬 사용?" 프롬프트(시간 제한 설정 가능, 기본 없음).

### 5.5 소켓과 권한
- 플레이어 클라이언트는 자신이 소유하지 않은 액터를 수정하지 않는다. `{ action: "applyDamage" | "applyEffect" | "advancePhase" …, payload }`를 보내고, 활성 GM 1명(`game.users.activeGM`)만 처리한다.

### 5.6 설정
| 키 | 값 |
|---|---|
| `autoApply` | off / confirm / auto (기본 confirm) |
| `revealOnIdentify` | 식별 성공 시 에너미 시트 공개 범위 |
| `fpStart` | 세션 시작 FP(기본 1) |
| `timeUnit` | 랜덤 던전 턴 / 베이직 던전 세그먼트 |

## 6. 확인 필요 (확인하면 체크하고 결과를 적는다)
- [x] #1 Combat 정렬: 정렬은 재정의하지 않고, `rollInitiative`를 재정의해 이니셔티브 = 【속도】(+1000/−1000, 동률 PC +0.2·아군 +0.1)로 넣는다. 기본 정렬(내림차순)이 그대로 맞는다
- [x] #2 Combat/Combatant 상태는 `flags.nssq`(phase, guarding, waiting, opening, timing)로 둔다
- [ ] #3 ActiveEffect 지속 시간 자동 처리를 피하는 방법
- [ ] #4 `CONFIG.Actor.trackableAttributes` 형식
- [x] #5 `compilePack` 옵션과 `packs` 항목 → `@foundryvtt/foundryvtt-cli` **1.1.0**으로 고정(2.x 이상은 v13용). 소스는 문서당 JSON 1개, 확장자로 yaml/json 구분. 문서마다 `_key` 필수: 최상위 `!items!<id>`·`!actors!<id>`·`!folders!<id>`, 임베디드 `!actors.items!<actorId>.<itemId>`. 액터의 `items`는 객체 배열로 넣으면 CLI가 id 배열로 바꿔 따로 저장한다. `packs` 항목은 `{ name, label, path, type, system, ownership }`, 폴더 묶음은 `packFolders`. `tools/pack.mjs`가 system.json의 두 항목을 다시 쓴다.
- [x] #7 `game.users.activeGM` 사용(v12에 있음). `src/combat/apply.mjs`의 `isActiveGM`
- [ ] #8 매니페스트 `grid` 키 형식(v12)과 `primaryTokenAttribute` 지원 여부
- [ ] #6 `renderChatMessage`에서 버튼 이벤트를 위임할 때 메시지 재렌더 시의 중복 바인딩
