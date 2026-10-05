// .env의 FOUNDRY_DATA/Data/systems/nssq 에 이 저장소를 링크한다 (Windows는 junction).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".env");
if (!fs.existsSync(envFile)) {
  console.error(".env가 없다. .env.example을 복사해 FOUNDRY_DATA를 적어라.");
  process.exit(1);
}
const env = Object.fromEntries(
  fs.readFileSync(envFile, "utf8").split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
if (!env.FOUNDRY_DATA) {
  console.error(".env에 FOUNDRY_DATA가 없다.");
  process.exit(1);
}
const systems = path.join(env.FOUNDRY_DATA, "Data", "systems");
const target = path.join(systems, "nssq");
fs.mkdirSync(systems, { recursive: true });
if (fs.existsSync(target)) {
  const stat = fs.lstatSync(target);
  if (!stat.isSymbolicLink()) {
    console.error(`${target}가 이미 있고 링크가 아니다. 직접 지운 뒤 다시 실행하라.`);
    process.exit(1);
  }
  fs.unlinkSync(target);
}
fs.symlinkSync(root, target, process.platform === "win32" ? "junction" : "dir");
console.log(`링크 완료: ${target} -> ${root}`);
