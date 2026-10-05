// 릴리스용 dist/nssq.zip 과 dist/system.json 을 만든다. 버전은 system.json 기준.
// 사용: node tools/package.mjs [버전]  (버전을 주면 system.json의 version·download를 갱신)
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "Nomal-1/nssq-fvtt";
// 런타임에 필요한 것만. data/raw(원문)·docs·tools·tests는 넣지 않는다
const INCLUDE = ["system.json", "src", "lang", "templates", "styles", "packs", "assets", "data", "LICENSE", "README.md"];
const EXCLUDE = [/^data[\\/]raw([\\/]|$)/, /^packs[\\/]\.gitkeep$/, /[\\/]LOCK$/];

const manifestPath = path.join(root, "system.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const version = (process.argv[2] ?? manifest.version).replace(/^v/, "");
manifest.version = version;
manifest.manifest = `https://github.com/${REPO}/releases/latest/download/system.json`;
manifest.download = `https://github.com/${REPO}/releases/download/v${version}/nssq.zip`;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

const dist = path.join(root, "dist");
const stage = path.join(dist, "nssq");
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
for (const f of INCLUDE) {
  const src = path.join(root, f);
  if (!fs.existsSync(src)) continue;
  fs.cpSync(src, path.join(stage, f), {
    recursive: true,
    filter: (p) => !EXCLUDE.some((re) => re.test(path.relative(root, p)))
  });
}

const zip = path.join(dist, "nssq.zip");
if (process.platform === "win32") {
  execFileSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${stage}\\*' -DestinationPath '${zip}'`], { stdio: "inherit" });
} else {
  execFileSync("zip", ["-r", "-q", zip, "."], { cwd: stage, stdio: "inherit" });
}
fs.copyFileSync(manifestPath, path.join(dist, "system.json"));
console.log(`dist/nssq.zip, dist/system.json (v${version})`);
