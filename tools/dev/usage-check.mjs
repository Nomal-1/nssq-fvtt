import fs from "fs";
import { skillUsage, treeLayout } from "../../src/engine/skills.mjs";
let n = 0;
const ex = [];
for (const f of fs.readdirSync("data/skills")) {
  const a = JSON.parse(fs.readFileSync("data/skills/" + f));
  for (const s of a) { n++; if (skillUsage(s.system) === "explore") ex.push(`${f.replace(".json","")}:${s.name}`); }
}
console.log(n, ex.length); console.log(ex.join(" | "));
const p = JSON.parse(fs.readFileSync("data/skills/プリンスプリンセス.json"));
const t = treeLayout(p.map((s) => ({ name: s.name, prereqs: s.system.prereqs })));
console.log(JSON.stringify(t.nodes), t.independent, t.cols, t.rows, t.outside);
