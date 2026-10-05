import { onShopHiddenChange, onShopToggle } from "./apps/shop.mjs";

export function registerSettings() {
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
