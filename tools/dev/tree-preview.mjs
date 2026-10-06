// 스킬 트리 창 미리보기(Foundry 없이): node build/tree-preview.mjs <클래스 파일> [가진 스킬=SL,...]
import fs from "node:fs";
import Handlebars from "handlebars";

const cls = process.argv[2] ?? "ダークハンター";
const ownedArg = Object.fromEntries((process.argv[3] ?? "").split(",").filter(Boolean).map((p) => p.split("=")).map(([n, v]) => [n, Number(v)]));
fs.mkdirSync("build", { recursive: true });
const ko = JSON.parse(fs.readFileSync("lang/ko.json", "utf8"));
const loc = (k) => k.split(".").reduce((o, x) => o?.[x], ko) ?? k;
globalThis.Application = class { static get defaultOptions() { return {}; } };
globalThis.foundry = { utils: { mergeObject: (a, b) => ({ ...a, ...b }) } };
const skills = JSON.parse(fs.readFileSync(`data/skills/${cls}.json`, "utf8")).map((s, i) => ({ ...s, _id: s.id ?? `s${i}`, sort: i, type: "skill" }));
globalThis.game = {
  i18n: { localize: loc, format: (k, d) => loc(k).replace(/\{(\w+)\}/g, (_, x) => d[x]) },
  packs: { get: () => ({ getIndex: async () => skills }) },
  user: { isGM: false }
};
const { SkillTree } = await import("../../src/apps/skill-tree.mjs");
const owned = skills.filter((s) => ownedArg[s.name]).map((s) => ({ name: s.name, system: { ...s.system, sl: ownedArg[s.name] } }));
const app = new SkillTree({ id: "a", isOwner: true, system: {} });
app.state = () => ({
  tabs: [{ key: "main", classKey: cls, label: cls }], tab: { key: "main", classKey: cls }, main: { system: { key: cls } }, sub: null,
  owned, slOf: (n) => ownedArg[n] ?? 0, budget: { total: 5, spent: 0, left: 5 }, level: 1
});
const data = await app.getData();
Handlebars.registerHelper("localize", (k) => loc(k));
Handlebars.registerHelper("nssqGt", (a, b) => a > b);
const body = Handlebars.compile(fs.readFileSync("templates/apps/skill-tree.hbs", "utf8"))(data);
const css = fs.readFileSync("styles/nssq.css", "utf8");
fs.writeFileSync("build/tree-preview.html", `<!doctype html><meta charset="utf-8"><style>${css} body{background:#0b1626;color:#dfe8f2;font-family:sans-serif;margin:0} a{text-decoration:none}</style>
<div class="nssq nq-window nssq-skill-tree" style="width:900px;height:760px"><div class="window-content" style="height:100%">${body}</div></div>`);
console.log("build/tree-preview.html");
