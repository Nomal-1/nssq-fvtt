/**
 * 마을(07 #167, 사용자 결정): 지도에 그리지 않는 완전한 안전지대. 필드 지도는 던전 안(언제든 위험해질 수 있는 곳)만.
 * - 월드 설정 towns { id: { id, name, img, desc, facilities: [{ id, type, name, img, desc, sceneId }], shopHidden? } }
 * - 월드 설정 location { kind: "town"|"dungeon"|"", townId }: 파티가 지금 있는 곳
 * - 귀환(returnToTown): 《아리아드네의 실》·던전 입구의 「마을로 돌아간다」·랜덤 던전 클리어·GM [던전 나가기]
 *   → 던전 진행을 끝내고, 파티 전원 【HP】【TP】 최대·상태 이상·강화·약화·오버히트 없음, 상점 열기, 누적 전투 턴 0
 *   (생활비만 내면 마을에서는 늘 회복된 상태 — 여관·시약원 무료)
 * - 던전에 들어가면(필드 지도 진행 시작·랜덤 던전 시작) location = dungeon, 상점 닫기
 * - 상점 판매 품목은 마을마다(shopHidden, 없으면 기본 설정)
 */
const L = (k, d) => (d ? game.i18n.format(`NSSQ.Town.${k}`, d) : game.i18n.localize(`NSSQ.Town.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const opt = (v, cur, label) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(label)}</option>`;
const rid = () => foundry.utils.randomID();

export const FACILITY_TYPES = ["guild", "shop", "inn", "apothecary", "pub", "office", "gate", "free"];
const ICONS = { guild: "fa-users", shop: "fa-store", inn: "fa-bed", apothecary: "fa-mortar-pestle", pub: "fa-beer", office: "fa-landmark", gate: "fa-dungeon", free: "fa-map-signs" };

export const allTowns = () => game.settings.get("nssq", "towns") ?? {};
export const location = () => game.settings.get("nssq", "location") ?? {};
/** 파티가 있는 마을(마을에 있을 때만) */
export const currentTown = () => (location().kind === "town" ? allTowns()[location().townId] ?? null : null);

async function saveTown(t) {
  await game.settings.set("nssq", "towns", { ...allTowns(), [t.id]: foundry.utils.deepClone(t) });
}

export function newTown(name) {
  return {
    id: rid(), name: name || L("newName"), img: "", desc: "",
    facilities: ["guild", "shop", "inn", "apothecary", "pub", "office"].map((type) => ({ id: rid(), type, name: L(`type.${type}`), img: "", desc: "", sceneId: "" }))
  };
}

/** 이 마을에서 숨긴 상점 품목(마을에 따로 정하지 않았으면 null → 기본 설정) */
export function townShopHidden(townId) {
  const t = allTowns()[townId];
  return Array.isArray(t?.shopHidden) ? t.shopHidden : null;
}

/** GM: 마을의 판매 품목 숨김·판매 전환(처음 고치면 기본 설정을 복사해서 시작) */
export async function setTownHidden(townId, uuids, hidden) {
  const t = foundry.utils.deepClone(allTowns()[townId]);
  if (!t) return;
  const set = new Set(Array.isArray(t.shopHidden) ? t.shopHidden : game.settings.get("nssq", "shopHidden") ?? []);
  for (const u of uuids) hidden ? set.add(u) : set.delete(u);
  t.shopHidden = [...set];
  await saveTown(t);
}

/* ---------------- 이동 ---------------- */

/** 던전에 들어갔다(필드 지도·랜덤 던전 시작이 부른다): 떠나온 마을을 기억하고 상점을 닫는다 */
export async function enteredDungeon() {
  if (!game.user.isGM) return;
  const loc = location();
  await game.settings.set("nssq", "location", { kind: "dungeon", townId: loc.townId ?? Object.keys(allTowns())[0] ?? null });
  if (game.settings.get("nssq", "shopOpen")) await game.settings.set("nssq", "shopOpen", false);
}

/** 파티 전원 회복: 【HP】【TP】 최대, 상태 이상·강화·약화·전투 고유 상태·오버히트 없음 */
async function restoreParty() {
  const party = (await import("./gm-screen.mjs")).partyActors();
  for (const a of party) {
    const s = a.system;
    await a.update({ "system.hp.value": s.hp?.max ?? 0, "system.tp.value": s.tp?.max ?? 0, "system.conditions": [], "system.buffs": [] });
    if (a.getFlag("nssq", "overheat")) await a.unsetFlag("nssq", "overheat");
    if ((a.getFlag("nssq", "states") ?? []).length) await a.unsetFlag("nssq", "states");
  }
  return party;
}

/**
 * 마을로 돌아온다(활성 GM). townId가 없으면 떠나온 마을 → 첫 마을.
 * 진행 중인 필드 지도·랜덤 던전은 끝낸다(필드 지도의 밟은 기록은 남아 다음에 이어서 들어간다)
 */
export async function returnToTown(townId = null, { reason = "" } = {}) {
  if (!game.user.isGM) return null;
  const towns = allTowns();
  const id = townId ?? (towns[location().townId] ? location().townId : Object.keys(towns)[0] ?? null);
  const fm = game.settings.get("nssq", "fieldMapState") ?? {};
  if (fm.active) await game.settings.set("nssq", "fieldMapState", { ...fm, active: false, proposal: null });
  const dg = game.settings.get("nssq", "dungeon") ?? {};
  if (dg.active) await game.settings.set("nssq", "dungeon", { ...dg, active: false });
  const party = await restoreParty();
  await (await import("./time-pass.mjs")).resetBattleTurns();
  const scene = towns[id] ? await ensureTownScene(towns[id]) : null;
  await game.settings.set("nssq", "location", { kind: "town", townId: id });
  if (scene && !scene.active) await scene.activate();
  if (!game.settings.get("nssq", "shopOpen")) await game.settings.set("nssq", "shopOpen", true);
  const name = towns[id]?.name ?? L("noTownName");
  await ChatMessage.create({ content: `<div class="nssq-town-card"><h3><i class="fas fa-home"></i> ${esc(L("returned", { name }))}</h3>${reason ? `<p>${esc(reason)}</p>` : ""}<p class="notes">${esc(L("restored", { names: party.map((a) => a.name).join(", ") }))}</p></div>` });
  return id;
}

/** 플레이어: 던전 입구에서 「마을로 돌아가자」(활성 GM이 확인) */
export async function requestReturnToTown() {
  const { emit } = await import("../socket.mjs");
  return emit("townReturn", { userId: game.user.id });
}

/** 미궁 입구: GM은 바로 들어가고, 플레이어는 GM에게 제안 */
export async function enterMapFromTown(mapId) {
  if (!game.user.isGM) return (await import("../socket.mjs")).emit("townGate", { userId: game.user.id, mapId });
  const { startProgress, allMaps, FieldMapApp } = await import("./fieldmap.mjs");
  const map = allMaps()[mapId];
  if (!map) return null;
  await startProgress(mapId, map.startHour ?? 8);
  return FieldMapApp.open();
}

async function onGateRequest({ userId, mapId }) {
  const { isActiveGM } = await import("../combat/apply.mjs");
  if (!isActiveGM()) return;
  const map = (await import("./fieldmap.mjs")).allMaps()[mapId];
  if (!map) return;
  const who = game.users.get(userId)?.name ?? "?";
  const ok = await Dialog.confirm({ title: L("title"), content: `<p>${esc(L("gateAsk", { who, name: map.name }))}</p>`, rejectClose: false });
  if (ok) await enterMapFromTown(mapId);
}

async function onReturnRequest({ userId }) {
  const { isActiveGM } = await import("../combat/apply.mjs");
  if (!isActiveGM()) return;
  const who = game.users.get(userId)?.name ?? "?";
  const ok = await Dialog.confirm({ title: L("title"), content: `<p>${esc(L("returnAsk", { who }))}</p>`, rejectClose: false });
  if (ok) await returnToTown(null, { reason: L("returnBy", { who }) });
}

/* ---------------- 마을 씬 ---------------- */

/** 마을 씬: 1920×1080 고정, 배경 = 마을 그림, 플래그 nssq.town = 마을 id. UI는 TownOverlay가 씬 위에 덮는다 */
export const TOWN_SCENE = { width: 1920, height: 1080 };
const DESIGN = { w: 1280, h: 720 };
export const townSceneOf = (t) => (t ? game.scenes.find((x) => x.getFlag("nssq", "town") === t.id) ?? null : null);

export async function ensureTownScene(t) {
  if (!game.user.isGM || !t) return null;
  const s = townSceneOf(t);
  if (s) {
    const upd = {};
    if ((s.background?.src ?? "") !== (t.img ?? "")) upd["background.src"] = t.img || null;
    if (s.name !== t.name) upd.name = t.name;
    if (Object.keys(upd).length) await s.update(upd);
    return s;
  }
  const folderName = L("sceneFolder");
  const folder = game.folders.find((x) => x.type === "Scene" && x.name === folderName) ?? await Folder.create({ name: folderName, type: "Scene" });
  return Scene.create({
    name: t.name, folder: folder.id, navigation: true, ...TOWN_SCENE, padding: 0, backgroundColor: "#000000",
    grid: { type: CONST.GRID_TYPES.GRIDLESS }, background: { src: t.img || null }, tokenVision: false, fog: { exploration: false },
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }, flags: { nssq: { town: t.id } }
  });
}

/** 마을 씬이 화면(사이드바·컨트롤 바깥)에 꽉 차게 */
let fitting = false;
function fitTownView() {
  if (!canvas.ready || !canvas.scene?.getFlag("nssq", "town")) return;
  const r = canvas.dimensions.sceneRect;
  const side = ui.sidebar?._collapsed ? 40 : (ui.sidebar?.element?.[0]?.offsetWidth ?? 300) + 16;
  // 씬 컨트롤·씬 내비게이션·핫바에 가리지 않게 실제 위치로 여백을 잰다
  const box = (id) => document.getElementById(id)?.getBoundingClientRect();
  const area = {
    l: Math.max(70, (box("controls")?.right ?? 60) + 8), t: Math.max(46, (box("navigation")?.bottom ?? 40) + 6),
    r: window.innerWidth - side, b: Math.min(window.innerHeight - 66, (box("hotbar")?.top ?? window.innerHeight - 66) - 6)
  };
  const scale = Math.min((area.r - area.l) / r.width, (area.b - area.t) / r.height);
  const x = r.x + r.width / 2 - ((area.l + area.r) / 2 - window.innerWidth / 2) / scale;
  const y = r.y + r.height / 2 - ((area.t + area.b) / 2 - window.innerHeight / 2) / scale;
  fitting = true;
  canvas.pan({ x, y, scale });
  fitting = false;
}

let overlay = null;
/** 지금 보는 씬이 마을 씬이면 마을 UI를 덮고, 아니면 걷는다 */
function syncOverlay() {
  if (overlay) { overlay.element?.remove(); overlay = null; }
  const tid = canvas.ready ? canvas.scene?.getFlag("nssq", "town") : null;
  if (!tid || !allTowns()[tid]) return;
  overlay = new TownOverlay();
  overlay.townId = tid;
  overlay.render(true);
  fitTownView();
}

/* ---------------- 창 ---------------- */

let app = null;

export class TownApp extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "nssq-town", classes: ["nssq", "nq-window", "nssq-town"], title: game.i18n.localize("NSSQ.Town.title"),
      width: 1200, height: 700, resizable: true
    });
  }

  static open(townId = null) {
    app ??= new TownApp();
    if (townId && townId !== app.townId) { app.townId = townId; app.facId = null; }
    return app.render(true, { focus: true });
  }

  static refresh() {
    if (app?.rendered && !app.draft) app.render();
    if (overlay?.rendered) overlay.render();
  }

  /** 마을 고르기(창: 보는 마을만 바꿈) */
  pickTown(id) { this.townId = id; this.render(); }

  /** 보여 줄 마을: GM은 고른 것(없으면 지금 마을 → 첫 마을), 플레이어는 파티가 있는 마을 */
  shownTown() {
    const towns = allTowns();
    if (!game.user.isGM) return currentTown();
    const id = towns[this.townId] ? this.townId : towns[location().townId] ? location().townId : Object.keys(towns)[0];
    this.townId = id ?? null;
    return id ? towns[id] : null;
  }

  async _renderInner() {
    if (this.draft) return $(this.editorHtml());
    const t = this.shownTown();
    const gm = game.user.isGM;
    const here = location().kind === "town" && location().townId === t?.id;
    const towns = Object.values(allTowns());
    // GM 도구는 제목 줄 아래 오른쪽 작은 줄(플레이어 화면에는 없음)
    const bar = gm ? `<div class="town-bar">
        <select data-town-pick>${towns.map((x) => opt(x.id, t?.id, `${x.name}${location().kind === "town" && location().townId === x.id ? ` ${L("hereMark")}` : ""}`)).join("")}${towns.length ? "" : opt("", "", L("none"))}</select>
        <button type="button" data-town="new" title="${esc(L("new"))}"><i class="fas fa-plus"></i></button>
        ${t ? `<button type="button" data-town="edit" title="${esc(L("edit"))}"><i class="fas fa-pen"></i></button><button type="button" data-town="viewScene" class="win-only" title="${esc(L("viewScene"))}"><i class="fas fa-map"></i></button>` : ""}
        ${t && !here ? `<button type="button" data-town="goHere" class="go"><i class="fas fa-home"></i> ${esc(L("goHere"))}</button>` : ""}
      </div>` : "";
    if (!t) return $(`<div class="town-stage empty">${bar}<p class="town-empty">${esc(gm ? L("noneGM") : L("notInTown"))}</p></div>`);
    const f = (t.facilities ?? []).find((x) => x.id === this.facId) ?? null;
    if (!f) this.facId = null;
    const bg = (src) => (src ? `style="background-image:url('${encodeURI(src)}')"` : "");
    const top = (place, say) => `<header class="town-top">${this.clockHtml()}
      <div class="headline"><b class="place">${esc(place)}</b><span class="say" data-say-default="${esc(say)}">${esc(say)}</span></div>
      <div class="money">${this.moneyText()}</div></header>`;
    if (!f) {
      // 마을 화면: 마을 일러 + 시설 선택지(원작의 거리 메뉴)
      const menu = (t.facilities ?? []).map((x) => `<button type="button" class="town-choice" data-go="${x.id}" data-say="${esc(x.desc && x.type === "free" ? x.desc : L(`hint.${x.type}`))}"><i class="fas ${ICONS[x.type] ?? "fa-map-signs"}"></i><span>${esc(x.name)}</span></button>`).join("");
      return $(`<div class="town-stage" ${bg(t.img)}>${top(t.name, t.desc || (here ? L("partyHere") : L("partyAway")))}${bar}
        <nav class="town-menu">${menu}</nav>
        <div class="town-name"><i class="fas fa-home"></i> ${esc(t.name)}${here ? "" : ` <small>${esc(L("partyAwayShort"))}</small>`}</div></div>`);
    }
    // 시설 화면: 시설 일러 + NPC + 메뉴 + 파티 상태(원작의 시설 화면)
    const items = await this.facilityButtons(f);
    return $(`<div class="town-stage facility ${f.img ? "" : "no-img"}" ${bg(f.img || t.img)}>${top(f.name, f.desc || L(`greet.${f.type}`))}${bar}
      ${f.npc ? `<img class="town-npc" src="${encodeURI(f.npc)}" alt=""/>` : f.img ? "" : `<i class="town-fac-icon fas ${ICONS[f.type] ?? "fa-map-signs"}"></i>`}
      <nav class="town-menu">${items}<button type="button" class="town-choice back" data-town="leaveFac" data-say="${esc(L("say.back"))}"><i class="fas fa-sign-out-alt"></i><span>${esc(L("toStreet"))}</span></button></nav>
      ${await this.partyHtml()}</div>`);
  }

  /** 시각: 필드 지도·랜덤 던전의 마지막 시각(없으면 시간대) */
  clockHtml() {
    const fm = game.settings.get("nssq", "fieldMapState") ?? {};
    const dg = game.settings.get("nssq", "dungeon") ?? {};
    const h = Number.isFinite(fm.hour) ? fm.hour : Number.isFinite(dg.hour) ? dg.hour : null;
    if (h === null) return `<div class="clock"><b class="tod">${esc(game.i18n.localize(`NSSQ.Dungeon.tod.${game.settings.get("nssq", "timeOfDay") ?? "day"}`))}</b></div>`;
    const hh = h % 24;
    return `<div class="clock"><span class="ampm">${esc(L(hh < 12 ? "am" : "pm"))}</span><b>${String(hh % 12 === 0 && hh >= 12 ? 12 : hh % 12).padStart(2, "0")}</b></div>`;
  }

  /** 소지금: 플레이어는 대표 캐릭터, GM은 파티 합계 */
  moneyText() {
    const mine = game.user.character ?? game.actors.find((a) => a.type === "character" && a.isOwner && !game.user.isGM);
    const n = game.user.isGM ? game.actors.filter((a) => a.type === "character" && !a.getFlag("nssq", "benched")).reduce((t, a) => t + (a.system.money ?? 0), 0) : mine?.system.money ?? 0;
    return `${n.toLocaleString()} <small>G</small>`;
  }

  async partyHtml() {
    const party = (await import("./gm-screen.mjs")).partyActors();
    const bar = (v, m, cls) => `<span class="bar ${cls}"><i style="width:${m ? Math.round((100 * Math.max(0, v)) / m) : 0}%"></i></span>`;
    return `<footer class="town-party">${party.map((a) => {
      const { hp, tp } = a.system;
      return `<div class="pc"><b>${esc(a.name)}</b>
        <div class="stat"><span>HP</span><em>${hp?.value ?? 0}</em><span>TP</span><em>${tp?.value ?? 0}</em></div>
        <div class="bars">${bar(hp?.value ?? 0, hp?.max ?? 0, "hp")}${bar(tp?.value ?? 0, tp?.max ?? 0, "tp")}</div></div>`;
    }).join("")}</footer>`;
  }

  async facilityButtons(f) {
    const b = (act, icon, label, extra = "") => `<button type="button" class="town-choice" data-fac="${act}" data-fid="${f.id}" data-say="${esc(L(`say.${act}`))}" ${extra}><i class="fas ${icon}"></i><span>${esc(label)}</span></button>`;
    const gm = game.user.isGM;
    const out = [];
    switch (f.type) {
      case "guild": out.push(b("guild", "fa-users", L("btn.guild")), b("tree", "fa-sitemap", L("btn.tree")), b("chargen", "fa-user-plus", L("btn.chargen"))); if (gm) out.push(b("gmScreen", "fa-users-cog", L("btn.party"))); break;
      case "shop": out.push(b("shop", "fa-store", L("btn.shop"))); break;
      case "apothecary": out.push(b("shop", "fa-prescription-bottle", L("btn.potions"))); break;
      case "inn": out.push(b("sheet", "fa-box", L("btn.storage"))); if (gm) out.push(b("living", "fa-coins", L("btn.living"))); break;
      case "office": out.push(b("bestiary", "fa-book-dead", L("btn.bestiary"))); break;
      case "gate": {
        const maps = Object.values((await import("./fieldmap.mjs")).allMaps());
        for (const m of maps) out.push(`<button type="button" class="town-choice" data-fac="enterMap" data-map="${m.id}" data-say="${esc(L(gm ? "say.enterMap" : "say.enterMapPL", { name: m.name }))}"><i class="fas fa-map"></i><span>${esc(m.name)}</span></button>`);
        if (gm) out.push(b("random", "fa-dice", L("btn.random")));
        if (!maps.length && !gm) out.push(`<p class="notes">${esc(L("noMaps"))}</p>`);
        break;
      }
      default: break;
    }
    if (f.sceneId && game.scenes.get(f.sceneId)) out.push(b("scene", "fa-eye", gm ? L("btn.sceneGM") : L("btn.scene")));
    return out.join("");
  }

  editorHtml() {
    const d = this.draft;
    const scenes = game.scenes.contents.filter((s) => !s.getFlag("nssq", "battlePreset") && !s.getFlag("nssq", "battleCopy"));
    const rows = d.facilities.map((f, i) => `<fieldset class="town-fac-edit"><legend><i class="fas ${ICONS[f.type]}"></i> ${esc(f.name)}
        <a data-row-up="${i}" title="${esc(L("up"))}"><i class="fas fa-arrow-up"></i></a> <a data-row-del="${i}" title="${esc(L("del"))}"><i class="fas fa-trash"></i></a></legend>
      <div class="form-group"><label>${esc(L("f.type"))}</label><select data-ff="${i}.type">${FACILITY_TYPES.map((x) => opt(x, f.type, L(`type.${x}`))).join("")}</select></div>
      <div class="form-group"><label>${esc(L("f.name"))}</label><input type="text" data-ff="${i}.name" value="${esc(f.name)}"/></div>
      <div class="form-group"><label>${esc(L("f.img"))}</label><input type="text" data-ff="${i}.img" value="${esc(f.img)}"/><button type="button" data-pick="${i}" class="icon"><i class="fas fa-file-import"></i></button></div>
      <div class="form-group"><label>${esc(L("f.npc"))}</label><input type="text" data-ff="${i}.npc" value="${esc(f.npc ?? "")}"/><button type="button" data-pick="${i}.npc" class="icon"><i class="fas fa-file-import"></i></button></div>
      <div class="form-group"><label>${esc(L("f.npcName"))}</label><input type="text" data-ff="${i}.npcName" value="${esc(f.npcName ?? "")}"/></div>
      <div class="form-group"><label>${esc(L("f.scene"))}</label><select data-ff="${i}.sceneId">${opt("", f.sceneId, L("noScene"))}${scenes.map((s) => opt(s.id, f.sceneId, s.name)).join("")}</select><button type="button" data-mkscene="${i}" class="icon" title="${esc(L("makeScene"))}"><i class="fas fa-plus"></i></button></div>
      <div class="form-group"><label>${esc(L("f.desc"))}</label><input type="text" data-ff="${i}.desc" value="${esc(f.desc)}"/></div></fieldset>`).join("");
    return `<div class="town-wrap town-edit">
      <div class="town-bar"><button type="button" data-town="back"><i class="fas fa-arrow-left"></i> ${esc(L("back"))}</button><span class="spacer"></span>
        <button type="button" data-town="delete" class="danger"><i class="fas fa-trash"></i> ${esc(L("delete"))}</button>
        <button type="button" data-town="save" class="go"><i class="fas fa-save"></i> ${esc(L("save"))}</button></div>
      <div class="form-group"><label>${esc(L("f.townName"))}</label><input type="text" data-tf="name" value="${esc(d.name)}"/></div>
      <div class="form-group"><label>${esc(L("f.img"))}</label><input type="text" data-tf="img" value="${esc(d.img)}"/><button type="button" data-pick="town" class="icon"><i class="fas fa-file-import"></i></button></div>
      <div class="form-group"><label>${esc(L("f.desc"))}</label><input type="text" data-tf="desc" value="${esc(d.desc)}"/></div>
      <div class="form-group"><label>${esc(L("f.maxRank"))}</label><input type="number" min="0" max="15" data-tf="maxRank" value="${esc(d.maxRank ?? "")}" placeholder="${esc(L("f.maxRankHint"))}"/></div>
      <p class="notes">${esc(L("shopHint"))}</p>
      <h3>${esc(L("facilities"))} <a data-town="addFac" title="${esc(L("addFac"))}"><i class="fas fa-plus"></i></a></h3>
      <div class="town-fac-list">${rows}</div>
      <p class="notes">${esc(L("editHint"))}</p></div>`;
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html[0];
    root.querySelector("[data-town-pick]")?.addEventListener("change", (ev) => this.pickTown(ev.currentTarget.value));
    root.querySelectorAll("[data-tf]").forEach((el) => el.addEventListener("change", () => { this.draft[el.dataset.tf] = el.value; }));
    root.querySelectorAll("[data-ff]").forEach((el) => el.addEventListener("change", () => {
      const [i, k] = el.dataset.ff.split(".");
      this.draft.facilities[Number(i)][k] = el.value;
      if (k === "type") this.render();
    }));
    root.querySelectorAll("[data-row-del]").forEach((el) => el.addEventListener("click", () => { this.draft.facilities.splice(Number(el.dataset.rowDel), 1); this.render(); }));
    root.querySelectorAll("[data-row-up]").forEach((el) => el.addEventListener("click", () => {
      const i = Number(el.dataset.rowUp);
      if (i > 0) [this.draft.facilities[i - 1], this.draft.facilities[i]] = [this.draft.facilities[i], this.draft.facilities[i - 1]];
      this.render();
    }));
    root.querySelectorAll("[data-pick]").forEach((el) => el.addEventListener("click", () => {
      const [k, field = "img"] = el.dataset.pick.split(".");
      const target = k === "town" ? this.draft : this.draft.facilities[Number(k)];
      new FilePicker({ type: "image", current: target[field], callback: (src) => { target[field] = src; this.render(); } }).render(true);
    }));
    root.querySelectorAll("[data-mkscene]").forEach((el) => el.addEventListener("click", () => this.makeScene(this.draft.facilities[Number(el.dataset.mkscene)])));
    root.querySelectorAll("[data-town]").forEach((el) => el.addEventListener("click", (ev) => { ev.preventDefault(); this.onAct(el.dataset.town); }));
    root.querySelectorAll("[data-fac]").forEach((el) => el.addEventListener("click", () => this.onFacility(el.dataset.fac, el.dataset.fid, el.dataset.map)));
    // 메뉴에 마우스를 올리면 제목 줄에 설명(원작처럼)
    const say = root.querySelector(".town-top .say");
    root.querySelectorAll("[data-say]").forEach((el) => {
      el.addEventListener("mouseenter", () => { if (say) say.textContent = el.dataset.say; });
      el.addEventListener("mouseleave", () => { if (say) say.textContent = say.dataset.sayDefault; });
    });
    root.querySelectorAll("[data-go]").forEach((el) => el.addEventListener("click", () => { this.facId = el.dataset.go; this.render(); }));
  }

  /** 시설 이름으로 씬(모두 시야, 관찰자 권한)을 만들어 연결 */
  async makeScene(f) {
    const folderName = `${L("sceneFolder")}: ${this.draft.name}`;
    const folder = game.folders.find((x) => x.type === "Scene" && x.name === folderName) ?? await Folder.create({ name: folderName, type: "Scene" });
    const scene = await Scene.create({
      name: f.name, folder: folder.id, navigation: false, tokenVision: false, fog: { exploration: false },
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }, ...(f.img ? { background: { src: f.img } } : {})
    });
    if (scene) { f.sceneId = scene.id; ui.notifications.info(L("sceneMade", { name: scene.name })); }
    this.render();
  }

  async onAct(act) {
    const t = this.shownTown();
    switch (act) {
      case "new": { const n = newTown(); await saveTown(n); this.townId = n.id; this.draft = foundry.utils.deepClone(n); return this.render(); }
      case "edit": this.draft = foundry.utils.deepClone(t); return this.render();
      case "back": this.draft = null; return this.render();
      case "leaveFac": this.facId = null; return this.render();
      case "addFac": this.draft.facilities.push({ id: rid(), type: "free", name: L("type.free"), img: "", desc: "", sceneId: "" }); return this.render();
      case "save": {
        if (!String(this.draft.name).trim()) return ui.notifications.warn(L("noName"));
        await saveTown(this.draft);
        if (townSceneOf(this.draft)) await ensureTownScene(this.draft);
        this.draft = null; return this.render();
      }
      case "delete": {
        if (!(await Dialog.confirm({ title: L("delete"), content: `<p>${esc(L("deleteConfirm", { name: this.draft.name }))}</p>`, rejectClose: false }))) return null;
        const all = { ...allTowns() };
        delete all[this.draft.id];
        await game.settings.set("nssq", "towns", all);
        this.draft = null; this.townId = null;
        return this.render();
      }
      case "goHere": return returnToTown(t.id, { reason: L("movedByGM") });
      case "viewScene": { const sc = await ensureTownScene(t); return sc?.view(); }
      case "toMap": return (await import("./fieldmap.mjs")).FieldMapApp.open();
      case "toRandom": return (await import("./dungeon.mjs")).openDungeonDialog();
    }
    return null;
  }

  /** 시설 버튼 */
  async onFacility(act, fid, mapId) {
    const t = this.shownTown();
    const f = t?.facilities.find((x) => x.id === fid);
    const mine = game.user.character ?? game.actors.find((a) => a.type === "character" && a.isOwner && !game.user.isGM) ?? null;
    const pickActor = async () => mine ?? (game.user.isGM ? this.pickPartyActor() : null);
    switch (act) {
      case "sheet": { const a = await pickActor(); return a ? a.sheet.render(true) : ui.notifications.warn(L("noCharacter")); }
      case "tree": { const a = await pickActor(); if (!a) return ui.notifications.warn(L("noCharacter")); return (await import("./skill-tree.mjs")).SkillTree.open(a); }
      case "chargen": return game.nssq.openChargen();
      case "enterMap": return enterMapFromTown(mapId);
      case "random": return (await import("./dungeon.mjs")).openDungeonDialog();
      case "guild": return (await import("./guild.mjs")).GuildApp.open(f?.name ? `${t.name} · ${f.name}` : null);
      case "gmScreen": return game.nssq.openGMScreen();
      case "shop": { const a = await pickActor(); if (!a) return ui.notifications.warn(L("noCharacter")); return game.nssq.openShop(a); }
      case "living": return (await import("./session.mjs")).openLivingCost();
      case "bestiary": return game.nssq.openBestiary();
      case "scene": { const s = game.scenes.get(f?.sceneId); if (!s) return null; return game.user.isGM ? s.activate() : s.view(); }
    }
    return null;
  }

  /** GM: 파티 중 누구로 열지 */
  async pickPartyActor() {
    const party = (await import("./gm-screen.mjs")).partyActors();
    if (party.length <= 1) return party[0] ?? null;
    return Dialog.prompt({
      title: L("pickActor"), content: `<form><select name="a">${party.map((a) => opt(a.id, "", a.name)).join("")}</select></form>`,
      label: L("ok"), rejectClose: false, callback: (html) => game.actors.get(html[0].querySelector("[name=a]").value)
    });
  }
}

/** 마을 씬 위에 덮는 마을 UI(07 #167, 사용자 결정: 씬에 박는다, 시설은 각자 따로 본다) */
export class TownOverlay extends TownApp {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, { id: `nssq-town-overlay-${rid()}`, popOut: false, resizable: false });
  }

  shownTown() { return allTowns()[this.townId] ?? null; }

  /** GM이 다른 마을을 고르면 그 마을 씬으로 */
  async pickTown(id) { const sc = await ensureTownScene(allTowns()[id]); return sc?.view(); }

  async _renderInner(data) {
    this.draft = null;
    const inner = await super._renderInner(data);
    const r = canvas.dimensions.sceneRect;
    const root = $(`<section id="${this.id}" class="nssq nssq-town town-overlay"></section>`).css({ left: r.x, top: r.y, width: r.width, height: r.height });
    const frame = $(`<div class="town-frame"></div>`).css({ width: DESIGN.w, height: DESIGN.h, transform: `scale(${r.width / DESIGN.w})` }).append(inner);
    // 마을 위에서는 휠로 확대하지 않는다
    root[0].addEventListener("wheel", (ev) => ev.stopPropagation());
    return root.append(frame);
  }

  _injectHTML(html) {
    document.getElementById("hud")?.append(html[0]);
    this._element = html;
  }

  /** 편집은 창에서 */
  async onAct(act) {
    if (act === "edit" || act === "new") { await TownApp.open(this.townId); return app.onAct(act); }
    return super.onAct(act);
  }
}

export function registerTown() {
  Hooks.on("canvasReady", () => syncOverlay());
  // 접속 직후에는 캔버스를 그린 뒤 #hud를 다시 그려 덮은 UI가 지워진다 → ready·HUD 렌더 때 다시 붙인다
  Hooks.once("ready", () => setTimeout(syncOverlay, 0));
  Hooks.on("renderHeadsUpDisplay", () => { if (overlay && !document.body.contains(overlay.element?.[0])) setTimeout(syncOverlay, 0); });
  Hooks.on("canvasPan", () => { if (!fitting && overlay) { clearTimeout(registerTown.t); registerTown.t = setTimeout(fitTownView, 400); } });
  Hooks.on("collapseSidebar", () => setTimeout(fitTownView, 300));
  window.addEventListener("resize", () => { clearTimeout(registerTown.r); registerTown.r = setTimeout(fitTownView, 200); });
  Hooks.on("updateScene", (sc, ch) => { if (sc.id === canvas.scene?.id && ("flags" in ch)) syncOverlay(); });
  // 파티 HP·TP 표시를 따라 바꾼다
  Hooks.on("updateActor", (a) => { if (overlay?.rendered && a.type === "character") { clearTimeout(registerTown.u); registerTown.u = setTimeout(() => overlay?.render(), 200); } });
  import("../socket.mjs").then(({ onSocket }) => { onSocket("townReturn", onReturnRequest); onSocket("townGate", onGateRequest); });
  game.settings.register("nssq", "towns", { scope: "world", config: false, type: Object, default: {}, onChange: () => TownApp.refresh() });
  game.settings.register("nssq", "location", {
    scope: "world", config: false, type: Object, default: {},
    // 마을에 도착하면 모두에게 마을 창
    // 마을 씬이 있으면 씬(GM이 띄움)이 마을 화면이고, 없으면 창으로
    onChange: (v) => {
      if (v?.kind === "town") { if (!townSceneOf(allTowns()[v.townId])) TownApp.open(v.townId); else if (app?.rendered) app.close(); }
      else if (app?.rendered) app.close();
    }
  });
  // 파티가 마을에 있을 때 접속한 플레이어에게도 마을 화면(전투 중이면 열지 않음)
  Hooks.once("ready", () => { if (!game.user.isGM && location().kind === "town" && !game.combat?.started && !townSceneOf(currentTown())) TownApp.open(location().townId); });
}
