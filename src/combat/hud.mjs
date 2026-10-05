/**
 * 전투 HUD(전투 사본 씬에서만): 행동 순서 띠, 파티 패널, 내 토큰 주위 명령 메뉴, 공격 대상 표시,
 * 플레이어 카메라 맞춤(진형 전체가 보이도록 자동 확대·이동, 손으로 움직이면 되돌린다).
 */
import { LAYOUT } from "../engine/formation.mjs";
import { inRange } from "../engine/combat.mjs";
import { normalAttack } from "./attack.mjs";
import { combatProfile, friendly, sideOf } from "./profile.mjs";
import { changePosition } from "./formation.mjs";
import { swapWeapon, toggleGuard } from "./tracker.mjs";
import { emit, onSocket } from "../socket.mjs";
import { isActiveGM } from "./apply.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Hud.${k}`, d) : game.i18n.localize(`NSSQ.Hud.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

let root = null;
let pending = null; // "attack" | null
let fitting = false;

const battleCombat = () => {
  const scene = canvas?.scene;
  if (!scene?.getFlag("nssq", "battleCopy")) return null;
  return game.combats.find((c) => c.scene?.id === scene.id && c.started) ?? null;
};

/* ---------------- 카메라 ---------------- */

function viewport() {
  const sidebar = document.getElementById("sidebar");
  const w = window.innerWidth - (sidebar && !ui.sidebar?._collapsed ? sidebar.offsetWidth : 0);
  return { w: Math.max(200, w), h: window.innerHeight };
}

/** 진형(위 두 줄 + 아래 두 줄)이 다 보이게 맞춘다 */
function fitCamera() {
  if (game.user.isGM || !battleCombat()) return;
  const box = { x: 150, y: LAYOUT.lanes.enemyBack - 250, w: LAYOUT.width - 300, h: LAYOUT.lanes.partyBack - LAYOUT.lanes.enemyBack + 650 };
  const { w, h } = viewport();
  const scale = Math.clamp(Math.min(w / box.w, h / box.h) * 0.92, 0.15, 3);
  const sidebarW = window.innerWidth - w;
  // 사이드바만큼 화면 중심이 왼쪽으로 치우치므로 그만큼 보정
  const cx = box.x + box.w / 2 + sidebarW / 2 / scale;
  const cy = box.y + box.h / 2;
  fitting = true;
  canvas.pan({ x: cx, y: cy, scale });
  fitting = false;
}

/* ---------------- 그리기 ---------------- */

function screenPos(token) {
  const t = token.object ?? token;
  const c = t.center ?? { x: token.x, y: token.y };
  const p = canvas.stage.worldTransform.apply(c);
  return { x: p.x, y: p.y, r: ((t.w ?? 100) * canvas.stage.scale.x) / 2 };
}

function ensureRoot() {
  if (root?.isConnected) return root;
  root = document.createElement("div");
  root.id = "nssq-hud";
  document.body.append(root);
  return root;
}

export function clearHud() {
  root?.remove();
  root = null;
  pending = null;
}

function memberCard(c, combat) {
  const a = c.actor;
  const s = a.system;
  const pct = (r) => (r?.max > 0 ? Math.clamp(Math.round((r.value / r.max) * 100), 0, 100) : 0);
  const ko = (s.hp?.value ?? 0) <= 0 || c.defeated;
  const cls = a.type === "character" ? s.classItems?.main?.name ?? "" : "";
  const tags = [cls ? `${esc(cls)} Lv${s.level}` : "", c.getFlag("nssq", "guarding") ? `<span class="guard">${L("guard")}</span>` : "", ko ? L("ko") : ""].filter(Boolean).join(" · ");
  const bar = (k, r) => `<div class="hud-bar ${k}"><b>${k.toUpperCase()}</b><div class="track"><i style="width:${pct(r)}%"></i></div><span>${r?.value ?? 0}/${r?.max ?? 0}</span></div>`;
  return `<div class="hud-member ${a.isOwner && !game.user.isGM ? "mine" : ""} ${combat.combatant?.id === c.id ? "current" : ""} ${ko ? "ko" : ""}" data-actor="${a.uuid}">
    <div class="top"><img src="${esc(c.img ?? a.img)}"/><span class="name">${esc(c.name)}</span></div>
    <div class="tags">${tags}</div>
    ${bar("hp", s.hp)}${a.type === "character" ? bar("tp", s.tp) : ""}
  </div>`;
}

function orderStrip(combat) {
  const phase = combat.getFlag("nssq", "phase") ?? "opening";
  const over = combat.getFlag("nssq", "over");
  const curIdx = combat.turn ?? -1;
  const items = combat.turns.map((c, i) => {
    const enemy = sideOf(c.actor) === "enemy";
    const ko = c.defeated || (c.actor?.system.hp?.value ?? 1) <= 0;
    const cls = [enemy ? "enemy" : "", phase === "main" && i === curIdx ? "current" : "", phase === "main" && i < curIdx ? "done" : "", ko ? "ko" : ""].join(" ");
    return `<span class="who ${cls}"><img src="${esc(c.img)}"/><span>${esc(c.name)}</span></span>`;
  }).join('<i class="fas fa-chevron-right sep"></i>');
  const label = over ? L(over === "victory" ? "victory" : "defeat") : `${combat.round}${L("round")} · ${game.i18n.localize(`NSSQ.Combat.phase.${phase}`)}`;
  return `<div class="hud-order"><span class="phase">${label}</span>${items}</div>`;
}

/** 내 차례(메인) 또는 개막 행동 메뉴를 그릴 전투원들 */
function menuTargets(combat) {
  const phase = combat.getFlag("nssq", "phase");
  if (combat.getFlag("nssq", "over")) return [];
  if (phase === "main") {
    const c = combat.combatant;
    return c?.actor?.isOwner && !c.defeated ? [{ c, kind: "main" }] : [];
  }
  if (phase === "opening") {
    // 플레이어: 자기 캐릭터. GM: 동료 NPC만(에너미의 개막 행동은 전투 추적기에서)
    const mine = (c) => (game.user.isGM ? sideOf(c.actor) === "ally" : c.actor.isOwner && sideOf(c.actor) !== "enemy");
    return combat.combatants.filter((c) => c.actor && mine(c) && !c.defeated && (c.actor.system.hp?.value ?? 0) > 0)
      .map((c) => ({ c, kind: "opening" }));
  }
  return [];
}

function menuButtons(kind, c) {
  if (kind === "main") {
    return [
      { id: "attack", icon: "fa-fist-raised", label: L("attack"), active: pending === "attack" },
      { id: "skill", icon: "fa-magic", label: L("skill"), disabled: true, title: L("later") },
      { id: "item", icon: "fa-flask", label: L("item"), disabled: true, title: L("later") },
      { id: "end", icon: "fa-forward", label: L("endTurn") }
    ];
  }
  const guarding = !!c.getFlag("nssq", "guarding");
  return [
    { id: "guard", icon: "fa-shield-alt", label: guarding ? L("guardOff") : L("guard"), active: guarding },
    { id: "row", icon: "fa-arrows-alt-v", label: L("row") },
    ...(c.actor.type === "character" ? [{ id: "swap", icon: "fa-exchange-alt", label: L("swap") }] : [])
  ];
}

/** 원형 배치: 위쪽부터 시계 방향(토큰 위가 파티 쪽에서 적 쪽) */
function placeAround(n, r) {
  const start = -Math.PI / 2 - (Math.PI * 0.55);
  const span = Math.PI * 1.1;
  return Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? -Math.PI / 2 : start + (span * i) / (n - 1);
    return { x: Math.cos(t) * r, y: Math.sin(t) * r };
  });
}

function attackTargets(combat, attacker) {
  const a = combatProfile(attacker, combat.combatants.find((x) => x.actor === attacker));
  return combat.combatants.filter((c) => c.actor && !friendly(attacker, c.actor) && !c.defeated && (c.actor.system.hp?.value ?? 0) > 0)
    .filter((c) => inRange(a.range, a.row, c.actor.system.row ?? "front"))
    .map((c) => c.token);
}

export function renderHud() {
  const combat = battleCombat();
  if (!combat || !canvas?.ready) return clearHud();
  const el = ensureRoot();
  el.classList.toggle("compact", window.innerWidth < 900);
  const party = combat.turns.filter((c) => c.actor && sideOf(c.actor) !== "enemy" && c.actor.type !== "token");
  let html = orderStrip(combat);
  html += `<div class="hud-party">${party.map((c) => memberCard(c, combat)).join("")}</div>`;
  // 명령 메뉴
  for (const { c, kind } of menuTargets(combat)) {
    if (!c.token) continue;
    const p = screenPos(c.token);
    const buttons = menuButtons(kind, c);
    const spots = placeAround(buttons.length, p.r + 46);
    html += `<div class="hud-menu" style="left:${p.x}px;top:${p.y}px" data-combatant="${c.id}">${buttons.map((b, i) =>
      `<button type="button" data-cmd="${b.id}" style="left:${spots[i].x}px;top:${spots[i].y}px" class="${b.active ? "active" : ""}" ${b.disabled ? "disabled" : ""} title="${esc(b.title ?? b.label)}"><i class="fas ${b.icon}"></i> ${esc(b.label)}</button>`).join("")}</div>`;
  }
  // 공격 대상 표시
  if (pending === "attack" && combat.combatant?.actor?.isOwner) {
    const targets = attackTargets(combat, combat.combatant.actor);
    for (const t of targets) {
      const p = screenPos(t);
      html += `<div class="hud-menu" style="left:${p.x}px;top:${p.y}px"><button type="button" class="active" data-target="${t.id}" style="left:0;top:${-p.r - 18}px"><i class="fas fa-crosshairs"></i> ${esc(t.name)}</button></div>`;
    }
    html += `<div class="hud-hint">${targets.length ? L("pickTarget") : L("noTarget")}</div>`;
  }
  el.innerHTML = html;
  bind(el, combat);
}

function bind(el, combat) {
  el.querySelectorAll(".hud-member").forEach((m) => m.addEventListener("click", async () => {
    const a = await fromUuid(m.dataset.actor);
    if (a?.isOwner) a.sheet.render(true);
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
  el.querySelectorAll("[data-target]").forEach((b) => b.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    const token = combat.scene.tokens.get(b.dataset.target)?.object;
    if (!token) return;
    token.setTarget(true, { releaseOthers: true });
    pending = null;
    renderHud();
    await normalAttack(combat.combatant.actor);
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
  Hooks.on("canvasReady", () => { pending = null; fitCamera(); renderHud(); });
  // 플레이어가 화면을 움직이면 되돌리고, 메뉴 위치는 따라간다
  Hooks.on("canvasPan", () => {
    if (!fitting && !game.user.isGM && battleCombat()) {
      clearTimeout(registerHud.snap);
      registerHud.snap = setTimeout(fitCamera, 120);
    }
    rerender();
  });
  window.addEventListener("resize", foundry.utils.debounce(() => { fitCamera(); renderHud(); }, 150));
  Hooks.on("collapseSidebar", () => setTimeout(() => { fitCamera(); renderHud(); }, 250));
  for (const hook of ["updateCombat", "createCombat", "updateCombatant", "updateActor", "updateToken", "createToken", "deleteToken", "controlToken"]) Hooks.on(hook, rerender);
  Hooks.on("updateCombat", (combat, changes) => {
    if (foundry.utils.hasProperty(changes, "turn") || foundry.utils.hasProperty(changes, "flags.nssq.phase")) pending = null;
    if (foundry.utils.hasProperty(changes, "started")) fitCamera();
  });
  Hooks.on("deleteCombat", () => setTimeout(renderHud, 50));
}
