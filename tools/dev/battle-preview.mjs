// 전투 화면 미리보기(Foundry 없이): node build/battle-preview.mjs → build/battle-preview.html
import fs from "node:fs";

fs.mkdirSync("build", { recursive: true });
const ko = JSON.parse(fs.readFileSync("lang/ko.json", "utf8"));
const loc = (k) => k.split(".").reduce((o, x) => o?.[x], ko) ?? k;
globalThis.foundry = { utils: { debounce: (f) => f, mergeObject: (a, b) => ({ ...a, ...b }), hasProperty: () => false } };
globalThis.Math.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
globalThis.Hooks = { on() {}, once() {} };
globalThis.CONFIG = {};
globalThis.Application = class { static get defaultOptions() { return {}; } };
globalThis.FormApplication = globalThis.Application;
globalThis.Dialog = globalThis.Application;
const art = JSON.parse(fs.readFileSync("src/generated/enemy-art.mjs", "utf8").replace(/^\/\/.*\n/, "").replace(/^export default /, "").replace(/;\s*$/, ""));
globalThis.game = {
  i18n: { localize: loc, format: (k, d) => loc(k).replace(/\{(\w+)\}/g, (_, x) => d[x]) },
  user: { isGM: process.argv[2] === "gm" },
  settings: { get: () => ({}) },
  scenes: { get: () => ({ background: { src: "https://images.unsplash.com/photo-1448375240586-882707db888b?w=1600" } }) }
};
const sampleSkills = [{ type: "skill", name: "갉아먹기", system: { timing: "주행동", range: "근", target: "적 단일", description: "<p>물리 공격 롤. 명중하면 [독].</p>" } }, { type: "skill", name: "약점: 혼란", system: { timing: "상시", range: "-", target: "자신", description: "" } }];
const mk = (id, name, type, sys, extra = {}) => {
  const actor = { id, name, type, items: { contents: type === "enemy" ? sampleSkills : [] }, img: extra.img ?? "../assets/enemies/" + (art[name] ?? "").split("/").pop(), isOwner: extra.owner ?? false, system: { row: "front", hp: { value: 10, max: 14 }, tp: { value: 5, max: 7 }, level: 1, sub: {}, stats: {}, equipment: { weapon: { range: "근" } }, ...sys } };
  return { id, name, actor, img: actor.img, defeated: false, initiative: 10 + id.length + Math.random() * 5, token: { texture: { src: actor.img } }, getFlag: (s, k) => (k === "guarding" ? extra.guard : null) };
};
const portrait = "https://api.dicebear.com/7.x/adventurer/svg?seed=";
const turns = [
  mk("p1", "플레이어2", "character", { classItems: { main: { name: "다크 헌터" } }, conditions: [{ id: "blind", depth: 10 }], buffs: [{ id: "physAtkUp", value: 2, turns: 2 }, { id: "resistGrant", param: "fire", turns: 3 }] }, { img: "https://api.dicebear.com/7.x/personas/svg?seed=hero&body=squared", owner: true }),
  mk("e1", "숲쥐", "enemy", { identified: true, level: 1, hp: { value: 6, max: 9 }, order: 0,
    stats: { physHit: 4, elemHit: 0, evasion: 7, physAtk: 11, elemAtk: 0, defense: 4, suppAtk: 3, suppDef: 3, speed: 12 },
    combatStats: { physHit: 4, elemHit: 0, evasion: 0, physAtk: 11, elemAtk: 0, defense: 2, suppAtk: 3, suppDef: 3, speed: 12 },
    resist: { slash: 3, strike: 3, pierce: 3, fire: 2, ice: 3, volt: 3 }, resistTotal: { slash: 3, strike: 3, pierce: 3, fire: 2, ice: 3, volt: 3 },
    drops: [{ min: 5, max: 9, item: "가죽", rank: 1 }, { min: 10, max: null, item: "이빨", rank: 1 }], conditions: [{ id: "poison", depth: 12 }, { id: "bindLeg", depth: 9 }], buffs: [{ id: "defenseDown", value: 2, turns: 3 }] }),
  mk("e2", "숲쥐", "enemy", { identified: false, hp: { value: 9, max: 9 }, order: 1 }),
  mk("n1", "동료2", "character", { npc: true, classItems: { main: { name: "몽크" } }, conditions: [{ id: "sleep", depth: 9 }] }, { img: portrait + "b", guard: true }),
  mk("e3", "광란의 뿔사슴", "enemy", { row: "back", identified: true, isRare: true, hp: { value: 20, max: 30 }, order: 2 }),
  mk("p2", "캐릭터", "character", { row: "back", classItems: { main: { name: "메딕" } } }, { img: portrait + "c" })
];
turns[1].name = "숲쥐 A";
turns[2].name = "숲쥐 B";
const combat = {
  round: 1, turn: 0, turns, combatant: turns[0],
  combatants: Object.assign(turns, { get: (id) => turns.find((t) => t.id === id) }),
  getFlag: (s, k) => ({ phase: process.argv[3] ?? "main", battle: { copy: "x" } })[k] ?? null
};
const { battleHtml } = await import("../../src/combat/hud.mjs");
const css = fs.readFileSync("styles/nssq.css", "utf8");
const html = battleHtml(combat, { attack: process.argv[4] === "attack" });
// 「상태 자세히」 창 견본(node … gm main pop)
const { enemyAnalysisHtml } = await import("../../src/combat/analysis.mjs");
const who = turns[process.argv[5] === "unknown" ? 2 : 1];
const pop = process.argv[4] === "pop" ? `<div id="nssq-status-pop" class="analysis" style="left:760px;top:300px">${enemyAnalysisHtml(who.actor, who.name)}</div>` : "";
fs.writeFileSync("build/battle-preview.html", `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"><style>${css}
body{margin:0;background:#556;font-family:sans-serif} #sidebar-mock{position:fixed;right:0;top:0;bottom:0;width:300px;background:#222;color:#ccc;padding:8px}</style>
<div id="sidebar-mock">sidebar</div><div id="nssq-battle">${html}</div>${pop}`);
console.log("build/battle-preview.html");
