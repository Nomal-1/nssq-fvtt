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
  game.settings.register("nssq", "fpStart", {
    name: "NSSQ.Settings.fpStart.name",
    hint: "NSSQ.Settings.fpStart.hint",
    scope: "world",
    config: true,
    type: Number,
    default: 1
  });
}
