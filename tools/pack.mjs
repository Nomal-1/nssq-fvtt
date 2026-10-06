// data/*.json → packs/<name> (LevelDB 컴펜디움). system.json의 packs·packFolders도 갱신한다.
// 사용: node tools/pack.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compilePack } from "@foundryvtt/foundryvtt-cli";
import { makeId } from "./lib/util.mjs";
import ENEMY_ART from "../src/generated/enemy-art.mjs";

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
    name: e.name, type: e.type, img: e.img, system,
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
  ownership: { PLAYER: "OBSERVER", ASSISTANT: "OWNER" }, flags: {}
}));
manifest.packFolders = [{ name: "NSSQ", sorting: "m", color: "#2e5e3a", packs: PACK_DEFS.map((d) => d.name) }];
fs.writeFileSync(path.join(ROOT, "system.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`컴펜디움 빌드 완료\n- ${summary.join("\n- ")}`);
