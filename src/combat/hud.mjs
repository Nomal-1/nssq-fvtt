/**
 * 원작풍 전투 화면: 전투 중에는 지금 보고 있는 씬(필드) 위에 HTML 화면을 덮는다.
 * - 위: 행동 순서 띠, 에너미 일러스트 줄(이름·【HP】·대상 고르기)
 * - 아래: 커맨드 창(현재 차례 전투원을 맡은 사람에게) + 파티 카드(전열·후열)
 * - [맵 보기]로 접으면 아래 필드 맵을 그대로 쓸 수 있다(보는 사람마다)
 * 전투원 데이터는 화면에 띄우지 않는 전투 사본 씬의 토큰에 있다(battle.mjs).
 */
import { inRange } from "../engine/combat.mjs";
import { normalAttack } from "./attack.mjs";
import { combatProfile, friendly, sideOf } from "./profile.mjs";
import { changePosition } from "./formation.mjs";
import { rollEscape, swapWeapon, toggleGuard } from "./tracker.mjs";
import { emit, onSocket } from "../socket.mjs";
import { isActiveGM } from "./apply.mjs";

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
  return root;
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
  const over = combat.getFlag("nssq", "over");
  const curIdx = combat.turn ?? -1;
  const items = combat.turns.map((c, i) => {
    const cls = [sideOf(c.actor) === "enemy" ? "enemy" : "", phase === "main" && i === curIdx ? "current" : "", phase === "main" && i < curIdx ? "done" : "", isKO(c) ? "ko" : ""].join(" ");
    return `<span class="who ${cls}"><img src="${esc(c.img)}"/><span>${esc(c.name)}</span></span>`;
  }).join('<i class="fas fa-chevron-right sep"></i>');
  const label = over ? L(over === "victory" ? "victory" : "defeat") : `${combat.round}${L("round")} · ${game.i18n.localize(`NSSQ.Combat.phase.${phase}`)}`;
  return `<div class="nb-order"><span class="phase">${label}</span>${items}</div>`;
}

/** GM 진행 버튼: 다음 턴·페이즈, 도주 판정, 결과 정리 */
function gmControls(combat) {
  if (!game.user.isGM) return "";
  const phase = combat.getFlag("nssq", "phase") ?? "opening";
  const over = combat.getFlag("nssq", "over");
  const C = (k) => game.i18n.localize(`NSSQ.Combat.${k}`);
  if (over) return `<button type="button" data-gm="end"><i class="fas fa-flag-checkered"></i> ${C(over === "victory" ? "endVictory" : "endDefeat")}</button>`;
  return `${phase === "opening" ? `<button type="button" data-gm="escape"><i class="fas fa-running"></i> ${C("escape")}</button>` : ""}
    <button type="button" data-gm="next"><i class="fas fa-forward"></i> ${phase === "main" ? C("nextTurn") : C("nextPhase")}</button>`;
}

/** 지금 공격할 수 있는 대상(사거리 안, 적 편, 쓰러지지 않음) */
function attackTargets(combat, attacker) {
  const a = combatProfile(attacker, combat.combatants.find((x) => x.actor === attacker));
  return combat.combatants.filter((c) => c.actor && !friendly(attacker, c.actor) && !isKO(c))
    .filter((c) => inRange(a.range, a.row, c.actor.system.row ?? "front"));
}

function enemyCard(c, combat, targetable) {
  const a = c.actor;
  const s = a.system;
  const showHp = game.user.isGM || s.identified;
  const img = c.token?.texture?.src || a.img;
  const cls = ["nb-enemy", s.row === "back" ? "back" : "front", isKO(c) ? "ko" : "", isCurrent(c, combat) ? "current" : "", targetable ? "targetable" : ""].join(" ");
  return `<div class="${cls}" data-combatant="${c.id}" title="${esc(c.name)}">
    <div class="art"><img src="${esc(img)}"/></div>
    <div class="name">${esc(c.name)}${s.row === "back" ? ` <em>${L("back")}</em>` : ""}</div>
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
    <div class="portrait"><img src="${esc(a.img)}"/>${guard ? `<span class="guard"><i class="fas fa-shield-alt"></i> ${L("guard")}</span>` : ""}</div>
    <div class="info">
      <div class="name">${esc(c.name)}${sideOf(a) === "ally" ? ` <em>NPC</em>` : ""}</div>
      <div class="cls">${cls ? `${esc(cls)} Lv${s.level}` : ""}${isKO(c) ? ` · ${L("ko")}` : ""}</div>
      ${bar("hp", s.hp)}${a.type === "character" ? bar("tp", s.tp) : ""}
    </div>
  </div>`;
}

/** 커맨드 창: 메인 페이즈는 현재 차례 전투원, 개막 페이즈는 내가 맡은 아군 모두 */
function commandWindow(combat) {
  const phase = combat.getFlag("nssq", "phase") ?? "opening";
  if (combat.getFlag("nssq", "over")) return `<div class="nb-command idle"><p>${L(combat.getFlag("nssq", "over") === "victory" ? "victory" : "defeat")}</p></div>`;
  if (phase === "main") {
    const c = combat.combatant;
    if (!c?.actor) return "";
    if (!c.actor.isOwner || isKO(c)) {
      return `<div class="nb-command idle"><div class="title">${L("acting", { name: esc(c.name) })}</div></div>`;
    }
    const cmd = (id, icon, label, { active = false, disabled = false, title = "" } = {}) =>
      `<button type="button" data-cmd="${id}" class="${active ? "active" : ""}" ${disabled ? "disabled" : ""} title="${esc(title || label)}"><i class="fas ${icon}"></i> ${esc(label)}</button>`;
    return `<div class="nb-command" data-combatant="${c.id}">
      <div class="title">${L("whoseAction", { name: esc(c.name) })}</div>
      ${cmd("attack", "fa-fist-raised", L("attack"), { active: pending === "attack" })}
      ${cmd("skill", "fa-magic", L("skill"), { disabled: true, title: L("later") })}
      ${cmd("item", "fa-flask", L("item"), { disabled: true, title: L("later") })}
      ${cmd("end", "fa-forward", L("endTurn"))}
    </div>`;
  }
  if (phase === "opening") {
    // 플레이어: 자기 캐릭터. GM: 동료 NPC(에너미의 개막 행동은 전투 추적기에서)
    const mine = (c) => (game.user.isGM ? sideOf(c.actor) === "ally" : c.actor.isOwner && sideOf(c.actor) !== "enemy");
    const list = combat.turns.filter((c) => c.actor && mine(c) && !isKO(c));
    if (!list.length) return `<div class="nb-command idle"><div class="title">${L("openingWait")}</div></div>`;
    const rows = list.map((c) => {
      const guarding = !!c.getFlag("nssq", "guarding");
      return `<div class="opening-row" data-combatant="${c.id}"><span class="who">${esc(c.name)}</span>
        <button type="button" data-cmd="guard" class="${guarding ? "active" : ""}"><i class="fas fa-shield-alt"></i> ${guarding ? L("guardOff") : L("guard")}</button>
        <button type="button" data-cmd="row"><i class="fas fa-arrows-alt-v"></i> ${L("row")}</button>
        ${c.actor.type === "character" ? `<button type="button" data-cmd="swap"><i class="fas fa-exchange-alt"></i> ${L("swap")}</button>` : ""}
      </div>`;
    }).join("");
    return `<div class="nb-command opening"><div class="title">${L("openingTitle")}</div>${rows}</div>`;
  }
  return "";
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
  const party = combat.turns.filter((c) => c.actor && sideOf(c.actor) !== "enemy");
  const rowOf = (c) => c.actor.system.row ?? "front";
  const partyRow = (row) => party.filter((c) => rowOf(c) === row).map((c) => partyCard(c, combat, targets.has(c.id))).join("");

  return `
    <div class="nb-bg" ${bg ? `style="background-image:url('${esc(bg)}')"` : ""}></div>
    <div class="nb-top">
      <button type="button" class="nb-map" data-ui="toggle" title="${esc(L("mapHint"))}"><i class="fas fa-map"></i> ${L("showMap")}</button>
      ${orderStrip(combat)}
      <div class="nb-gm">${gmControls(combat)}</div>
    </div>
    <div class="nb-enemies">${enemies.map((c) => enemyCard(c, combat, targets.has(c.id))).join("")}</div>
    ${attacker ? `<div class="nb-hint">${targets.size ? L("pickTarget") : L("noTarget")}</div>` : ""}
    <div class="nb-bottom">
      ${commandWindow(combat)}
      <div class="nb-party">
        <div class="nb-row front"><span class="label">${L("front")}</span>${partyRow("front")}</div>
        <div class="nb-row back"><span class="label">${L("back")}</span>${partyRow("back")}</div>
      </div>
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
      case "row": return changePosition(c);
      case "swap": return swapWeapon(c);
    }
  }));
  // 대상 고르기(공격 중) / 그 밖에는 시트 열기(권한이 있을 때)
  el.querySelectorAll(".nb-enemy, .nb-member").forEach((card) => card.addEventListener("click", async () => {
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
