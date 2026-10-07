# NSSQ — 「SRS가 아닌 세계수의 미궁 TRPG」 Foundry VTT 시스템 (한국어판)

팬메이드 TRPG 「SRSじゃない世界樹の迷宮TRPG」(NSSQ)의 **한국어판**을 Foundry VTT **v12.331**에서 돌리는 게임 시스템을 만든다.
목표는 **완전 자동화**다. 캐릭터 작성, 판정, 전투(명중·대미지·크리티컬·상태 이상·강화/약화·종료 페이즈), 스킬·아이템 효과, 탐색(채집·캠프), 성장까지 시스템이 처리하고, GM은 확인과 예외 처리만 한다.

## 문서 지도 (작업 전에 해당 문서를 반드시 읽는다)

| 문서 | 내용 |
|---|---|
| `docs/01-rules.md` | 구현할 룰 전체를 공식으로 정리한 명세. 판정·부능력치·전투·상태 이상·탐색·성장·쇼핑 |
| `docs/02-data.md` | 원천 데이터(`data/raw/`) 형식, 파싱 규칙, 열거형, ID 규칙, Actor/Item 데이터 모델 |
| `docs/03-effects.md` | 스킬·아이템 효과를 데이터로 적는 스키마(effects DSL)와 작성 절차 |
| `docs/04-foundry-v12.md` | Foundry v12.331 구현 지침. 써도 되는 API·쓰면 안 되는 API·확인 필요 목록 |
| `docs/05-roadmap.md` | 구현 단계, 단계별 완료 기준, 테스트 지침 |
| `docs/06-terminology.md` | 한국어 표기 규칙(괄호 기호, 조사, UI 문구)과 `docs/glossary.json` 사용법 |
| `docs/07-open-questions.md` | 원문에 명시가 없어 임시로 정한 처리. 확정되면 01에 반영하고 여기서 지운다 |
| `docs/glossary.json` | 번역 대조표 1,047항목. **용어의 절대 기준** |
| `data/raw/` | Notion 한국어판 전체 내보내기(74페이지). 룰 원문의 근거 |

`data/raw/`와 `docs/01-rules.md`가 다르면 `data/raw/`가 맞다. 차이를 발견하면 07에 적는다.

## 절대 규칙

1. **Foundry v12.331 전용.** `system.json`의 `compatibility`는 `{"minimum":"12","verified":"12.331","maximum":"12"}`.
   v13 API(ApplicationV2 기반 문서 시트, `renderChatMessageHTML`, `foundry.applications.ux.*` 등)는 쓰지 않는다. 자세한 건 04.
   v12에 그 API가 있는지 확실하지 않으면 추측하지 말고 04의 「확인 필요」에 적은 뒤 v12.331 소스(`resources/app/client`, `common`)에서 확인한다.
2. **용어는 `docs/glossary.json`이 절대 기준.** 한국어 문자열을 새로 만들 때는 먼저 glossary에서 찾는다. `forbidden`에 있는 표기는 절대 쓰지 않는다. 표기 규칙은 06.
3. **UI 문자열은 `lang/ko.json`에만.** 코드에 한국어를 하드코딩하지 않는다(데이터 파일의 이름·해설은 예외).
4. **스킬·아이템 효과는 데이터(`effects`)로만 구현.** 해설 문장을 런타임에 해석하거나 `if (name === "…")`로 분기하지 않는다. 스키마로 못 적는 것만 `custom` 핸들러로. 03 참조.
5. **규칙 엔진(`src/engine/`)은 Foundry를 import하지 않는 순수 JS.** 주사위는 주입받은 RNG로 굴린다. 엔진을 바꾸면 `npm test`가 통과해야 한다.
6. **룰이 애매하면 추측해서 구현하지 않는다.** 07에 질문을 추가하고, 채팅 카드에 "GM 판단 필요" 안내와 수동 적용 버튼을 두는 폴백으로 처리한다.
7. **자동 적용은 GM이 통제할 수 있어야 한다.** 설정 `autoApply`(끔/확인 후 적용/즉시 적용)를 모든 HP·TP·상태 변경에 적용한다. 플레이어가 소유하지 않은 문서의 변경은 소켓으로 GM에게 위임한다.
8. **공개 배포.** 저장소 `Nomal-1/nssq-fvtt`(공개)의 GitHub Releases로 배포한다. 매니페스트 URL은 `https://github.com/Nomal-1/nssq-fvtt/releases/latest/download/system.json`. `system.json`의 `manifest`·`download`는 `tools/package.mjs`가 버전에 맞춰 고친다. 릴리스는 `v*` 태그를 push하면 `.github/workflows/release.yml`이 만든다. 태그를 push할 수 없으면 버전을 올린 커밋을 main에 push한 뒤 사용자에게 https://github.com/Nomal-1/nssq-fvtt/actions/workflows/release.yml 의 [Run workflow]를 눌러 달라고 링크를 준다(package.json 버전으로 태그·릴리스를 만든다).

## 명령어

```bash
npm install
npm test                 # 엔진 단위 테스트 (vitest)
npm run build:data       # data/raw → data/*.json 변환 + build/report.md
npm run build:packs      # data/*.json → packs/ (LevelDB 컴펜디움)
npm run link             # .env의 FOUNDRY_DATA/Data/systems/nssq 로 심볼릭 링크
npm run package          # dist/nssq.zip + dist/system.json (릴리스용)
node tools/dev/foundry-e2e.mjs eval gm -e "return game.system.version" --shot build/a.png  # 테스트 월드 접속(NSSQ_FOUNDRY_URL·USER·PASSWORD·PLAYER·PLAYER_PASSWORD, 비밀번호 출력·커밋 금지)
node tools/dev/foundry-e2e.mjs update   # 서버 시스템을 최신 릴리스로 올리고 nssqtest 다시 켜기(NSSQ_FOUNDRY_ADMIN_PASSWORD)
```

## 작업 방식

- 05의 단계 순서대로 진행한다. 큰 단계는 plan mode로 계획을 먼저 보여 준다.
- 단계를 마치면 05의 체크리스트를 갱신하고 커밋한다. 커밋 메시지는 한국어 `[단계N] 요약`.
- 변환기에서 열거형 밖의 값, 파싱 실패, glossary에 없는 용어가 나오면 조용히 넘기지 말고 `build/report.md`에 남긴다.
- 사람이 검수해야 할 것(효과 데이터의 `review: "auto"` 등)은 목록으로 모아 보고한다.
