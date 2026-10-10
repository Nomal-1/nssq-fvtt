import { onShopHiddenChange, onShopToggle } from "./apps/shop.mjs";

export function registerSettings() {
  // 에너미 일러스트를 월드 액터·토큰에 적용한 표시(그림 표 크기:버전)
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
  // 어둠 속 전투에서 에너미도 불이익을 받는가(07 #165)
  game.settings.register("nssq", "darkEnemies", {
    name: "NSSQ.Settings.darkEnemies.name",
    hint: "NSSQ.Settings.darkEnemies.hint",
    scope: "world",
    config: true,
    type: String,
    choices: { exceptNocturnal: "NSSQ.Settings.darkEnemies.exceptNocturnal", all: "NSSQ.Settings.darkEnemies.all", none: "NSSQ.Settings.darkEnemies.none" },
    default: "exceptNocturnal"
  });
  // 전투 중 흐른 시간(분, 원작: 전투 1턴 = 2분, 60분이면 탐색 시간 1시간)
  game.settings.register("nssq", "battleMinutes", { scope: "world", config: false, type: Number, default: 0 });
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
