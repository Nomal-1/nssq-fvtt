import fs from "fs";
import { treeLayout } from "../../src/engine/skills.mjs";
const p = JSON.parse(fs.readFileSync("data/skills/" + process.argv[2] + ".json"));
const t = treeLayout(p.map((s) => ({ name: s.name, prereqs: s.system.prereqs })));
for (const n of [...t.nodes].sort((a, b) => a.col - b.col || a.row - b.row)) console.log(n.col, n.row, n.kind === "or" ? "<또는 " + n.alts.map((a) => a.skill).join("/") + ">" : n.name);
console.log("edges", t.edges.length, "indep", t.independent.join(","));
