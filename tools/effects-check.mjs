// 효과 데이터 검사 + build/effects-report.md (단계 7)
// 사용: node tools/effects-check.mjs [묶음 이름…]   (묶음을 주면 그 묶음의 오류만 출력)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkAll, reportMarkdown } from "./lib/effects-check.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = checkAll();
fs.mkdirSync(path.join(ROOT, "build"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "build/effects-report.md"), reportMarkdown(result));

const only = process.argv.slice(2);
const errors = only.length ? result.errors.filter((e) => only.some((g) => e.startsWith(g))) : result.errors;
for (const [g, c] of result.counts) if (!only.length || only.includes(g)) console.log(`${g}: todo ${c.todo ?? 0}, auto ${c.auto ?? 0}, partial ${c.partial ?? 0}, ok ${c.ok ?? 0}`);
console.log(errors.length ? `오류 ${errors.length}건\n${errors.join("\n")}` : "오류 없음");
console.log("→ build/effects-report.md");
process.exit(errors.length ? 1 : 0);
