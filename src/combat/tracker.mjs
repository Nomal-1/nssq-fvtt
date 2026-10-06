/**
 * 컴뱃 트래커: 페이즈 표시·[다음 페이즈], 전투원별 열·방어 전념 표시,
 * 개막 행동(방어 전념·배치 변경·무기 교체), 통상 공격, 도주 판정.
 */
import { escapeSucceeds } from "../engine/combat.mjs";
import { changePosition } from "./formation.mjs";
import { evaluateCheck } from "../engine/check.mjs";
import { slotOccupant } from "../engine/equipment.mjs";
import { normalAttack } from "./attack.mjs";
import { combatProfile } from "./profile.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Combat.${k}`, d) : game.i18n.localize(`NSSQ.Combat.${k}`));

/* ---------------- 개막 행동 ---------------- */

export async function toggleGuard(combatant) {
  const on = !combatant.getFlag("nssq", "guarding");
  await combatant.update({ "flags.nssq.guarding": on, "flags.nssq.waiting": on, "flags.nssq.opening": on ? "guard" : null });
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: combatant.actor }),
    content: `<div class="nssq-combat-note"><i class="fas fa-shield-alt"></i> ${L(on ? "guardOn" : "guardOff", { name: combatant.name })}</div>`
  });
}

export async function toggleRow(combatant) {
  if (await changePosition(combatant)) await combatant.setFlag("nssq", "opening", "row");
}

/** 무기 슬롯과 기타 슬롯의 무기를 맞바꾼다 */
export async function swapWeapon(combatant) {
  const actor = combatant.actor;
  if (actor.type !== "character") return;
  const items = actor.items.contents;
  const main = slotOccupant(items, "weapon");
  const sub = slotOccupant(items, "other");
  if (!main || !sub || main.type !== "weapon" || sub.type !== "weapon") return ui.notifications.warn(L("noSwap"));
  await actor.updateEmbeddedDocuments("Item", [{ _id: main.id, "system.slot": "other" }, { _id: sub.id, "system.slot": "weapon" }]);
  await combatant.setFlag("nssq", "opening", "swap");
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="nssq-combat-note"><i class="fas fa-exchange-alt"></i> ${L("swapped", { name: combatant.name, weapon: sub.name })}</div>`
  });
}

/* ---------------- 식별(GM이 언제든) ---------------- */

/** 에너미 식별 상태를 바꾼다. 식별하면 모두에게 알린다 */
export async function setIdentified(actors, on) {
  const changed = actors.filter((a) => a?.type === "enemy" && !!a.system.identified !== on);
  for (const a of changed) await a.update({ "system.identified": on });
  if (on && changed.length) {
    await ChatMessage.create({
      speaker: { alias: L("tracker") },
      content: `<div class="nssq-combat-note"><i class="fas fa-eye"></i> ${L("identified", { names: changed.map((a) => a.token?.name ?? a.name).join(", ") })}</div>`
    });
  }
}

/* ---------------- 도주 ---------------- */

/** 도주 판정(GM): 살아 있는 참가자 전원 【회피】로 일반 행위 판정 */
export async function rollEscape(combat) {
  if (!game.user.isGM || !combat) return;
  const ok = await Dialog.confirm({ title: L("escape"), content: `<p>${L("escapeConfirm")}</p>`, rejectClose: false });
  if (!ok) return;
  const rows = [];
  const rolls = [];
  for (const c of combat.combatants) {
    if (!c.actor || c.defeated) continue;
    const p = combatProfile(c.actor, c);
    if (p.ko) continue;
    // [다리] 봉인은 도주 판정에 참가하지 않는다(단계 5에서 상태 연결)
    if (c.actor.statuses?.has("bindLeg")) continue;
    const roll = await new Roll("2d6").evaluate();
    rolls.push(roll);
    const r = evaluateCheck({ dice: roll.dice[0].results.map((x) => x.result), modifier: p.evasion });
    rows.push({ name: c.name, flee: p.side !== "enemy", total: r.total, dice: r.used });
  }
  const flee = rows.filter((r) => r.flee).map((r) => r.total);
  const chase = rows.filter((r) => !r.flee).map((r) => r.total);
  const success = escapeSucceeds(flee, chase);
  const line = (r) => `<li>${r.name}: [${r.dice.join(", ")}] + ${r.total - r.dice[0] - r.dice[1]} = <b>${r.total}</b></li>`;
  await ChatMessage.create({
    speaker: { alias: L("tracker") },
    rolls,
    sound: CONFIG.sounds.dice,
    content: `<div class="nssq-escape">
      <header class="check-header"><span class="check-label"><i class="fas fa-running"></i> ${L("escape")}</span></header>
      <p>${L("escapeFlee")}</p><ul>${rows.filter((r) => r.flee).map(line).join("")}</ul>
      <p>${L("escapeChase")}</p><ul>${rows.filter((r) => !r.flee).map(line).join("")}</ul>
      <div class="check-result ${success ? "success" : "failure"}">${success ? L("escapeSuccess") : L("escapeFail")}</div>
      <p class="notes">${L("escapeNote")}</p>
    </div>`
  });
}

/* ---------------- 트래커 꾸미기 ---------------- */

export function registerTracker() {
  Hooks.on("renderCombatTracker", (app, html) => {
    const combat = app.viewed;
    if (!combat) return;
    const root = html[0] ?? html;
    const started = combat.started;
    const phase = combat.phase ?? "opening";

    // 페이즈 표시와 GM 버튼
    if (started) {
      const bar = document.createElement("div");
      const over = combat.getFlag("nssq", "over");
      bar.className = `nssq-phase-bar phase-${phase}${over ? " over" : ""}`;
      bar.innerHTML = over
        ? `<span class="phase-label">${L(over === "victory" ? "enemyDefeated" : "partyDefeated")}</span>`
        : `<span class="phase-label">${L("roundPhase", { round: combat.round, phase: L(`phase.${phase}`) })}</span>
        <span class="phase-hint">${L(`phaseHint.${phase}`)}</span>`;
      if (game.user.isGM && over) {
        const end = document.createElement("button");
        end.type = "button";
        end.className = "nssq-end-battle";
        end.innerHTML = `<i class="fas fa-flag-checkered"></i> ${L(over === "victory" ? "endVictory" : "endDefeat")}`;
        end.addEventListener("click", () => combat.nextTurn());
        bar.append(end);
      } else if (game.user.isGM) {
        const next = document.createElement("button");
        next.type = "button";
        next.className = "nssq-next-phase";
        next.innerHTML = `<i class="fas fa-forward"></i> ${phase === "main" ? L("nextTurn") : L("nextPhase")}`;
        next.addEventListener("click", () => combat.nextPhase());
        bar.append(next);
        // 모두 식별: 전투 중 어느 때든(창발적 행동으로 알게 된 경우 등)
        const unknown = combat.combatants.filter((c) => c.actor?.type === "enemy" && !c.actor.system.identified);
        if (unknown.length) {
          const idAll = document.createElement("button");
          idAll.type = "button";
          idAll.title = L("identifyAllHint");
          idAll.innerHTML = `<i class="fas fa-eye"></i> ${L("identifyAll")}`;
          idAll.addEventListener("click", () => setIdentified(unknown.map((c) => c.actor), true));
          bar.append(idAll);
        }
        if (phase === "opening") {
          const esc = document.createElement("button");
          esc.type = "button";
          esc.innerHTML = `<i class="fas fa-running"></i> ${L("escape")}`;
          esc.addEventListener("click", () => rollEscape(combat));
          bar.append(esc);
        }
      }
      const header = root.querySelector("#combat-round, .combat-tracker-header, header") ?? root.firstElementChild;
      header?.after(bar);
    }

    // 전투원별: 버튼(위치 고정) → 표시(열·희소종·방어)
    root.querySelectorAll("li.combatant").forEach((li) => {
      const c = combat.combatants.get(li.dataset.combatantId);
      if (!c?.actor) return;
      const actor = c.actor;
      // 에너미의 이니셔티브 값은 플레이어에게 숨긴다
      if (!game.user.isGM && actor.type === "enemy") {
        const init = li.querySelector(".token-initiative");
        if (init) init.innerHTML = "";
      }
      const box = document.createElement("div");
      box.className = "nssq-combatant-tools";
      const owner = actor.isOwner;
      const guarding = !!c.getFlag("nssq", "guarding");
      const btn = (icon, title, fn, active = false) => {
        const a = document.createElement("a");
        a.className = `nssq-tool${active ? " active" : ""}`;
        a.title = title;
        a.innerHTML = `<i class="fas ${icon}"></i>`;
        a.addEventListener("click", (ev) => { ev.stopPropagation(); fn(ev); });
        box.append(a);
      };
      if (owner && started && phase === "opening" && !c.defeated) {
        btn("fa-shield-alt", guarding ? L("guardRelease") : L("guard"), () => toggleGuard(c), guarding);
        btn("fa-arrows-alt-v", L("changeRow"), () => toggleRow(c));
        if (actor.type === "character") btn("fa-exchange-alt", L("swapWeapon"), () => swapWeapon(c));
      }
      if (owner && started && phase === "main" && !c.defeated) {
        btn("fa-fist-raised", L("normalAttack"), (ev) => normalAttack(actor, { ignoreRange: ev.shiftKey && game.user.isGM }));
      }
      // GM: 에너미 식별 전환(감은 눈 = 식별 전, 뜬 눈 = 식별됨)
      if (game.user.isGM && actor.type === "enemy") {
        const known = !!actor.system.identified;
        btn(known ? "fa-eye" : "fa-eye-slash", known ? L("identifiedOn") : L("identifiedOff"), () => setIdentified([actor], !known), known);
      }
      const row = actor.system.row === "back" ? "back" : "front";
      const tags = document.createElement("span");
      tags.className = "nssq-tags";
      tags.innerHTML = `<span class="row-tag ${row}" title="${L("rowTitle")}">${game.i18n.localize(`NSSQ.Row.${row}`)}</span>`
        + (game.user.isGM && actor.type === "enemy" && actor.system.isRare ? `<span class="rare-tag" title="${game.i18n.localize("NSSQ.Rare.gmOnly")}">★</span>` : "")
        // 방어 전념 표시: 버튼이 보이는 개막 페이즈에는 버튼이 켜진 것으로 대신한다
        + (guarding && !(owner && phase === "opening") ? `<span class="guard-tag" title="${L("guardTitle")}"><i class="fas fa-shield-alt"></i> ${L("guardShort")}</span>` : "");
      box.append(tags);
      if (c.getFlag("nssq", "opening")) li.classList.add("nssq-opened");
      const name = li.querySelector(".token-name") ?? li;
      name.append(box);
    });
  });

  // 메인 페이즈: 전투 씬을 보고 있는 플레이어는 「타겟 선택」 도구로, 끝나면 「토큰 선택」으로
  // (v0.8.0부터 전투 씬으로 옮기지 않으므로 예전 방식 전투에만 해당)
  const syncTool = (combat) => {
    if (game.user.isGM || !canvas?.ready || !combat?.started) return;
    if (!canvas.scene?.getFlag("nssq", "battleCopy")) return;
    const mine = combat.combatants.some((c) => c.actor?.isOwner);
    if (!mine) return;
    const want = combat.getFlag("nssq", "phase") === "main" && !combat.getFlag("nssq", "over") ? "target" : "select";
    if (ui.controls.activeControl === "token" && ui.controls.activeTool === want) return;
    ui.controls.initialize({ control: "token", tool: want });
    canvas.tokens.activate({ tool: want });
  };
  Hooks.on("updateCombat", (combat, changes) => {
    if (foundry.utils.hasProperty(changes, "flags.nssq.phase") || foundry.utils.hasProperty(changes, "flags.nssq.over")) syncTool(combat);
  });
  Hooks.on("deleteCombat", () => {
    if (game.user.isGM || !canvas?.ready || ui.controls.activeTool !== "target") return;
    ui.controls.initialize({ control: "token", tool: "select" });
    canvas.tokens.activate({ tool: "select" });
  });
  // 메인 페이즈 도중에 접속하거나 씬이 바뀌어도 맞춘다
  Hooks.on("canvasReady", () => syncTool(game.combat));

  // 전투 중에 추가된 전투원도 【속도】로 이니셔티브
  Hooks.on("createCombatant", (combatant) => {
    if (game.user.isGM && combatant.combat?.started) combatant.combat.rollInitiative([combatant.id]);
  });
  // 【속도】·열·식별이 바뀌면 트래커 갱신
  Hooks.on("updateActor", () => ui.combat?.render(false));
  Hooks.on("updateToken", () => ui.combat?.render(false));
}
