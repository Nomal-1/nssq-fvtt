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
  game.settings.register("nssq", "fpStart", {
    name: "NSSQ.Settings.fpStart.name",
    hint: "NSSQ.Settings.fpStart.hint",
    scope: "world",
    config: true,
    type: Number,
    default: 1
  });
}
