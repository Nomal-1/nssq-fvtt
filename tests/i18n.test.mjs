import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const ko = JSON.parse(fs.readFileSync(path.join(root, "lang/ko.json"), "utf8"));
const has = (key) => key.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), ko) !== undefined;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

describe("lang/ko.json", () => {
  const files = [...walk(path.join(root, "src")), ...walk(path.join(root, "templates"))];

  it("코드·템플릿이 쓰는 고정 키가 모두 있다", () => {
    const missing = [];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      for (const m of src.matchAll(/["'`](NSSQ(?:\.[A-Za-z0-9]+)+)["'`]/g)) if (!has(m[1])) missing.push(`${path.relative(root, f)}: ${m[1]}`);
      // 파일마다 L("key") 줄임: const L = … `NSSQ.<Group>.${k}`
      const group = src.match(/const L = [^\n]*`NSSQ\.([A-Za-z]+)\.\$\{k\}`/)?.[1];
      if (group && !f.endsWith("check-request.mjs")) {
        for (const m of src.matchAll(/\bL\("([A-Za-z]+)"/g)) if (!has(`NSSQ.${group}.${m[1]}`)) missing.push(`${path.relative(root, f)}: NSSQ.${group}.${m[1]}`);
      }
      // check-request.mjs의 L("key") 줄임
      if (f.endsWith("check-request.mjs")) {
        for (const m of src.matchAll(/\bL\("([A-Za-z]+)"/g)) if (!has(`NSSQ.Request.${m[1]}`)) missing.push(`${path.relative(root, f)}: NSSQ.Request.${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("능력치·부능력치·내성·상태 라벨이 모두 있다", async () => {
    const { ABILITIES, SUB_STATS, RESISTS } = await import("../src/engine/derive.mjs");
    for (const k of ABILITIES) expect(has(`NSSQ.Ability.${k}`), k).toBe(true);
    for (const k of SUB_STATS) expect(has(`NSSQ.Sub.${k}`), k).toBe(true);
    // 시트 부능력치 칸·제련 배지가 쓰는 짧은 라벨
    for (const k of SUB_STATS) expect(has(`NSSQ.Inventory.${k}`), `Inventory.${k}`).toBe(true);
    for (const k of RESISTS) expect(has(`NSSQ.Resist.${k}`), k).toBe(true);
  });
});
