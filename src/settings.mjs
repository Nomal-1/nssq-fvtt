import { onShopHiddenChange, onShopToggle } from "./apps/shop.mjs";
import { setDayHours } from "./engine/dungeon.mjs";

export function registerSettings() {
  // 에너미 일러스트를 월드 액터·토큰에 적용한 표시(그림 표 크기:버전)
  // 플레이어 공격의 명중·대미지 굴리기 팝업(combat/dice-flow.mjs)
  game.settings.register("nssq", "rollPopup", { name: "NSSQ.Settings.rollPopup", hint: "NSSQ.Settings.rollPopupHint", scope: "client", config: true, type: Boolean, default: true });
  // 전투 화면의 스킬·속성 이펙트(사람마다)
  game.settings.register("nssq", "battleFx", { name: "NSSQ.Settings.battleFx", hint: "NSSQ.Settings.battleFxHint", scope: "client", config: true, type: Boolean, default: true });
  game.settings.register("nssq", "enemyArtApplied", { scope: "world", config: false, type: String, default: "" });
  game.settings.register("nssq", "autoApply", {
    name: "NSSQ.Settings.autoApply.name",
    hint: "NSSQ.Settings.autoApply.hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      off: "NSSQ.Settings.autoApply.off",
      confirm: "NSSQ.Settings.autoApply.confirm",
      auto: "NSSQ.Settings.autoApply.auto"
    },
    default: "confirm"
  });
  // 시간대(낮/밤): 《야행성》·《주행성》 등. 단계 9-D 던전 도구에서도 바꾼다
  game.settings.register("nssq", "timeOfDay", {
    name: "NSSQ.Settings.timeOfDay.name",
    hint: "NSSQ.Settings.timeOfDay.hint",
    scope: "world",
    config: true,
    type: String,
    choices: { none: "NSSQ.Settings.timeOfDay.none", day: "NSSQ.Settings.timeOfDay.day", night: "NSSQ.Settings.timeOfDay.night" },
    default: "none"
  });
  // 낮·밤이 시작하는 시각(사용자 요청). 바꾸면 진행 중인 던전의 시간대도 다시 계산
  for (const [key, def] of [["dayStart", 6], ["nightStart", 18]]) {
    game.settings.register("nssq", key, {
      name: `NSSQ.Settings.${key}.name`, hint: `NSSQ.Settings.${key}.hint`,
      scope: "world", config: true, type: Number, range: { min: 0, max: 23, step: 1 }, default: def,
      onChange: (v) => {
        // 엔진에는 바로(비동기 import를 기다리면 그사이 판정이 옛 시각을 쓴다), 시간대 설정 갱신은 그다음
        const day = key === "dayStart" ? v : game.settings.get("nssq", "dayStart");
        const night = key === "nightStart" ? v : game.settings.get("nssq", "nightStart");
        setDayHours(day, night);
        import("./apps/time-pass.mjs").then((m) => m.refreshTimeOfDay()).catch((e) => console.warn("NSSQ | dayHours", e));
      }
    });
  }
  // 탐색 시간 경과(세그먼트·랜덤 던전 1시간·캠프)마다 독·자연 회복·심도·오버히트를 처리하는가(사용자 요청으로 기본 끔, 01 #164)
  game.settings.register("nssq", "timeTicks", { name: "NSSQ.Settings.timeTicks.name", hint: "NSSQ.Settings.timeTicks.hint", scope: "world", config: true, type: Boolean, default: false });
  // 어둠 속 전투에서 에너미도 불이익을 받는가(01 #165)
  game.settings.register("nssq", "darkEnemies", {
    name: "NSSQ.Settings.darkEnemies.name",
    hint: "NSSQ.Settings.darkEnemies.hint",
    scope: "world",
    config: true,
    type: String,
    choices: { exceptNocturnal: "NSSQ.Settings.darkEnemies.exceptNocturnal", all: "NSSQ.Settings.darkEnemies.all", none: "NSSQ.Settings.darkEnemies.none" },
    default: "exceptNocturnal"
  });
  // 던전에 들어간 뒤 누적 전투 턴(30이면 탐색 시각 +1시간 하고 0, 던전을 나가거나 야영하면 0)
  game.settings.register("nssq", "battleTurns", { scope: "world", config: false, type: Number, default: 0 });
  game.settings.register("nssq", "storage", {
    name: "NSSQ.Settings.storage.name",
    hint: "NSSQ.Settings.storage.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => Object.values(ui.windows).filter((w) => w.actor?.type === "character").forEach((w) => w.render(false))
  });
  // 상점 열림 여부(GM이 액터 탭·토큰 도구로 여닫음)와 추가 품목 폴더
  game.settings.register("nssq", "shopOpen", {
    scope: "world", config: false, type: Boolean, default: false,
    onChange: (v) => onShopToggle(v)
  });
  game.settings.register("nssq", "shopFolder", { scope: "world", config: false, type: String, default: "" });
  game.settings.register("nssq", "shopHidden", {
    scope: "world", config: false, type: Array, default: [],
    onChange: () => onShopHiddenChange()
  });
  game.settings.register("nssq", "fpStart", {
    name: "NSSQ.Settings.fpStart.name",
    hint: "NSSQ.Settings.fpStart.hint",
    scope: "world",
    config: true,
    type: Number,
    default: 1
  });
}
