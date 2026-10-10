/**
 * 미궁 씬(사용자 결정): 필드 지도 진행 중에는 모두가 미궁 씬을 보고, 씬 위 메뉴로 탐색한다.
 * - 미궁마다 1920×1080 씬(플래그 nssq.fieldMap = 지도 id). 진입하면 활성화. 배경은 지금 에어리어 그림(메뉴 레이어가 그린다)
 * - 메뉴: 이동(투표 제안)·조사·채집·캠프·지도 작성 판정·지도 보기·(입구에서) 마을로 돌아간다
 *   플레이어가 누르면 GM에게 제안(GM이 확인하면 실행), GM이 누르면 바로 실행
 * - 이벤트 잠금: GM이 처리하지 않은 트리거·F.O.E. 카드가 있으면(fieldMapState.events) 플레이어 메뉴를 가린다
 * - 지도 창은 플레이어에게 보기 전용(지도로 조작하는 것은 GM)
 */
import * as FM from "../engine/fieldmap.mjs";
import { emit, onSocket } from "../socket.mjs";
import { isActiveGM } from "../combat/apply.mjs";
import { activeMap, answerProposal, campHere, gatherHere, mapState, moveTo, requestMove, search } from "./fieldmap.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.FieldScene.${k}`, d) : game.i18n.localize(`NSSQ.FieldScene.${k}`));
const LF = (k, d) => (d ? game.i18n.format(`NSSQ.FieldMap.${k}`, d) : game.i18n.localize(`NSSQ.FieldMap.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const url = (p) => (/%[0-9A-F]{2}/i.test(p ?? "") ? p : encodeURI(p ?? ""));
const DESIGN_W = 1280;
const ACTS = { search: "fa-search", gather: "fa-leaf", camp: "fa-campground", mapping: "fa-map-marked-alt" };
const areaOf = (map, id) => map?.areas?.find((a) => a.id === id) ?? null;
const areaImg = (a) => a?.img || a?.sceneImg || "";

/* ---------------- 씬 ---------------- */

export const fieldSceneOf = (map) => (map ? game.scenes.find((s) => s.getFlag("nssq", "fieldMap") === map.id) ?? null : null);

export async function ensureFieldScene(map) {
  if (!game.user.isGM || !map) return null;
  const s = fieldSceneOf(map);
  if (s) { if (s.name !== map.name) await s.update({ name: map.name }); return s; }
  const folderName = L("folder");
  const folder = game.folders.find((x) => x.type === "Scene" && x.name === folderName) ?? await Folder.create({ name: folderName, type: "Scene" });
  const start = areaOf(map, map.start);
  return Scene.create({
    name: map.name, folder: folder.id, navigation: true, width: 1920, height: 1080, padding: 0, backgroundColor: "#000000",
    grid: { type: CONST.GRID_TYPES.GRIDLESS }, background: { src: areaImg(start) || map.battleBg || null }, tokenVision: false, fog: { exploration: false },
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }, flags: { nssq: { fieldMap: map.id } }
  });
}

/** 진행 시작·재개 때(startProgress): 미궁 씬을 만들어 활성화 */
export async function activateFieldScene(map) {
  if (openEvents().length) await game.settings.set("nssq", "fieldEvents", []);
  const sc = await ensureFieldScene(map);
  if (sc && !sc.active) await sc.activate();
  return sc;
}

/** 지금 보는 씬이 진행 중인 지도의 미궁 씬(또는 에어리어에 연결한 씬)인가 */
function shownMap() {
  if (!canvas.ready || !canvas.scene) return null;
  const map = activeMap();
  if (!map) return null;
  if (canvas.scene.getFlag("nssq", "fieldMap") === map.id) return map;
  return (map.areas ?? []).some((a) => a.sceneId && a.sceneId === canvas.scene.id) ? map : null;
}

let fitting = false;
function fitView() {
  if (!overlay || !canvas.ready) return;
  const r = canvas.dimensions.sceneRect;
  const side = ui.sidebar?._collapsed ? 40 : (ui.sidebar?.element?.[0]?.offsetWidth ?? 300) + 16;
  const box = (id) => document.getElementById(id)?.getBoundingClientRect();
  const area = {
    l: Math.max(70, (box("controls")?.right ?? 60) + 8), t: Math.max(46, (box("navigation")?.bottom ?? 40) + 6),
    r: window.innerWidth - side, b: Math.min(window.innerHeight - 66, (box("hotbar")?.top ?? window.innerHeight - 66) - 6)
  };
  const scale = Math.min((area.r - area.l) / r.width, (area.b - area.t) / r.height);
  fitting = true;
  canvas.pan({
    x: r.x + r.width / 2 - ((area.l + area.r) / 2 - window.innerWidth / 2) / scale,
    y: r.y + r.height / 2 - ((area.t + area.b) / 2 - window.innerHeight / 2) / scale, scale
  });
  fitting = false;
}

/* ---------------- 메뉴 레이어 ---------------- */

let overlay = null;
let gen = 0;
/** 메뉴 레이어를 다시 붙인다. 렌더가 비동기라 늦게 끝난 옛 레이어가 붙지 않게 세대 번호로 거른다 */
function sync() {
  gen += 1;
  document.querySelectorAll(".field-overlay").forEach((e) => e.remove());
  overlay = null;
  if (!shownMap()) return;
  const o = new FieldOverlay();
  o.gen = gen;
  overlay = o;
  o.render(true);
  fitView();
}
/** 다시 그리기. 렌더 중이면 끝난 뒤 한 번 더(그 사이의 변경을 놓치지 않게) */
const refresh = () => {
  if (!overlay) { if (shownMap()) sync(); return; }
  if (overlay._state === Application.RENDER_STATES.RENDERING) overlay.dirty = true;
  else overlay.render();
};
const openEvents = () => game.settings.get("nssq", "fieldEvents") ?? [];

export class FieldOverlay extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, { id: `nssq-field-overlay-${foundry.utils.randomID()}`, popOut: false });
  }

  async _renderInner() {
    const map = activeMap();
    const st = mapState();
    const r = canvas.dimensions.sceneRect;
    const scale = r.width / DESIGN_W;
    const root = $(`<section id="${this.id}" class="nssq nssq-town town-overlay field-overlay"></section>`).css({ left: r.x, top: r.y, width: r.width, height: r.height });
    const frame = $(`<div class="town-frame"></div>`).css({ width: DESIGN_W, height: r.height / scale, transform: `scale(${scale})` });
    root[0].addEventListener("wheel", (ev) => ev.stopPropagation());
    if (!map) return root.append(frame);
    const v = FM.playerView(map, st);
    const here = areaOf(map, v.current);
    const gm = game.user.isGM;
    const locked = openEvents().length > 0;
    const foeHere = v.foes.some((f) => f.area === v.current);
    const foeNear = v.foes.some((f) => f.area !== v.current && v.reachable.includes(f.area));
    const hour = Number.isFinite(st.hour) ? st.hour : null;
    const clock = hour === null ? "" : `<div class="clock"><span class="ampm">${esc(game.i18n.localize(`NSSQ.Town.${hour % 24 < 12 ? "am" : "pm"}`))}</span><b>${String(hour % 12 === 0 && hour % 24 >= 12 ? 12 : hour % 12).padStart(2, "0")}</b></div>`;
    const top = `<header class="town-top">${clock}<div class="headline"><b class="place">${esc(here?.name ?? "")}</b>
      <span class="say" data-say-default="${esc(here?.terrain ?? "")}">${esc(here?.terrain ?? "")}</span></div>
      <div class="money"><small>${esc(map.name)}</small></div></header>`;
    const warn = foeHere ? `<div class="fs-warn danger"><i class="fas fa-skull"></i> ${esc(LF("foeHere"))}</div>` : foeNear ? `<div class="fs-warn"><i class="fas fa-exclamation-triangle"></i> ${esc(L("foeNear"))}</div>` : "";
    const menu = locked && !gm ? `<div class="fs-locked"><i class="fas fa-hourglass-half"></i> ${esc(L("eventWait"))}</div>` : this.menuHtml(map, st, v);
    const stage = `<div class="town-stage facility" ${areaImg(here) || map.battleBg ? `style="background-image:url('${url(areaImg(here) || map.battleBg)}')"` : ""}>
      ${top}${warn}<nav class="town-menu">${menu}</nav>${gm && locked ? `<div class="fs-gmnote"><i class="fas fa-bolt"></i> ${esc(L("eventGm", { n: openEvents().length }))}</div>` : ""}
      ${await this.partyHtml()}</div>`;
    frame.append(stage);
    return root.append(frame);
  }

  menuHtml(map, st, v) {
    const gm = game.user.isGM;
    const btn = (attrs, icon, label, say) => `<button type="button" class="town-choice" ${attrs} data-say="${esc(say ?? "")}"><i class="fas ${icon}"></i><span>${esc(label)}</span></button>`;
    // 이동 제안이 걸려 있으면 투표
    const p = st.proposal;
    if (p) {
      const me = game.user.id;
      const dest = (st.visited?.[p.to] ?? 0) > 0 ? areaOf(map, p.to)?.name : LF("unknownArea");
      const rows = (p.voters ?? []).map((u) => {
        const a = p.answers?.[u];
        const name = u === "gm" ? LF("gmVoter") : game.users.get(u)?.name ?? "?";
        return `<li class="${a === true ? "yes" : a === false ? "no" : "wait"}"><i class="fas ${a === true ? "fa-check" : a === false ? "fa-times" : "fa-hourglass-half"}"></i> ${esc(name)}</li>`;
      }).join("");
      const voteKey = gm ? "gm" : me;
      const mine = (p.voters ?? []).includes(voteKey) && p.answers?.[voteKey] === undefined;
      return `<div class="fs-vote"><p><b>${esc(game.users.get(p.by)?.name ?? "")}</b>: ${esc(LF("proposalTo", { name: dest }))}</p><ul>${rows}</ul></div>
        ${mine ? btn('data-fs="yes"', "fa-check", LF("accept")) + btn('data-fs="no"', "fa-times", LF("decline")) : ""}
        ${p.by === me ? btn('data-fs="cancel"', "fa-ban", LF("cancelProposal")) : ""}`;
    }
    if (this.picking) {
      const dests = v.reachable.map((id) => {
        const a = areaOf(map, id);
        const known = (st.visited?.[id] ?? 0) > 0;
        const foe = v.foes.some((f) => f.area === id);
        return btn(`data-fs-dest="${id}"`, foe ? "fa-skull" : "fa-shoe-prints", known ? a.name : LF("unknownArea"), `${a?.terrain ?? ""}${foe ? ` · ${LF("foeSign")}` : ""}`);
      }).join("");
      return (dests || `<p class="notes">${esc(LF("noDest"))}</p>`) + btn('data-fs="back"', "fa-arrow-left", LF("back"));
    }
    const out = [btn(`data-fs="move" ${v.reachable.length ? "" : "disabled"}`, "fa-shoe-prints", L("move"), L("say.move"))];
    for (const [act, icon] of Object.entries(ACTS)) out.push(btn(`data-fs-act="${act}"`, icon, L(`act.${act}`), L(gm ? `say.${act}` : "say.propose", { act: L(`act.${act}`) })));
    out.push(btn('data-fs="party"', "fa-users", L("party"), L("say.party")));
    out.push(btn('data-fs="map"', "fa-map", L("map"), L(gm ? "say.mapGM" : "say.map")));
    if (v.current === map.start) out.push(btn('data-fs="town"', "fa-home", LF(gm ? "toTown" : "toTownPropose"), L("say.town")));
    if (gm) out.push(btn('data-fs="gmScreen"', "fa-user-shield", game.i18n.localize("NSSQ.Town.gmScreen"), ""));
    return out.join("");
  }

  /** 파티 줄(미궁에서는 HP·TP가 중요) */
  async partyHtml() {
    const party = await (await import("./roster.mjs")).rosterMembers();
    let hidden = false;
    try { hidden = localStorage.getItem("nssq.townPartyHidden") === "1"; } catch { /* 저장 못 함 */ }
    const bar = (v, m, cls) => `<span class="bar ${cls}"><i style="width:${m ? Math.round((100 * Math.max(0, v)) / m) : 0}%"></i></span>`;
    const cards = party.map((a) => {
      const { hp, tp, bad } = a;
      return `<div class="pc ${game.user.isGM || a.owners.includes(game.user.id) ? "mine" : ""} ${(hp?.value ?? 0) <= 0 ? "down" : ""}" data-pc="${a.id}" title="${esc(a.name)}">
        <img src="${esc(a.img)}" alt=""/>
        <div class="pc-info"><b>${esc(a.name)}${bad ? ` <i class="fas fa-exclamation-circle bad"></i>` : ""}</b>
          <span class="pc-hp">HP ${hp?.value ?? 0}/${hp?.max ?? 0} · TP ${tp?.value ?? 0}/${tp?.max ?? 0}</span>
          <span class="bars">${bar(hp?.value ?? 0, hp?.max ?? 0, "hp")}${bar(tp?.value ?? 0, tp?.max ?? 0, "tp")}</span></div></div>`;
    }).join("");
    return `<footer class="town-party ${hidden ? "folded" : ""}">
      <button type="button" class="pc-fold" data-fs="fold"><i class="fas fa-chevron-${hidden ? "up" : "down"}"></i> ${esc(game.i18n.format("NSSQ.Town.party", { n: party.length }))}</button>
      <div class="pc-row">${cards}</div></footer>`;
  }

  async _render(...args) {
    await super._render(...args);
    if (this.dirty && this.gen === gen) { this.dirty = false; this.render(); }
  }

  _injectHTML(html) {
    if (this.gen !== gen) return;
    document.getElementById("hud")?.append(html[0]);
    this._element = html;
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html[0];
    const say = root.querySelector(".town-top .say");
    root.querySelectorAll("[data-say]").forEach((el) => {
      el.addEventListener("mouseenter", () => { if (say && el.dataset.say) say.textContent = el.dataset.say; });
      el.addEventListener("mouseleave", () => { if (say) say.textContent = say.dataset.sayDefault; });
    });
    root.querySelectorAll("[data-fs]").forEach((el) => el.addEventListener("click", () => this.onAct(el.dataset.fs)));
    root.querySelectorAll("[data-fs-dest]").forEach((el) => el.addEventListener("click", () => {
      this.picking = false;
      return game.user.isGM ? moveTo(el.dataset.fsDest) : requestMove(el.dataset.fsDest);
    }));
    root.querySelectorAll("[data-fs-act]").forEach((el) => el.addEventListener("click", () => doAct(el.dataset.fsAct)));
    root.querySelectorAll("[data-pc]").forEach((el) => el.addEventListener("click", () => { const a = game.actors.get(el.dataset.pc); if (a?.isOwner) a.sheet.render(true); }));
  }

  async onAct(act) {
    switch (act) {
      case "move": this.picking = true; return this.render();
      case "back": this.picking = false; return this.render();
      case "yes": return answerProposal(true);
      case "no": return answerProposal(false);
      case "cancel": return answerProposal(false, { cancel: true });
      case "map": return (await import("./fieldmap.mjs")).FieldMapApp.open();
      case "party": return (await import("./party-board.mjs")).PartyBoard.open();
      case "gmScreen": return game.nssq.openGMScreen();
      case "town": {
        const T = await import("./town.mjs");
        return game.user.isGM ? T.returnToTown(null, { reason: LF("toTownReason") }) : T.requestReturnToTown();
      }
      case "fold":
        try { localStorage.setItem("nssq.townPartyHidden", localStorage.getItem("nssq.townPartyHidden") === "1" ? "0" : "1"); } catch { /* 저장 못 함 */ }
        return this.render();
    }
    return null;
  }
}

/* ---------------- 탐색 행동: GM은 바로, 플레이어는 제안 ---------------- */

async function runAct(act) {
  switch (act) {
    case "search": return search();
    case "gather": return gatherHere();
    case "camp": return campHere();
    case "mapping": return (await import("./check-request.mjs")).openRequestDialog([], { ability: "tec", kinds: ["mapping"], note: LF("mapping"), tag: "fieldMapping" });
  }
  return null;
}

function doAct(act) {
  if (game.user.isGM) return runAct(act);
  if (!game.users.activeGM) return ui.notifications.warn(L("noGM"));
  emit("fieldAct", { userId: game.user.id, act });
  return ui.notifications.info(L("proposed", { act: L(`act.${act}`) }));
}

async function onActProposal({ userId, act }) {
  if (!isActiveGM() || !ACTS[act] || !activeMap()) return;
  const who = game.users.get(userId)?.name ?? "?";
  const ok = await Dialog.confirm({ title: L("actTitle"), content: `<p>${esc(L("actAsk", { who, act: L(`act.${act}`) }))}</p>`, rejectClose: false });
  if (ok) await runAct(act);
  else await ChatMessage.create({ speaker: { alias: LF("title") }, content: `<p>${esc(L("actRejected", { who, act: L(`act.${act}`) }))}</p>` });
}

/* ---------------- 이벤트 잠금(활성 GM이 기록) ---------------- */

const EVENT_KINDS = ["trigger", "foe"];
async function trackEvent(message, removed = false) {
  if (!isActiveGM()) return;
  const d = message.getFlag("nssq", "fieldEvent");
  if (!d || !EVENT_KINDS.includes(d.kind)) return;
  if (!mapState().active && !removed) return;
  const events = new Set(openEvents());
  const open = !removed && !d.done;
  if (open === events.has(message.id)) return;
  if (open) events.add(message.id); else events.delete(message.id);
  // 지도 진행 상태(fieldMapState)와 따로 둔다(지도 쪽 저장이 덮어쓰지 않게)
  await game.settings.set("nssq", "fieldEvents", [...events]);
}

export function registerFieldScene() {
  game.settings.register("nssq", "fieldEvents", { scope: "world", config: false, type: Array, default: [] });
  onSocket("fieldAct", onActProposal);
  Hooks.on("canvasReady", () => sync());
  Hooks.on("nssqRoster", () => refresh());
  Hooks.once("ready", () => setTimeout(sync, 0));
  Hooks.on("renderHeadsUpDisplay", () => { if (overlay && !document.body.contains(overlay.element?.[0])) setTimeout(sync, 0); });
  Hooks.on("canvasPan", () => { if (!fitting && overlay) { clearTimeout(registerFieldScene.t); registerFieldScene.t = setTimeout(fitView, 400); } });
  Hooks.on("collapseSidebar", () => setTimeout(fitView, 300));
  window.addEventListener("resize", () => { clearTimeout(registerFieldScene.r); registerFieldScene.r = setTimeout(fitView, 200); });
  for (const h of ["createSetting", "updateSetting"]) Hooks.on(h, (s) => {
    if (["nssq.fieldMapState", "nssq.fieldMaps", "nssq.fieldEvents"].includes(s.key)) { if (shownMap()) refresh(); else if (overlay) sync(); }
  });
  Hooks.on("updateActor", (a) => { if (overlay?.rendered && a.type === "character") { clearTimeout(registerFieldScene.u); registerFieldScene.u = setTimeout(refresh, 200); } });
  Hooks.on("createChatMessage", (m) => trackEvent(m));
  Hooks.on("updateChatMessage", (m) => trackEvent(m));
  Hooks.on("deleteChatMessage", (m) => trackEvent(m, true));
}

