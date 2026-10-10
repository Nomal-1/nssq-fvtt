/**
 * 전투 구성(07 #166): 무대(배경·BGM)와 에너미 목록을 나눈 전투 프리셋.
 * - 월드 설정 encounters { id: 구성 }. 씬을 만들지 않으므로 몇백 개여도 씬 목록이 늘지 않는다
 * - 시작하면 임시 프리셋 씬(배경·BGM = 구성, 비면 그 던전(필드 지도)의 기본 무대)에 열대로 토큰을 놓고 전투 개시 창
 * - 기존 씬 프리셋도 그대로 쓰고, [변환]으로 구성으로 옮길 수 있다
 * - 지도 연결: 지도 battleBg·battleBgm(기본 무대), 에어리어 encounters [{ id, weight }](조우표, apps/fieldmap.mjs)
 */
import { expandEnemies, enemiesFromTokens, pickWeighted, resolveStage, validateEncounter } from "../engine/encounters.mjs";
import { LAYOUT } from "../engine/formation.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Encounter.${k}`, d) : game.i18n.localize(`NSSQ.Encounter.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const opt = (v, cur, label) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(label)}</option>`;
const rid = () => foundry.utils.randomID();

export const allEncounters = () => game.settings.get("nssq", "encounters") ?? {};
const maps = () => game.settings.get("nssq", "fieldMaps") ?? {};

async function saveEncounter(enc) {
  await game.settings.set("nssq", "encounters", { ...allEncounters(), [enc.id]: foundry.utils.deepClone(enc) });
}
async function deleteEncounter(id) {
  const all = { ...allEncounters() };
  delete all[id];
  await game.settings.set("nssq", "encounters", all);
}

/** 재생목록·곡 선택지(값 "재생목록id" 또는 "재생목록id.곡id") */
export function bgmOptions(cur, emptyLabel) {
  const out = [opt("", cur, emptyLabel)];
  for (const p of game.playlists.contents) {
    out.push(opt(p.id, cur, `♫ ${p.name}`));
    for (const s of p.sounds.contents) out.push(opt(`${p.id}.${s.id}`, cur, `  └ ${s.name}`));
  }
  return out.join("");
}

/** 에너미 선택지(월드 에너미 + 컴펜디움) */
let enemyCache = null;
async function enemyChoices() {
  if (enemyCache) return enemyCache;
  const pack = game.packs.get("nssq.enemies");
  const index = pack ? await pack.getIndex({ fields: ["img", "system.level"] }) : [];
  enemyCache = [
    ...game.actors.filter((a) => a.type === "enemy" && !a.getFlag("nssq", "library")).map((a) => ({ uuid: a.uuid, name: a.name, img: a.img, label: `${a.name} (${L("world")})` })),
    ...index.map((e) => ({ uuid: e.uuid, name: e.name, img: e.img, label: `${e.name}${e.system?.level ? ` Lv${e.system.level}` : ""}` }))
  ];
  return enemyCache;
}

/** uuid → 전투에 쓸 월드 액터(컴펜디움이면 「프리셋 에너미」 폴더의 기본 액터) */
async function actorFor(uuid) {
  if (String(uuid).startsWith("Actor.")) return fromUuid(uuid);
  return (await import("./enemy-library.mjs")).enemyActorFor(uuid);
}

/** 지금 진행 중인 필드 지도(던전 기본 무대용) */
function liveMap() {
  const st = game.settings.get("nssq", "fieldMapState") ?? {};
  return st.active ? maps()[st.mapId] ?? null : null;
}

/** 이 구성으로 전투 개시 창. map: 기본 무대를 가져올 지도(없으면 진행 중인 지도 → 구성의 묶음 지도) */
export async function startEncounter(id, { map = null, flags = {} } = {}) {
  const enc = allEncounters()[id];
  if (!enc || !game.user.isGM) return null;
  const m = map ?? liveMap() ?? (String(enc.group).startsWith("map:") ? maps()[enc.group.slice(4)] : null);
  const actors = [];
  for (const e of expandEnemies(enc)) {
    const actor = await actorFor(e.uuid);
    if (actor) actors.push({ actor, row: e.row });
  }
  if (!actors.length) return ui.notifications.warn(L("noEnemies"));
  return (await import("./dungeon.mjs")).presetBattle(enc.name, actors, flags, resolveStage(enc, m));
}

/** 조우표에서 가중치대로 하나 골라 시작 */
export async function randomEncounter(table, { map = null, name = "" } = {}) {
  const all = allEncounters();
  const id = pickWeighted(table, CONFIG.Dice.randomUniform(), (x) => !!all[x]);
  if (!id) return ui.notifications.warn(L("emptyTable"));
  await ChatMessage.create({ whisper: game.users.filter((u) => u.isGM).map((u) => u.id), content: `<div class="nssq-combat-note"><i class="fas fa-dice"></i> ${esc(L("rolled", { area: name, name: all[id].name }))}</div>` });
  return startEncounter(id, { map });
}

/** 기존 씬 프리셋 → 구성(배경·BGM·에너미 토큰) */
export async function convertScenePreset(scene) {
  const mid = (LAYOUT.lanes.enemyBack + LAYOUT.lanes.enemyFront) / 2;
  const tokens = scene.tokens.filter((t) => t.actor?.type === "enemy").sort((a, b) => a.x - b.x).map((t) => ({
    uuid: t.actor.getFlag("nssq", "library") || t.actor.uuid, name: t.name, img: t.texture?.src || t.actor.img,
    y: t.y + ((t.height ?? 1) * scene.grid.size) / 2
  }));
  const enc = {
    id: rid(), name: scene.name, group: "", fav: false,
    bg: scene.background?.src ?? "", bgm: scene.playlist ? `${scene.playlist.id}${scene.playlistSound ? `.${scene.playlistSound.id}` : ""}` : "",
    enemies: enemiesFromTokens(tokens, mid)
  };
  await saveEncounter(enc);
  ui.notifications.info(L("converted", { name: scene.name }));
  return enc;
}

/* ---------------- 창 ---------------- */

let app = null;

export class EncounterApp extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "nssq-encounters", classes: ["nssq", "nq-window", "nssq-encounters"], title: game.i18n.localize("NSSQ.Encounter.title"),
      width: 900, height: 680, resizable: true
    });
  }

  static open(opts = {}) {
    if (!game.user.isGM) return null;
    app ??= new EncounterApp();
    if (opts.group !== undefined) app.group = opts.group;
    return app.render(true, { focus: true });
  }

  static refresh() { if (app?.rendered && !app.draft) app.render(); }

  async _renderInner() {
    if (this.draft) return $(await this.editorHtml());
    const encs = Object.values(allEncounters());
    const g = this.group ?? "all";
    const q = (this.query ?? "").trim();
    const mapList = Object.values(maps());
    const groups = [opt("all", g, L("gAll")), opt("fav", g, L("gFav")), ...mapList.map((m) => opt(`map:${m.id}`, g, `🗺 ${m.name}`)), opt("", g, L("gNone")), opt("scenes", g, L("gScenes"))].join("");
    const match = (e) => (g === "all" || (g === "fav" ? e.fav : e.group === g)) && (!q || e.name.includes(q) || (e.enemies ?? []).some((x) => x.name?.includes(q)));
    const cards = g === "scenes" ? this.sceneCards(q) : encs.filter(match).sort((a, b) => a.name.localeCompare(b.name, "ko")).map((e) => this.card(e)).join("");
    return $(`<div class="enc-wrap">
      <div class="enc-toolbar">
        <select data-enc-group>${groups}</select>
        <input type="search" data-enc-q value="${esc(q)}" placeholder="${esc(L("search"))}"/>
        <button type="button" data-enc="new"><i class="fas fa-plus"></i> ${esc(L("new"))}</button>
      </div>
      <p class="notes">${esc(L("hint"))}</p>
      <div class="enc-grid">${cards || `<p class="enc-empty">${esc(L("none"))}</p>`}</div>
    </div>`);
  }

  card(e) {
    const map = String(e.group).startsWith("map:") ? maps()[e.group.slice(4)] : null;
    const st = resolveStage(e, map);
    const chips = (e.enemies ?? []).map((x) => `<span class="chip ${x.row}" title="${esc(x.name)} (${esc(L(`row.${x.row}`))})">${x.img ? `<img src="${esc(x.img)}"/>` : ""}${esc(x.name)}${x.count > 1 ? ` ×${x.count}` : ""}</span>`).join("");
    const inherited = !e.bg && st.bg;
    return `<div class="enc-card" data-id="${e.id}">
      <div class="thumb ${inherited ? "inherited" : ""}" ${st.bg ? `style="background-image:url('${esc(st.bg)}')"` : ""}>${inherited ? `<span class="tag">${esc(L("mapDefault"))}</span>` : ""}
        <a class="fav ${e.fav ? "on" : ""}" data-enc="fav" title="${esc(L("fav"))}"><i class="fas fa-star"></i></a></div>
      <div class="info"><b>${esc(e.name)}</b>${map ? `<span class="grp">🗺 ${esc(map.name)}</span>` : ""}<div class="chips">${chips}</div></div>
      <div class="acts"><button type="button" data-enc="start" class="go"><i class="fas fa-skull-crossbones"></i> ${esc(L("start"))}</button>
        <a data-enc="edit" title="${esc(L("edit"))}"><i class="fas fa-pen"></i></a><a data-enc="dup" title="${esc(L("dup"))}"><i class="fas fa-copy"></i></a><a data-enc="del" title="${esc(L("del"))}"><i class="fas fa-trash"></i></a></div>
    </div>`;
  }

  /** 기존 씬 프리셋(임시 프리셋 제외) */
  sceneCards(q) {
    return game.scenes.filter((s) => s.getFlag("nssq", "battlePreset") && !s.getFlag("nssq", "randomPreset") && (!q || s.name.includes(q))).map((s) => {
      const names = s.tokens.filter((t) => t.actor?.type === "enemy").map((t) => t.name).join(", ");
      return `<div class="enc-card scene" data-scene="${s.id}">
        <div class="thumb" ${s.background?.src ? `style="background-image:url('${esc(s.background.src)}')"` : ""}></div>
        <div class="info"><b>${esc(s.name)}</b><div class="chips"><span class="chip">${esc(names || "-")}</span></div></div>
        <div class="acts"><button type="button" data-enc="sceneStart" class="go"><i class="fas fa-skull-crossbones"></i> ${esc(L("start"))}</button>
          <a data-enc="convert" title="${esc(L("convertHint"))}"><i class="fas fa-exchange-alt"></i></a><a data-enc="sceneView" title="${esc(L("view"))}"><i class="fas fa-eye"></i></a></div>
      </div>`;
    }).join("");
  }

  async editorHtml() {
    const d = this.draft;
    const enemies = await enemyChoices();
    const mapList = Object.values(maps());
    const map = String(d.group).startsWith("map:") ? maps()[d.group.slice(4)] : null;
    const rows = d.enemies.map((x, i) => `<tr><td>${x.img ? `<img src="${esc(x.img)}"/>` : ""}</td><td>${esc(x.name)}</td>
      <td><input type="number" min="1" max="9" data-row-count="${i}" value="${x.count}"/></td>
      <td><select data-row-row="${i}">${opt("front", x.row, L("row.front"))}${opt("back", x.row, L("row.back"))}</select></td>
      <td><a data-row-del="${i}"><i class="fas fa-times"></i></a></td></tr>`).join("");
    return `<div class="enc-wrap enc-edit">
      <div class="enc-toolbar"><button type="button" data-enc="back"><i class="fas fa-arrow-left"></i> ${esc(L("back"))}</button><span class="spacer"></span>
        <button type="button" data-enc="save" class="go"><i class="fas fa-save"></i> ${esc(L("save"))}</button></div>
      <div class="form-group"><label>${esc(L("name"))}</label><input type="text" data-f="name" value="${esc(d.name)}"/></div>
      <div class="form-group"><label>${esc(L("group"))}</label><select data-f="group">${opt("", d.group, L("gNone"))}${mapList.map((m) => opt(`map:${m.id}`, d.group, m.name)).join("")}</select></div>
      <div class="form-group"><label>${esc(L("bg"))}</label><input type="text" data-f="bg" value="${esc(d.bg)}" placeholder="${esc(map?.battleBg ? L("bgFromMap", { name: map.name }) : L("bgEmpty"))}"/><button type="button" data-enc="pickBg" class="icon"><i class="fas fa-file-import"></i></button></div>
      <div class="form-group"><label>${esc(L("bgm"))}</label><select data-f="bgm">${bgmOptions(d.bgm, map?.battleBgm ? L("bgmFromMap", { name: map.name }) : L("bgmEmpty"))}</select></div>
      <p class="notes">${esc(L("stageHint"))}</p>
      <h3>${esc(L("enemies"))}</h3>
      <table class="enc-enemies"><thead><tr><th></th><th>${esc(L("enemy"))}</th><th>${esc(L("count"))}</th><th>${esc(L("rowLabel"))}</th><th></th></tr></thead><tbody>${rows || `<tr><td colspan="5" class="notes">${esc(L("noEnemies"))}</td></tr>`}</tbody></table>
      <div class="enc-add"><input type="text" list="enc-enemy-list" data-add-name placeholder="${esc(L("addHint"))}"/><select data-add-row>${opt("front", "front", L("row.front"))}${opt("back", "", L("row.back"))}</select>
        <button type="button" data-enc="add"><i class="fas fa-plus"></i> ${esc(L("add"))}</button></div>
      <datalist id="enc-enemy-list">${enemies.map((x) => `<option value="${esc(x.label)}"></option>`).join("")}</datalist>
    </div>`;
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html[0];
    root.querySelector("[data-enc-group]")?.addEventListener("change", (ev) => { this.group = ev.currentTarget.value; this.render(); });
    root.querySelector("[data-enc-q]")?.addEventListener("change", (ev) => { this.query = ev.currentTarget.value; this.render(); });
    root.querySelectorAll("[data-f]").forEach((el) => el.addEventListener("change", () => { this.draft[el.dataset.f] = el.value; if (el.dataset.f === "group") this.render(); }));
    root.querySelectorAll("[data-row-count]").forEach((el) => el.addEventListener("change", () => { this.draft.enemies[el.dataset.rowCount].count = Math.max(1, Number(el.value) || 1); }));
    root.querySelectorAll("[data-row-row]").forEach((el) => el.addEventListener("change", () => { this.draft.enemies[el.dataset.rowRow].row = el.value; }));
    root.querySelectorAll("[data-row-del]").forEach((el) => el.addEventListener("click", () => { this.draft.enemies.splice(Number(el.dataset.rowDel), 1); this.render(); }));
    root.querySelectorAll("[data-enc]").forEach((el) => el.addEventListener("click", (ev) => { ev.preventDefault(); this.onAct(el); }));
  }

  async onAct(el) {
    const act = el.dataset.enc;
    const id = el.closest("[data-id]")?.dataset.id;
    const all = allEncounters();
    switch (act) {
      case "new": this.draft = { id: rid(), name: L("newName"), group: this.group?.startsWith("map:") ? this.group : "", bg: "", bgm: "", enemies: [], fav: false }; return this.render();
      case "edit": this.draft = foundry.utils.deepClone(all[id]); return this.render();
      case "dup": { const e = { ...foundry.utils.deepClone(all[id]), id: rid(), name: L("copyName", { name: all[id].name }) }; await saveEncounter(e); return this.render(); }
      case "del": {
        if (!(await Dialog.confirm({ title: L("del"), content: `<p>${esc(L("delConfirm", { name: all[id].name }))}</p>`, rejectClose: false }))) return null;
        await deleteEncounter(id); return this.render();
      }
      case "fav": await saveEncounter({ ...all[id], fav: !all[id].fav }); return this.render();
      case "start": return startEncounter(id);
      case "back": this.draft = null; return this.render();
      case "pickBg": return new FilePicker({ type: "image", current: this.draft.bg, callback: (src) => { this.draft.bg = src; this.render(); } }).render(true);
      case "add": {
        const root = this.element[0];
        const label = root.querySelector("[data-add-name]").value.trim();
        const e = (await enemyChoices()).find((x) => x.label === label || x.name === label);
        if (!e) return ui.notifications.warn(L("unknownEnemy", { name: label }));
        const row = root.querySelector("[data-add-row]").value;
        const same = this.draft.enemies.find((x) => x.uuid === e.uuid && x.row === row);
        if (same) same.count += 1; else this.draft.enemies.push({ uuid: e.uuid, name: e.name, img: e.img, count: 1, row });
        return this.render();
      }
      case "save": {
        const errs = validateEncounter(this.draft);
        if (errs.length) return ui.notifications.warn(errs.map((x) => L(x)).join(" "));
        await saveEncounter(this.draft);
        this.draft = null;
        return this.render();
      }
      case "sceneStart": return (await import("./battle.mjs")).openStartDialog(el.closest("[data-scene]").dataset.scene);
      case "sceneView": return game.scenes.get(el.closest("[data-scene]").dataset.scene)?.view();
      case "convert": { await convertScenePreset(game.scenes.get(el.closest("[data-scene]").dataset.scene)); this.group = "all"; return this.render(); }
    }
    return null;
  }
}

export function registerEncounters() {
  game.settings.register("nssq", "encounters", { scope: "world", config: false, type: Object, default: {}, onChange: () => { EncounterApp.refresh(); } });
  Hooks.on("createActor", () => { enemyCache = null; });
  Hooks.on("deleteActor", () => { enemyCache = null; });
}
