/**
 * 에셋 폴더 연결(사용자 요청): 서버 Data의 폴더(기본 nssq-assets)에 이름 규칙대로 넣은 그림·음악을 한 번에 연결한다.
 * 저작물(공식 그림·BGM)은 시스템에 넣지 않고 그 서버에만 둔다. 공개되는 것은 「폴더를 읽어 이름으로 연결하는 기능」뿐.
 * 하위 폴더(이름은 lang NSSQ.Assets.dir.*) → 대상(파일 이름 = 대상 이름, 확장자 무시, 공백·괄호 무시):
 *   에너미/    에너미 그림(월드 에너미 액터·배치된 토큰, 앞으로 컴펜디움에서 만드는 에너미도. 설정 assetLinks.enemies)
 *   전투BGM/   F.O.E.·지도·에어리어·전투 구성의 전투 BGM(재생목록 「NSSQ 에셋 BGM」에 곡으로 넣어 연결)
 *   전투배경/  F.O.E.·지도·에어리어·전투 구성의 전투 배경
 *   에어리어/  필드 지도 에어리어 그림
 *   마을/      마을·시설 그림
 *   NPC/       시설 NPC 스프라이트(시설 이름 또는 NPC 이름)
 *   스킬아이콘/ 스킬의 [의존 부위][의존 무기] 아이콘(머리·팔·다리·무기 종류 이름, apps/skill-badge.mjs. 설정 assetLinks.icons)
 * 이미 정해 둔 것은 건너뛴다([덮어쓰기]를 켜면 바꾼다). 맞지 않는 파일은 목록으로 보여 준다(그런 것은 각 편집 창에서 직접 고른다)
 */
const L = (k, d) => (d ? game.i18n.format(`NSSQ.Assets.${k}`, d) : game.i18n.localize(`NSSQ.Assets.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const KINDS = ["enemy", "bgm", "bg", "area", "town", "npc", "icon"];

/** 이름 비교용: 확장자·공백·괄호류를 뺀다 */
export const nameKey = (s) => String(s ?? "").normalize("NFC").replace(/\.[^./]+$/, "").replace(/[\s「」『』()（）[\]'"·.,_-]/g, "").toLowerCase();
const baseName = (path) => { const b = String(path).split("/").pop(); try { return decodeURIComponent(b); } catch { return b; } };
const extOf = (path) => String(path).split(".").pop().toLowerCase();

/** 에너미 그림 덮어쓰기(이름 → 경로). enemy-art.mjs·enemy-library.mjs가 쓴다 */
export function customEnemyArt(name) {
  const map = game.settings.get("nssq", "assetLinks")?.enemies ?? {};
  return map[nameKey(name)] ?? null;
}

async function browse(path) {
  try { return await FilePicker.browse("data", path); } catch { return null; }
}

/** 폴더를 읽는다: { kind: [{ path, name, key }] } */
async function scan(root) {
  const top = await browse(root);
  if (!top) return null;
  const out = Object.fromEntries(KINDS.map((k) => [k, []]));
  const want = (kind) => (kind === "bgm" ? CONST.AUDIO_FILE_EXTENSIONS : CONST.IMAGE_FILE_EXTENSIONS);
  for (const kind of KINDS) {
    const dirName = nameKey(L(`dir.${kind}`));
    const dir = top.dirs.find((d) => nameKey(baseName(d)) === dirName);
    if (!dir) continue;
    const r = await browse(dir);
    for (const f of r?.files ?? []) if (extOf(f) in want(kind)) out[kind].push({ path: f, name: baseName(f), key: nameKey(baseName(f)) });
  }
  return out;
}

/** 연결 대상 목록: { kind: [{ key, label, get, set }] } (지도·마을·구성은 설정 사본에 쓴다) */
async function targets(state) {
  const t = Object.fromEntries(KINDS.map((k) => [k, []]));
  const add = (kind, name, label, obj, field) => { if (name) t[kind].push({ key: nameKey(name), label, get: () => obj[field] ?? "", set: (v) => { obj[field] = v; } }); };
  // 에너미: 컴펜디움 + 월드 에너미 이름
  const names = new Set([...((await game.packs.get("nssq.enemies")?.getIndex()) ?? []).map((i) => i.name), ...game.actors.filter((a) => a.type === "enemy").map((a) => a.name)]);
  const enemies = state.enemies;
  const { BADGE_NAMES } = await import("./skill-badge.mjs");
  for (const n of BADGE_NAMES) t.icon.push({ key: nameKey(n), label: L("t.icon", { name: n }), get: () => state.icons[nameKey(n)] ?? "", set: (v) => { state.icons[nameKey(n)] = v; } });
  for (const n of names) t.enemy.push({ key: nameKey(n), label: n, get: () => enemies[nameKey(n)] ?? "", set: (v) => { enemies[nameKey(n)] = v; } });
  for (const m of Object.values(state.maps)) {
    add("bgm", m.name, L("t.map", { name: m.name }), m, "battleBgm");
    add("bg", m.name, L("t.map", { name: m.name }), m, "battleBg");
    for (const a of m.areas ?? []) {
      add("bgm", a.name, L("t.area", { map: m.name, name: a.name }), a, "battleBgm");
      add("bg", a.name, L("t.area", { map: m.name, name: a.name }), a, "battleBg");
      add("area", a.name, L("t.area", { map: m.name, name: a.name }), a, "img");
    }
    for (const f of m.foes ?? []) {
      add("bgm", f.name, L("t.foe", { map: m.name, name: f.name }), f, "bgm");
      add("bg", f.name, L("t.foe", { map: m.name, name: f.name }), f, "bg");
    }
  }
  for (const e of Object.values(state.encounters)) {
    add("bgm", e.name, L("t.enc", { name: e.name }), e, "bgm");
    add("bg", e.name, L("t.enc", { name: e.name }), e, "bg");
  }
  for (const town of Object.values(state.towns)) {
    add("town", town.name, L("t.town", { name: town.name }), town, "img");
    for (const f of town.facilities ?? []) {
      add("town", f.name, L("t.fac", { town: town.name, name: f.name }), f, "img");
      add("npc", f.name, L("t.fac", { town: town.name, name: f.name }), f, "npc");
      if (f.npcName && nameKey(f.npcName) !== nameKey(f.name)) add("npc", f.npcName, L("t.fac", { town: town.name, name: f.name }), f, "npc");
    }
  }
  return t;
}

/** 연결 계획: [{ kind, file, target, from, skip }] 와 맞지 않은 파일 */
function plan(files, t, overwrite) {
  const rows = [];
  const unmatched = [];
  for (const kind of KINDS) {
    for (const f of files[kind]) {
      const hits = t[kind].filter((x) => x.key === f.key);
      if (!hits.length) { unmatched.push({ kind, file: f }); continue; }
      for (const h of hits) {
        const from = h.get();
        rows.push({ kind, file: f, target: h, from, skip: !!from && !overwrite && from !== f.path });
      }
    }
  }
  return { rows, unmatched };
}

/** BGM 파일을 재생목록 「NSSQ 에셋 BGM」의 곡으로(같은 경로면 재사용) → "재생목록id.곡id" */
async function bgmRefs(paths) {
  if (!paths.length) return {};
  let list = game.playlists.find((p) => p.getFlag("nssq", "assetBgm"));
  if (!list) list = await CONFIG.Playlist.documentClass.create({ name: L("playlist"), mode: CONST.PLAYLIST_MODES.DISABLED, flags: { nssq: { assetBgm: true } } });
  const missing = [...new Set(paths)].filter((p) => !list.sounds.some((s) => s.path === p));
  if (missing.length) await list.createEmbeddedDocuments("PlaylistSound", missing.map((p) => ({ name: baseName(p).replace(/\.[^.]+$/, ""), path: p, repeat: true, volume: 0.5 })));
  return Object.fromEntries(list.sounds.map((s) => [s.path, `${list.id}.${s.id}`]));
}

/** 월드 에너미 액터·토큰에 그림 반영: 기본 아이콘·시스템 내장 그림·이전 연결 그림이면 바꾼다(GM이 직접 고른 다른 그림은 overwrite일 때만) */
async function applyEnemies(map, prev, overwrite) {
  const { isReplaceableArt } = await import("./enemy-art.mjs");
  const can = (src) => overwrite || isReplaceableArt(src) || Object.values(prev).includes(src);
  let n = 0;
  for (const a of game.actors.filter((x) => x.type === "enemy")) {
    const art = map[nameKey(a.name)];
    if (!art) continue;
    const u = {};
    if (a.img !== art && can(a.img)) u.img = art;
    if (a.prototypeToken.texture.src !== art && can(a.prototypeToken.texture.src)) u["prototypeToken.texture.src"] = art;
    if (Object.keys(u).length) { await a.update(u); n++; }
  }
  for (const scene of game.scenes) {
    const ups = scene.tokens.filter((tk) => tk.actor?.type === "enemy").map((tk) => ({ tk, art: map[nameKey(tk.actor.name)] }))
      .filter(({ tk, art }) => art && tk.texture.src !== art && can(tk.texture.src)).map(({ tk, art }) => ({ _id: tk.id, "texture.src": art }));
    if (ups.length) { await scene.updateEmbeddedDocuments("Token", ups); n += ups.length; }
  }
  return n;
}

function previewHtml(root, p) {
  const row = (r) => `<tr class="${r.skip ? "skip" : ""}"><td>${esc(L(`dir.${r.kind}`))}</td><td>${esc(r.file.name)}</td><td>${esc(r.target.label)}</td><td>${esc(r.skip ? L("st.skip") : r.from === r.file.path ? L("st.same") : r.from ? L("st.replace") : L("st.new"))}</td></tr>`;
  return `<div class="nssq-asset-link">
    <p class="notes">${esc(L("previewHead", { root, n: p.rows.filter((r) => !r.skip && r.from !== r.file.path).length }))}</p>
    ${p.rows.length ? `<table><thead><tr><th>${esc(L("col.dir"))}</th><th>${esc(L("col.file"))}</th><th>${esc(L("col.target"))}</th><th>${esc(L("col.state"))}</th></tr></thead><tbody>${p.rows.map(row).join("")}</tbody></table>` : `<p>${esc(L("noMatch"))}</p>`}
    ${p.unmatched.length ? `<details><summary>${esc(L("unmatched", { n: p.unmatched.length }))}</summary><ul>${p.unmatched.map((u) => `<li>${esc(L(`dir.${u.kind}`))}/${esc(u.file.name)}</li>`).join("")}</ul></details>` : ""}
  </div>`;
}

/** GM 스크린 버튼: 폴더 고르기 → 미리보기 → 적용 */
export async function openAssetLink() {
  if (!game.user.isGM) return null;
  const saved = game.settings.get("nssq", "assetFolder") || "nssq-assets";
  const content = `<form><p class="notes">${esc(L("hint"))}</p>
    <div class="form-group"><label>${esc(L("folder"))}</label><input type="text" name="root" value="${esc(saved)}"/><button type="button" data-pick style="flex:0 0 32px"><i class="fas fa-folder-open"></i></button></div>
    <div class="form-group"><label class="checkbox"><input type="checkbox" name="overwrite"/> ${esc(L("overwrite"))}</label></div>
    <p class="notes">${esc(L("rule"))}</p></form>`;
  const opts = await Dialog.prompt({
    title: L("title"), content, label: L("scan"), rejectClose: false, options: { width: 520 },
    render: (html) => (html[0] ?? html).querySelector("[data-pick]")?.addEventListener("click", () => {
      const input = (html[0] ?? html).querySelector("[name=root]");
      new FilePicker({ type: "folder", current: input.value, callback: (p) => { input.value = p; } }).render(true);
    }),
    callback: (html) => { const f = html[0].querySelector("form"); return { root: f.root.value.trim().replace(/\/+$/, ""), overwrite: f.overwrite.checked }; }
  });
  if (!opts?.root) return null;
  const files = await scan(opts.root);
  if (!files) return ui.notifications.warn(L("noFolder", { root: opts.root }));
  await game.settings.set("nssq", "assetFolder", opts.root);
  // 지금 설정으로 대상·계획을 만든다(미리보기 창을 연 동안 다른 창에서 고친 것을 덮지 않도록 적용 직전에 한 번 더)
  const build = async () => {
    const prevLinks = game.settings.get("nssq", "assetLinks") ?? {};
    const state = {
      enemies: { ...(prevLinks.enemies ?? {}) },
      icons: { ...(prevLinks.icons ?? {}) },
      maps: foundry.utils.deepClone(game.settings.get("nssq", "fieldMaps") ?? {}),
      encounters: foundry.utils.deepClone(game.settings.get("nssq", "encounters") ?? {}),
      towns: foundry.utils.deepClone(game.settings.get("nssq", "towns") ?? {})
    };
    const t = await targets(state);
    // BGM 대상의 지금 값은 "재생목록.곡" 참조라 파일 경로와 비교하려면 곡 경로로 바꿔 본다
    const refPath = (ref) => { const [pl, so] = String(ref ?? "").split("."); return game.playlists.get(pl)?.sounds.get(so)?.path ?? ref; };
    for (const x of t.bgm) { const g = x.get; x.get = () => refPath(g()); }
    return { prevLinks, state, p: plan(files, t, opts.overwrite) };
  };
  const first = await build();
  const ok = await Dialog.confirm({ title: L("title"), content: previewHtml(opts.root, first.p), rejectClose: false, options: { width: 640, classes: ["nssq", "dialog"] } });
  if (!ok) return null;
  const { prevLinks, state, p } = await build();
  const todo = p.rows.filter((r) => !r.skip && r.from !== r.file.path);
  const refs = await bgmRefs(todo.filter((r) => r.kind === "bgm").map((r) => r.file.path));
  for (const r of todo) r.target.set(r.kind === "bgm" ? refs[r.file.path] ?? "" : r.file.path);
  const touched = new Set(todo.map((r) => r.kind));
  if (touched.has("enemy") || touched.has("icon")) await game.settings.set("nssq", "assetLinks", { ...prevLinks, enemies: state.enemies, icons: state.icons });
  if (["bgm", "bg", "area"].some((k) => touched.has(k))) await game.settings.set("nssq", "fieldMaps", state.maps);
  if (["bgm", "bg"].some((k) => touched.has(k))) await game.settings.set("nssq", "encounters", state.encounters);
  if (["town", "npc"].some((k) => touched.has(k))) await game.settings.set("nssq", "towns", state.towns);
  const actors = touched.has("enemy") ? await applyEnemies(state.enemies, prevLinks.enemies ?? {}, opts.overwrite) : 0;
  ui.notifications.info(L("done", { n: todo.length, actors }));
  return { linked: todo.length, actors, unmatched: p.unmatched.length };
}

export function registerAssetLink() {
  game.settings.register("nssq", "assetFolder", { scope: "world", config: false, type: String, default: "nssq-assets" });
  game.settings.register("nssq", "assetLinks", { scope: "world", config: false, type: Object, default: {} });
}
