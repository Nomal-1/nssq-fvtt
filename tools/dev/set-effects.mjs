// 효과 데이터 작성 도우미(단계 7): 스킬 이름별 effects를 data/skills/<파일>.json에 넣는다.
// 사용: node tools/dev/set-effects.mjs <spec.mjs|spec.json>
//      node tools/dev/set-effects.mjs --fill-same   이름·해설이 같은 다른 클래스 스킬의 effects를 todo 스킬에 복사
//   spec: { file: "ソードマン.json", skills: { "스킬명": { effects: [...], review?: "ok", note?: "남은 처리" } } }
//   note가 있으면 review 기본값은 partial. 이름이 없거나 겹치면 오류로 멈춘다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = process.argv[2];
if (!arg) { console.error("spec 파일을 주세요"); process.exit(1); }
if (arg === "--fill-same") {
  const dir = path.join(ROOT, "data/skills");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const data = Object.fromEntries(files.map((f) => [f, JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))]));
  const done = new Map();
  for (const list of Object.values(data)) for (const s of list) {
    if (s.system.review && s.system.review !== "todo") done.set(`${s.name}\u0000${s.system.description}`, s.system);
  }
  for (const [f, list] of Object.entries(data)) {
    const filled = [];
    for (const s of list) {
      const src = s.system.review === "todo" && done.get(`${s.name}\u0000${s.system.description}`);
      if (!src) continue;
      s.system.effects = structuredClone(src.effects);
      s.system.review = src.review;
      if (src.effectsNote) s.system.effectsNote = src.effectsNote;
      filled.push(s.name);
    }
    if (filled.length) {
      fs.writeFileSync(path.join(dir, f), JSON.stringify(list, null, 1) + "\n");
      console.log(`${f}: ${filled.join(", ")}`);
    }
  }
  process.exit(0);
}
const spec = arg.endsWith(".json") ? JSON.parse(fs.readFileSync(arg, "utf8")) : (await import(pathToFileURL(path.resolve(arg)).href)).default;
const file = path.join(ROOT, spec.dir ?? "data/skills", spec.file);
const list = JSON.parse(fs.readFileSync(file, "utf8"));
const holders = spec.dir === "data/enemies"
  ? list.flatMap((a) => (a.items ?? []).map((it) => ({ name: `${a.name}/${it.name}`, sys: it.system })))
  : list.map((s) => ({ name: s.name, sys: s.system ?? s }));
let n = 0;
for (const [name, v] of Object.entries(spec.skills)) {
  const hit = holders.filter((h) => h.name === name);
  if (hit.length !== 1) { console.error(`이름 ${name}: ${hit.length}개`); process.exit(1); }
  const sys = hit[0].sys;
  sys.effects = v.effects;
  sys.review = v.review ?? (v.note ? "partial" : "ok");
  if (v.note) sys.effectsNote = v.note;
  else delete sys.effectsNote;
  n++;
}
fs.writeFileSync(file, JSON.stringify(list, null, 1) + "\n");
console.log(`${spec.file}: ${n}개`);
