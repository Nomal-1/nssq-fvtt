# 개발용 도구 (배포에 들어가지 않음)

저장소 루트에서 실행한다. 결과 HTML은 `build/`(gitignore)에 생긴다.

| 파일 | 하는 일 |
| --- | --- |
| `node tools/dev/hbs-check.mjs "$PWD"` | 모든 Handlebars 템플릿을 가짜 데이터로 렌더해 문법 오류 확인 |
| `node tools/dev/battle-preview.mjs [gm\|player] [opening\|main] [attack]` | 전투 화면을 Foundry 없이 `build/battle-preview.html`로 |
| `node tools/dev/tree-preview.mjs <클래스 파일> "스킬=SL,..."` | 스킬 트리 창을 `build/tree-preview.html`로 |
| `node tools/dev/tree-dump.mjs <클래스 파일>` | 스킬 트리 배치를 글로 |
| `node tools/dev/usage-check.mjs` | 전투/비전투 자동 분류 결과 |
| `tools/dev/morph-test.html`, `bust-test.html` | 브라우저에서 여는 전투 화면 갱신(morph·FLIP) 확인 페이지. 저장소 루트를 웹 서버로 띄우고(`python -m http.server`) `/tools/dev/…html`로 연다 |

에너미 일러스트를 다시 만드는 `tools/enemy-art.py`는 원본 스프라이트 폴더(로컬에만 있음)가 필요하다.
