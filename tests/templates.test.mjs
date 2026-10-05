import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TEMPLATES } from "../src/templates.mjs";

const root = path.resolve(import.meta.dirname, "..");
const toFile = (p) => path.join(root, p.replace(/^systems\/nssq\//, ""));

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

describe("템플릿 등록", () => {
  const files = walk(path.join(root, "templates")).filter((f) => f.endsWith(".hbs"));

  it("TEMPLATES의 파일이 모두 존재한다", () => {
    for (const t of TEMPLATES) expect(fs.existsSync(toFile(t)), t).toBe(true);
  });

  it("모든 부분 템플릿이 TEMPLATES에 등록돼 있다", () => {
    for (const f of files) {
      for (const m of fs.readFileSync(f, "utf8").matchAll(/\{\{>\s*"([^"]+)"/g)) {
        expect(TEMPLATES, `${path.relative(root, f)} → ${m[1]}`).toContain(m[1]);
      }
    }
  });

  it("templates/의 .hbs가 모두 TEMPLATES에 있다", () => {
    for (const f of files) expect(TEMPLATES).toContain(`systems/nssq/${path.relative(root, f).replaceAll("\\", "/")}`);
  });
});
