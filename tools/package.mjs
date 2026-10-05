// 릴리스용 dist/nssq.zip 과 dist/system.json 을 만든다. 버전은 system.json 기준.
// 사용: node tools/package.mjs [버전]  (버전을 주면 system.json의 version·download를 갱신)
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "Nomal-1/nssq-fvtt";
const INCLUDE = ["system.json", "src", "lang", "templates", "styles", "packs", "assets", "LICENSE", "README.md"];

const manifestPath = path.join(root, "system.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const version = (process.argv[2] ?? manifest.version).replace(/^v/, "");
manifest.version = version;
manifest.manifest = `https://github.com/${REPO}/releases/latest/download/system.json`;
manifest.download = `https://github.com/${REPO}/releases/download/v${version}/nssq.zip`;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

const dist = path.join(root, "dist");
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist);
const files = INCLUDE.filter((f) => fs.existsSync(path.join(root, f)));
const zip = path.join(dist, "nssq.zip");
if (process.platform === "win32") {
  const list = files.map((f) => `'${path.join(root, f)}'`).join(",");
  execFileSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path ${list} -DestinationPath '${zip}'`], { stdio: "inherit" });
} else {
  execFileSync("zip", ["-r", "-q", zip, ...files, "-x", "packs/.gitkeep"], { cwd: root, stdio: "inherit" });
}
fs.copyFileSync(manifestPath, path.join(dist, "system.json"));
console.log(`dist/nssq.zip, dist/system.json (v${version})`);
