# NSSQ — SRS가 아닌 세계수의 미궁 TRPG (Foundry VTT 시스템)

팬메이드 TRPG 「SRSじゃない世界樹の迷宮TRPG」(NSSQ, 제작 ◆SQ.iJMf4FY) 한국어판을 Foundry VTT **v12**에서 플레이하기 위한 비공식 게임 시스템입니다.

> 개발 중(단계 0: 뼈대). 현재는 캐릭터·에너미·토큰 액터와 각 아이템을 만들고 편집하는 기능만 있습니다.

## 설치

Foundry VTT **v12** → 게임 시스템 → 시스템 설치 → 아래 매니페스트 URL을 붙여 넣기:

```
https://github.com/Nomal-1/nssq-fvtt/releases/latest/download/system.json
```

v13에서는 동작하지 않습니다.

## 개발

```bash
npm install
npm test            # 규칙 엔진 단위 테스트
cp .env.example .env  # FOUNDRY_DATA 지정
npm run link        # Foundry Data/systems/nssq 로 링크
```

릴리스: `system.json`의 `version`을 올리고 커밋한 뒤 `git tag v0.x.y && git push --tags`. GitHub Actions가 `nssq.zip`과 `system.json`을 릴리스에 올립니다.

## 고지

- 원작: 「SRSじゃない世界樹の迷宮TRPG」 <https://yggdrasystem.sakura.ne.jp/nssq/>
- 『세계수의 미궁』은 ATLUS/SEGA의 상표·저작물입니다. 이 프로젝트는 비공식 팬 작업이며 원작자·ATLUS·SEGA와 관계가 없습니다.
- 권리자의 요청이 있으면 즉시 내리겠습니다.
