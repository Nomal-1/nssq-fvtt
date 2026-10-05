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

async function toggleGuard(combatant) {
  const on = !combatant.getFlag("nssq", "guarding");
  await combatant.update({ "flags.nssq.guarding": on, "flags.nssq.waiting": on, "flags.nssq.opening": on ? "guard" : null });
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: combatant.actor }),
    content: `<div class="nssq-combat-note"><i class="fas fa-shield-alt"></i> ${L(on ? "guardOn" : "guardOff", { name: combatant.name })}</div>`
  });
}

async function toggleRow(combatant) {
  if (await changePosition(combatant)) await combatant.setFlag("nssq", "opening", "row");
}

/** 무기 슬롯과 기타 슬롯의 무기를 맞바꾼다 */
async function swapWeapon(combatant) {
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
      bar.className = `nssq-phase-bar phase-${phase}`;
      bar.innerHTML = `<span class="phase-label">${L("roundPhase", { round: combat.round, phase: L(`phase.${phase}`) })}</span>
        <span class="phase-hint">${L(`phaseHint.${phase}`)}</span>`;
      if (game.user.isGM) {
        const next = document.createElement("button");
        next.type = "button";
        next.className = "nssq-next-phase";
        next.innerHTML = `<i class="fas fa-forward"></i> ${phase === "main" ? L("nextTurn") : L("nextPhase")}`;
        next.addEventListener("click", () => combat.nextPhase());
        bar.append(next);
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

    // 전투원별: 열, 방어 전념, 개막 행동, 통상 공격
    root.querySelectorAll("li.combatant").forEach((li) => {
      const c = combat.combatants.get(li.dataset.combatantId);
      if (!c?.actor) return;
      const actor = c.actor;
      const box = document.createElement("div");
      box.className = "nssq-combatant-tools";
      const row = actor.system.row === "back" ? "back" : "front";
      const tags = [`<span class="row-tag ${row}" title="${L("rowTitle")}">${game.i18n.localize(`NSSQ.Row.${row}`)}</span>`];
      if (game.user.isGM && actor.type === "enemy" && actor.system.isRare) tags.push(`<span class="rare-tag" title="${game.i18n.localize("NSSQ.Rare.gmOnly")}">★</span>`);
      if (c.getFlag("nssq", "guarding")) tags.push(`<span class="guard-tag" title="${L("guardTitle")}"><i class="fas fa-shield-alt"></i></span>`);
      box.innerHTML = tags.join("");
      const owner = actor.isOwner;
      const btn = (icon, title, fn) => {
        const a = document.createElement("a");
        a.className = "nssq-tool";
        a.title = title;
        a.innerHTML = `<i class="fas ${icon}"></i>`;
        a.addEventListener("click", (ev) => { ev.stopPropagation(); fn(ev); });
        box.append(a);
      };
      if (owner && started && phase === "opening" && !c.defeated) {
        btn("fa-shield-alt", L("guard"), () => toggleGuard(c));
        btn("fa-arrows-alt-v", L("changeRow"), () => toggleRow(c));
        if (actor.type === "character") btn("fa-exchange-alt", L("swapWeapon"), () => swapWeapon(c));
      }
      if (owner && started && phase === "main" && !c.defeated) {
        btn("fa-fist-raised", L("normalAttack"), (ev) => normalAttack(actor, { ignoreRange: ev.shiftKey && game.user.isGM }));
      }
      if (c.getFlag("nssq", "opening")) li.classList.add("nssq-opened");
      const name = li.querySelector(".token-name") ?? li;
      name.append(box);
    });
  });

  // 전투 중에 추가된 전투원도 【속도】로 이니셔티브
  Hooks.on("createCombatant", (combatant) => {
    if (game.user.isGM && combatant.combat?.started) combatant.combat.rollInitiative([combatant.id]);
  });
  // 【속도】·열이 바뀌면 트래커 갱신
  Hooks.on("updateActor", () => ui.combat?.render(false));
}
