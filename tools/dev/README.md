# 개발용 도구 (배포에 들어가지 않음)

저장소 루트에서 실행한다. 결과 HTML은 `build/`(gitignore)에 생긴다.

| 파일 | 하는 일 |
| --- | --- |
| `node tools/dev/hbs-check.mjs "$PWD"` | 모든 Handlebars 템플릿을 가짜 데이터로 렌더해 문법 오류 확인 |
| `node tools/dev/battle-preview.mjs [gm\|player] [opening\|main] [attack]` | 전투 화면을 Foundry 없이 `build/battle-preview.html`로 |
| `node tools/dev/tree-preview.mjs <클래스 파일> "스킬=SL,..."` | 스킬 트리 창을 `build/tree-preview.html`로 |
| `node tools/dev/tree-dump.mjs <클래스 파일>` | 스킬 트리 배치를 글로 |
| `node tools/dev/foundry-e2e.mjs info\|eval\|shot [gm\|player] …` | 오라클 테스트 월드에 Playwright로 로그인해 정보·스크린샷·월드 안 JS 실행(`-e "return game.user.name"`)·콘솔 오류 수집. 다른 스크립트에서 `connect(role)`로 불러 써도 된다. 환경 변수는 CLAUDE.md |
| `node tools/dev/foundry-e2e.mjs update [월드id] [--backup]` | 관리자 비밀번호(`NSSQ_FOUNDRY_ADMIN_PASSWORD`)로 테스트 월드를 끄고 서버의 NSSQ 시스템을 최신 릴리스로 올린 뒤 다시 켠다. 켜진 월드가 다르면 끄지 않는다 |
| `node tools/dev/usage-check.mjs` | 전투/비전투 자동 분류 결과 |
| `tools/dev/morph-test.html`, `bust-test.html` | 브라우저에서 여는 전투 화면 갱신(morph·FLIP) 확인 페이지. 저장소 루트를 웹 서버로 띄우고(`python -m http.server`) `/tools/dev/…html`로 연다 |

에너미 일러스트를 다시 만드는 `tools/enemy-art.py`는 원본 스프라이트 폴더(로컬에만 있음)가 필요하다.
