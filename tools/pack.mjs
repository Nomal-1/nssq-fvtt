// data/*.json → packs/<name> (LevelDB 컴펜디움). system.json의 packs·packFolders도 갱신한다.
// 사용: node tools/pack.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compilePack } from "@foundryvtt/foundryvtt-cli";
import { makeId } from "./lib/util.mjs";
import ENEMY_ART from "../src/generated/enemy-art.mjs";
import { iconFor } from "./lib/icons.mjs";
import { mdToHtml, splitPages } from "./lib/md.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const SRC = path.join(ROOT, "build", "pack-src");
const PACKS = path.join(ROOT, "packs");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "system.json"), "utf8"));

const load = (rel) => JSON.parse(fs.readFileSync(path.join(DATA, rel), "utf8"));
const STATS = { coreVersion: "12.331", systemId: "nssq", systemVersion: manifest.version };

// 스키마 밖의 변환 보조 필드는 컴펜디움에 넣지 않는다 (런타임 표는 data/*.json에서 읽는다)
const STRIP = ["table", "effectText"];

function itemDoc(e, { folder = null, sort = 0 } = {}) {
  const system = { ...e.system };
  for (const k of STRIP) delete system[k];
  const _id = e._id ?? e.id;
  return {
    _id, _key: e._key ?? `!items!${_id}`,
    name: e.name, type: e.type, img: iconFor(e), system,
    effects: [], folder, sort, ownership: { default: 0 }, flags: {}, _stats: STATS
  };
}

function actorDoc(e, { folder = null, sort = 0 } = {}) {
  const _id = e.id;
  // 에너미 일러스트(tools/enemy-art.py). 토큰도 같은 그림
  const img = ENEMY_ART[e.name] ?? e.img;
  return {
    _id, _key: `!actors!${_id}`,
    name: e.name, type: e.type, img, system: e.system,
    items: e.items.map((i, n) => {
      const d = itemDoc(i, { sort: (n + 1) * 100 });
      delete d.folder;
      return d;
    }),
    effects: [], folder, sort, ownership: { default: 0 }, flags: {}, _stats: STATS,
    prototypeToken: {
      name: e.name, actorLink: false, disposition: -1, displayBars: 20, displayName: 20,
      bar1: { attribute: "hp" }, bar2: { attribute: null }, texture: { src: img }
    }
  };
}

function folderDoc(type, pack, name, sort) {
  const _id = makeId("Folder", pack, name);
  return { _id, _key: `!folders!${_id}`, name, type, folder: null, sorting: "m", sort, color: null, description: "", flags: {}, _stats: STATS };
}

/* ---------------- 저널(룰북·가이드) ---------------- */

const RAW = path.join(DATA, "raw");
const readText = (p) => fs.readFileSync(p, "utf8");
/** 원문 파일 이름의 첫 「# 제목」 */
const titleOf = (md, fallback) => md.match(/^#\s+(.+)$/m)?.[1].trim() ?? fallback;

/**
 * @param {string} pack
 * @param {string} name
 * @param {{name: string, html: string}[]} pages
 * @param {{ folder?: string|null, sort?: number, observer?: boolean }} [opts] observer: 월드로 가져왔을 때 모든 플레이어가 볼 수 있게
 */
function journalDoc(pack, name, pages, { folder = null, sort = 0, observer = true } = {}) {
  const _id = makeId("JournalEntry", pack, name);
  return {
    _id, _key: `!journal!${_id}`, name, folder, sort,
    ownership: { default: observer ? 2 : 0 }, flags: {}, _stats: STATS,
    pages: pages.map((pg, i) => {
      const pid = makeId("JournalEntryPage", `${pack}/${name}`, `${i}:${pg.name}`);
      return {
        _id: pid, _key: `!journal.pages!${_id}.${pid}`, name: pg.name || name, type: "text",
        title: { show: true, level: 1 }, text: { format: 1, content: pg.html },
        sort: (i + 1) * 100, ownership: { default: -1 }, flags: {}, _stats: STATS
      };
    })
  };
}

/** 원문 폴더의 파일들 → 페이지(파일 하나 = 한 페이지, 이름은 첫 제목) */
/** 클래스 페이지 머리의 데이터 블록(```json)을 읽는다 */
const ABIL = ["STR", "TEC", "VIT", "AGI", "LUC"];
function classData(md) {
  const m = md.match(/```json\s*\n([\s\S]*?)\n```/);
  try { return m ? JSON.parse(m[1]) : null; } catch { return null; }
}
const roles = (d) => (Array.isArray(d["역할"]) ? d["역할"].join("·") : d["역할"] ?? "");

/** 원문 페이지. 클래스의 데이터 블록은 표로 바꾼다(Notion 데이터베이스 속성) */
function rawPages(files) {
  return files.map((f) => {
    let md = readText(path.join(RAW, f));
    const d = classData(md);
    if (d) {
      const table = [`| 위치 | 역할 | ${ABIL.join(" | ")} | 무기 | 방어구 |`, `|${"---|".repeat(9)}`,
        `| ${d["위치"] ?? ""} | ${roles(d)} | ${ABIL.map((k) => d[k] ?? "").join(" | ")} | ${d["무기"] ?? ""} | ${d["방어구"] ?? ""} |`].join("\n");
      md = md.replace(/```json\s*\n[\s\S]*?\n```/, `${table}\n\n원문: ${d["원문"] ?? ""}`);
    }
    return { name: titleOf(md, path.basename(f, ".md")), html: mdToHtml(md, { dropTitle: true }) };
  });
}

/** 「클래스 일람」(원문은 Notion 데이터베이스라 내보내기에 없다): 클래스 페이지의 데이터로 표를 만든다 */
function classListPage(files) {
  const rows = files.map((f) => classData(readText(path.join(RAW, f)))).filter(Boolean).sort((a, b) => (a["번호"] ?? 0) - (b["번호"] ?? 0));
  const md = [`| 클래스 | 위치 | 역할 | ${ABIL.join(" | ")} | 무기 | 방어구 |`, `|${"---|".repeat(10)}`,
    ...rows.map((d) => `| ${d["클래스"]} | ${d["위치"] ?? ""} | ${roles(d)} | ${ABIL.map((k) => d[k] ?? "").join(" | ")} | ${d["무기"] ?? ""} | ${d["방어구"] ?? ""} |`)].join("\n");
  return { name: "클래스 일람", html: `<p>31개 클래스의 능력치 보정, 장비 가능 무기·방어구. 스킬은 각 클래스 페이지.</p>\n${mdToHtml(md)}` };
}
const rawDir = (dir, filter = () => true) => fs.readdirSync(path.join(RAW, dir)).filter((f) => f.endsWith(".md") && filter(f)).sort((a, b) => a.localeCompare(b, "ko")).map((f) => `${dir}/${f}`);

/** docs/manual.md → 「## 장」마다 한 페이지(목차는 뺀다) */
function manualPages() {
  const md = readText(path.join(ROOT, "docs", "manual.md"));
  const body = md.split(/\n## /).slice(1).map((s) => `## ${s}`).filter((s) => !s.startsWith("## 목차"));
  const intro = md.split(/\n## /)[0].replace(/^#\s+.*$/m, "").replace(/\n---\s*$/, "");
  const pages = [{ name: "이 가이드에 대해", html: mdToHtml(intro) }];
  for (const s of body) {
    const name = s.match(/^## (.+)$/m)[1].replace(/^\d+\.\s*/, "").trim();
    // 장 안의 ###은 페이지 안 제목(##)으로
    pages.push({ name, html: mdToHtml(s.replace(/^## .+$/m, "").replace(/\n---\s*$/, "").replace(/^### /gm, "## ")) });
  }
  return pages;
}

/** 드롭 아이템 일람(사용자 요청): 에너미 레벨별로 「눈 범위 · 받을 이름 · 종류 R」 표. 이름은 data/drop-names.json */
const MATERIAL_IDS = new Map(load("materials.json").map((m) => [m.name, m.id ?? m._id]));
function dropListPages() {
  return [["Lv1", "lv1"], ["Lv2", "lv2"], ["Lv3~4", "lv3-4"], ["F.O.E.", "foe"]].map(([label, file]) => {
    const rows = load(`enemies/${file}.json`).flatMap((e) => (e.system.drops ?? []).map((d, i) => {
      const range = d.max === null ? `${d.min}~` : d.min === d.max ? `${d.min}` : `${d.min}~${d.max}`;
      // 종류 칸은 컴펜디움 「아이템」의 그 소재로 링크
      const mat = MATERIAL_IDS.get(d.item);
      const kind = `${d.item}${d.rank ? ` R${d.rank}` : ""}`;
      return `| ${i ? "" : `**${e.name}**`} | ${range} | ${d.name || d.item} | ${mat ? `@UUID[Compendium.nssq.items.Item.${mat}]{${kind}}` : kind} |`;
    }));
    return { name: label, html: mdToHtml(["| 에너미 | 드롭 눈 | 받을 이름 | 종류 |", "|---|---|---|---|", ...rows].join("\n")) };
  });
}

/** 룰북(전문): 원문을 묶음별 저널로. GM 섹션·샘플 시나리오·에너미는 「GM 기능 가이드」 쪽 */
const RULEBOOK = [
  ["시작하며", () => ["misc/SRS가-아닌-세계수의-미궁-TRPG.md", "misc/들어가며-(At-First).md"]],
  ["플레이 룰", () => ["rules/플레이-룰-(Playing-Rules).md", "rules/일반-행위-판정.md", "rules/전투-룰.md", "rules/던전-탐색-룰.md", "rules/베이직-던전.md", "rules/랜덤-던전.md", "rules/세션-진행.md", "rules/세션-결과와-성장.md", "rules/쇼핑과-생활.md"]],
  ["캐릭터 작성", () => ["character/캐릭터-작성-(Character-Generation).md", "character/샘플-캐릭터-(Sample-Characters).md", ...rawDir("character", (f) => /^\d/.test(f))]],
  ["클래스", () => rawDir("classes")],
  ["데이터 레퍼런스", () => ["data/데이터-레퍼런스-(Data-Reference).md", "data/무기·방어구.md", "data/아이템.md", "data/소재.md", "data/커먼-스킬.md"]],
  ["부록", () => ["misc/FAQ.md", "misc/갱신-이력-(History-of-Revision).md", "misc/유용한-도구-(Useful-Tools).md", "misc/제작자-연락-(Contact-to-Designer).md"]]
];

/** 팩 정의: 각 팩의 문서 목록을 만든다 */
const PACK_DEFS = [
  {
    name: "classes", label: "클래스", type: "Item",
    build: () => load("classes.json").map((c, i) => itemDoc(c, { sort: (i + 1) * 100 }))
  },
  {
    name: "skills", label: "스킬", type: "Item",
    build: () => {
      const docs = [];
      const classes = load("classes.json");
      const groups = [...classes.map((c) => ({ key: c.system.key, name: c.name })), { key: "common", name: "커먼 스킬" }];
      groups.forEach((g, gi) => {
        const folder = folderDoc("Item", "skills", g.name, (gi + 1) * 100);
        docs.push(folder);
        load(`skills/${g.key}.json`).forEach((s, i) => docs.push(itemDoc(s, { folder: folder._id, sort: (i + 1) * 100 })));
      });
      return docs;
    }
  },
  {
    name: "equipment", label: "장비", type: "Item",
    build: () => {
      const docs = [];
      [["무기", "weapons.json"], ["방어구", "armors.json"], ["장식", "accessories.json"]].forEach(([label, file], gi) => {
        const folder = folderDoc("Item", "equipment", label, (gi + 1) * 100);
        docs.push(folder);
        load(file).forEach((e, i) => docs.push(itemDoc(e, { folder: folder._id, sort: (i + 1) * 100 })));
      });
      return docs;
    }
  },
  {
    name: "items", label: "아이템·소재", type: "Item",
    build: () => {
      const docs = [];
      const items = load("items.json");
      const groups = [
        ["소모품", items.filter((i) => i.type === "consumable")],
        ["기타 아이템", items.filter((i) => i.type === "tool")],
        ["소재", load("materials.json")]
      ];
      groups.forEach(([label, list], gi) => {
        const folder = folderDoc("Item", "items", label, (gi + 1) * 100);
        docs.push(folder);
        list.forEach((e, i) => docs.push(itemDoc(e, { folder: folder._id, sort: (i + 1) * 100 })));
      });
      return docs;
    }
  },
  {
    name: "enemies", label: "에너미", type: "Actor",
    build: () => {
      const docs = [];
      [["Lv1", "lv1"], ["Lv2", "lv2"], ["Lv3~4", "lv3-4"], ["F.O.E.", "foe"]].forEach(([label, file], gi) => {
        const folder = folderDoc("Actor", "enemies", label, (gi + 1) * 100);
        docs.push(folder);
        load(`enemies/${file}.json`).forEach((e, i) => docs.push(actorDoc(e, { folder: folder._id, sort: (i + 1) * 100 })));
      });
      return docs;
    }
  },
  {
    // 플레이어용 간결한 룰북(data/journals/player-guide.md, 「# 제목」마다 한 페이지)
    name: "player-guide", label: "플레이어 룰북(간결)", type: "JournalEntry",
    build: () => [journalDoc("player-guide", "NSSQ 플레이어 룰북(간결)", splitPages(readText(path.join(DATA, "journals", "player-guide.md"))))]
  },
  {
    // 모든 플레이어가 볼 수 있는 룰북 전문(data/raw 원문)
    name: "rulebook", label: "룰북(전문)", type: "JournalEntry",
    build: () => RULEBOOK.map(([name, files], i) => journalDoc("rulebook", `${i + 1}. ${name}`, [...(name === "클래스" ? [classListPage(files())] : []), ...rawPages(files())], { sort: (i + 1) * 100 }))
  },
  {
    // GM 전용: 기능 가이드(docs/manual.md) + 원문 GM 섹션·샘플 시나리오. 팩 자체를 플레이어에게 감춘다
    name: "gm-guide", label: "GM 기능 가이드", type: "JournalEntry", gmOnly: true,
    build: () => [
      journalDoc("gm-guide", "NSSQ GM 기능 가이드", manualPages(), { sort: 100, observer: false }),
      journalDoc("gm-guide", "GM 섹션·샘플 시나리오(원문)", rawPages(rawDir("gm")), { sort: 200, observer: false }),
      journalDoc("gm-guide", "드롭 아이템 일람", dropListPages(), { sort: 300, observer: false })
    ]
  }
];

fs.rmSync(SRC, { recursive: true, force: true });
const summary = [];
for (const def of PACK_DEFS) {
  const docs = def.build();
  const dir = path.join(SRC, def.name);
  fs.mkdirSync(dir, { recursive: true });
  const ids = new Set();
  for (const d of docs) {
    if (!/^[A-Za-z0-9]{16}$/.test(d._id)) throw new Error(`${def.name}: 잘못된 _id ${d._id} (${d.name})`);
    if (ids.has(d._id)) throw new Error(`${def.name}: 중복 _id ${d._id} (${d.name})`);
    ids.add(d._id);
    fs.writeFileSync(path.join(dir, `${d._id}.json`), JSON.stringify(d));
  }
  const dest = path.join(PACKS, def.name);
  fs.rmSync(dest, { recursive: true, force: true });
  await compilePack(dir, dest, { log: false });
  summary.push(`${def.label}(${def.name}): ${docs.filter((d) => !d._key.startsWith("!folders")).length}`);
}

// system.json 갱신
manifest.packs = PACK_DEFS.map((d) => ({
  name: d.name, label: d.label, path: `packs/${d.name}`, type: d.type, system: "nssq",
  ownership: d.gmOnly ? { PLAYER: "NONE", TRUSTED: "NONE", ASSISTANT: "OWNER" } : { PLAYER: "OBSERVER", ASSISTANT: "OWNER" }, flags: {}
}));
// 데이터 팩과 룰북·가이드(저널) 팩을 다른 폴더에
const journals = PACK_DEFS.filter((d) => d.type === "JournalEntry").map((d) => d.name);
manifest.packFolders = [
  { name: "NSSQ", sorting: "m", color: "#2e5e3a", packs: PACK_DEFS.filter((d) => d.type !== "JournalEntry").map((d) => d.name) },
  { name: "NSSQ 룰북·가이드", sorting: "m", color: "#5e4a2e", packs: journals }
];
fs.writeFileSync(path.join(ROOT, "system.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`컴펜디움 빌드 완료\n- ${summary.join("\n- ")}`);
