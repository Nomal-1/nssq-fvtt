# 05. 구현 단계와 완료 기준

각 단계는 앞 단계가 끝나야 시작한다. 단계가 끝나면 아래 체크박스를 갱신하고 `[단계N]` 커밋을 만든다.

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| **0 뼈대** | system.json, documentTypes, 빈 DataModel, ko.json, 빈 시트, vitest·eslint 설정, `npm run link` | v12.331에서 월드 생성, 모든 타입의 액터·아이템을 만들고 열 수 있다 |
| **1 데이터 변환** | `tools/convert.mjs`: data/raw → data/*.json (effects는 빈 배열) + glossary 검사 + `build/report.md`. `tools/pack.mjs`로 컴펜디움 | 클래스 31, 스킬 755(클래스 738 + 커먼 17), 무기 15종(+주먹 마스터리 대체 식), 방어구 4종, 장식 15, 제련 17, 소모품 23·기타 아이템 16, 소재 23종, 에너미 65블록(스킬 162)이 변환되고 리포트의 열거형 위반이 0이거나 사유가 적혀 있다 |
| **2 캐릭터 시트·판정** | 파생치, 일반 행위 판정, 대항 판정, 절대 성공·실패, FP(추가·재굴림) | 01 §1.2 모든 식과 §2 규칙이 단위 테스트로 통과. 시트에서 능력치 판정 버튼이 채팅 카드를 낸다 |
| **3 장비·인벤토리** | 슬롯, 장비 가능 판정, R식 계산, 제련(2개·중복 금지), 소지 한도, 구입·매각(G, 소재 소모) | 장비 가능 판정·소지 한도·가격 식 테스트 통과 |
| **4 전투 코어** | NssqCombat 페이즈, 행동 순서, 통상 공격(명중·대미지·크리티컬·내성), 대기·방어 전념, 전투 불능·전후위 교대, 소켓 | 플레이어 클라이언트가 에너미를 공격하면 GM 쪽에서 HP가 줄어든다(autoApply 3모드 모두) |
| **5 상태·효과 관리** | 상태 이상·봉인·심도, 강화/약화(3종·최대값·대항), 종료 페이즈 6단계, 식별·희소종 | 01 §3.8~3.12 규칙 테스트 통과 |
| **6 효과 엔진** | expr, effects 해석기, 스킬 사용 흐름(03 §6), 수동 반응, 회복 롤, 억제 방어(고정/대결) | 03 §4의 예시 전부가 테스트로 통과 |
| **7 효과 데이터 작성** | 클래스별 effects 작성(클래스당 1커밋), 에너미 스킬·아이템·장식·제련 | report의 `todo` 0. `partial` 목록을 정리해 보고 |
| **8 트리거계** | 추격·반격(연쇄 금지), 지연 공격, 연계 공격, 토큰, 오버히트, 크리티컬 시 발동, 선언 명칭 스킬 | 반격의 반격 없음·추격에 대한 반격 있음 테스트, 토큰 2개 유지 등 |
| **9 탐색·세션 도구** | 채집 대화창(조금만/적당히/잔뜩, 아앗!), 캠프, 트랩, 랜덤 던전 이벤트 롤러, 드롭 판정, 세션 결과(경험점·능력치 성장·레벨업) | 랜덤 던전 1회를 처음부터 끝까지 도구만으로 진행할 수 있다 |
| **10 캐릭터 작성 마법사** | 3D6×5 배정, 클래스·서브, SL 5(Lv1 최대 2)·전제·고유 스킬, 커먼 스킬, 초기 소지금, 구입 | 샘플 캐릭터 12종(`data/raw/character/`) 중 3종 이상을 마법사로 재현 |

### 단계 9 갈무리 설계 메모 (단계 3에서 준비)
- 아이템 받기는 `src/apps/acquire.mjs`의 `acquireItems(actor, dataList, { source })` 하나로 한다. 반환값 `{ taken, left }`.
- 출처 `loot`(갈무리·채집)·`gift`(끌어 놓기·건네기)는 창고로 보낼 수 없고 일부만 챙길 수 있다. `shop`·`storage`는 창고 가능, 전부 아니면 취소.
- 소지 수를 넘으면 정리 창(두고 가기 / 버리기 / 창고로). GM이 호출하면 소유 플레이어에게 넘기고 결과를 소켓으로 돌려받는다.
- 갈무리: 드롭 판정 결과를 「갈무리 풀」(채팅 카드 또는 창)에 모으고, 플레이어가 집거나 GM이 배분하면 `acquireItems(..., { source: "loot", reason })`를 부른다. `left`는 풀로 되돌려 다른 캐릭터가 가져갈 수 있게 한다. 풀을 닫으면 남은 것은 버린 것으로 본다.

### 이후 메모
- 커스텀 몬스터 기능을 넣을 때: 에너미 그림의 투명 여백을 자동으로 잘라 보여 주기(정보판이 그림 끝에 붙으므로 여백이 많으면 떨어져 보인다, 사용자 요청으로 그때 함께)

## 테스트 지침

- 엔진 함수는 RNG를 주입받는다. **고정 주사위 배열**로 테스트한다.
- 필수 케이스
  - 【물리 공격】 9, 대상 【방어】 3, 〈참〉 내성 3 → 6D6, 눈 [4,5,6,1,2,3] → 실대미지 3
  - 6이 3개, 1이 1개 → 크리티컬(차이 2) → 4다이스 추가 / 『크리티컬 업』이면 차이 1에서도 크리티컬
  - 일반 행위 판정 [1,1] → 절대 실패 + FP +2
  - [6,6] + 수정 0, 목표값 20 → 절대 성공
  - FP 2로 주사위 추가 → 4D6 중 2개 선택, FP 획득 없음 / 재굴림 후에도 4D6 유지
  - 「주행동」 발동 2D6 [1,1] → 발동 실패
  - 다회 공격에서 1이 여러 번 나와도 FP는 주행동당 1
  - 회복 롤: 속성 공격 5 + 보정 3 → 8D6 중 4 이상 개수
  - 무속성 공격은 내성 0, 복합 속성은 최저 내성
  - 미식별 에너미의 내성 1 → 3으로 취급
  - \[수면\] 대상에게 공격 → 처리 후 해제, 처리 중에는 〈참〉 내성 −1 적용
  - 『방어 상승: 2』와 『방어 저하: 1』 → 둘 다 소멸
  - 강화 4종류째 → 07의 처리대로
  - 종료 페이즈: 지연 공격 → 독 → 종료 효과 → 자연 회복 → 지속 감소 → 심도 감소 순서
  - 반격에 대한 반격 없음, 추격에 대한 반격 있음, 추격의 추격 없음
  - 도주: 동점이면 실패, \[다리\] 봉인 캐릭터는 판정 불참
  - 【속도】가 음수가 되면 0
  - 레벨업 표, 경험점이 10의 배수를 넘을 때마다 능력치 +1
- Foundry 연동 부분은 `tests/manual-checklist.md`에 수동 확인 절차를 적고 단계마다 갱신한다.

## 진행 체크
- [x] 0  - [x] 1  - [x] 2  - [x] 3  - [x] 4  - [x] 5  - [x] 6  - [x] 7  - [ ] 8  - [ ] 9  - [ ] 10

## 인계 메모 (세션이 바뀌면 먼저 읽는다)
- **현재**: main = v0.13.9. 8-F 2차 완료: 효과 `repeat`·`rallyChase`, trigger on `bindInflicted`, when `selfWeapon`·`singleTarget`·`skillKey`, 대기 상태 능동 회피(《몽상검》, reaction.mjs `stance:` 선택지), 스킬 카드에 `itemId`·`variant`·`skillKey`·`main`. 07 #87~92 임시. 8-F 1차 완료: `src/combat/events.mjs`(enemyKO·damaged·hpLost·beforeKO·conditionGained·buffGained·endPhase·openingPhase·battleWon, 선택형은 `followups` 카드의 type `event`), 도주 선언 창(tracker.mjs `escapeDeclarations`). 07 #82~86 임시. 8-E 완료: `src/engine/tokens.mjs`·`src/combat/tokens.mjs`(배치자 전투원 플래그 `tokens`, 차례가 배치자 자리를 지날 때 `runTokensFor`, 종료 페이즈 `tickAllTokens`, 《부정형 생물》은 guard.mjs의 `tokenStances`, 효과 `tokenRemove`). 07 #77~81 임시. 8-D 완료: `src/combat/late.mjs`(후발 행동 예약 `late`·지연 공격 `delayed` 예약 → `NssqCombat.endMain()`에서 【속도】 순 실행, 종료 페이즈 지연 `runDelayedEnd`, 메인 페이즈 개시 선언 `mainStartDeclarations` → 플래그 `acted`, 효과 `extraAction` → 플래그 `extraAction`). 07 #73~76 확정. 남은 후발 계열 partial(《끝없는 원무곡》·《리벤지 스마이트》·《공방일체》·《딜레이 스탭》·《에테르 압축》·《다원 발도》)은 8-F. 8-C 완료: `src/engine/guards.mjs`(`planGuards`: 도발 → 《캐슬링》 → 반사 → 대신 받기 → 반감·【방어】·【내성】) → `src/combat/guard.mjs`(`guardAttack` → 대상 교체·`apply(profile)`·`commit(명중 id)`), 통상 공격·스킬 공격 모두 공격 롤 전에. 도발류·《캐슬링》은 `stance` `wait: false`(07 #69~72 확정). 단계 8 진행 중(계획: 8-A 기반 → 8-B 추격·반격 → 8-C 가드 → 8-D 지연·후발 → 8-E 토큰 → 8-F 기타 트리거, 체크리스트 36~). 8-B 완료: `src/combat/chase.mjs`(활성 GM이 공격·스킬 카드마다 `attackEvent` → `findReactions`·`findHitTriggers` → 자동 실행 또는 원래 카드 플래그 `followups`의 버튼). 추격·반격 카드는 스킬 카드 `followup.type`으로 연쇄 금지 판단, 「선언」 대미지 다이스 +n은 `extendDamage`(07 #62~68 확정). 남은 단계 8 표시 partial(《더블 액션》·《퍼니시 모어》·《와이드 이펙트》·《일제 사격》 등)은 8-F. 8-A 완료: `src/engine/triggers.mjs`(연쇄 규칙·후보), 대기 상태는 전투원 플래그 `stances`, 선언형 스킬 `optional`과 시트 「자동」 토글(액터 플래그 `autoTrigger`, 키는 `autoKey(스킬 key)`, 『추격』 강화는 `chaseBuff`). 사용자 결정: 선택형(「사용을 선언한다」·『추격』 강화)은 버튼, 의무는 자동, 토글 켜면 자동, 에너미는 항상 자동. **단계 7 완료**(효과 데이터 todo 0: ok 813 · partial 155 · none 20, `node tools/effects-check.mjs` → build/effects-report.md). 다음은 단계 8(트리거계). partial 155 중 단계 8 대상(후발 행동 15·대기/반격/추격/토큰/트리거 38)과 단계 9 대상(채집·드롭·캠프·세션 26)은 그 단계에서 데이터를 읽게 연결하면 된다(데이터는 이미 들어 있음). 나머지 76은 「그 턴 동안」 범위·규칙 변경 16, 전투 밖 연출·GM 판단 60. 작성 도우미 `node tools/dev/set-effects.mjs <spec.mjs>`(`--fill-same`), 검사기 `node tools/effects-check.mjs`. 클래스별 릴리스 기록은 체크리스트 29~35.
- **단계 9에 연결할 효과 데이터**: modifier `checks.<판정>`(커먼 《괴물 지식》 식별 +2 등, 장식 「지식의 서」)·`gather.*`·`campHeal`, flag `campCook*`는 데이터만 있고 아직 읽는 곳이 없다(판정 대화창·식별·채집·캠프 도구에서 읽게 할 것).
- **자동 실행 훅 규칙**: 모든 클라이언트에서 도는 훅(deleteCombat·createCombatant 등)에서 문서를 고칠 때는 `game.user.isGM`이 아니라 `game.users.activeGM?.id === game.user.id`(또는 `isActiveGM()`)로 거른다. 단계 6 완료 후 사용자 테스트 피드백을 반영하는 중. 다음은 단계 7(클래스별 효과 데이터, 클래스 하나에 커밋 하나).
- **사용자 확인 끝**: 체크리스트 0~24번은 v0.10.7까지 사용자가 확인함(22번의 「다회 공격 회차 표시」는 28번으로 바뀜). 25번은 Claude가 테스트 월드에서 확인(v0.10.8) → 버그 4건을 v0.10.9에서 고침. 26·27번은 서버를 v0.10.10으로 올린 뒤 Claude가 테스트 월드에서 확인함(모두 통과).
- **미결 결정**
  - 없음. (다회 공격 표시는 (가)로 결정·구현, 07 #56·#57은 확정)
- **작업 방식(사용자 선호)**
  - 사용자는 오라클 클라우드 Foundry에서 GitHub Releases로 업데이트해 테스트하고, 「v0.x.y로 버그 리포트」처럼 버전을 밝혀 보고한다. 그 버전 기준으로 판단한다.
  - 릴리스는 태그 push가 막혀 있으므로 버전 커밋을 main에 push한 뒤 매번 https://github.com/Nomal-1/nssq-fvtt/actions/workflows/release.yml 의 [Run workflow] 링크를 준다.
  - 고칠 때마다 `tests/manual-checklist.md`의 「지금 확인할 것」에 번호 붙은 절을 추가하고 머리말 버전을 올린다.
  - 룰이 원문에 없으면 임시 처리 + 07에 「사용자 확인 필요」로 적고 보고한다.
  - 스킬 판단을 물을 때는 **스킬명과 직업(클래스)을 함께** 적는다(예: 무사 《일의전심》). 07에 적을 때도 같다.
- **Foundry 실제 확인**: 클라우드 환경 변수 `NSSQ_FOUNDRY_URL`·`NSSQ_FOUNDRY_USER`·`NSSQ_FOUNDRY_PASSWORD`·`NSSQ_FOUNDRY_PLAYER`·`NSSQ_FOUNDRY_PLAYER_PASSWORD`로 오라클 서버의 테스트 전용 월드(`nssq-test`)에 Playwright(Chromium, `/opt/pw-browsers`)로 접속할 수 있다. 비밀번호는 출력·커밋 금지. 실제 플레이 월드는 건드리지 않는다. 서버에 깔린 시스템 버전을 먼저 확인한다.
  - 도구: `node tools/dev/foundry-e2e.mjs info|eval|shot [gm|player]`, 스크립트에서는 `connect(role, { user })`. 클라우드 Chromium은 ws://가 막혀 socket.io를 Node WebSocket으로 중계한다(도구 안에 들어 있음). 월드 id는 `nssqtest`.
  - 테스트용 액터는 `[e2e]` 접두사로 만들고 끝나면 지운다. 사용자가 관전하는 계정: `GM관전`(보조 GM)·`PL관전`(플레이어), 비밀번호 없음. 관전 계정으로는 접속하지 않는다(겹치면 사용자가 못 들어온다). GM관전이 접속해 있으면 GM 클라이언트가 둘이라는 점을 감안한다.
  - **서버의 시스템 업데이트도 Claude가 한다**: `node tools/dev/foundry-e2e.mjs update [월드id=nssqtest] [--backup]` (환경 변수 `NSSQ_FOUNDRY_ADMIN_PASSWORD`, 출력·커밋 금지). 릴리스할 때마다 이걸로 올리고 체크리스트를 이어서 확인한다.
    - 흐름: `/api/status`로 켜진 월드 확인 → 접속 화면 「셋업으로 돌아가기」(관리자 비밀번호)로 종료(접속자가 있으면 「연결이 끊긴다」 확인 창 → [예]) → 셋업 화면에서 `Setup.checkPackage`·`Setup.installPackage`로 nssq 업데이트(이미 최신이면 건너뜀) → 월드 [실행] → 「월드 데이터 마이그레이션」 확인 창(시스템 버전이 바뀌면 뜸)을 [마이그레이션 시작]으로(백업은 `--backup`일 때만) → GM 접속으로 `game.system.version` 확인.
    - 켜진 월드가 `nssqtest`가 아니면(실제 플레이 월드 등) **끄지 않고 멈춘다** → 사용자에게 알린다. 업데이트 중에는 접속자가 모두 튕긴다(관전 계정 포함). 시스템은 서버 전체 공용이라 같은 서버의 다른 월드도 같은 버전이 된다.
    - 업데이트 뒤 첫 GM 접속의 자동 효과 동기화(`effectsSyncedVersion`, 에너미 스킬 아이콘 고치기 포함)는 몇 초 걸린다. `eval`처럼 바로 끊는 접속만 하면 끝나기 전에 닫혀 일부만 바뀐다 → 업데이트 뒤 한 번은 `game.settings.get("nssq","effectsSyncedVersion") === game.system.version`이 될 때까지 기다린다.
  - 플레이어 권한이 아니라 GM 둘이 필요한 확인(27번 등): 관전 계정 대신 `ClaudePlayer`를 잠시 보조 GM(`role` 3)으로 바꿔 접속하고 끝나면 PLAYER(1)로 되돌린다.
  - 업데이트 전에 고친 코드를 확인하려면: 고친 파일을 읽어 상대 import를 `${location.origin}/systems/nssq/src/…` 절대 URL로 바꿔 blob 모듈로 `import()`하고, 그 함수를 직접 부르거나 문서 클래스 메서드·훅을 바꿔 끼운다(서버 버전과 섞이지 않게 테스트 뒤 새로고침).
