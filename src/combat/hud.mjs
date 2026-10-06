/**
 * 원작풍 전투 화면: 전투 중에는 지금 보고 있는 씬(필드) 위에 HTML 화면을 덮는다.
 * - 위: 행동 순서 띠 / 가운데: 에너미 일러스트 줄(이름·【HP】·대상 고르기)
 * - 왼쪽 아래(고정): 커맨드 창 — 머리에 페이즈·GM 진행 버튼, 몸통은 상황에 따라(행동 메뉴·개막 행동·대기)
 * - 맨 아래(전체 폭): 파티 패널 3칸 × 2줄(전열·후열). 빈 칸도 자리를 지켜 카드가 움직이지 않는다
 * - [맵 보기]로 접으면 아래 필드 맵을 그대로 쓸 수 있다(보는 사람마다)
 * 전투원 데이터는 화면에 띄우지 않는 전투 사본 씬의 토큰에 있다(battle.mjs).
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

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Hud.${k}`, d) : game.i18n.localize(`NSSQ.Hud.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pct = (r) => (r?.max > 0 ? Math.clamp(Math.round((r.value / r.max) * 100), 0, 100) : 0);

let root = null;
let pending = null; // "attack" | null
let collapsed = false;

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
  return root;
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

export function clearHud() {
  root?.remove();
  root = null;
  pending = null;
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
    return `<span class="who ${cls}"><img src="${esc(c.img)}"/><span>${esc(c.name)}</span>${init}</span>`;
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
  const unknown = combat.combatants.some((c) => c.actor?.type === "enemy" && !c.actor.system.identified);
  return `${unknown ? `<button type="button" data-gm="identifyAll" title="${esc(C("identifyAllHint"))}"><i class="fas fa-eye"></i> ${C("identifyAll")}</button>` : ""}
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
  const showHp = game.user.isGM || s.identified;
  const cls = ["nb-enemy", s.row === "back" ? "back" : "front", isKO(c) ? "ko" : "", isCurrent(c, combat) ? "current" : "", targetable ? "targetable" : ""].join(" ");
  const tools = game.user.isGM ? `<div class="gm-tools">
      <a data-tool="identify" class="${s.identified ? "on" : ""}" title="${esc(game.i18n.localize(s.identified ? "NSSQ.Combat.identifiedOn" : "NSSQ.Combat.identifiedOff"))}"><i class="fas ${s.identified ? "fa-eye" : "fa-eye-slash"}"></i></a>
      <a data-tool="row" title="${esc(game.i18n.localize("NSSQ.Combat.changeRow"))}"><i class="fas fa-arrows-alt-v"></i></a>
      <a data-tool="defeated" class="${c.defeated ? "on" : ""}" title="${esc(L("toggleDefeated"))}"><i class="fas fa-skull"></i></a>
      <a data-tool="sheet" title="${esc(L("openSheet"))}"><i class="fas fa-id-card"></i></a>
    </div>` : "";
  return `<div class="${cls}" data-combatant="${c.id}" title="${esc(c.name)}">
    ${tools}
    <div class="art"><img src="${esc(enemyImage(c))}"/></div>
    <div class="name">${game.user.isGM && s.isRare ? `<span class="rare" title="${esc(game.i18n.localize("NSSQ.Rare.gmOnly"))}">★</span>` : ""}${esc(c.name)}${s.row === "back" ? ` <em>${L("back")}</em>` : ""}</div>
    <div class="nb-bar hp ${showHp ? "" : "unknown"}"><i style="width:${showHp ? pct(s.hp) : 100}%"></i>${showHp ? `<span>${s.hp?.value ?? 0}/${s.hp?.max ?? 0}</span>` : ""}</div>
  </div>`;
}

function partyCard(c, combat, targetable) {
  const a = c.actor;
  const s = a.system;
  const cls = a.type === "character" ? s.classItems?.main?.name ?? "" : "";
  const guard = c.getFlag("nssq", "guarding");
  const bar = (k, r) => `<div class="nb-bar ${k}"><b>${k.toUpperCase()}</b><i style="width:${pct(r)}%"></i><span>${r?.value ?? 0}/${r?.max ?? 0}</span></div>`;
  const classes = ["nb-member", isKO(c) ? "ko" : "", isCurrent(c, combat) ? "current" : "", a.isOwner && !game.user.isGM ? "mine" : "", targetable ? "targetable" : ""].join(" ");
  return `<div class="${classes}" data-combatant="${c.id}">
    <div class="portrait"><img src="${esc(a.img)}"/></div>
    <div class="info">
      <div class="line"><span class="name">${esc(c.name)}</span>${sideOf(a) === "ally" ? `<em class="npc">NPC</em>` : ""}${guard ? `<em class="guard"><i class="fas fa-shield-alt"></i> ${L("guard")}</em>` : ""}
        <span class="cls">${cls ? `${esc(cls)} Lv${s.level}` : ""}${isKO(c) ? ` · ${L("ko")}` : ""}</span></div>
      <div class="bars">${bar("hp", s.hp)}${a.type === "character" ? bar("tp", s.tp) : ""}</div>
    </div>
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
    return `<div class="who">${L("whoseAction", { name: esc(c.name) })}</div>
      <div class="cmds" data-combatant="${c.id}">
        ${cmd("attack", "fa-fist-raised", L("attack"), { active: pending === "attack" })}
        ${cmd("skill", "fa-magic", L("skill"), { disabled: true, title: L("later") })}
        ${cmd("item", "fa-flask", L("item"), { disabled: true, title: L("later") })}
        ${cmd("end", "fa-forward", L("endTurn"))}
      </div>`;
  }
  if (phase === "opening") {
    // 플레이어: 자기 캐릭터. GM: 동료 NPC, 그 아래 에너미
    const mine = (c) => (game.user.isGM ? sideOf(c.actor) !== "pc" : c.actor.isOwner && sideOf(c.actor) !== "enemy");
    const list = combat.turns.filter((c) => c.actor && mine(c) && !isKO(c))
      .sort((a, b) => (sideOf(a.actor) === "enemy") - (sideOf(b.actor) === "enemy"));
    if (!list.length) return `<p class="wait">${L("openingWait")}</p>`;
    return `<div class="who">${L("openingTitle")}</div>` + list.map((c) => {
      const guarding = !!c.getFlag("nssq", "guarding");
      return `<div class="opening-row ${sideOf(c.actor) === "enemy" ? "enemy" : ""} ${c.getFlag("nssq", "opening") ? "done" : ""}" data-combatant="${c.id}"><span class="name">${esc(c.name)}</span>
        <button type="button" data-cmd="guard" class="${guarding ? "active" : ""}" title="${guarding ? L("guardOff") : L("guard")}"><i class="fas fa-shield-alt"></i> ${L("guard")}</button>
        <button type="button" data-cmd="row" title="${L("row")}"><i class="fas fa-arrows-alt-v"></i> ${L("row")}</button>
        ${c.actor.type === "character" ? `<button type="button" data-cmd="swap" title="${L("swap")}"><i class="fas fa-exchange-alt"></i> ${L("swapShort")}</button>` : ""}
      </div>`;
    }).join("");
  }
  return "";
}

/** 커맨드 창(항상 같은 자리·크기): 머리 = 페이즈 + GM 진행 버튼 */
function commandWindow(combat) {
  const gm = gmControls(combat);
  return `<div class="nb-command">
    <div class="head"><span class="phase">${phaseLabel(combat)}</span></div>
    ${gm ? `<div class="gm">${gm}</div>` : ""}
    <div class="body">${commandBody(combat)}</div>
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
    el.innerHTML = `<button type="button" class="nb-open" data-ui="toggle"><i class="fas fa-skull-crossbones"></i> ${L("openBattle")}</button>`;
    return bind(el, combat);
  }
  el.innerHTML = battleHtml(combat);
  bind(el, combat);
}

/** 펼친 전투 화면의 HTML */
export function battleHtml(combat, { attack = pending === "attack" } = {}) {
  const info = combat.getFlag("nssq", "battle") ?? {};
  const bg = game.scenes.get(info.copy)?.background?.src;
  const attacker = attack ? combat.combatant?.actor : null;
  const targets = new Set(attacker ? attackTargets(combat, attacker).map((c) => c.id) : []);
  const enemies = combat.turns.filter((c) => c.actor && sideOf(c.actor) === "enemy")
    .sort((a, b) => (a.actor.system.row === b.actor.system.row ? (a.actor.system.order ?? 0) - (b.actor.system.order ?? 0) : a.actor.system.row === "back" ? -1 : 1));
  // 파티: 전열·후열 각 3칸. 칸 순서는 진형 배치(사본 씬 토큰의 가로 위치)를 따른다
  const party = combat.combatants.filter((c) => c.actor && sideOf(c.actor) !== "enemy")
    .sort((a, b) => (a.token?.x ?? 0) - (b.token?.x ?? 0));
  const slots = (row) => {
    const cards = party.filter((c) => (c.actor.system.row ?? "front") === row).map((c) => partyCard(c, combat, targets.has(c.id)));
    while (cards.length < 3) cards.push(`<div class="nb-member empty"></div>`);
    return cards.join("");
  };

  return `
    <div class="nb-bg" ${bg ? `style="background-image:url('${esc(bg)}')"` : ""}></div>
    <div class="nb-top">
      <button type="button" class="nb-map" data-ui="toggle" title="${esc(L("mapHint"))}"><i class="fas fa-map"></i> ${L("showMap")}</button>
      ${orderStrip(combat)}
    </div>
    <div class="nb-field">
      <div class="nb-enemies ${enemies.some((c) => c.actor.system.row === "back") ? "has-back" : ""}">
        <div class="nb-erow back">${enemies.filter((c) => c.actor.system.row === "back").map((c) => enemyCard(c, combat, targets.has(c.id))).join("")}</div>
        <div class="nb-erow front">${enemies.filter((c) => c.actor.system.row !== "back").map((c) => enemyCard(c, combat, targets.has(c.id))).join("")}</div>
      </div>
      ${attacker ? `<div class="nb-hint">${targets.size ? L("pickTarget") : L("noTarget")}</div>` : ""}
      ${commandWindow(combat)}
      ${game.user.isGM ? `<div class="nb-drop">${L("dropHint")}</div>` : ""}
    </div>
    <div class="nb-party">
      <div class="nb-row front"><span class="label">${L("front")}</span>${slots("front")}</div>
      <div class="nb-row back"><span class="label">${L("back")}</span>${slots("back")}</div>
    </div>`;
}

function bind(el, combat) {
  el.querySelectorAll("[data-ui=toggle]").forEach((b) => b.addEventListener("click", () => {
    collapsed = !collapsed;
    renderHud();
  }));
  el.querySelectorAll("[data-gm]").forEach((b) => b.addEventListener("click", () => {
    switch (b.dataset.gm) {
      case "next": return combat.nextPhase();
      case "end": return combat.nextTurn();
      case "escape": return rollEscape(combat);
      case "shuffle": return shuffleRowsDialog(combat);
      case "finish": return openEndDialog();
      case "identifyAll": return setIdentified(combat.combatants.filter((c) => c.actor?.type === "enemy").map((c) => c.actor), true);
    }
  }));
  el.querySelectorAll("[data-cmd]").forEach((b) => b.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    const c = combat.combatants.get(b.closest("[data-combatant]")?.dataset.combatant);
    if (!c) return;
    switch (b.dataset.cmd) {
      case "attack": pending = pending === "attack" ? null : "attack"; return renderHud();
      case "end": return requestEndTurn(combat);
      case "guard": return toggleGuard(c);
      case "row": return toggleRow(c);
      case "swap": return swapWeapon(c);
    }
  }));
  // GM: 에너미 카드 도구
  el.querySelectorAll(".nb-enemy [data-tool]").forEach((t) => t.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const c = combat.combatants.get(t.closest("[data-combatant]")?.dataset.combatant);
    if (!c?.actor) return;
    switch (t.dataset.tool) {
      case "identify": return setIdentified([c.actor], !c.actor.system.identified);
      case "row": return changePosition(c);
      case "defeated": return c.update({ defeated: !c.defeated });
      case "sheet": return c.actor.sheet.render(true);
    }
  }));
  // 대상 고르기(공격 중) / 그 밖에는 시트 열기(권한이 있을 때)
  el.querySelectorAll(".nb-enemy, .nb-member:not(.empty)").forEach((card) => card.addEventListener("click", async () => {
    const c = combat.combatants.get(card.dataset.combatant);
    if (!c) return;
    if (pending === "attack" && card.classList.contains("targetable")) {
      const attacker = combat.combatant.actor;
      pending = null;
      renderHud();
      return normalAttack(attacker, { target: c.token });
    }
    if (c.actor?.isOwner) c.actor.sheet.render(true);
  }));
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
  window.addEventListener("resize", rerender);
  Hooks.on("collapseSidebar", () => setTimeout(renderHud, 250));
  for (const hook of ["updateCombat", "createCombat", "updateCombatant", "createCombatant", "deleteCombatant", "updateActor", "updateToken", "createItem", "updateItem", "deleteItem"]) Hooks.on(hook, rerender);
  Hooks.on("updateCombat", (combat, changes) => {
    if (foundry.utils.hasProperty(changes, "turn") || foundry.utils.hasProperty(changes, "flags.nssq.phase")) pending = null;
    // 새 전투가 시작되면 화면을 펼친다
    if (foundry.utils.hasProperty(changes, "started") && changes.started) collapsed = false;
  });
  Hooks.on("deleteCombat", () => setTimeout(renderHud, 50));
}
