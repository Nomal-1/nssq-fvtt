/**
 * 원작풍 전투 화면: 전투 중에는 지금 보고 있는 씬(필드) 위에 HTML 화면을 덮는다.
 * - 위: 행동 순서 띠 / 가운데: 에너미 일러스트 줄(이름·【HP】·대상 고르기)
 * - 왼쪽 아래(고정): 커맨드 창 — 머리에 페이즈·GM 진행 버튼, 몸통은 상황에 따라(행동 메뉴·개막 행동·대기)
 * - 맨 아래(전체 폭): 파티 패널 3칸 × 2줄(전열·후열). 빈 칸도 자리를 지켜 카드가 움직이지 않는다
 * - [맵 보기]로 접으면 아래 필드 맵을 그대로 쓸 수 있다(보는 사람마다)
 * 전투원 데이터는 화면에 띄우지 않는 전투 사본 씬의 토큰에 있다(battle.mjs).
 * 다시 그릴 때는 바뀐 곳만 고치고(morph.mjs), 자리를 옮긴 카드는 미끄러지게, 페이즈·차례가 바뀌면 배너,
 * 공격·【HP】 변화에는 피격 이펙트를 띄운다.
 */
import { inRange } from "../engine/combat.mjs";
import { normalAttack } from "./attack.mjs";
import { combatProfile, friendly, sideOf } from "./profile.mjs";
import { changePosition, shuffleRowsDialog } from "./formation.mjs";
import { joinBattle, openEndDialog } from "../apps/battle.mjs";
import { rollEscape, setIdentified, swapWeapon, toggleGuard, toggleRow } from "./tracker.mjs";
import { emit, onSocket } from "../socket.mjs";
import { isActiveGM } from "./apply.mjs";
import { enemyArtFor } from "../apps/enemy-art.mjs";
import { bustStyle, faceStyle } from "../apps/art-config.mjs";
import { flip, morph, snapshot } from "./morph.mjs";
import { identifyDialog } from "./identify.mjs";
import { randomEnemyAction } from "./enemy-ai.mjs";
import { StatusApp, statusChips, statusMarks } from "./status.mjs";
import { allyAnalysisHtml, enemyAnalysisHtml } from "./analysis.mjs";
import { knowsEnemy } from "./bestiary.mjs";
import { actionState, confusedAction, endPhaseMessage, requestEndPhaseApply } from "./turn-status.mjs";
import { actionList, beginAction, pickTarget } from "./skill-use.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Hud.${k}`, d) : game.i18n.localize(`NSSQ.Hud.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pct = (r) => (r?.max > 0 ? Math.clamp(Math.round((r.value / r.max) * 100), 0, 100) : 0);

let root = null;
let fxLayer = null;
let pending = null; // "attack" | { pick: [combatantId], kind, id, combatantId, spec } | null
let menu = null; // { kind: "skill"|"item", combatantId } | null
let collapsed = false;
let banner = null; // { id, text, cls }
let bannerSeq = 0;
let lastPhaseKey = null;
let lastTurnKey = null;
const lastHp = new Map(); // combatant id → 【HP】(피격 숫자용)

/** 진행 중인 NSSQ 전투(전투 개시로 만든 것) */
export const battleCombat = () => game.combats.find((c) => c.getFlag("nssq", "battle") && c.started) ?? null;

const isKO = (c) => c.defeated || (c.actor?.system.hp?.value ?? 0) <= 0;
/** 메인 페이즈의 현재 차례 전투원인가 */
const isCurrent = (c, combat) => combat.getFlag("nssq", "phase") === "main" && combat.combatant?.id === c.id;

function ensureRoot() {
  if (root?.isConnected) return root;
  root = document.createElement("div");
  root.id = "nssq-battle";
  document.body.append(root);
  bindDrop(root);
  bindClicks(root);
  return root;
}

/** 이펙트(피격 숫자·MISS)를 띄우는 층. 전투 화면 위, 클릭은 통과 */
function ensureFx() {
  if (fxLayer?.isConnected) return fxLayer;
  fxLayer = document.createElement("div");
  fxLayer.id = "nssq-battle-fx";
  document.body.append(fxLayer);
  return fxLayer;
}

/**
 * GM: 액터(컴펜디움·액터 목록)를 끌어 놓으면 이 전투에만 난입. 에너미 줄 위쪽 절반에 놓으면 후열.
 * 루트 요소에 한 번만 붙인다(다시 그릴 때마다 붙이면 한 번 놓아도 여러 번 난입한다)
 */
function bindDrop(el) {
  const allowed = () => game.user.isGM && !collapsed && battleCombat();
  el.addEventListener("dragover", (ev) => {
    if (!allowed()) return;
    ev.preventDefault();
    el.classList.add("dropping");
  });
  el.addEventListener("dragleave", (ev) => {
    if (!el.contains(ev.relatedTarget)) el.classList.remove("dropping");
  });
  el.addEventListener("drop", async (ev) => {
    el.classList.remove("dropping");
    const combat = allowed();
    if (!combat) return;
    ev.preventDefault();
    const data = TextEditor.getDragEventData(ev);
    if (data?.type !== "Actor" || !data.uuid) return ui.notifications.warn(game.i18n.localize("NSSQ.Battle.joinActorOnly"));
    const area = el.querySelector(".nb-enemies")?.getBoundingClientRect();
    const row = area && ev.clientY < area.top + area.height / 2 ? "back" : "front";
    await joinBattle(combat, data.uuid, { row });
  });
}

/* ---------------- 상태 자세히(카드를 누르면) ---------------- */

let popId = null;
let popEl = null;

function closePop() {
  popId = null;
  popEl?.remove();
  popEl = null;
}

/** 카드 옆에 상태 이상·강화·약화 자세히(플레이어도). 같은 카드를 다시 누르면 닫힌다 */
function togglePop(combat, c, card) {
  if (popId === c.id) return closePop();
  popId = c.id;
  if (!popEl) {
    popEl = document.createElement("div");
    popEl.id = "nssq-status-pop";
    document.body.append(popEl);
    popEl.addEventListener("click", (ev) => {
      if (ev.target.closest("[data-pop-close]")) return closePop();
      // GM: 상태 이상·강화·약화 부여 창
      if (ev.target.closest("[data-pop-status]")) {
        const c = battleCombat()?.combatants.get(popId);
        if (c?.actor) StatusApp.open(c.actor);
      }
    });
  }
  fillPop(c);
  // 에너미는 실제 그림 기준(카드는 줄 높이 전체라 그림보다 크다)
  const r = (card.querySelector(".art img") ?? card).getBoundingClientRect();
  const w = popEl.offsetWidth || 300;
  const h = popEl.offsetHeight || 200;
  let left = r.right + 8;
  if (left + w > window.innerWidth - 8) left = Math.max(8, r.left - w - 8);
  let top = Math.min(Math.max(8, r.top), window.innerHeight - h - 8);
  // 아군 카드(화면 아래)는 전투 화면 가운데에 띄운다
  if (c.actor?.type !== "enemy") {
    const field = root?.getBoundingClientRect() ?? { left: 0, width: window.innerWidth, top: 0, height: window.innerHeight };
    left = Math.max(8, field.left + (field.width - w) / 2);
    top = Math.max(8, field.top + (field.height - h) / 2 - 60);
  }
  popEl.style.left = `${left}px`;
  popEl.style.top = `${top}px`;
}

/** 에너미는 원작풍 정보 화면(식별에 따라 ???), 아군도 같은 모양(능력치·강화·약화·상태 이상) */
function fillPop(c) {
  const enemy = c.actor?.type === "enemy";
  popEl.classList.add("analysis");
  popEl.classList.toggle("ally", !enemy);
  popEl.innerHTML = enemy ? enemyAnalysisHtml(c.actor, c.name) : allyAnalysisHtml(c.actor, c.name);
}

/** 다시 그릴 때 열려 있는 창의 내용도 맞춘다 */
function refreshPop(combat) {
  if (!popId || !popEl) return;
  const c = combat.combatants.get(popId);
  if (!c?.actor) return closePop();
  fillPop(c);
}

export function clearHud() {
  closePop();
  root?.remove();
  root = null;
  fxLayer?.remove();
  fxLayer = null;
  pending = null;
  banner = null;
  lastPhaseKey = lastTurnKey = null;
  lastHp.clear();
}

/** 사이드바를 가리지 않게 오른쪽 끝을 맞춘다 */
function fitToViewport(el) {
  const sidebar = document.getElementById("sidebar");
  const w = sidebar && !ui.sidebar?._collapsed ? sidebar.offsetWidth : (sidebar?.offsetWidth ?? 0);
  el.style.right = `${w + 4}px`;
  el.classList.toggle("compact", window.innerWidth - w < 1000);
}

/* ---------------- 조각 ---------------- */

function orderStrip(combat) {
  const phase = combat.getFlag("nssq", "phase") ?? "opening";
  const curIdx = combat.turn ?? -1;
  const items = combat.turns.map((c, i) => {
    const cls = [sideOf(c.actor) === "enemy" ? "enemy" : "", phase === "main" && i === curIdx ? "current" : "", phase === "main" && i < curIdx ? "done" : "", isKO(c) ? "ko" : ""].join(" ");
    const init = c.initiative !== null && c.initiative !== undefined && (game.user.isGM || sideOf(c.actor) !== "enemy")
      ? `<em class="init" title="${esc(L("initiative"))}">${Math.round(c.initiative * 10) / 10}</em>` : "";
    return `<span class="who ${cls}" data-key="o-${c.id}" data-flip><img src="${esc(c.img)}"/><span>${esc(c.name)}</span>${init}</span>`;
  }).join('<i class="fas fa-chevron-right sep"></i>');
  return `<div class="nb-order">${items}</div>`;
}

/** 「n턴 · ○○ 페이즈」(전멸이면 결과) */
function phaseLabel(combat) {
  const phase = combat.getFlag("nssq", "phase") ?? "opening";
  const over = combat.getFlag("nssq", "over");
  return over ? L(over === "victory" ? "victory" : "defeat") : `${combat.round}${L("round")} · ${game.i18n.localize(`NSSQ.Combat.phase.${phase}`)}`;
}

/** GM 진행 버튼: 다음 턴·페이즈, 도주 판정, 결과 정리 */
function gmControls(combat) {
  if (!game.user.isGM) return "";
  const phase = combat.getFlag("nssq", "phase") ?? "opening";
  const over = combat.getFlag("nssq", "over");
  const C = (k) => game.i18n.localize(`NSSQ.Combat.${k}`);
  if (over) return `<button type="button" data-gm="end"><i class="fas fa-flag-checkered"></i> ${C(over === "victory" ? "endVictory" : "endDefeat")}</button>`;
  const idValue = combat.getFlag("nssq", "battle")?.identifyValue;
  return `<button type="button" data-gm="identify" title="${esc(game.i18n.localize("NSSQ.Identify.hint"))}"><i class="fas fa-search"></i> ${game.i18n.localize("NSSQ.Identify.title")}${idValue !== null && idValue !== undefined ? ` (${idValue})` : ""}</button>
    <button type="button" data-gm="finish" title="${esc(L("finishHint"))}"><i class="fas fa-flag-checkered"></i> ${L("finish")}</button>
    ${phase === "opening" ? `<button type="button" data-gm="escape"><i class="fas fa-running"></i> ${C("escape")}</button>` : ""}
    <button type="button" data-gm="shuffle" title="${esc(L("shuffleHint"))}"><i class="fas fa-random"></i> ${L("shuffle")}</button>
    <button type="button" data-gm="next"><i class="fas fa-forward"></i> ${phase === "main" ? C("nextTurn") : C("nextPhase")}</button>`;
}

/** 지금 공격할 수 있는 대상(사거리 안, 적 편, 쓰러지지 않음) */
function attackTargets(combat, attacker) {
  const a = combatProfile(attacker, combat.combatants.find((x) => x.actor === attacker));
  return combat.combatants.filter((c) => c.actor && !friendly(attacker, c.actor) && !isKO(c))
    .filter((c) => inRange(a.range, a.row, c.actor.system.row ?? "front"));
}

const DEFAULT_ICONS = new Set(["icons/svg/mystery-man.svg", "icons/svg/mystery-man-black.svg", ""]);
/** 에너미 그림: 토큰 그림 → (기본 아이콘이면) 일러스트 → 액터 그림 */
function enemyImage(c) {
  const t = c.token?.texture?.src ?? "";
  if (!DEFAULT_ICONS.has(t)) return t;
  return enemyArtFor(c.actor) ?? (DEFAULT_ICONS.has(c.actor.img) ? t || c.actor.img : c.actor.img);
}

function enemyCard(c, combat, targetable) {
  const a = c.actor;
  const s = a.system;
  const showHp = game.user.isGM || knowsEnemy(a);
  const cls = ["nb-enemy", s.row === "back" ? "back" : "front", isKO(c) ? "ko" : "", isCurrent(c, combat) ? "current" : "", targetable ? "targetable" : ""].join(" ");
  const tools = game.user.isGM ? `<div class="gm-tools">
      <a data-tool="identify" class="${s.identified ? "on" : ""}" title="${esc(game.i18n.localize(s.identified ? "NSSQ.Combat.identifiedOn" : "NSSQ.Combat.identifiedOff"))}"><i class="fas ${s.identified ? "fa-eye" : "fa-eye-slash"}"></i></a>
      <a data-tool="row" title="${esc(game.i18n.localize("NSSQ.Combat.changeRow"))}"><i class="fas fa-arrows-alt-v"></i></a>
      <a data-tool="defeated" class="${c.defeated ? "on" : ""}" title="${esc(L("toggleDefeated"))}"><i class="fas fa-skull"></i></a>
      <a data-tool="status" title="${esc(game.i18n.localize("NSSQ.Conditions.button"))}"><i class="fas fa-heartbeat"></i></a>
      <a data-tool="sheet" title="${esc(L("openSheet"))}"><i class="fas fa-id-card"></i></a>
    </div>` : "";
  // 이름·【HP】·상태 표시·GM 도구를 한 덩어리(plate)로 그림에 붙인다. 그림 크기와 관계없이 전열은 그림 아래, 후열은 그림 위
  return `<div class="${cls}" data-combatant="${c.id}" data-key="e-${c.id}" data-flip title="${esc(c.name)}">
    <div class="art"><img src="${esc(enemyImage(c))}"/></div>
    <div class="plate">
      <div class="name">${s.isRare && (game.user.isGM || s.rareKnown) ? `<span class="rare" title="${esc(game.i18n.localize("NSSQ.Rare.gmOnly"))}">★</span>` : ""}${esc(c.name)}${s.row === "back" ? ` <em>${L("back")}</em>` : ""}</div>
      <div class="nb-bar hp ${showHp ? "" : "unknown"}"><i style="width:${showHp ? pct(s.hp) : 100}%"></i>${showHp ? `<span>${s.hp?.value ?? 0}/${s.hp?.max ?? 0}</span>` : ""}</div>
      ${statusMarks(a)}
      ${tools}
    </div>
  </div>`;
}

function partyCard(c, combat, targetable) {
  const a = c.actor;
  const s = a.system;
  const cls = a.type === "character" ? s.classItems?.main?.name ?? "" : "";
  const guard = c.getFlag("nssq", "guarding");
  const bar = (k, r) => `<div class="nb-bar ${k}"><b>${k.toUpperCase()}</b><i style="width:${pct(r)}%"></i><span>${r?.value ?? 0}/${r?.max ?? 0}</span></div>`;
  const classes = ["nb-member", isKO(c) ? "ko" : "", isCurrent(c, combat) ? "current" : "", a.isOwner && !game.user.isGM ? "mine" : "", targetable ? "targetable" : ""].join(" ");
  return `<div class="${classes}" data-combatant="${c.id}" data-key="p-${c.id}" data-flip>
    <div class="portrait" style="${a.type === "character" ? faceStyle(a) : `background-image: url('${esc(a.img)}'); background-size: cover; background-position: center top;`}"></div>
    <div class="info">
      <div class="line"><span class="name">${esc(c.name)}</span>${sideOf(a) === "ally" ? `<em class="npc">NPC</em>` : ""}${guard ? `<em class="guard"><i class="fas fa-shield-alt"></i> ${L("guard")}</em>` : ""}${statusChips(a)}
        <span class="cls">${cls ? `${esc(cls)} Lv${s.level}` : ""}${isKO(c) ? ` · ${L("ko")}` : ""}</span></div>
      <div class="bars">${bar("hp", s.hp)}${a.type === "character" ? bar("tp", s.tp) : ""}</div>
    </div>
    <span class="nb-member-tools">${a.isOwner ? `<a data-tool="sheet" title="${esc(L("openSheet"))}"><i class="fas fa-id-card"></i></a>` : ""}${game.user.isGM ? `<a data-tool="status" title="${esc(game.i18n.localize("NSSQ.Conditions.button"))}"><i class="fas fa-heartbeat"></i></a>` : ""}</span>
  </div>`;
}

/** [스킬]·[아이템] 목록(커맨드 창 안) */
function actionMenu(combat, c) {
  const S = (k, d) => (d ? game.i18n.format(`NSSQ.SkillUse.${k}`, d) : game.i18n.localize(`NSSQ.SkillUse.${k}`));
  const list = actionList(combat, c, menu.kind);
  const rows = list.map((x) => `<button type="button" class="act ${x.ok ? "" : "disabled"}" data-action-id="${x.id}" title="${esc(x.ok ? x.target ?? "" : S(`reason.${x.reason}`))}">
      <span class="nm">${esc(x.name)}</span><small>${esc(x.cost)} · ${esc(x.target ?? "")}</small>${x.ok ? "" : `<em>${esc(S(`reason.${x.reason}`))}</em>`}</button>`).join("");
  return `<div class="who">${esc(S(menu.kind === "item" ? "itemTitle" : "skillTitle", { name: c.name }))}</div>
    <div class="action-list" data-combatant="${c.id}">
      <button type="button" class="act back" data-act="back"><i class="fas fa-arrow-left"></i> ${esc(S("back"))}</button>
      ${rows || `<p class="wait">${esc(S(menu.kind === "item" ? "noItems" : "noSkills"))}</p>`}
    </div>`;
}

/** 커맨드 창 몸통: 메인 페이즈는 현재 차례 전투원, 개막 페이즈는 내가 맡은 아군 모두 */
function commandBody(combat) {
  const phase = combat.getFlag("nssq", "phase") ?? "opening";
  const over = combat.getFlag("nssq", "over");
  if (over) return `<p class="wait">${L(over === "victory" ? "victory" : "defeat")}</p>`;
  if (phase === "main") {
    const c = combat.combatant;
    if (!c?.actor) return "";
    if (!c.actor.isOwner || isKO(c)) return `<p class="wait">${L("acting", { name: esc(c.name) })}</p>`;
    const cmd = (id, icon, label, { active = false, disabled = false, title = "" } = {}) =>
      `<button type="button" data-cmd="${id}" class="cmd ${active ? "active" : ""}" ${disabled ? "disabled" : ""} title="${esc(title || label)}"><i class="fas ${icon}"></i> ${esc(label)}</button>`;
    // [혼란] 판정 실패: 같은 열 아군에게 통상 공격만(수동 스킬은 가능)
    const st = actionState(c);
    if (st.confused) {
      return `<div class="who">${L("whoseAction", { name: esc(c.name) })}</div>
      <p class="notes">${esc(game.i18n.localize("NSSQ.Turn.confusedHint"))}</p>
      <div class="cmds" data-combatant="${c.id}">
        ${cmd("confused", "fa-dizzy", game.i18n.localize("NSSQ.Turn.confusedButton"))}
        ${cmd("end", "fa-forward", L("endTurn"))}
      </div>`;
    }
    if (st.noAction) return `<p class="wait">${esc(game.i18n.format("NSSQ.Turn.cannotAct", { name: c.name, reason: st.reason }))}</p>`;
    if (menu && menu.combatantId === c.id) return actionMenu(combat, c);
    return `<div class="who">${L("whoseAction", { name: esc(c.name) })}</div>
      <div class="cmds" data-combatant="${c.id}">
        ${game.user.isGM && sideOf(c.actor) === "enemy" ? cmd("random", "fa-dice", L("randomAction"), { title: L("randomActionHint") }) : ""}
        ${cmd("attack", "fa-fist-raised", L("attack"), { active: pending === "attack" })}
        ${cmd("skill", "fa-magic", L("skill"))}
        ${cmd("item", "fa-flask", L("item"))}
        ${cmd("end", "fa-forward", L("endTurn"))}
      </div>`;
  }
  if (phase === "opening") {
    // 플레이어: 자기 캐릭터. GM: 동료 NPC, 그 아래 에너미
    const mine = (c) => (game.user.isGM ? sideOf(c.actor) !== "pc" : c.actor.isOwner && sideOf(c.actor) !== "enemy");
    const list = combat.turns.filter((c) => c.actor && mine(c) && !isKO(c))
      .sort((a, b) => (sideOf(a.actor) === "enemy") - (sideOf(b.actor) === "enemy"));
    if (!list.length) return `<p class="wait">${L("openingWait")}</p>`;
    const open = menu && list.find((c) => c.id === menu.combatantId);
    if (open) return actionMenu(combat, open);
    return `<div class="who">${L("openingTitle")}</div>` + list.map((c) => {
      // 행동 불가·혼란 판정 실패는 개막 행동 없음
      const st = actionState(c);
      if (st.noOpening) return `<div class="opening-row disabled" data-combatant="${c.id}"><span class="name">${esc(c.name)}</span><span class="notes">${esc(game.i18n.format("NSSQ.Turn.noOpening", { reason: st.reason }))}</span></div>`;
      const guarding = !!c.getFlag("nssq", "guarding");
      return `<div class="opening-row ${sideOf(c.actor) === "enemy" ? "enemy" : ""} ${c.getFlag("nssq", "opening") ? "done" : ""}" data-combatant="${c.id}"><span class="name">${esc(c.name)}</span>
        <button type="button" data-cmd="guard" class="${guarding ? "active" : ""}" title="${guarding ? L("guardOff") : L("guard")}"><i class="fas fa-shield-alt"></i> ${L("guard")}</button>
        <button type="button" data-cmd="row" title="${L("row")}"><i class="fas fa-arrows-alt-v"></i> ${L("row")}</button>
        ${c.actor.type === "character" ? `<button type="button" data-cmd="swap" title="${L("swap")}"><i class="fas fa-exchange-alt"></i> ${L("swapShort")}</button>` : ""}
        <button type="button" data-cmd="skill" title="${L("skill")}"><i class="fas fa-magic"></i> ${L("skill")}</button>
      </div>`;
    }).join("");
  }
  if (phase === "end") {
    // 종료 페이즈: 채팅에 올라온 결과를 그대로, GM은 [적용]·[되돌리기]
    const msg = endPhaseMessage(combat);
    const data = msg?.getFlag("nssq", "endPhase");
    if (!data) return `<p class="wait">${esc(game.i18n.localize("NSSQ.Turn.endProcessing"))}</p>`;
    const T = (k) => game.i18n.localize(`NSSQ.Turn.${k}`);
    const buttons = game.user.isGM && data.updates?.length
      ? `<div class="end-buttons" data-message="${msg.id}">${data.applied
        ? `<button type="button" data-endphase="undo"><i class="fas fa-undo"></i> ${esc(T("undo"))}</button>`
        : `<button type="button" data-endphase="apply"><i class="fas fa-check"></i> ${esc(T("apply"))}</button>`}</div>` : "";
    return `<div class="who">${esc(game.i18n.format("NSSQ.Turn.endTitle", { round: combat.round }))}</div>
      <div class="end-body nssq-end-phase">${data.body ?? ""}</div>
      ${data.updates?.length ? `<p class="notes">${esc(data.applied ? T("applied") : T("notApplied"))}</p>` : ""}${buttons}`;
  }
  return "";
}

/** 커맨드 창(항상 같은 자리·크기): 머리 = 페이즈 + GM 진행 버튼 */
function commandWindow(combat) {
  const gm = gmControls(combat);
  return `<div class="nb-command" data-key="command">
    <div class="head"><span class="phase">${phaseLabel(combat)}</span></div>
    ${gm ? `<div class="gm">${gm}</div>` : ""}
    <div class="body"><div class="body-in" data-key="body-${combat.round}-${combat.getFlag("nssq", "phase")}-${combat.turn}-${combat.getFlag("nssq", "over") ?? ""}">${commandBody(combat)}</div></div>
  </div>`;
}

/* ---------------- 그리기 ---------------- */

export function renderHud() {
  const combat = battleCombat();
  if (!combat) return clearHud();
  const el = ensureRoot();
  fitToViewport(el);
  el.classList.toggle("collapsed", collapsed);
  if (collapsed) {
    morph(el, `<button type="button" class="nb-open" data-ui="toggle"><i class="fas fa-skull-crossbones"></i> ${L("openBattle")}</button>`);
    return;
  }
  updateBanner(combat);
  const hpChanges = diffHp(combat);
  const before = snapshot(el);
  morph(el, battleHtml(combat));
  flip(el, before);
  refreshPop(combat);
  for (const h of hpChanges) hpEffect(h.id, h.delta);
}

/** 페이즈·차례가 바뀌면 화면 가운데에 배너(처음 그릴 때는 없음) */
function updateBanner(combat) {
  const phase = combat.getFlag("nssq", "phase") ?? "opening";
  const over = combat.getFlag("nssq", "over");
  const phaseKey = `${combat.round}:${phase}:${over ?? ""}`;
  const turnKey = phase === "main" ? `${phaseKey}:${combat.combatant?.id ?? ""}` : null;
  let next = null;
  if (lastPhaseKey !== null && phaseKey !== lastPhaseKey) next = { text: phaseLabel(combat), cls: over ? "big over" : "big" };
  else if (lastTurnKey !== null && turnKey && turnKey !== lastTurnKey && combat.combatant) next = { text: L("turnOf", { name: combat.combatant.name }), cls: sideOf(combat.combatant.actor) === "enemy" ? "small enemy" : "small" };
  lastPhaseKey = phaseKey;
  lastTurnKey = turnKey;
  if (!next) return;
  const id = ++bannerSeq;
  banner = { id, ...next };
  setTimeout(() => {
    if (banner?.id !== id) return;
    banner = null;
    rerender();
  }, next.cls.includes("big") ? 1700 : 1100);
}

/** 지난번과 비교한 【HP】 변화(쓰러진 뒤 회복 등 포함) */
function diffHp(combat) {
  const out = [];
  for (const c of combat.combatants) {
    const hp = c.actor?.system.hp?.value;
    if (hp === undefined) continue;
    const prev = lastHp.get(c.id);
    if (prev !== undefined && prev !== hp) out.push({ id: c.id, delta: hp - prev });
    lastHp.set(c.id, hp);
  }
  return out;
}

/* ---------------- 이펙트 ---------------- */

const cardEl = (combatantId) => root?.querySelector(`[data-key="e-${combatantId}"], [data-key="p-${combatantId}"]`);

/** 카드 위에 떠오르는 글자 */
function popText(card, text, cls) {
  if (!card) return;
  const fx = ensureFx();
  // 에너미는 실제 그림, 파티는 얼굴 칸의 가운데(카드 위쪽 빈 공간에 뜨지 않게)
  const pic = card.querySelector(".art img") ?? card.querySelector(".portrait") ?? card;
  const r = pic.getBoundingClientRect();
  const n = document.createElement("div");
  n.className = `nb-pop ${cls}`;
  n.textContent = text;
  n.style.left = `${r.left + r.width / 2}px`;
  n.style.top = `${r.top + r.height * (pic === card ? 0.45 : 0.55)}px`;
  fx.append(n);
  n.addEventListener("animationend", () => n.remove());
}

/** 명중 순간: 붉은 번쩍임만(흔들림은 대미지가 들어갈 때) */
function hitFlash(card) {
  const target = card?.querySelector(".art img, .portrait") ?? card;
  target?.animate([
    { filter: "brightness(2.2) saturate(0.4) drop-shadow(0 0 12px #ff4a3a)" },
    { filter: "brightness(1)" }
  ], { duration: 380, easing: "ease-out" });
}

/** 대미지: 흔들림 + 붉은 번쩍임(속성은 건드리지 않는 Web Animations) */
function hitShake(card, strong = false) {
  if (!card) return;
  const a = strong ? 10 : 6;
  card.animate([
    { transform: "translateX(0)" }, { transform: `translateX(-${a}px)` }, { transform: `translateX(${a}px)` },
    { transform: `translateX(-${a / 2}px)` }, { transform: `translateX(${a / 2}px)` }, { transform: "translateX(0)" }
  ], { duration: 360, easing: "ease-out" });
  const target = card.querySelector(".art img, .portrait") ?? card;
  target.animate([
    { filter: "brightness(2.2) saturate(0.4) drop-shadow(0 0 12px #ff4a3a)" },
    { filter: "brightness(1)" }
  ], { duration: 420, easing: "ease-out" });
}

function hpEffect(combatantId, delta) {
  const card = cardEl(combatantId);
  if (delta < 0) {
    hitShake(card, delta <= -10);
    popText(card, `${delta}`, "dmg");
  } else popText(card, `+${delta}`, "heal");
}

/** 공격 카드가 올라오면: 맞았으면 번쩍임(크리티컬은 글자도), 빗나갔으면 MISS. 흔들림은 【HP】가 깎일 때 */
async function attackEffect(message) {
  const card = message.getFlag("nssq", "attack");
  const combat = battleCombat();
  if (!card || !combat || collapsed) return;
  if (game.dice3d) await game.dice3d.waitFor3DAnimationByMessageID?.(message.id);
  for (const t of card.targets ?? []) {
    const c = combat.combatants.find((x) => x.actor?.uuid === t.actorUuid);
    const el = c && cardEl(c.id);
    if (!el) continue;
    if (!t.hit) popText(el, L("miss"), "miss");
    else {
      hitFlash(el);
      if (t.crit) popText(el, L("critical"), "crit");
    }
  }
}

/** 메인 페이즈에 행동하는 캐릭터(플레이어·동료 NPC)의 상반신. 에너미 차례에는 없다 */
function bust(combat) {
  if (combat.getFlag("nssq", "phase") !== "main" || combat.getFlag("nssq", "over")) return "";
  const c = combat.combatant;
  if (!c?.actor || c.actor.type !== "character" || isKO(c)) return "";
  return `<div class="nb-bust" data-key="bust-${c.id}" style="${bustStyle(c.actor)}"><span class="nb-bust-name">${esc(c.name)}</span></div>`;
}

/** 펼친 전투 화면의 HTML */
export function battleHtml(combat, { attack = pending === "attack" } = {}) {
  const info = combat.getFlag("nssq", "battle") ?? {};
  const bg = game.scenes.get(info.copy)?.background?.src;
  const attacker = attack ? combat.combatant?.actor : null;
  const picking = pending && typeof pending === "object" && pending.pick;
  const targets = new Set(picking ? pending.pick : attacker ? attackTargets(combat, attacker).map((c) => c.id) : []);
  const enemies = combat.turns.filter((c) => c.actor && sideOf(c.actor) === "enemy")
    .sort((a, b) => (a.actor.system.row === b.actor.system.row ? (a.actor.system.order ?? 0) - (b.actor.system.order ?? 0) : a.actor.system.row === "back" ? -1 : 1));
  // 파티: 전열·후열 각 3칸. 칸 순서는 진형 배치(사본 씬 토큰의 가로 위치)를 따른다
  const party = combat.combatants.filter((c) => c.actor && sideOf(c.actor) !== "enemy")
    .sort((a, b) => (a.token?.x ?? 0) - (b.token?.x ?? 0));
  const slots = (row) => {
    const cards = party.filter((c) => (c.actor.system.row ?? "front") === row).map((c) => partyCard(c, combat, targets.has(c.id)));
    while (cards.length < 3) cards.push(`<div class="nb-member empty" data-key="empty-${row}-${cards.length}"></div>`);
    return cards.join("");
  };

  return `
    <div class="nb-bg" data-key="bg" ${bg ? `style="background-image:url('${esc(bg)}')"` : ""}></div>
    <div class="nb-top" data-key="top">
      <button type="button" class="nb-map" data-ui="toggle" title="${esc(L("mapHint"))}"><i class="fas fa-map"></i> ${L("showMap")}</button>
      ${orderStrip(combat)}
    </div>
    <div class="nb-field" data-key="field">
      <div data-key="enemies" class="nb-enemies ${enemies.some((c) => c.actor.system.row === "back") ? "has-back" : ""} ${bust(combat) ? "has-bust" : ""}">
        <div class="nb-erow back" data-key="erow-back">${enemies.filter((c) => c.actor.system.row === "back").map((c) => enemyCard(c, combat, targets.has(c.id))).join("")}</div>
        <div class="nb-erow front" data-key="erow-front">${enemies.filter((c) => c.actor.system.row !== "back").map((c) => enemyCard(c, combat, targets.has(c.id))).join("")}</div>
      </div>
      ${attacker || picking ? `<div class="nb-hint" data-key="hint">${targets.size ? L("pickTarget") : L("noTarget")}</div>` : ""}
      ${commandWindow(combat)}
      ${bust(combat)}
      ${game.user.isGM ? `<div class="nb-drop" data-key="drop">${L("dropHint")}</div>` : ""}
      ${banner ? `<div class="nb-banner ${banner.cls}" data-key="banner-${banner.id}"><span>${esc(banner.text)}</span></div>` : ""}
    </div>
    <div class="nb-party" data-key="party">
      <div class="nb-row front" data-key="prow-front"><span class="label">${L("front")}</span>${slots("front")}</div>
      <div class="nb-row back" data-key="prow-back"><span class="label">${L("back")}</span>${slots("back")}</div>
    </div>`;
}

/** 클릭은 루트에 한 번만 붙여 위임한다(바뀐 곳만 고치므로 요소마다 붙이면 겹친다) */
function bindClicks(el) {
  el.addEventListener("click", async (ev) => {
    const combat = battleCombat();
    if (!combat) return;
    const hit = (sel) => ev.target.closest(sel);
    let t;
    if ((t = hit("[data-ui=toggle]"))) {
      collapsed = !collapsed;
      return renderHud();
    }
    if ((t = hit("[data-gm]"))) {
      switch (t.dataset.gm) {
        case "next": return combat.nextPhase();
        case "end": return combat.nextTurn();
        case "escape": return rollEscape(combat);
        case "shuffle": return shuffleRowsDialog(combat);
        case "finish": return openEndDialog();
        case "identify": return identifyDialog(combat);
      }
      return;
    }
    if ((t = hit("[data-endphase]"))) {
      const id = t.closest("[data-message]")?.dataset.message;
      if (id) return requestEndPhaseApply(id, t.dataset.endphase === "undo");
      return;
    }
    // [스킬]·[아이템] 목록
    if ((t = hit("[data-act=back]"))) { menu = null; return renderHud(); }
    if ((t = hit("[data-action-id]"))) {
      const c = combat.combatants.get(t.closest("[data-combatant]")?.dataset.combatant);
      if (!c || !menu) return;
      const kind = menu.kind;
      const r = await beginAction(combat, c, kind, t.dataset.actionId);
      menu = null;
      if (r?.pick) pending = { pick: r.pick, kind, id: t.dataset.actionId, combatantId: c.id, spec: r.spec };
      return renderHud();
    }
    if ((t = hit("[data-cmd]"))) {
      if (t.disabled) return;
      const c = combat.combatants.get(t.closest("[data-combatant]")?.dataset.combatant);
      if (!c) return;
      switch (t.dataset.cmd) {
        case "attack": pending = pending === "attack" ? null : "attack"; menu = null; return renderHud();
        case "skill":
        case "item": pending = null; menu = menu?.combatantId === c.id && menu.kind === t.dataset.cmd ? null : { kind: t.dataset.cmd, combatantId: c.id }; return renderHud();
        case "end": return requestEndTurn(combat);
        case "random": pending = null; return randomEnemyAction(combat);
        case "confused": pending = null; return confusedAction(combat, c);
        case "guard": return toggleGuard(c);
        case "row": return toggleRow(c);
        case "swap": return swapWeapon(c);
      }
      return;
    }
    // GM: 에너미 카드 도구
    if ((t = hit(".nb-enemy [data-tool]"))) {
      const c = combat.combatants.get(t.closest("[data-combatant]")?.dataset.combatant);
      if (!c?.actor) return;
      switch (t.dataset.tool) {
        case "identify": return setIdentified([c.actor], !c.actor.system.identified);
        case "row": return changePosition(c);
        case "defeated": return c.update({ defeated: !c.defeated });
        case "sheet": return c.actor.sheet.render(true);
        case "status": return StatusApp.open(c.actor);
      }
      return;
    }
    // 파티 카드 도구: 시트(소유자), [상태](GM)
    if ((t = hit(".nb-member [data-tool]"))) {
      const c = combat.combatants.get(t.closest("[data-combatant]")?.dataset.combatant);
      if (t.dataset.tool === "sheet") return c?.actor?.sheet.render(true);
      return StatusApp.open(c?.actor);
    }
    // 대상 고르기(공격 중) / 그 밖에는 시트 열기(권한이 있을 때)
    if ((t = hit(".nb-enemy, .nb-member:not(.empty)"))) {
      const c = combat.combatants.get(t.dataset.combatant);
      if (!c) return;
      // 스킬·아이템 대상 고르기
      if (pending && typeof pending === "object" && pending.pick && t.classList.contains("targetable")) {
        const p = pending;
        pending = null;
        renderHud();
        const user = combat.combatants.get(p.combatantId);
        if (user) return pickTarget(combat, user, p.kind, p.id, c, p.spec);
        return;
      }
      if (pending === "attack" && t.classList.contains("targetable")) {
        const attacker = combat.combatant.actor;
        pending = null;
        renderHud();
        return normalAttack(attacker, { target: c.token });
      }
      // 어느 카드든 누르면 상태 자세히(시트는 카드의 신분증 아이콘)
      return togglePop(combat, c, t);
    }
  });
}

/** 턴 종료: GM은 바로, 플레이어는 GM에게 부탁 */
function requestEndTurn(combat) {
  pending = null;
  if (game.user.isGM) return combat.nextTurn();
  if (!combat.combatant?.actor?.isOwner) return;
  emit("endTurn", { combatId: combat.id, combatantId: combat.combatant.id });
}

/* ---------------- 등록 ---------------- */

const rerender = foundry.utils.debounce(() => renderHud(), 50);

export function registerHud() {
  onSocket("endTurn", ({ combatId, combatantId }) => {
    if (!isActiveGM()) return;
    const combat = game.combats.get(combatId);
    if (combat?.combatant?.id === combatantId) combat.nextTurn();
  });
  Hooks.once("ready", () => renderHud());
  // 창 밖을 누르거나 Esc면 닫는다
  document.addEventListener("mousedown", (ev) => {
    if (popEl && !ev.target.closest("#nssq-status-pop, .nb-enemy, .nb-member")) closePop();
  });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closePop(); });
  window.addEventListener("resize", rerender);
  Hooks.on("collapseSidebar", () => setTimeout(renderHud, 250));
  for (const hook of ["updateCombat", "createCombat", "updateCombatant", "createCombatant", "deleteCombatant", "updateActor", "updateToken", "createItem", "updateItem", "deleteItem"]) Hooks.on(hook, rerender);
  Hooks.on("updateCombat", (combat, changes) => {
    if (foundry.utils.hasProperty(changes, "turn") || foundry.utils.hasProperty(changes, "flags.nssq.phase")) { pending = null; menu = null; }
    // 새 전투가 시작되면 화면을 펼친다
    if (foundry.utils.hasProperty(changes, "started") && changes.started) collapsed = false;
  });
  Hooks.on("deleteCombat", () => setTimeout(renderHud, 50));
  Hooks.on("nssqBestiary", rerender);
  // 종료 페이즈 카드가 생기거나 적용되면 커맨드 창도
  for (const hook of ["createChatMessage", "updateChatMessage"]) Hooks.on(hook, (m) => { if (m.getFlag("nssq", "endPhase")) rerender(); });
  Hooks.on("createChatMessage", (message) => attackEffect(message));
}
