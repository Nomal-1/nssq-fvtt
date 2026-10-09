/**
 * 필드 지도(베이직 던전, 단계 9.5). 규칙·계산은 engine/fieldmap.mjs
 * - 월드 설정 fieldMaps: 지도 정의 { [id]: map }, fieldMapState: 진행 상태(활성 지도 하나, 되돌리기 1단계 prev)
 * - 지도 창(사용자마다 따로 여닫음: 토큰 도구 「지도」·단축키 M·GM 스크린)
 *   플레이어: 탐색한 에어리어·현재 위치·지금 갈 수 있는 곳·이론상 갈 수 있는 곳(밟은 에어리어의 인접)·보이는 F.O.E.
 *   GM: [진행] 전체 보기(비밀 포함)·이동·조사·채집·캠프·선택지 / [편집] 핀(에어리어)·선(통로)·트리거·F.O.E. 루트
 * - 이동: 플레이어가 [이동 제안] → 목적지를 고르면 투표(설정 fieldMapMove: all 참여 플레이어 전원+GM / gm GM만 / free 바로 이동). 한 명이라도 거절하면 취소, 모두 승낙하면 이동
 * - 에어리어에 씬을 연결하면 그 씬 배경이 지도 메달·카드 그림이 된다(지도 옵션: 도착하면 그 씬으로 전환)
 * - 트리거: GM 카드 [실행]/[건너뛰기](auto면 바로). 선택지 카드: 플레이어 투표 → GM 확정
 * 비밀은 화면에서만 거른다(설정 값은 모든 클라이언트에 전송된다, 07 참조)
 */
import * as FM from "../engine/fieldmap.mjs";
import { timeOfDayAt } from "../engine/dungeon.mjs";
import { GATHER_AMOUNT } from "../engine/loot.mjs";
import { ABILITIES } from "../engine/derive.mjs";
import { CHECK_KINDS } from "../chat/check-mods.mjs";
import { evaluateCheck } from "../engine/check.mjs";
import { isActiveGM } from "../combat/apply.mjs";
import { emit, onSocket } from "../socket.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.FieldMap.${k}`, d) : game.i18n.localize(`NSSQ.FieldMap.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const opt = (v, cur, label) => `<option value="${esc(v)}" ${String(v) === String(cur ?? "") ? "selected" : ""}>${esc(label)}</option>`;
const rid = () => foundry.utils.randomID(8);
const W = 1000;
const H = 700;
const R = 34;
// Font Awesome 글리프(SVG 텍스트)
const G = { lock: "", flag: "", eye: "" };

/* ---------------- 상태 ---------------- */

export const allMaps = () => game.settings.get("nssq", "fieldMaps") ?? {};
export const mapState = () => game.settings.get("nssq", "fieldMapState") ?? {};
/** 엔진에 넘길 상태(되돌리기용 prev 제외) */
const cur = () => { const s = foundry.utils.deepClone(mapState()); delete s.prev; return s; };
export const activeMap = () => { const s = mapState(); return s.active ? allMaps()[s.mapId] ?? null : null; };
const party = async () => (await import("./gm-screen.mjs")).partyActors();
const areaName = (map, id) => map?.areas?.find((a) => a.id === id)?.name ?? "?";
const areaOf = (map, id) => map?.areas?.find((a) => a.id === id) ?? null;
/** 에어리어 그림: 직접 고른 그림 → 연결한 씬의 배경(저장할 때 sceneImg로 복사해 두어 플레이어도 본다) */
const areaImg = (a) => a?.img || a?.sceneImg || "";
const sceneImage = (id) => { const sc = game.scenes.get(id); return sc?.background?.src || sc?.thumb || ""; };
/** 양피지 위 나침반(장식) */
const compass = () => `<g class="fm-compass" transform="translate(${W - 70},${H - 78})"><circle r="38"/><circle r="30"/><path d="M0,-44 L7,-7 L44,0 L7,7 L0,44 L-7,7 L-44,0 L-7,-7 Z"/><path class="n" d="M0,-44 L7,-7 L-7,-7 Z"/><text y="-50">N</text></g>`;
const passageLabel = (map, p) => `${areaName(map, p.a)} ${p.oneWay ? "→" : "↔"} ${areaName(map, p.b)}${p.label ? ` (${p.label})` : ""}`;
const clock = (s) => L("clock", { seg: s.segment ?? 0, h: s.hour ?? 0, tod: game.i18n.localize(`NSSQ.Dungeon.tod.${timeOfDayAt(s.hour ?? 0)}`) });

async function saveMap(map) {
  if (!game.user.isGM) return;
  await game.settings.set("nssq", "fieldMaps", { ...allMaps(), [map.id]: foundry.utils.deepClone(map) });
}

async function setMapState(s, { undo = true } = {}) {
  const before = cur();
  delete before.proposal;
  const prev = undo ? (before.mapId ? before : null) : mapState().prev ?? null;
  await game.settings.set("nssq", "fieldMapState", { ...s, prev });
}

export function newMap(name) {
  return { id: rid(), name: name || L("newMap"), bg: { style: "parchment", src: "" }, start: null, startHour: 8, areas: [], passages: [], foes: [], triggers: [] };
}

/* ---------------- 진행(GM) ---------------- */

/** 시각(낮·밤 설정)과 임페리얼 오버히트(세그먼트당 −1) */
async function passTime(hour, segs) {
  const tod = timeOfDayAt(hour);
  if (tod !== game.settings.get("nssq", "timeOfDay")) await game.settings.set("nssq", "timeOfDay", tod);
  if (segs > 0) await (await import("./dungeon.mjs")).coolOverheat(segs);
}

export async function startProgress(mapId, hour) {
  if (!game.user.isGM) return;
  const map = allMaps()[mapId];
  if (!map) return;
  const { errors } = FM.validateMap(map);
  if (errors.length) return ui.notifications.warn(L("hasErrors", { n: errors.length }));
  const s = FM.startState(map, { hour });
  await setMapState(s, { undo: false });
  await passTime(s.hour, 0);
  await post(`<h3><i class="fas fa-map"></i> ${esc(L("started", { name: map.name }))}</h3>${arrivalHtml(map, s)}`);
  return processTriggers(map, FM.arrivalTriggers(map, s, s.current));
}

export async function endProgress() {
  if (!game.user.isGM) return;
  await setMapState({ ...cur(), active: false }, { undo: false });
  return post(`<h3><i class="fas fa-map"></i> ${esc(L("ended"))}</h3>`);
}

export async function undo() {
  const { prev } = mapState();
  if (!game.user.isGM || !prev) return ui.notifications.warn(L("noUndo"));
  await game.settings.set("nssq", "fieldMapState", { ...prev, prev: null });
  ui.notifications.info(L("undone"));
}

/* 지도 작성 판정(원문 예: 실패하면 1세그먼트가 더 경과): 요청 묶음마다 결과를 모아, 아무도 성공하지 못하면 1세그먼트 */
const mapping = new Map(); // group → { size, results: Map(messageId → { success, final }) }

function trackMapping(message) {
  const req = message.getFlag("nssq", "request");
  const st = message.getFlag("nssq", "check");
  if (req?.tag !== "fieldMapping" || !st || !isActiveGM() || message.getFlag("nssq", "mappingDone")) return;
  const r = evaluateCheck({ ...st, modifier: st.bonus + st.modifier });
  const g = mapping.get(req.group) ?? { size: req.groupSize ?? 1, results: new Map() };
  g.results.set(message.id, { success: r.success === true, final: !!(st.closed || st.rerolled || r.success === true) });
  mapping.set(req.group, g);
  if (g.results.size >= g.size && [...g.results.values()].every((x) => x.final)) settleGroup(req.group);
}

async function settleGroup(group) {
  const g = mapping.get(group);
  if (!g) return;
  mapping.delete(group);
  for (const id of g.results.keys()) await game.messages.get(id)?.setFlag("nssq", "mappingDone", true);
  if ([...g.results.values()].some((x) => x.success)) return post(`<p><i class="fas fa-map-marked-alt"></i> ${esc(L("mappingOk"))}</p>`);
  if (activeMap()) await wait(1, L("mappingFailed"));
}

/** 다음 세그먼트 행동 전에: 결과가 다 모인 묶음은 확정하지 않았어도 그 결과로 처리한다 */
async function settleMappingBeforeStep() {
  for (const [group, g] of [...mapping]) if (g.results.size >= g.size) await settleGroup(group);
}

/** 세그먼트 진행 공통. opts: { to } 이동 / { segments } 그 자리 */
async function step(opts) {
  const map = activeMap();
  if (!map) return null;
  await settleMappingBeforeStep();
  const s0 = cur();
  delete s0.proposal;
  const r = FM.advance(map, s0, opts);
  if (r.error) { ui.notifications.warn(L(r.error)); return null; }
  await setMapState(r.state);
  await passTime(r.state.hour, r.state.segment - s0.segment);
  return { map, ...r };
}

/** 이동(GM). 플레이어는 제안 */
export async function moveTo(to) {
  if (!game.user.isGM) return requestMove(to);
  const r = await step({ to });
  if (!r) return;
  await activateLinked(r.map, to);
  await post(`<h3>${esc(clock(r.state))}</h3>${arrivalHtml(r.map, r.state)}`);
  await handleEncounters(r.map, r.encounters);
  return processTriggers(r.map, r.triggers);
}

/** 지도 옵션 「도착하면 연결된 씬으로」 */
async function activateLinked(map, areaId) {
  if (!map.activateScene) return;
  const scene = game.scenes.get(areaOf(map, areaId)?.sceneId);
  if (scene && !scene.active) await scene.activate();
}

/** 그 자리에서 n세그먼트(채집·조사·캠프·지도 작성 실패 등) */
export async function wait(segments = 1, label = "") {
  const r = await step({ segments });
  if (!r) return null;
  await post(`<h3>${esc(clock(r.state))}</h3><p>${esc(label || L("waited", { n: segments }))}</p>`);
  await handleEncounters(r.map, r.encounters);
  await processTriggers(r.map, r.triggers);
  return r;
}

/** 조사: 1세그먼트 + 그 에어리어의 조사 트리거 */
export async function search() {
  const r = await wait(1, L("searching", { name: areaName(activeMap(), cur().current) }));
  if (!r) return;
  const found = FM.searchTriggers(r.map, cur());
  if (!found.length) return post(`<p>${esc(L("nothingFound"))}</p>`, { gm: true });
  return processTriggers(r.map, found);
}

/** 채집: 1세그먼트 + 채집 창(그 에어리어의 채집 표) */
export async function gatherHere() {
  const map = activeMap();
  const area = areaOf(map, cur().current);
  if (!(await wait(1, L("gathering", { name: area?.name ?? "" })))) return;
  return (await import("./loot.mjs")).openGatherDialog({ table: area?.gather ?? "" });
}

/** 캠프: n세그먼트(기본 6) + 캠프 창 */
export async function campHere() {
  const n = await Dialog.prompt({
    title: L("campTitle"), content: `<form><div class="form-group"><label>${esc(L("campSegments"))}</label><input type="number" name="n" min="1" value="6"/></div></form>`,
    label: L("camp"), rejectClose: false, callback: (html) => Math.max(1, Number(html[0].querySelector("[name=n]").value) || 6)
  });
  if (!n || !(await wait(n, L("camping", { n })))) return;
  return (await import("./explore.mjs")).openCampDialog({ hours: n });
}

/** 시간이 흐르지 않는 이동(트리거·GM) */
export async function teleport(to, depth = 0) {
  const map = activeMap();
  if (!map) return;
  const r = FM.teleport(map, cur(), to);
  await setMapState(r.state);
  await activateLinked(map, to);
  await post(`<h3>${esc(L("moved"))}</h3>${arrivalHtml(map, r.state)}`);
  return processTriggers(map, r.triggers, depth + 1);
}

export async function revealThing({ area, passage }) {
  const map = activeMap();
  if (!map) return;
  await setMapState(FM.reveal(map, cur(), { area, passage }));
  const what = area ? L("revealArea", { name: areaName(map, area) }) : L("revealPassage", { name: passageLabel(map, map.passages.find((p) => p.id === passage) ?? {}) });
  return post(`<p><i class="fas fa-eye"></i> ${esc(what)}</p>`);
}

export async function setPassageState(passage, state, { quiet = false } = {}) {
  const map = activeMap();
  if (!map) return;
  await setMapState(FM.setPassage(cur(), passage, state));
  if (!quiet) return post(`<p><i class="fas fa-${state === "locked" ? "lock" : "lock-open"}"></i> ${esc(L(`passageNow.${state}`, { name: passageLabel(map, map.passages.find((p) => p.id === passage) ?? {}) }))}</p>`);
}

export async function removeFoe(foeId, { restore = false } = {}) {
  const s = cur();
  if (restore) s.foeGone = (s.foeGone ?? []).filter((x) => x !== foeId);
  await setMapState(restore ? s : FM.removeFoe(s, foeId));
}

export async function setFoePos(foeId, area) {
  const s = cur();
  s.foePos = { ...s.foePos, [foeId]: area };
  await setMapState(s);
}

/* ---------------- 카드 ---------------- */

function post(html, { gm = false, flags = {} } = {}) {
  return ChatMessage.create({
    speaker: { alias: L("title") }, content: `<div class="nssq-fieldmap-card">${html}</div>`,
    whisper: gm ? ChatMessage.getWhisperRecipients("GM").map((u) => u.id) : [], flags: { nssq: flags }
  });
}

/** 도착 안내: 지금 에어리어 + 인접 에어리어의 지형 개요·F.O.E. 기척(룰: 도착할 때마다 GM이 알려 주는 것) */
function arrivalHtml(map, s) {
  const v = FM.playerView(map, s);
  const here = areaOf(map, v.current);
  const near = v.passages.filter((p) => p.a === v.current || p.b === v.current).map((p) => {
    const other = p.a === v.current ? p.b : p.a;
    const a = areaOf(map, other);
    const known = (s.visited?.[other] ?? 0) > 0;
    const status = v.reachable.includes(other) ? L("canGo") : p.state === "locked" ? L("ps.locked") : L("oneWayNo");
    const foe = v.foes.filter((f) => f.area === other).map((f) => f.name);
    return `<li><b>${esc(known ? a?.name : L("unknownArea"))}</b> ${a?.terrain ? `— ${esc(a.terrain)}` : ""} <small>(${esc(status)})</small>${foe.length ? ` <span class="fm-foe-warn"><i class="fas fa-skull"></i> ${esc(L("foeSign"))}</span>` : ""}</li>`;
  }).join("");
  const foeHere = v.foes.filter((f) => f.area === v.current).map((f) => f.name);
  const img = areaImg(here);
  return `${img ? `<div class="fm-card-img" style="background-image:url('${esc(img)}')"></div>` : ""}<p class="fm-here"><i class="fas fa-flag"></i> <b>${esc(here?.name ?? "")}</b>${here?.terrain ? ` — ${esc(here.terrain)}` : ""}</p>
    ${foeHere.length ? `<p class="fm-foe-warn"><i class="fas fa-skull"></i> ${esc(L("foeHere"))}</p>` : ""}
    ${near ? `<ul class="fm-near">${near}</ul>` : ""}
    <button type="button" data-fm="open"><i class="fas fa-map"></i> ${esc(L("openMap"))}</button>`;
}

async function handleEncounters(map, list) {
  for (const e of list) {
    await post(`<h3><i class="fas fa-skull"></i> ${esc(L("encounter", { name: e.name }))}</h3><p>${esc(L(e.how === "same" ? "encSame" : "encPassage"))}</p><p class="notes">${esc(L("encHint"))}</p>
      <div class="fm-gm"><button type="button" data-fm="foeBattle"><i class="fas fa-skull-crossbones"></i> ${esc(L("battle"))}</button><button type="button" data-fm="foeAvoid">${esc(L("avoided"))}</button></div>`,
    { flags: { fieldEvent: { kind: "foe", foeId: e.foeId } } });
  }
}

function findTrigger(map, id) {
  for (const a of map.areas ?? []) { const t = (a.triggers ?? []).find((x) => x.id === id); if (t) return { trigger: t, areaId: a.id }; }
  const t = (map.triggers ?? []).find((x) => x.id === id);
  return t ? { trigger: t, areaId: null } : null;
}

function triggerHead(map, { trigger: t, areaId }) {
  const where = areaId ? `《${areaName(map, areaId)}》` : L("wholeMap");
  return L("triggerHead", { where, on: L(`on.${t.on}`, { n: t.n || 1 }) });
}

/** 발동한 트리거: auto면 바로, 아니면 GM 카드 */
async function processTriggers(map, list, depth = 0) {
  if (depth > 5) return;
  for (const x of list) {
    if (x.trigger.auto) { await runTrigger(map, x.trigger, x.areaId, depth); continue; }
    const acts = (x.trigger.actions ?? []).map((a) => L(`act.${a.type}`)).join(" → ");
    await post(`<h3><i class="fas fa-bolt"></i> ${esc(triggerHead(map, x))}</h3>${x.trigger.text ? `<p>${esc(x.trigger.text)}</p>` : ""}${acts ? `<p class="notes">${esc(acts)}</p>` : ""}
      <div class="fm-gm"><button type="button" data-fm="run"><i class="fas fa-play"></i> ${esc(L("run"))}</button><button type="button" data-fm="skip">${esc(L("skip"))}</button></div>`,
    { gm: true, flags: { fieldEvent: { kind: "trigger", triggerId: x.trigger.id, depth } } });
  }
}

async function runTrigger(map, t, areaId, depth = 0) {
  await setMapState(FM.markFired(cur(), t.id), { undo: false });
  if (t.playerText) await post(`<p>${esc(t.playerText).replace(/\n/g, "<br>")}</p>`);
  for (const a of t.actions ?? []) await runAction(map, a, { areaId, depth });
}

/** 동작 하나 */
export async function runAction(map, a, { areaId = null, depth = 0 } = {}) {
  const here = areaOf(map, areaId ?? cur().current);
  switch (a.type) {
    case "message": return a.text ? post(`<p>${esc(a.text).replace(/\n/g, "<br>")}</p>`) : null;
    case "battle": return battleWith(a.enemies, here?.name ?? map.name, {});
    case "gather": return (await import("./loot.mjs")).openGatherDialog({ method: a.method, amount: a.amount, rank: a.rank, table: here?.gather ?? "" });
    case "trap": return (await import("./explore.mjs")).trap({ level: Number(a.level) || 1, kind: a.kind || "hp", uuids: (await party()).map((x) => x.uuid) });
    case "camp": return campHere();
    case "check": return (await import("./check-request.mjs")).openRequestDialog((await party()).map((x) => x.id), { ability: a.ability ?? "tec", kinds: a.checkKind ? [a.checkKind] : [], target: a.target ?? null, note: a.note ?? "" });
    case "reveal": return revealThing({ area: a.area || null, passage: a.passage || null });
    case "passage": return a.passage ? setPassageState(a.passage, a.state || "open") : null;
    case "foeRemove": return a.foe ? removeFoe(a.foe) : null;
    case "move": return a.area ? teleport(a.area, depth) : null;
    case "choice": return postChoice({ text: a.text, options: a.options ?? [] });
  }
}

/** 「가위풍뎅이*2, 숲쥐」 → 전투 개시 창. 월드 에너미 이름이 먼저, 없으면 컴펜디움 */
async function battleWith(spec, name, flags) {
  const pack = game.packs.get("nssq.enemies");
  const index = (await pack?.getIndex()) ?? [];
  const { enemyActorFor } = await import("./enemy-library.mjs");
  const actors = [];
  for (const part of String(spec ?? "").split(/[,，、]/).map((x) => x.trim()).filter(Boolean)) {
    const m = part.match(/^(.*?)\s*[*×x]\s*(\d+)$/);
    const nm = (m ? m[1] : part).trim();
    const n = m ? Number(m[2]) : 1;
    const world = game.actors.find((x) => x.type === "enemy" && x.name === nm);
    const entry = index.find((x) => x.name === nm);
    const actor = world ?? (entry ? await enemyActorFor(entry.uuid) : null);
    if (!actor) { ui.notifications.warn(L("noEnemy", { name: nm })); continue; }
    for (let i = 0; i < n; i++) actors.push(actor);
  }
  if (!actors.length) return;
  return (await import("./dungeon.mjs")).presetBattle(L("battleName", { name }), actors, flags);
}

/* ---------------- 선택지(투표 → GM 확정) ---------------- */

export async function postChoice({ text, options }) {
  const data = { kind: "choice", text, options: options.map((o) => ({ label: o.label, actions: o.actions ?? [] })), votes: {}, done: null };
  return ChatMessage.create({ speaker: { alias: L("title") }, content: choiceHtml(data), flags: { nssq: { fieldEvent: data } } });
}

function choiceHtml(d) {
  const names = (i) => Object.entries(d.votes ?? {}).filter(([, v]) => v === i).map(([u]) => game.users.get(u)?.name ?? "?");
  const rows = d.options.map((o, i) => `<li class="${d.done === i ? "chosen" : ""}"><button type="button" data-fm="vote" data-i="${i}" ${d.done !== null ? "disabled" : ""}>${esc(o.label)}</button>
    <span class="fm-votes">${esc(names(i).join(", "))}</span>${d.done === null ? `<button type="button" class="fm-gm-only" data-fm="pick" data-i="${i}" title="${esc(L("pick"))}"><i class="fas fa-check"></i></button>` : ""}</li>`).join("");
  return `<div class="nssq-fieldmap-card fm-choice"><h3><i class="fas fa-question-circle"></i> ${esc(L("choiceHead"))}</h3>${d.text ? `<p>${esc(d.text).replace(/\n/g, "<br>")}</p>` : ""}<ul>${rows}</ul>
    ${d.done !== null ? `<p class="notes">${esc(L("chosen", { label: d.options[d.done]?.label ?? "" }))}</p>` : `<p class="notes">${esc(L("voteHint"))}</p>`}</div>`;
}

async function vote(message, i, userId) {
  const d = foundry.utils.deepClone(message.getFlag("nssq", "fieldEvent"));
  if (!d || d.done !== null) return;
  d.votes = { ...d.votes, [userId]: i };
  await message.update({ content: choiceHtml(d), "flags.nssq.fieldEvent": d });
}

async function pick(message, i) {
  const d = foundry.utils.deepClone(message.getFlag("nssq", "fieldEvent"));
  if (!d || d.done !== null) return;
  d.done = i;
  await message.update({ content: choiceHtml(d), "flags.nssq.fieldEvent": d });
  const map = activeMap();
  for (const a of d.options[i]?.actions ?? []) if (map) await runAction(map, a);
}

/** GM: 즉석 선택지. 한 줄에 하나, 「라벨 > 에어리어 이름」이면 고르면 그리로 이동(시간 없음) */
export async function openChoiceDialog() {
  const map = activeMap();
  const got = await Dialog.prompt({
    title: L("choiceHead"),
    content: `<form class="nssq-fm-choice"><div class="form-group stacked"><label>${esc(L("choiceText"))}</label><textarea name="text" rows="2"></textarea></div>
      <div class="form-group stacked"><label>${esc(L("choiceOptions"))}</label><textarea name="opts" rows="4" placeholder="${esc(L("choiceOptionsHint"))}"></textarea></div></form>`,
    label: L("post"), rejectClose: false,
    callback: (html) => ({ text: html[0].querySelector("[name=text]").value.trim(), lines: html[0].querySelector("[name=opts]").value.split("\n").map((x) => x.trim()).filter(Boolean) })
  });
  if (!got?.lines.length) return;
  const options = got.lines.map((line) => {
    const [label, target] = line.split(">").map((x) => x.trim());
    const area = target && map?.areas.find((a) => a.name === target);
    return { label, actions: area ? [{ type: "move", area: area.id }] : [] };
  });
  return postChoice({ text: got.text, options });
}

/* ---------------- 이동 제안(플레이어 → GM) ---------------- */

export function requestMove(to) {
  const map = activeMap();
  if (!map) return;
  if (mapState().proposal) return ui.notifications.warn(L("proposalPending"));
  emit("fieldPropose", { to, by: game.user.id }, { local: isActiveGM() });
  ui.notifications.info(L("proposed", { name: (mapState().visited?.[to] ?? 0) > 0 ? areaName(map, to) : L("unknownArea") }));
}

/** 이번 탐색에 참여하는 플레이어: 접속 중이고 파티 캐릭터를 소유한 사람 */
async function partyVoters() {
  const members = await party();
  return game.users.filter((u) => u.active && !u.isGM && members.some((a) => a.testUserPermission(u, "OWNER"))).map((u) => u.id);
}

/** 활성 GM: 제안을 받아 설정(fieldMapMove)대로 투표를 연다 */
async function onPropose({ to, by }) {
  if (!isActiveGM()) return;
  const map = activeMap();
  const st = cur();
  if (!map || st.proposal || !FM.playerView(map, st).reachable.includes(to)) return;
  const mode = game.settings.get("nssq", "fieldMapMove");
  if (mode === "free") return moveTo(to);
  const voters = mode === "gm" ? ["gm"] : [...new Set([...(await partyVoters()), by]), "gm"];
  const proposal = { id: rid(), to, by, voters, answers: { [by]: true } };
  if (FM.voteResult(proposal) === "accepted") return moveTo(to);
  await setMapState({ ...st, proposal }, { undo: false });
}

/** 승낙·거절·취소(제안한 사람) */
export function answerProposal(accept, { cancel = false } = {}) {
  const p = mapState().proposal;
  if (!p) return;
  const payload = { id: p.id, user: game.user.id, gm: game.user.isGM, accept, cancel };
  return isActiveGM() ? onAnswer(payload) : emit("fieldAnswer", payload);
}

async function onAnswer({ id, user, gm, accept, cancel }) {
  if (!isActiveGM()) return;
  const st = cur();
  const p = st.proposal;
  if (!p || p.id !== id) return;
  const map = activeMap();
  const dest = (st.visited?.[p.to] ?? 0) > 0 ? areaName(map, p.to) : L("unknownArea");
  const who = game.users.get(user)?.name ?? "";
  if (cancel) {
    if (user !== p.by && !gm) return;
    delete st.proposal;
    await setMapState(st, { undo: false });
    return post(`<p><i class="fas fa-ban"></i> ${esc(L("proposalCancelled", { by: who, name: dest }))}</p>`);
  }
  const key = gm ? "gm" : user;
  if (!p.voters.includes(key)) return;
  p.answers = { ...p.answers, [key]: !!accept };
  const result = FM.voteResult(p);
  if (result === "pending") return setMapState(st, { undo: false });
  delete st.proposal;
  await setMapState(st, { undo: false });
  if (result === "rejected") return post(`<p><i class="fas fa-times-circle"></i> ${esc(L("proposalRejected", { name: dest, by: key === "gm" ? L("gmVoter") : who }))}</p>`);
  return moveTo(p.to);
}

/** GM: 투표를 무시하고 이동 */
async function forceProposal() {
  const st = cur();
  const p = st.proposal;
  if (!p) return;
  delete st.proposal;
  await setMapState(st, { undo: false });
  return moveTo(p.to);
}

/** 투표할 사람에게 창을 띄운다(지도 창을 닫아 둔 사람도) */
let votePrompt = null;
function promptVote(st) {
  const p = st?.proposal;
  const key = game.user.isGM ? "gm" : game.user.id;
  if (votePrompt && (!p || votePrompt.id !== p.id || p.answers?.[key] !== undefined)) { votePrompt.dialog.close(); votePrompt = null; }
  if (!p || !p.voters.includes(key) || p.answers?.[key] !== undefined || votePrompt) return;
  if (game.user.isGM && game.users.activeGM?.id !== game.user.id) return;
  const map = activeMap();
  if (!map) return;
  const a = areaOf(map, p.to);
  const known = game.user.isGM || (st.visited?.[p.to] ?? 0) > 0;
  const img = areaImg(a);
  const dialog = new Dialog({
    title: L("proposalTitle"),
    content: `<div class="nssq-fm-vote">${img ? `<div class="thumb ${known ? "" : "fog"}" style="background-image:url('${esc(img)}')"></div>` : ""}
      <p>${esc(L("proposalAsk", { by: game.users.get(p.by)?.name ?? "", name: known ? a?.name ?? "" : L("unknownArea") }))}</p>${a?.terrain ? `<p class="notes">${esc(a.terrain)}</p>` : ""}</div>`,
    buttons: {
      yes: { icon: '<i class="fas fa-check"></i>', label: L("accept"), callback: () => answerProposal(true) },
      no: { icon: '<i class="fas fa-times"></i>', label: L("decline"), callback: () => answerProposal(false) }
    },
    default: "yes"
  }, { classes: ["nssq", "dialog", "nssq-fm-vote-dialog"] });
  dialog.render(true);
  votePrompt = { id: p.id, dialog };
}

/* ---------------- 카드 버튼 ---------------- */

async function onCard(message, action, el) {
  const d = message.getFlag("nssq", "fieldEvent") ?? {};
  if (action === "open") return FieldMapApp.open();
  if (action === "vote") {
    const i = Number(el.dataset.i);
    return isActiveGM() ? vote(message, i, game.user.id) : emit("fieldVote", { messageId: message.id, i, userId: game.user.id });
  }
  if (!game.user.isGM) return;
  if (action === "pick") return pick(message, Number(el.dataset.i));
  const map = activeMap();
  if (!map) return ui.notifications.warn(L("noActive"));
  const done = (label) => message.update({ content: message.content.replace(/<div class="fm-gm">[\s\S]*?<\/div>/, `<p class="notes">${esc(label)}</p>`), "flags.nssq.fieldEvent.done": true });
  switch (action) {
    case "run": {
      const f = findTrigger(map, d.triggerId);
      await done(L("ran"));
      return f ? runTrigger(map, f.trigger, f.areaId, d.depth ?? 0) : null;
    }
    case "skip": return done(L("skipped"));
    case "foeBattle": {
      const foe = map.foes.find((f) => f.id === d.foeId);
      await done(L("battle"));
      const actor = foe?.actorUuid ? await fromUuid(foe.actorUuid) : null;
      if (!actor) return ui.notifications.warn(L("noEnemy", { name: foe?.name ?? "" }));
      const a = actor.pack ? await (await import("./enemy-library.mjs")).enemyActorFor(actor.uuid) : actor;
      return (await import("./dungeon.mjs")).presetBattle(L("battleName", { name: foe.name }), [a], { fieldFoe: foe.id });
    }
    case "foeAvoid": return done(L("avoided"));
  }
}

/* ---------------- 지도 창 ---------------- */

let app = null;

const ACTIONS = {
  message: [["text", "textarea"]],
  battle: [["enemies", "enemies"]],
  gather: [["method", "select", ["felling", "mining", "picking"]], ["amount", "select", Object.keys(GATHER_AMOUNT)], ["rank", "num"]],
  trap: [["kind", "select", ["hp", "tp"]], ["level", "num"]],
  camp: [],
  check: [["ability", "ability"], ["checkKind", "checkKind"], ["target", "num"], ["note", "text"]],
  reveal: [["area", "area"], ["passage", "passage"]],
  passage: [["passage", "passage"], ["state", "select", FM.PASSAGE_STATES]],
  foeRemove: [["foe", "foe"]],
  move: [["area", "area"]],
  choice: [["text", "textarea"], ["options", "options"]]
};

export class FieldMapApp extends Application {
  constructor(options = {}) {
    super(options);
    this.mode = "play";
    this.tool = "select";
    this.sel = null; // { kind: area|passage, id }
    this.draft = null;
    this.dirty = false;
    this.linkFrom = null;
    this.routeFoe = null;
    this.preview = false;
    this.mapId = null;
    this.issues = null;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, { id: "nssq-fieldmap", classes: ["nssq", "nq-window", "nssq-fieldmap"], width: 1000, height: 700, resizable: true });
  }

  get title() { return L("title"); }

  static open() { app ??= new FieldMapApp(); return app.render(true); }
  static toggle() { if (app?.rendered) return app.close(); return FieldMapApp.open(); }
  static refresh({ maps = false } = {}) {
    if (!app?.rendered) return;
    if (maps && app.mode === "edit" && app.dirty) return;
    if (maps && app.mode === "edit") app.draft = null;
    app.render();
  }

  /** 지금 보는 지도: 편집 중이면 초안 */
  currentMap() {
    if (!game.user.isGM) return activeMap();
    const maps = allMaps();
    this.mapId = maps[this.mapId] ? this.mapId : mapState().mapId && maps[mapState().mapId] ? mapState().mapId : Object.keys(maps)[0] ?? null;
    if (this.mode === "edit") {
      if (!this.draft || this.draft.id !== this.mapId) { this.draft = this.mapId ? foundry.utils.deepClone(maps[this.mapId]) : null; this.dirty = false; }
      return this.draft;
    }
    return this.mapId ? maps[this.mapId] : null;
  }

  async _renderInner() {
    const map = this.currentMap();
    const st = mapState();
    const gm = game.user.isGM;
    const live = !!(st.active && map && st.mapId === map.id);
    if (!gm) {
      if (!map) return $(`<div class="fm-wrap"><p class="fm-empty">${esc(L("noActive"))}</p></div>`);
      return $(`<div class="fm-wrap"><div class="fm-body"><div class="fm-stage">${this.svg(map, st, { player: true })}${this.legend(map, st)}</div><aside class="fm-panel player">${this.playerPanel(map, st)}</aside></div></div>`);
    }
    const maps = allMaps();
    const toolbar = `<div class="fm-toolbar">
      <select data-fm-map>${Object.values(maps).map((m) => opt(m.id, this.mapId, `${m.name}${st.active && st.mapId === m.id ? ` ${L("liveMark")}` : ""}`)).join("")}${map ? "" : opt("", "", L("noMaps"))}</select>
      <button type="button" data-fm-act="newMap"><i class="fas fa-plus"></i> ${esc(L("newMap"))}</button>
      <span class="fm-sep"></span>
      <button type="button" data-fm-act="modePlay" class="${this.mode === "play" ? "active" : ""}"><i class="fas fa-shoe-prints"></i> ${esc(L("modePlay"))}</button>
      <button type="button" data-fm-act="modeEdit" class="${this.mode === "edit" ? "active" : ""}" ${map ? "" : "disabled"}><i class="fas fa-pen"></i> ${esc(L("modeEdit"))}</button>
      ${this.mode === "edit" ? `<span class="fm-sep"></span>${["select", "area", "link"].map((t) => `<button type="button" data-fm-tool="${t}" class="${this.tool === t ? "active" : ""}"><i class="fas ${{ select: "fa-mouse-pointer", area: "fa-map-pin", link: "fa-project-diagram" }[t]}"></i> ${esc(L(`tool.${t}`))}</button>`).join("")}
        ${this.routeFoe ? `<span class="fm-routing">${esc(L("routing", { name: map?.foes.find((f) => f.id === this.routeFoe)?.name ?? "" }))} <a data-fm-act="routeDone">${esc(L("done"))}</a></span>` : ""}
        <span class="fm-sep"></span><button type="button" data-fm-act="save" class="${this.dirty ? "fm-dirty" : ""}"><i class="fas fa-save"></i> ${esc(L("save"))}</button>`
    : `<label class="fm-preview"><input type="checkbox" data-fm-act="preview" ${this.preview ? "checked" : ""}/> ${esc(L("preview"))}</label>`}
    </div>`;
    const stage = map ? this.svg(map, st, { player: this.mode === "play" && this.preview, live: this.mode === "play" && live }) : `<p class="fm-empty">${esc(L("noMaps"))}</p>`;
    const panel = map ? (this.mode === "edit" ? this.editPanel(map) : this.preview && live ? this.playerPanel(map, st) : this.playPanel(map, st, live)) : "";
    return $(`<div class="fm-wrap gm">${toolbar}<div class="fm-body"><div class="fm-stage">${stage}${this.mode === "play" && live ? this.legend(map, st) : ""}</div><aside class="fm-panel">${panel}</aside></div></div>`);
  }

  /* ---------- SVG ---------- */

  svg(map, st, { player = false, live = false } = {}) {
    const edit = this.mode === "edit" && game.user.isGM;
    const showState = player || live;
    const v = showState ? FM.playerView(map, st) : { explored: [], reachable: [], frontier: [], shown: [], passages: [], foes: [], current: null };
    const areas = player ? map.areas.filter((a) => v.shown.includes(a.id)) : map.areas;
    const passages = player ? v.passages : map.passages.map((p) => ({ ...p, state: live ? FM.passageState(st, p) : p.state }));
    const pos = (id) => { const a = areaOf(map, id); return a ? [a.x, a.y] : [0, 0]; };
    const visited = (id) => (st.visited?.[id] ?? 0) > 0;
    const bg = map.bg?.style === "image" && map.bg.src
      ? `<image href="${esc(map.bg.src)}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>`
      : `<rect width="${W}" height="${H}" fill="url(#fm-grad)"/><rect width="${W}" height="${H}" filter="url(#fm-noise)" opacity="0.35"/>${compass()}`;
    // 통로: 점선 잉크 자국(밟은 길은 실선, 지금 갈 수 있는 길은 초록으로 흐른다)
    const pLines = passages.map((p) => {
      const [x1, y1] = pos(p.a);
      const [x2, y2] = pos(p.b);
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const cls = ["fm-passage", `st-${p.state}`];
      if (p.oneWay) cls.push("one-way");
      if (showState && visited(p.a) && visited(p.b)) cls.push("walked");
      if (showState && v.current && ((p.a === v.current && v.reachable.includes(p.b)) || (p.b === v.current && v.reachable.includes(p.a))) && p.state === "open") cls.push("open-route");
      if (this.sel?.kind === "passage" && this.sel.id === p.id) cls.push("selected");
      return `<g class="${cls.join(" ")}" data-pid="${p.id}">
        <path class="hit" d="M${x1},${y1} L${x2},${y2}"/><path class="line" d="M${x1},${y1} L${mx},${my} L${x2},${y2}" ${p.oneWay ? `marker-mid="url(#fm-arrow)"` : ""}/>
        ${p.state === "locked" ? `<circle class="fm-badge lock" cx="${mx}" cy="${my}" r="11"/><text class="fm-glyph lock" x="${mx}" y="${my + 5}">${G.lock}</text>` : ""}
        ${p.state === "hidden" && !player ? `<circle class="fm-badge hidden" cx="${mx}" cy="${my}" r="11"/><text class="fm-glyph hidden" x="${mx}" y="${my + 5}">${G.eye}</text>` : ""}
        <title>${esc(player ? L(`ps.${p.state}`) : `${passageLabel(map, p)} · ${L(`ps.${p.state}`)}`)}</title></g>`;
    }).join("");
    const route = edit && this.routeFoe ? (() => {
      const f = map.foes.find((x) => x.id === this.routeFoe);
      const pts = (f?.route ?? []).map((id) => pos(id).join(",")).join(" ");
      return pts ? `<polyline class="fm-route" points="${pts}"/>` : "";
    })() : "";
    // 에어리어: 씬 배경을 담은 원형 메달 + 이름 띠
    const nodes = areas.map((a) => {
      const cls = ["fm-area"];
      const seen = visited(a.id) || a.id === v.current;
      if (showState) {
        if (v.explored.includes(a.id)) cls.push("explored");
        if (v.frontier.includes(a.id)) cls.push("frontier");
        if (v.reachable.includes(a.id)) cls.push("reachable");
        if (a.id === v.current) cls.push("current");
      }
      if (!player && a.secret && !(live && (st.revealed?.areas ?? []).includes(a.id))) cls.push("secret");
      if (!showState) cls.push("explored");
      if (!player && live && !seen && !v.frontier.includes(a.id)) cls.push("unknown");
      if (this.sel?.kind === "area" && this.sel.id === a.id) cls.push("selected");
      if (edit && this.linkFrom === a.id) cls.push("link-from");
      if (edit && map.start === a.id) cls.push("start");
      const hide = player && !seen;
      const img = areaImg(a);
      const label = hide ? (a.terrain ? a.terrain.slice(0, 12) : "???") : a.name;
      const lw = Math.max(52, [...label].length * 13 + 18);
      const tip = hide ? `${L("unexplored")}${a.terrain ? `: ${a.terrain}` : ""}` : `${a.name}${a.terrain ? `\n${a.terrain}` : ""}${!player && a.gmNote ? `\n[GM] ${a.gmNote}` : ""}${showState ? `\n${L("visits", { n: st.visited?.[a.id] ?? 0 })}` : ""}`;
      return `<g class="${cls.join(" ")}" data-aid="${a.id}" transform="translate(${a.x},${a.y})">
        <circle class="halo" r="${R + 9}"/>
        <circle class="disc" r="${R}"/>
        ${img ? `<image href="${esc(img)}" x="${-R}" y="${-R}" width="${R * 2}" height="${R * 2}" clip-path="url(#fm-clip)" preserveAspectRatio="xMidYMid slice" ${hide ? `filter="url(#fm-fog)"` : ""}/>` : `<text class="fm-initial" y="9">${esc(hide ? "?" : [...a.name][0] ?? "?")}</text>`}
        ${hide && img ? `<circle class="fog" r="${R}"/><text class="fm-q" y="10">?</text>` : ""}
        <circle class="ring" r="${R}"/>
        <g class="plate" transform="translate(0,${R + 16})"><rect x="${-lw / 2}" y="-11" width="${lw}" height="22" rx="4"/><text y="5">${esc(label)}</text></g>
        ${a.id === v.current ? `<g class="party" transform="translate(${-R + 2},${-R + 2})"><circle r="12"/><text class="fm-glyph" y="5">${G.flag}</text></g>` : ""}
        <title>${esc(tip)}</title></g>`;
    }).join("");
    const foeList = player ? v.foes : live ? map.foes.filter((f) => st.foePos?.[f.id] && !(st.foeGone ?? []).includes(f.id)).map((f) => ({ ...f, area: st.foePos[f.id] })) : map.foes.filter((f) => f.route?.length).map((f) => ({ ...f, area: f.route[0] }));
    const perArea = {};
    const foes = foeList.map((f) => {
      const [x, y] = pos(f.area);
      const k = (perArea[f.area] = (perArea[f.area] ?? 0) + 1) - 1;
      const visible = !live || player || v.foes.some((x2) => x2.id === f.id);
      return `<g class="fm-foe ${visible ? "" : "unseen"}" transform="translate(${x + R * 0.78 - k * 20},${y - R * 0.78})"><path d="M0,-13 L12,0 L0,13 L-12,0 Z"/><text y="4">F</text><title>F.O.E. ${esc(f.name)}</title></g>`;
    }).join("");
    return `<svg class="fm-svg ${edit ? `edit tool-${this.tool}` : ""}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id="fm-grad" cx="50%" cy="45%" r="75%"><stop offset="0%" stop-color="#f4e7c5"/><stop offset="70%" stop-color="#e2cc96"/><stop offset="100%" stop-color="#b8975c"/></radialGradient>
        <radialGradient id="fm-vignette" cx="50%" cy="50%" r="70%"><stop offset="65%" stop-color="#3b2510" stop-opacity="0"/><stop offset="100%" stop-color="#3b2510" stop-opacity="0.45"/></radialGradient>
        <filter id="fm-noise"><feTurbulence type="fractalNoise" baseFrequency="0.012 0.02" numOctaves="4" seed="7"/><feColorMatrix values="0 0 0 0 0.45  0 0 0 0 0.32  0 0 0 0 0.15  0 0 0 0.9 -0.25"/></filter>
        <filter id="fm-fog"><feColorMatrix type="saturate" values="0.05"/><feGaussianBlur stdDeviation="2.2"/></filter>
        <filter id="fm-shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#2b1a08" flood-opacity="0.45"/></filter>
        <clipPath id="fm-clip" clipPathUnits="objectBoundingBox"><circle cx="0.5" cy="0.5" r="0.5"/></clipPath>
        <marker id="fm-arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="fm-arrow"/></marker>
      </defs>
      <rect class="fm-bgclick" width="${W}" height="${H}" fill="transparent"/>${bg}<rect width="${W}" height="${H}" fill="url(#fm-vignette)" pointer-events="none"/>${pLines}${route}${nodes}${foes}</svg>`;
  }

  legend(map, st) {
    const here = areaOf(map, st.current);
    const item = (k, label) => `<span class="fm-key ${k}" data-key="${k}"><i></i>${esc(label)}</span>`;
    return `<footer class="fm-legend">${item("current", L("key.current"))}${item("explored", L("key.explored"))}${item("reachable", L("key.reachable"))}${item("frontier", L("key.frontier"))}${item("foe", "F.O.E.")}
      <span class="fm-clock">${esc(here?.name ?? "")} · ${esc(clock(st))}</span></footer>`;
  }

  /* ---------- 플레이어 패널: 지금 위치·이동 제안 ---------- */

  playerPanel(map, st) {
    const v = FM.playerView(map, st);
    const here = areaOf(map, v.current);
    const img = areaImg(here);
    const p = st.proposal;
    const me = game.user.id;
    const destCard = (id) => {
      const a = areaOf(map, id);
      const known = (st.visited?.[id] ?? 0) > 0;
      const foe = v.foes.some((f) => f.area === id);
      const im = areaImg(a);
      return `<button type="button" class="fm-dest ${foe ? "danger" : ""}" data-fm-dest="${id}">
        <span class="thumb ${known ? "" : "fog"}" style="${im ? `background-image:url('${esc(im)}')` : ""}">${known ? "" : "?"}</span>
        <span class="txt"><b>${esc(known ? a.name : L("unknownArea"))}</b><small>${esc(a.terrain ?? "")}</small>${foe ? `<small class="fm-foe-warn"><i class="fas fa-skull"></i> ${esc(L("foeSign"))}</small>` : ""}</span></button>`;
    };
    let move;
    if (p) {
      const rows = (p.voters ?? []).map((u) => {
        const a = p.answers?.[u];
        const name = u === "gm" ? L("gmVoter") : game.users.get(u)?.name ?? "?";
        return `<li class="${a === true ? "yes" : a === false ? "no" : "wait"}"><i class="fas ${a === true ? "fa-check" : a === false ? "fa-times" : "fa-hourglass-half"}"></i> ${esc(name)}</li>`;
      }).join("");
      const mine = (p.voters ?? []).includes(me) && p.answers?.[me] === undefined;
      move = `<div class="fm-proposal"><p><b>${esc(game.users.get(p.by)?.name ?? "")}</b>: ${esc(L("proposalTo", { name: (st.visited?.[p.to] ?? 0) > 0 ? areaName(map, p.to) : L("unknownArea") }))}</p><ul>${rows}</ul>
        ${mine ? `<div class="fm-row"><button type="button" data-fm-vote="yes"><i class="fas fa-check"></i> ${esc(L("accept"))}</button><button type="button" data-fm-vote="no"><i class="fas fa-times"></i> ${esc(L("decline"))}</button></div>` : ""}
        ${p.by === me ? `<button type="button" data-fm-vote="cancel">${esc(L("cancelProposal"))}</button>` : ""}</div>`;
    } else if (this.proposing) {
      move = `<p class="fm-sub">${esc(L("pickDest"))}</p>${v.reachable.map(destCard).join("") || `<p class="notes">${esc(L("noDest"))}</p>`}
        <button type="button" data-fm-pact="cancelPick">${esc(L("back"))}</button>`;
    } else {
      move = `<button type="button" class="fm-big" data-fm-pact="propose" ${v.reachable.length ? "" : "disabled"}><i class="fas fa-shoe-prints"></i> ${esc(L("proposeMove"))}</button>`;
    }
    const foeHere = v.foes.filter((f) => f.area === v.current);
    return `<div class="fm-loc">
        <div class="fm-loc-img" style="${img ? `background-image:url('${esc(img)}')` : ""}"><span class="fm-loc-name">${esc(here?.name ?? "")}</span></div>
        <p class="fm-loc-meta">${esc(clock(st))} · ${esc(L("visits", { n: st.visited?.[v.current] ?? 0 }))}</p>
        ${here?.terrain ? `<p class="fm-loc-terrain">${esc(here.terrain)}</p>` : ""}
        ${foeHere.length ? `<p class="fm-foe-warn"><i class="fas fa-skull"></i> ${esc(L("foeHere"))}</p>` : ""}
      </div>
      <h4>${esc(L("moveHead"))}</h4>${move}`;
  }

  /* ---------- GM 패널: 진행 ---------- */

  playPanel(map, st, live) {
    const { errors, warnings } = FM.validateMap(map);
    const issues = [...errors.map((e) => `<li class="err">${esc(L(`v.${e.code}`, { name: e.name ?? "" }))}</li>`), ...warnings.map((e) => `<li>${esc(L(`v.${e.code}`, { name: e.name ?? "" }))}</li>`)].join("");
    if (!live) {
      return `<h3>${esc(map.name)}</h3>${st.active ? `<p class="notes">${esc(L("otherLive", { name: allMaps()[st.mapId]?.name ?? "" }))}</p>` : ""}
        <div class="form-group"><label>${esc(L("startHour"))}</label><input type="number" data-fm-hour min="0" max="23" value="${map.startHour ?? 8}"/></div>
        <button type="button" data-fm-act="start" ${errors.length ? "disabled" : ""}><i class="fas fa-play"></i> ${esc(L("start"))}</button>
        ${issues ? `<ul class="fm-issues">${issues}</ul>` : ""}<p class="notes">${esc(L("playHint"))}</p>`;
    }
    const b = (act, icon, label) => `<button type="button" data-fm-act="${act}"><i class="fas ${icon}"></i> ${esc(label)}</button>`;
    let sel = "";
    if (this.sel?.kind === "area") {
      const a = areaOf(map, this.sel.id);
      if (a) {
        const hidden = a.secret && !(st.revealed?.areas ?? []).includes(a.id);
        sel = `<section class="fm-sel"><h4>${esc(a.name)}</h4>${a.terrain ? `<p>${esc(a.terrain)}</p>` : ""}${a.gmNote ? `<p class="notes">${esc(a.gmNote)}</p>` : ""}
          <p class="notes">${esc(L("visits", { n: st.visited?.[a.id] ?? 0 }))}${(a.triggers ?? []).length ? ` · ${esc(L("triggerCount", { n: a.triggers.length }))}` : ""}</p>
          ${b("teleport", "fa-street-view", L("teleport"))}${hidden ? b("revealArea", "fa-eye", L("reveal")) : ""}</section>`;
      }
    }
    if (this.sel?.kind === "passage") {
      const p = map.passages.find((x) => x.id === this.sel.id);
      if (p) {
        const s = FM.passageState(st, p);
        sel = `<section class="fm-sel"><h4>${esc(passageLabel(map, p))}</h4>
          <select data-fm-pstate>${FM.PASSAGE_STATES.map((x) => opt(x, s, L(`ps.${x}`))).join("")}</select>
          ${s === "hidden" ? b("revealPassage", "fa-eye", L("reveal")) : ""}</section>`;
      }
    }
    const foes = map.foes.map((f) => {
      const gone = (st.foeGone ?? []).includes(f.id);
      return `<li>${esc(f.name)} <select data-fm-foepos="${f.id}" ${gone ? "disabled" : ""}>${map.areas.map((a) => opt(a.id, st.foePos?.[f.id], a.name)).join("")}</select>
        ${gone ? `<a data-fm-act="foeRestore" data-id="${f.id}">${esc(L("restore"))}</a>` : `<a data-fm-act="foeRemove" data-id="${f.id}" title="${esc(L("remove"))}"><i class="fas fa-times"></i></a>`}</li>`;
    }).join("");
    const pr = st.proposal;
    const prop = pr ? `<section class="fm-proposal"><p><b>${esc(game.users.get(pr.by)?.name ?? "")}</b>: ${esc(L("proposalTo", { name: areaName(map, pr.to) }))}</p>
      <ul>${pr.voters.map((u) => { const x = pr.answers?.[u]; return `<li class="${x === true ? "yes" : x === false ? "no" : "wait"}"><i class="fas ${x === true ? "fa-check" : x === false ? "fa-times" : "fa-hourglass-half"}"></i> ${esc(u === "gm" ? L("gmVoter") : game.users.get(u)?.name ?? "?")}</li>`; }).join("")}</ul>
      <div class="fm-actions">${pr.voters.includes("gm") && pr.answers?.gm === undefined ? `${b("gmYes", "fa-check", L("accept"))}${b("gmNo", "fa-times", L("decline"))}` : ""}${b("forceMove", "fa-forward", L("forceMove"))}${b("cancelProposal", "fa-ban", L("cancelProposal"))}</div></section>` : "";
    return `<h3>${esc(map.name)}</h3><p class="fm-clockline">${esc(clock(st))} · ${esc(areaName(map, st.current))}</p>${prop}
      <div class="fm-actions">${b("search", "fa-search", L("search"))}${b("gather", "fa-leaf", L("gather"))}${b("camp", "fa-campground", L("camp"))}${b("mapping", "fa-map-marked-alt", L("mapping"))}
        ${b("wait", "fa-hourglass-half", L("wait"))}${b("choice", "fa-question-circle", L("choice"))}${b("undo", "fa-undo", L("undo"))}</div>
      <p class="notes">${esc(L("moveHint"))}</p>${sel}
      ${foes ? `<h4>F.O.E.</h4><ul class="fm-foes">${foes}</ul>` : ""}
      <div class="fm-actions end">${b("restart", "fa-redo", L("restart"))}${b("end", "fa-stop", L("end"))}</div>`;
  }

  /* ---------- GM 패널: 편집 ---------- */

  editPanel(map) {
    const issues = this.issues ? [...this.issues.errors.map((e) => `<li class="err">${esc(L(`v.${e.code}`, { name: e.name ?? "" }))}</li>`), ...this.issues.warnings.map((e) => `<li>${esc(L(`v.${e.code}`, { name: e.name ?? "" }))}</li>`)].join("") || `<li>${esc(L("v.ok"))}</li>` : "";
    const check = `<button type="button" data-fm-act="validate"><i class="fas fa-check-double"></i> ${esc(L("validate"))}</button>${issues ? `<ul class="fm-issues">${issues}</ul>` : ""}`;
    if (this.sel?.kind === "area") {
      const i = map.areas.findIndex((a) => a.id === this.sel.id);
      const a = map.areas[i];
      if (a) {
        const p = `areas.${i}`;
        return `<h3>${esc(L("areaHead"))} <a data-fm-act="deselect" title="${esc(L("close"))}"><i class="fas fa-times"></i></a></h3>
          ${this.field(`${p}.name`, a.name, L("f.name"))}
          <div class="form-group"><label>${esc(L("f.scene"))}</label><select data-path="${p}.sceneId" data-struct>${opt("", a.sceneId, L("noScene"))}${game.scenes.contents.filter((x) => !x.getFlag("nssq", "randomPreset")).map((x) => opt(x.id, a.sceneId, x.name)).join("")}</select></div>
          <div class="form-group"><label>${esc(L("f.img"))}</label><input type="text" data-path="${p}.img" data-struct value="${esc(a.img ?? "")}" placeholder="${esc(L("f.imgHint"))}"/><button type="button" data-fm-act="pickImg" class="fm-icon"><i class="fas fa-file-import"></i></button></div>
          ${areaImg(a) ? `<div class="fm-edit-img" style="background-image:url('${esc(areaImg(a))}')"></div>` : ""}
          ${this.field(`${p}.terrain`, a.terrain, L("f.terrain"), "text", L("f.terrainHint"))}
          ${this.field(`${p}.gmNote`, a.gmNote, L("f.gmNote"), "textarea")}
          ${this.field(`${p}.gather`, a.gather, L("f.gather"), "text", game.i18n.localize("NSSQ.Loot.tablePlaceholder"))}
          ${this.field(`${p}.tags`, a.tags, L("f.tags"), "text", L("f.tagsHint"))}
          ${this.field(`${p}.secret`, a.secret, L("f.secret"), "bool")}
          <p>${map.start === a.id ? `<b><i class="fas fa-flag"></i> ${esc(L("isStart"))}</b>` : `<button type="button" data-fm-act="setStart">${esc(L("setStart"))}</button>`}</p>
          ${this.triggersHtml(`${p}.triggers`, a.triggers ?? [], FM.AREA_TRIGGERS, map)}
          <p><button type="button" data-fm-act="delArea" class="fm-danger"><i class="fas fa-trash"></i> ${esc(L("delArea"))}</button></p>`;
      }
    }
    if (this.sel?.kind === "passage") {
      const i = map.passages.findIndex((x) => x.id === this.sel.id);
      const pa = map.passages[i];
      if (pa) {
        const p = `passages.${i}`;
        return `<h3>${esc(L("passageHead"))} <a data-fm-act="deselect"><i class="fas fa-times"></i></a></h3><p>${esc(passageLabel(map, pa))}</p>
          <div class="form-group"><label>${esc(L("f.state"))}</label><select data-path="${p}.state">${FM.PASSAGE_STATES.map((x) => opt(x, pa.state, L(`ps.${x}`))).join("")}</select></div>
          ${this.field(`${p}.oneWay`, pa.oneWay, L("f.oneWay"), "bool")}
          <p><button type="button" data-fm-act="flip">${esc(L("flip"))}</button></p>
          ${this.field(`${p}.label`, pa.label, L("f.label"))}
          <p class="notes">${esc(L("passageHint"))}</p>
          <p><button type="button" data-fm-act="delPassage" class="fm-danger"><i class="fas fa-trash"></i> ${esc(L("delPassage"))}</button></p>`;
      }
    }
    const foes = map.foes.map((f, i) => `<fieldset class="fm-foe-edit"><legend>${esc(f.name || "F.O.E.")} <a data-fm-del="foes.${i}"><i class="fas fa-trash"></i></a></legend>
      ${this.field(`foes.${i}.actorLabel`, f.actorLabel, L("f.actor"), "enemy")}
      ${this.field(`foes.${i}.name`, f.name, L("f.name"))}
      <div class="form-group"><label>${esc(L("f.mode"))}</label><select data-path="foes.${i}.mode" data-struct>${FM.FOE_MODES.map((m) => opt(m, f.mode, L(`mode.${m}`))).join("")}</select></div>
      ${f.mode === "chase" ? this.field(`foes.${i}.range`, f.range ?? 1, L("f.range"), "num") : ""}
      ${this.field(`foes.${i}.every`, f.every ?? 1, L("f.every"), "num")}
      ${this.field(`foes.${i}.nightOnly`, f.nightOnly, L("f.nightOnly"), "bool")}
      <p class="notes">${esc(L("f.route"))}: ${esc((f.route ?? []).map((id) => areaName(map, id)).join(" → ") || L("none"))}</p>
      <p><button type="button" data-fm-act="route" data-id="${f.id}">${esc(L(this.routeFoe === f.id ? "routeStop" : "routeSet"))}</button><button type="button" data-fm-act="routeClear" data-id="${f.id}">${esc(L("routeClear"))}</button></p></fieldset>`).join("");
    return `<h3>${esc(L("mapHead"))}</h3>
      ${this.field("name", map.name, L("f.mapName"))}
      ${this.field("startHour", map.startHour ?? 8, L("startHour"), "num")}
      ${this.field("activateScene", map.activateScene, L("f.activateScene"), "bool")}
      <div class="form-group"><label>${esc(L("f.bg"))}</label><select data-path="bg.style">${opt("parchment", map.bg?.style, L("bg.parchment"))}${opt("image", map.bg?.style, L("bg.image"))}</select></div>
      ${map.bg?.style === "image" ? `<div class="form-group"><input type="text" data-path="bg.src" value="${esc(map.bg.src)}"/><button type="button" data-fm-act="pickBg"><i class="fas fa-file-import"></i></button></div>` : ""}
      <p class="notes">${esc(L("editHint"))}</p>${check}
      <h3>F.O.E. <a data-fm-add="foes" data-kind="foe"><i class="fas fa-plus"></i></a></h3>${foes}
      <datalist id="fm-enemies">${this.enemyChoices().map((x) => `<option value="${esc(x.label)}"></option>`).join("")}</datalist>
      ${this.triggersHtml("triggers", map.triggers ?? [], FM.MAP_TRIGGERS, map)}
      <p><button type="button" data-fm-act="dupMap"><i class="fas fa-copy"></i> ${esc(L("dupMap"))}</button><button type="button" data-fm-act="delMap" class="fm-danger"><i class="fas fa-trash"></i> ${esc(L("delMap"))}</button></p>`;
  }

  enemyChoices() {
    this._enemies ??= [
      ...game.actors.filter((a) => a.type === "enemy").map((a) => ({ uuid: a.uuid, label: `${a.system.isFOE ? "★" : ""}${a.name}` })),
      ...(game.packs.get("nssq.enemies")?.index ?? []).map((e) => ({ uuid: e.uuid, label: e.name }))
    ];
    return this._enemies;
  }

  field(path, value, label, kind = "text", hint = "") {
    const v = value ?? "";
    let input;
    if (kind === "bool") input = `<input type="checkbox" data-path="${path}" data-type="bool" ${v ? "checked" : ""}/>`;
    else if (kind === "textarea") input = `<textarea data-path="${path}" rows="2">${esc(v)}</textarea>`;
    else if (kind === "num") input = `<input type="number" data-path="${path}" data-type="num" value="${esc(v)}"/>`;
    else if (kind === "enemy") input = `<input type="text" data-path="${path}" data-type="enemy" list="fm-enemies" value="${esc(v)}" placeholder="${esc(L("f.actorHint"))}"/>`;
    else input = `<input type="text" data-path="${path}" value="${esc(v)}" placeholder="${esc(hint)}"/>`;
    return `<div class="form-group ${kind === "textarea" ? "stacked" : ""}"><label>${esc(label)}</label>${input}</div>`;
  }

  triggersHtml(path, list, ons, map) {
    const rows = list.map((t, i) => {
      const p = `${path}.${i}`;
      return `<fieldset class="fm-trigger"><legend><select data-path="${p}.on" data-struct>${ons.map((o) => opt(o, t.on, L(`on.${o}`, { n: "n" }))).join("")}</select>
        <a data-fm-up="${p}" title="${esc(L("up"))}"><i class="fas fa-arrow-up"></i></a> <a data-fm-del="${p}" title="${esc(L("remove"))}"><i class="fas fa-trash"></i></a></legend>
        ${t.on === "visit" || t.on === "segment" ? this.field(`${p}.n`, t.n ?? 1, L("f.n"), "num") : ""}
        ${this.field(`${p}.once`, t.once, L("f.once"), "bool")}${this.field(`${p}.auto`, t.auto, L("f.auto"), "bool")}
        ${this.field(`${p}.text`, t.text, L("f.gmText"), "textarea")}${this.field(`${p}.playerText`, t.playerText, L("f.playerText"), "textarea")}
        ${this.actionsHtml(`${p}.actions`, t.actions ?? [], map, true)}</fieldset>`;
    }).join("");
    return `<h3>${esc(L(path === "triggers" ? "mapTriggers" : "triggers"))} <a data-fm-add="${path}" data-kind="trigger" data-on="${ons[0]}"><i class="fas fa-plus"></i></a></h3>${rows}`;
  }

  actionsHtml(path, list, map, allowChoice) {
    const types = Object.keys(ACTIONS).filter((t) => allowChoice || t !== "choice");
    const rows = list.map((a, i) => {
      const p = `${path}.${i}`;
      const fields = (ACTIONS[a.type] ?? []).map(([k, kind, choices]) => {
        const fp = `${p}.${k}`;
        const lab = L(`af.${k}`);
        switch (kind) {
          case "select": return `<div class="form-group"><label>${esc(lab)}</label><select data-path="${fp}">${choices.map((c) => opt(c, a[k], L(`av.${c}`))).join("")}</select></div>`;
          case "area": return `<div class="form-group"><label>${esc(lab)}</label><select data-path="${fp}">${opt("", a[k], L("none"))}${map.areas.map((x) => opt(x.id, a[k], x.name)).join("")}</select></div>`;
          case "passage": return `<div class="form-group"><label>${esc(lab)}</label><select data-path="${fp}">${opt("", a[k], L("none"))}${map.passages.map((x) => opt(x.id, a[k], passageLabel(map, x))).join("")}</select></div>`;
          case "foe": return `<div class="form-group"><label>${esc(lab)}</label><select data-path="${fp}">${opt("", a[k], L("none"))}${map.foes.map((x) => opt(x.id, a[k], x.name)).join("")}</select></div>`;
          case "num": return this.field(fp, a[k], lab, "num");
          case "ability": return `<div class="form-group"><label>${esc(lab)}</label><select data-path="${fp}">${ABILITIES.map((c) => opt(c, a[k] ?? "tec", game.i18n.localize(`NSSQ.Ability.${c}`))).join("")}</select></div>`;
          case "checkKind": return `<div class="form-group"><label>${esc(lab)}</label><select data-path="${fp}">${opt("", a[k], L("none"))}${CHECK_KINDS.map((c) => opt(c, a[k], game.i18n.localize(`NSSQ.Check.kind.${c}`))).join("")}</select></div>`;
          case "textarea": return this.field(fp, a[k], lab, "textarea");
          case "enemies": return this.field(fp, a[k], lab, "text", L("af.enemiesHint"));
          case "options": return `<div class="fm-options">${(a.options ?? []).map((o, j) => `<fieldset><legend>${esc(L("option", { n: j + 1 }))} <a data-fm-del="${fp}.${j}"><i class="fas fa-trash"></i></a></legend>
            ${this.field(`${fp}.${j}.label`, o.label, L("af.label"))}${this.actionsHtml(`${fp}.${j}.actions`, o.actions ?? [], map, false)}</fieldset>`).join("")}
            <a data-fm-add="${fp}" data-kind="option"><i class="fas fa-plus"></i> ${esc(L("addOption"))}</a></div>`;
          default: return this.field(fp, a[k], lab);
        }
      }).join("");
      return `<div class="fm-action"><div class="fm-action-head"><select data-path="${p}.type" data-struct>${types.map((t) => opt(t, a.type, L(`act.${t}`))).join("")}</select>
        <a data-fm-up="${p}"><i class="fas fa-arrow-up"></i></a> <a data-fm-del="${p}"><i class="fas fa-times"></i></a></div>${fields}</div>`;
    }).join("");
    return `<div class="fm-actions-edit"><p class="fm-sub">${esc(L("actions"))} <a data-fm-add="${path}" data-kind="action"><i class="fas fa-plus"></i></a></p>${rows}</div>`;
  }

  /* ---------- 입력 ---------- */

  activateListeners(html) {
    super.activateListeners(html);
    const root = html[0];
    const svg = root.querySelector("svg.fm-svg");
    if (svg) this.svgListeners(svg);
    // 범례에 마우스를 올리면 그 종류만 강조
    html.on("mouseenter", ".fm-key[data-key]", (ev) => svg?.classList.add(`hl-${ev.currentTarget.dataset.key}`));
    html.on("mouseleave", ".fm-key[data-key]", (ev) => svg?.classList.remove(`hl-${ev.currentTarget.dataset.key}`));
    // 플레이어 패널
    html.on("click", "[data-fm-pact]", (ev) => { this.proposing = ev.currentTarget.dataset.fmPact === "propose"; this.render(); });
    html.on("click", "[data-fm-dest]", (ev) => { this.proposing = false; requestMove(ev.currentTarget.dataset.fmDest); });
    html.on("click", "[data-fm-vote]", (ev) => { const v = ev.currentTarget.dataset.fmVote; answerProposal(v === "yes", { cancel: v === "cancel" }); });
    if (!game.user.isGM) return;
    html.on("change", "[data-fm-map]", (ev) => this.switchMap(ev.currentTarget.value));
    html.on("change", "[data-path]", (ev) => this.onField(ev.currentTarget));
    html.on("change", "[data-fm-pstate]", (ev) => setPassageState(this.sel.id, ev.currentTarget.value));
    html.on("change", "[data-fm-foepos]", (ev) => setFoePos(ev.currentTarget.dataset.fmFoepos, ev.currentTarget.value));
    html.on("click", "[data-fm-tool]", (ev) => { this.tool = ev.currentTarget.dataset.fmTool; this.linkFrom = null; this.routeFoe = null; this.render(); });
    html.on("click", "[data-fm-add]", (ev) => this.addItem(ev.currentTarget.dataset));
    html.on("click", "[data-fm-del]", (ev) => this.delItem(ev.currentTarget.dataset.fmDel));
    html.on("click", "[data-fm-up]", (ev) => this.upItem(ev.currentTarget.dataset.fmUp));
    html.on("click", "[data-fm-act]", (ev) => { if (ev.currentTarget.type !== "checkbox") this.onAct(ev.currentTarget); });
    html.on("change", "[data-fm-act=preview]", (ev) => { this.preview = ev.currentTarget.checked; this.render(); });
  }

  async switchMap(id) {
    if (this.dirty) await this.save();
    this.mapId = id;
    this.draft = null;
    this.sel = null;
    this.routeFoe = null;
    this.render();
  }

  /** 편집 칸 → 초안. 구조가 바뀌는 칸(data-struct)이면 다시 그린다 */
  onField(el) {
    if (this.mode !== "edit" || !this.draft) return;
    let v = el.type === "checkbox" ? el.checked : el.value;
    if (el.dataset.type === "num") v = el.value === "" ? null : Number(el.value);
    const path = el.dataset.path;
    if (el.dataset.type === "enemy") {
      const hit = this.enemyChoices().find((x) => x.label === v);
      const base = path.replace(/\.actorLabel$/, "");
      foundry.utils.setProperty(this.draft, `${base}.actorUuid`, hit?.uuid ?? "");
      const f = foundry.utils.getProperty(this.draft, base);
      if (hit && !f.name) f.name = hit.label.replace(/^★/, "");
    }
    if (path.endsWith(".type") && el.dataset.struct !== undefined) {
      // 동작 종류가 바뀌면 그 동작의 칸을 비운다
      foundry.utils.setProperty(this.draft, path.replace(/\.type$/, ""), { type: v, ...(v === "choice" ? { options: [] } : {}) });
    } else foundry.utils.setProperty(this.draft, path, v);
    if (path.endsWith(".sceneId")) foundry.utils.setProperty(this.draft, path.replace(/sceneId$/, "sceneImg"), sceneImage(v));
    this.dirty = true;
    const structural = el.dataset.struct !== undefined || el.dataset.type === "enemy" || path === "bg.style" || path.endsWith(".oneWay") || path.endsWith(".state") || path.endsWith(".name") || path.endsWith(".secret");
    if (structural) this.render();
    else this.element.find("[data-fm-act=save]").addClass("fm-dirty");
  }

  addItem({ fmAdd: path, kind, on }) {
    const list = foundry.utils.getProperty(this.draft, path) ?? [];
    const item = {
      trigger: () => ({ id: rid(), on: on || "enter", n: 1, once: false, auto: false, text: "", playerText: "", actions: [] }),
      action: () => ({ type: "message", text: "" }),
      option: () => ({ label: "", actions: [] }),
      foe: () => ({ id: rid(), name: "", actorUuid: "", actorLabel: "", route: [], mode: "loop", every: 1, nightOnly: false, active: true })
    }[kind]();
    list.push(item);
    foundry.utils.setProperty(this.draft, path, list);
    this.dirty = true;
    this.render();
  }

  delItem(path) {
    const parts = path.split(".");
    const i = Number(parts.pop());
    const list = foundry.utils.getProperty(this.draft, parts.join("."));
    if (Array.isArray(list)) list.splice(i, 1);
    this.dirty = true;
    this.render();
  }

  upItem(path) {
    const parts = path.split(".");
    const i = Number(parts.pop());
    const list = foundry.utils.getProperty(this.draft, parts.join("."));
    if (Array.isArray(list) && i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
    this.dirty = true;
    this.render();
  }

  async save() {
    if (!this.draft) return;
    for (const a of this.draft.areas) if (a.sceneId) a.sceneImg = sceneImage(a.sceneId) || a.sceneImg || "";
    await saveMap(this.draft);
    this.dirty = false;
    ui.notifications.info(L("saved", { name: this.draft.name }));
  }

  async onAct(el) {
    const a = el.dataset.fmAct;
    const map = this.currentMap();
    const id = el.dataset.id;
    switch (a) {
      case "newMap": {
        if (this.dirty) await this.save();
        const m = newMap(L("newMapName", { n: Object.keys(allMaps()).length + 1 }));
        await saveMap(m);
        this.mapId = m.id; this.mode = "edit"; this.tool = "area"; this.draft = null; this.sel = null;
        return this.render();
      }
      case "modePlay": if (this.dirty) await this.save(); this.mode = "play"; this.sel = null; this.routeFoe = null; this.linkFrom = null; return this.render();
      case "modeEdit": this.mode = "edit"; this.sel = null; this.draft = null; return this.render();
      case "save": await this.save(); return this.render();
      case "validate": this.issues = FM.validateMap(map); return this.render();
      case "deselect": this.sel = null; return this.render();
      case "setStart": map.start = this.sel.id; this.dirty = true; return this.render();
      case "delArea": {
        const aid = this.sel.id;
        map.areas = map.areas.filter((x) => x.id !== aid);
        map.passages = map.passages.filter((p) => p.a !== aid && p.b !== aid);
        for (const f of map.foes) f.route = (f.route ?? []).filter((r) => r !== aid);
        if (map.start === aid) map.start = map.areas[0]?.id ?? null;
        this.sel = null; this.dirty = true; return this.render();
      }
      case "delPassage": map.passages = map.passages.filter((p) => p.id !== this.sel.id); this.sel = null; this.dirty = true; return this.render();
      case "flip": { const p = map.passages.find((x) => x.id === this.sel.id); [p.a, p.b] = [p.b, p.a]; this.dirty = true; return this.render(); }
      case "pickImg": { const ar = map.areas.find((x) => x.id === this.sel.id); return new FilePicker({ type: "image", current: ar.img, callback: (src) => { ar.img = src; this.dirty = true; this.render(); } }).render(true); }
      case "pickBg": return new FilePicker({ type: "image", current: map.bg?.src, callback: (src) => { map.bg = { style: "image", src }; this.dirty = true; this.render(); } }).render(true);
      case "route": this.routeFoe = this.routeFoe === id ? null : id; this.tool = "select"; this.linkFrom = null; return this.render();
      case "routeDone": this.routeFoe = null; return this.render();
      case "routeClear": { const f = map.foes.find((x) => x.id === id); f.route = []; this.dirty = true; return this.render(); }
      case "dupMap": {
        if (this.dirty) await this.save();
        const m = { ...foundry.utils.deepClone(map), id: rid(), name: L("copyName", { name: map.name }) };
        await saveMap(m);
        this.mapId = m.id; this.draft = null; return this.render();
      }
      case "delMap": {
        if (!(await Dialog.confirm({ title: L("delMap"), content: `<p>${esc(L("delMapAsk", { name: map.name }))}</p>`, rejectClose: false }))) return;
        if (mapState().mapId === map.id && mapState().active) await endProgress();
        const all = allMaps();
        delete all[map.id];
        await game.settings.set("nssq", "fieldMaps", foundry.utils.deepClone(all));
        this.mapId = null; this.draft = null; this.dirty = false; this.mode = "play"; return this.render();
      }
      // 진행
      case "start": return startProgress(map.id, Number(this.element.find("[data-fm-hour]").val()) || 0);
      case "restart": if (await Dialog.confirm({ title: L("restart"), content: `<p>${esc(L("restartAsk"))}</p>`, rejectClose: false })) return startProgress(map.id, map.startHour ?? 8); return;
      case "end": return endProgress();
      case "undo": return undo();
      case "search": return search();
      case "gather": return gatherHere();
      case "camp": return campHere();
      case "wait": return wait(1);
      case "mapping": return (await import("./check-request.mjs")).openRequestDialog([], { ability: "tec", kinds: ["mapping"], note: L("mapping"), tag: "fieldMapping" });
      case "choice": return openChoiceDialog();
      case "teleport": return teleport(this.sel.id);
      case "revealArea": return revealThing({ area: this.sel.id });
      case "revealPassage": return revealThing({ passage: this.sel.id });
      case "foeRemove": return removeFoe(id);
      case "foeRestore": return removeFoe(id, { restore: true });
      case "gmYes": return answerProposal(true);
      case "gmNo": return answerProposal(false);
      case "forceMove": return forceProposal();
      case "cancelProposal": return answerProposal(false, { cancel: true });
    }
  }

  /* ---------- 지도 위 조작 ---------- */

  svgListeners(svg) {
    const toSvg = (ev) => {
      const pt = svg.createSVGPoint();
      pt.x = ev.clientX; pt.y = ev.clientY;
      const p = pt.matrixTransform(svg.getScreenCTM().inverse());
      return { x: Math.round(Math.min(W - R - 8, Math.max(R + 8, p.x))), y: Math.round(Math.min(H - R - 34, Math.max(R + 12, p.y))) };
    };
    const edit = this.mode === "edit" && game.user.isGM;
    let drag = null;
    svg.addEventListener("pointerdown", (ev) => {
      const g = ev.target.closest(".fm-area");
      if (!edit || this.tool !== "select" || !g || this.routeFoe) return;
      drag = { id: g.dataset.aid, g, start: toSvg(ev), moved: false };
      svg.setPointerCapture(ev.pointerId);
    });
    svg.addEventListener("pointermove", (ev) => {
      if (!drag) return;
      const p = toSvg(ev);
      if (Math.abs(p.x - drag.start.x) + Math.abs(p.y - drag.start.y) > 4) drag.moved = true;
      if (drag.moved) drag.g.setAttribute("transform", `translate(${p.x},${p.y})`);
    });
    svg.addEventListener("pointerup", (ev) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      this._noClick = true;
      if (!d.moved) return this.clickArea(d.id);
      const a = this.draft.areas.find((x) => x.id === d.id);
      Object.assign(a, toSvg(ev));
      this.dirty = true;
      this.render();
    });
    svg.addEventListener("click", (ev) => {
      if (this._noClick) { this._noClick = false; return; }
      const g = ev.target.closest(".fm-area");
      const pg = ev.target.closest(".fm-passage");
      if (g) { if (!(edit && this.tool === "select" && !this.routeFoe)) this.clickArea(g.dataset.aid); return; }
      if (pg) return this.clickPassage(pg.dataset.pid);
      if (!edit) { if (game.user.isGM && this.sel) { this.sel = null; this.render(); } return; }
      if (this.tool === "area") return this.addArea(toSvg(ev));
      this.sel = null; this.linkFrom = null; this.render();
    });
    svg.addEventListener("dblclick", (ev) => { if (edit && !ev.target.closest(".fm-area, .fm-passage")) this.addArea(toSvg(ev)); });
  }

  addArea({ x, y }) {
    const map = this.draft;
    const a = { id: rid(), name: L("newArea", { n: map.areas.length + 1 }), x, y, terrain: "", gmNote: "", secret: false, gather: "", tags: "", triggers: [] };
    map.areas.push(a);
    map.start ??= a.id;
    this.sel = { kind: "area", id: a.id };
    this.dirty = true;
    this.render();
  }

  clickArea(id) {
    const gm = game.user.isGM;
    if (this.mode === "edit" && gm) {
      const map = this.draft;
      if (this.routeFoe) {
        const f = map.foes.find((x) => x.id === this.routeFoe);
        if (f) { f.route = [...(f.route ?? []), id]; this.dirty = true; }
        return this.render();
      }
      if (this.tool === "link") {
        if (this.linkFrom && this.linkFrom !== id && !FM.passageBetween(map, this.linkFrom, id)) {
          map.passages.push({ id: rid(), a: this.linkFrom, b: id, state: "open", oneWay: false, label: "" });
          this.dirty = true;
        }
        this.linkFrom = id;
        return this.render();
      }
      this.sel = { kind: "area", id };
      return this.render();
    }
    // 진행: 갈 수 있는 곳이면 이동(GM) / 제안(플레이어). GM은 그 밖이면 선택
    const map = activeMap();
    const st = mapState();
    if (map && st.active && (!gm || map.id === this.mapId) && FM.playerView(map, st).reachable.includes(id)) return gm ? moveTo(id) : requestMove(id);
    if (gm) { this.sel = { kind: "area", id }; this.render(); }
  }

  clickPassage(id) {
    if (!game.user.isGM) return;
    this.sel = { kind: "passage", id };
    this.render();
  }

  async close(options) {
    if (game.user.isGM && this.dirty) await this.save();
    return super.close(options);
  }
}

/* ---------------- 등록 ---------------- */

export function registerFieldMap() {
  game.settings.register("nssq", "fieldMaps", { scope: "world", config: false, type: Object, default: {}, onChange: () => FieldMapApp.refresh({ maps: true }) });
  game.settings.register("nssq", "fieldMapState", {
    scope: "world", config: false, type: Object, default: {},
    onChange: (v) => {
      FieldMapApp.refresh();
      promptVote(v);
      if (!!v?.active !== fieldActive) { fieldActive = !!v?.active; ui.controls?.initialize(); }
    }
  });
  game.settings.register("nssq", "fieldMapMove", {
    name: "NSSQ.FieldMap.settingMove", hint: "NSSQ.FieldMap.settingMoveHint", scope: "world", config: true, type: String, default: "all",
    choices: { all: "NSSQ.FieldMap.moveAll", gm: "NSSQ.FieldMap.moveGm", free: "NSSQ.FieldMap.moveFree" }
  });
  game.keybindings.register("nssq", "openFieldMap", {
    name: "NSSQ.FieldMap.keybinding", editable: [{ key: "KeyM" }], restricted: false,
    onDown: () => { FieldMapApp.toggle(); return true; }
  });
  Hooks.once("ready", () => { fieldActive = !!mapState().active; });
  Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user.isGM && !mapState().active) return;
    controls.find((c) => c.name === "token")?.tools.push({ name: "nssq-fieldmap", title: "NSSQ.FieldMap.title", icon: "fas fa-map", button: true, onClick: () => FieldMapApp.toggle() });
  });
  Hooks.on("createChatMessage", (m) => trackMapping(m));
  Hooks.on("updateChatMessage", (m) => trackMapping(m));
  onSocket("fieldPropose", onPropose);
  onSocket("fieldAnswer", onAnswer);
  onSocket("fieldVote", async ({ messageId, i, userId }) => { if (isActiveGM()) { const m = game.messages.get(messageId); if (m) await vote(m, i, userId); } });
  Hooks.on("renderChatMessage", (message, html) => {
    const root = html[0];
    if (!root.querySelector(".nssq-fieldmap-card")) return;
    const d = message.getFlag("nssq", "fieldEvent") ?? {};
    root.querySelectorAll(".fm-gm, .fm-gm-only").forEach((el) => { if (!game.user.isGM || d.done === true) el.remove(); });
    if (game.user.isGM) root.querySelectorAll("[data-fm=vote]").forEach((b) => { b.disabled = true; });
    root.querySelectorAll("[data-fm]").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.fm !== "open" && b.dataset.fm !== "vote") b.disabled = true;
      onCard(message, b.dataset.fm, b);
    }));
  });
  // F.O.E. 전투에서 이기면 지도에서 지울지 묻는다
  Hooks.on("nssqBattleEnded", async ({ result, preset }) => {
    const foeId = preset?.getFlag("nssq", "fieldFoe");
    if (!foeId || result !== "victory" || !isActiveGM()) return;
    const foe = activeMap()?.foes.find((f) => f.id === foeId);
    if (foe && (await Dialog.confirm({ title: L("title"), content: `<p>${esc(L("foeDefeatedAsk", { name: foe.name }))}</p>`, rejectClose: false }))) await removeFoe(foeId);
  });
}

let fieldActive = false;
