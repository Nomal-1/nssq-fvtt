/**
 * 미궁 화면(사용자 결정): 필드 지도 진행 중에는 모두가 미궁 화면을 보고, 화면의 메뉴로 탐색한다.
 * - 씬은 쓰지 않는다(2026-11-16). 화면은 apps/stage.mjs가 연다. 배경은 지금 에어리어 그림
 * - 메뉴: 이동(투표 제안)·조사·채집·캠프·지도 작성 판정·지도 보기·(입구에서) 마을로 돌아간다
 *   플레이어가 누르면 GM에게 제안(GM이 확인하면 실행), GM이 누르면 바로 실행
 * - 이벤트 잠금: GM이 처리하지 않은 트리거·F.O.E. 카드가 있으면(fieldMapState.events) 플레이어 메뉴를 가린다
 * - 나레이션 잠금: 이동해 도착하면 GM이 [플레이어 메뉴 열기]를 누를 때까지(또는 GM이 다음 행동을 할 때까지) 플레이어 메뉴를 가린다(설정 fieldNarrate)
 * - 지도 창은 플레이어에게 보기 전용(지도로 조작하는 것은 GM)
 */
import { STAGE_OPTIONS, placeStage, resetStageHidden, syncStage } from "./stage.mjs";
import { LegacyApp } from "../legacy-app.mjs";
import * as FM from "../engine/fieldmap.mjs";
import { emit, onSocket } from "../socket.mjs";
import { isActiveGM } from "../combat/apply.mjs";
import { activeMap, answerProposal, areaExits, campHere, destLabel, endNarration, gatherHere, mapState, moveTo, requestMove, search } from "./fieldmap.mjs";
import { esc } from "../util.mjs";
import { Dialog } from "../dialogs.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.FieldScene.${k}`, d) : game.i18n.localize(`NSSQ.FieldScene.${k}`));
const LF = (k, d) => (d ? game.i18n.format(`NSSQ.FieldMap.${k}`, d) : game.i18n.localize(`NSSQ.FieldMap.${k}`));
const url = (p) => (/%[0-9A-F]{2}/i.test(p ?? "") ? p : encodeURI(p ?? ""));
const ACTS = { search: "fa-search", gather: "fa-leaf", camp: "fa-campground", mapping: "fa-map-marked-alt" };
const areaOf = (map, id) => map?.areas?.find((a) => a.id === id) ?? null;
const areaImg = (a) => a?.img || a?.sceneImg || "";

/* ---------------- 진입 ---------------- */

/** 진행 시작·재개 때(startProgress): 처리 못 한 이벤트·나레이션을 비우고, 걷어 둔 화면을 되돌린다(화면은 stage.mjs가 연다) */
export async function activateFieldScene() {
  if (openEvents().length) await game.settings.set("nssq", "fieldEvents", []);
  await endNarration();
  await resetStageHidden();
  return syncStage();
}

/* ---------------- 미궁 화면 ---------------- */

const openEvents = () => game.settings.get("nssq", "fieldEvents") ?? [];
/** F.O.E. 그림(토큰 → 액터 그림). 컴펜디움 문서를 매번 읽지 않게 기억 */
const foeArt = new Map();
async function foeImg(uuid) {
  if (!uuid) return "";
  if (!foeArt.has(uuid)) foeArt.set(uuid, fromUuid(uuid).then((a) => a?.prototypeToken?.texture?.src || a?.img || "").catch(() => ""));
  return foeArt.get(uuid);
}
/** 이 에어리어의 나레이션 글: 다시 왔을 때 글이 있으면 그것, 없으면 첫 방문 글 */
const narrationOf = (area, st) => String(((st.visited?.[area?.id] ?? 0) > 1 && area?.narrationAgain?.trim()) || area?.narration || "").trim();
async function postNarration() {
  const map = activeMap();
  const st = mapState();
  const here = areaOf(map, st.current);
  const text = narrationOf(here, st);
  if (!text) return null;
  return ChatMessage.create({ speaker: { alias: here?.name ?? map?.name ?? "" }, content: `<div class="nssq-fieldmap-card fs-narration-card"><p>${esc(text).replace(/\n/g, "<br>")}</p></div>` });
}

export class FieldStage extends LegacyApp {
  static DEFAULT_OPTIONS = STAGE_OPTIONS;

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, { id: "nssq-field-stage", classes: ["nssq", "nssq-town", "town-overlay", "field-overlay", "nssq-stage"] });
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    placeStage(this.element);
  }

  async _renderInner() {
    const map = activeMap();
    const st = mapState();
    const frame = $(`<div class="town-frame"></div>`);
    if (!map) return frame;
    const v = FM.playerView(map, st);
    const here = areaOf(map, v.current);
    const gm = game.user.isGM;
    const locked = openEvents().length > 0;
    const narrating = !!game.settings.get("nssq", "fieldNarration");
    const foeHere = v.foes.some((f) => f.area === v.current);
    const foeNear = v.foes.some((f) => f.area !== v.current && v.reachable.includes(f.area));
    const hour = Number.isFinite(st.hour) ? st.hour : null;
    const clock = hour === null ? "" : `<div class="clock"><span class="ampm">${esc(game.i18n.localize(`NSSQ.Town.${hour % 24 < 12 ? "am" : "pm"}`))}</span><b>${String(hour % 12 === 0 && hour % 24 >= 12 ? 12 : hour % 12).padStart(2, "0")}</b></div>`;
    const top = `<header class="town-top">${clock}<div class="headline"><b class="place">${esc(here?.name ?? "")}</b>
      <span class="say" data-say-default="${esc(here?.terrain ?? "")}">${esc(here?.terrain ?? "")}</span></div>
      <div class="money"><small>${esc(map.name)}</small></div></header>`;
    const warn = foeHere ? `<div class="fs-warn danger"><i class="fas fa-skull"></i> ${esc(LF("foeHere"))}</div>` : foeNear ? `<div class="fs-warn"><i class="fas fa-exclamation-triangle"></i> ${esc(L("foeNear"))}</div>` : "";
    // F.O.E. 토큰: 같은 에어리어에 있을 때만 가운데에 크게(이웃은 경고 문구만)
    const foeToken = async (f) => {
      const img = await foeImg(f.actorUuid);
      return `<div class="fs-foe here" title="${esc(f.name)}">${img ? `<img src="${url(img)}" alt=""/>` : `<i class="fas fa-skull"></i>`}<span><b>${esc(f.name)}</b></span></div>`;
    };
    const foesHere = (await Promise.all(v.foes.filter((f) => f.area === v.current).map(foeToken))).join("");
    const foeLayer = foesHere ? `<div class="fs-foes-here">${foesHere}</div>` : "";
    const menu = gm ? `${narrating ? `<button type="button" class="town-choice fs-release" data-fs="release" data-say="${esc(L("say.release"))}"><i class="fas fa-play"></i><span>${esc(L("release"))}</span></button>` : ""}${this.menuHtml(map, st, v)}`
      : locked ? `<div class="fs-locked"><i class="fas fa-hourglass-half"></i> ${esc(L("eventWait"))}</div>`
        : narrating ? `<div class="fs-locked"><i class="fas fa-feather-alt"></i> ${esc(L("narrationWait"))}</div>` : this.menuHtml(map, st, v);
    const stage = `<div class="town-stage facility" ${areaImg(here) || map.battleBg ? `style="background-image:url('${url(areaImg(here) || map.battleBg)}')"` : ""}>
      ${top}${warn}${foeLayer}<nav class="town-menu">${menu}</nav>${gm && locked ? `<div class="fs-gmnote"><i class="fas fa-bolt"></i> ${esc(L("eventGm", { n: openEvents().length }))}</div>` : gm && narrating ? this.narrationHtml(here, st) : ""}
      ${await this.partyHtml()}</div>`;
    frame.append(stage);
    return frame;
  }

  /** GM 나레이션 칸: 에어리어에 미리 써 둔 글(첫 방문 / 다시 왔을 때)을 GM만 보고, [채팅으로 읽기]로 모두에게 보낸다 */
  narrationHtml(here, st) {
    const text = narrationOf(here, st);
    return `<div class="fs-gmnote fs-narration"><p><i class="fas fa-feather-alt"></i> ${esc(L("narrationGm"))}</p>
      ${text ? `<blockquote>${esc(text).replace(/\n/g, "<br>")}</blockquote><button type="button" data-fs="narrate"><i class="fas fa-comment-dots"></i> ${esc(L("narrate"))}</button>` : `<p class="notes">${esc(L("narrationNone"))}</p>`}</div>`;
  }

  menuHtml(map, st, v) {
    const gm = game.user.isGM;
    const btn = (attrs, icon, label, say) => `<button type="button" class="town-choice" ${attrs} data-say="${esc(say ?? "")}"><i class="fas ${icon}"></i><span>${esc(label)}</span></button>`;
    // 이동 제안이 걸려 있으면 투표
    const p = st.proposal;
    if (p) {
      const me = game.user.id;
      const dest = destLabel(map, st, p.to);
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
      // 다른 지도로 가는 길(에어리어 exits)
      const exits = areaExits(map, v.current).map((x) => btn(`data-fs-dest="${x.id}"`, "fa-route", destLabel(map, st, x.id), x.target.name)).join("");
      return (dests || exits ? dests + exits : `<p class="notes">${esc(LF("noDest"))}</p>`) + btn('data-fs="back"', "fa-arrow-left", LF("back"));
    }
    const out = [btn(`data-fs="move" ${v.reachable.length || areaExits(map, v.current).length ? "" : "disabled"}`, "fa-shoe-prints", L("move"), L("say.move"))];
    // 이 에어리어에서 할 수 있는 행동만(지도 편집 「할 수 있는 행동」, GM은 GM 스크린에서 언제나)
    const can = FM.areaActs(areaOf(map, v.current));
    for (const [act, icon] of Object.entries(ACTS).filter(([k]) => can[k])) out.push(btn(`data-fs-act="${act}"`, icon, L(`act.${act}`), L(gm ? `say.${act}` : "say.propose", { act: L(`act.${act}`) })));
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
      return `<div class="pc ${game.user.isGM || a.owners.includes(game.user.id) ? "mine" : ""} ${(hp?.value ?? 0) <= 0 ? "down" : ""} ${a.online === false ? "offline" : ""}" data-pc="${a.id}" title="${esc(a.name)}">
        <img src="${esc(a.img)}" alt=""/>
        <div class="pc-info"><b>${esc(a.name)}${bad ? ` <i class="fas fa-exclamation-circle bad"></i>` : ""}</b>
          <span class="pc-hp">HP ${hp?.value ?? 0}/${hp?.max ?? 0} · TP ${tp?.value ?? 0}/${tp?.max ?? 0}</span>
          <span class="bars">${bar(hp?.value ?? 0, hp?.max ?? 0, "hp")}${bar(tp?.value ?? 0, tp?.max ?? 0, "tp")}</span></div></div>`;
    }).join("");
    return `<footer class="town-party ${hidden ? "folded" : ""}">
      <button type="button" class="pc-fold" data-fs="fold"><i class="fas fa-chevron-${hidden ? "up" : "down"}"></i> ${esc(game.i18n.format("NSSQ.Town.party", { n: party.length }))}</button>
      <div class="pc-row">${cards}</div></footer>`;
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
      case "release": return endNarration();
      case "narrate": return postNarration();
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
  if (!FM.areaActs(areaOf(activeMap(), mapState().current))[act]) return;
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
  Hooks.on("createChatMessage", (m) => trackEvent(m));
  Hooks.on("updateChatMessage", (m) => trackEvent(m));
  Hooks.on("deleteChatMessage", (m) => trackEvent(m, true));
}

