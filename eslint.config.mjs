import js from "@eslint/js";
import globals from "globals";

const foundryGlobals = Object.fromEntries([
  "foundry", "game", "CONFIG", "Hooks", "Actor", "Item", "Actors", "Items", "ActorSheet", "ItemSheet",
  "Combat", "Combatant", "ActiveEffect", "ChatMessage", "Roll", "Dialog", "FormApplication",
  "TextEditor", "renderTemplate", "loadTemplates", "Handlebars", "ui", "$", "fromUuid", "fromUuidSync", "canvas", "Application", "Folder"
].map((k) => [k, "readonly"]));

export default [
  js.configs.recommended,
  {
    files: ["src/**/*.mjs"],
    languageOptions: { globals: { ...globals.browser, ...foundryGlobals } }
  },
  {
    // 엔진은 Foundry 비의존: Foundry 전역을 허용하지 않는다
    files: ["src/engine/**/*.mjs"],
    languageOptions: {
      globals: Object.fromEntries(Object.keys({ ...globals.browser, ...foundryGlobals }).map((k) => [k, "off"]))
    }
  },
  {
    files: ["tools/**/*.mjs", "tests/**/*.mjs", "*.mjs"],
    languageOptions: { globals: globals.node }
  }
];
