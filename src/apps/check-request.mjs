/**
 * GM 판정 요청: GM이 캐릭터·능력치·수정치·목표값을 지정해 보내면
 * 그 캐릭터를 소유한 접속 중인 플레이어에게 [실시]/[거절] 팝업이 뜬다.
 */
import { ABILITIES } from "../engine/derive.mjs";
import { rollCheck } from "../chat/check.mjs";
import { emit, onSocket } from "../socket.mjs";

const open = new Map(); // requestId → Dialog

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Request.${k}`, d) : game.i18n.localize(`NSSQ.Request.${k}`));
const abilityLabel = (k) => (k ? game.i18n.localize(`NSSQ.Ability.${k}`) : game.i18n.localize("NSSQ.Check.custom"));

/** 이 액터에 응답할 사용자: 접속 중이고 소유권이 있는 플레이어. 없으면 GM 자신 */
function respondersFor(actor) {
  const players = game.users.filter((u) => u.active && !u.isGM && actor.testUserPermission(u, "OWNER"));
  return players.length ? players.map((u) => u.id) : [game.user.id];
}

function describe(req) {
  const parts = [abilityLabel(req.ability)];
  if (req.modifier) parts.push(`${L("modifierShort")} ${req.modifier > 0 ? "+" : ""}${req.modifier}`);
  if (req.target !== null) parts.push(`${game.i18n.localize("NSSQ.Check.target")} ${req.target}`);
  return parts.join(" · ");
}

/* ---------------- GM 쪽 ---------------- */

export async function openRequestDialog(preselect = []) {
  if (!game.user.isGM) return;
  const characters = game.actors.filter((a) => a.type === "character");
  if (!characters.length) return ui.notifications.warn(L("noCharacters"));
  const ownerNames = (a) => game.users.filter((u) => !u.isGM && a.testUserPermission(u, "OWNER"))
    .map((u) => `${u.name}${u.active ? "" : ` (${L("offline")})`}`).join(", ") || L("noOwner");
  const rows = characters.map((a) => `
    <label class="request-actor">
      <input type="checkbox" name="actor" value="${a.id}" ${preselect.includes(a.id) ? "checked" : ""}/>
      <img src="${a.img}" width="24" height="24"/> <span class="name">${a.name}</span>
      <span class="owner">${ownerNames(a)}</span>
    </label>`).join("");
  const modes = Object.entries(CONFIG.Dice.rollModes)
    .map(([k, v]) => `<option value="${k}">${game.i18n.localize(v)}</option>`).join("");
  const content = `
    <form class="nssq-request-form">
      <fieldset><legend>${L("characters")}</legend><div class="request-actors">${rows}</div></fieldset>
      <div class="form-group"><label>${game.i18n.localize("NSSQ.Check.ability")}</label>
        <select name="ability">${ABILITIES.map((k) => `<option value="${k}">${abilityLabel(k)}</option>`).join("")}
        <option value="">${abilityLabel(null)}</option></select></div>
      <div class="form-group"><label>${game.i18n.localize("NSSQ.Check.modifier")}</label><input type="number" name="modifier" value="0"/></div>
      <div class="form-group"><label>${game.i18n.localize("NSSQ.Check.target")}</label>
        <input type="number" name="target" placeholder="${game.i18n.localize("NSSQ.Check.targetNone")}"/></div>
      <div class="form-group"><label>${L("note")}</label><input type="text" name="note" placeholder="${L("notePlaceholder")}"/></div>
      <div class="form-group"><label>${L("rollMode")}</label><select name="rollMode">${modes}</select></div>
    </form>`;
  const data = await Dialog.prompt({
    title: L("title"),
    content,
    label: L("send"),
    rejectClose: false,
    options: { width: 460, classes: ["nssq", "dialog"] },
    callback: (html) => {
      const f = html[0].querySelector("form");
      return {
        actorIds: [...f.querySelectorAll("[name=actor]:checked")].map((i) => i.value),
        ability: f.ability.value || null,
        modifier: Number(f.modifier.value) || 0,
        target: f.target.value === "" ? null : Number(f.target.value),
        note: f.note.value.trim(),
        rollMode: f.rollMode.value
      };
    }
  });
  if (!data) return;
  if (!data.actorIds.length) return ui.notifications.warn(L("pickOne"));
  for (const actorId of data.actorIds) sendRequest({ ...data, actorId });
}

function sendRequest({ actorId, ability, modifier, target, note, rollMode }) {
  const actor = game.actors.get(actorId);
  const users = respondersFor(actor);
  const req = {
    id: foundry.utils.randomID(), actorId, ability, modifier, target, note, rollMode,
    from: game.user.id, users
  };
  emit("requestCheck", req, { local: users.includes(game.user.id) });
  ui.notifications.info(L("sent", { name: actor.name, what: describe(req) }));
}

/* ---------------- 플레이어 쪽 ---------------- */

function showRequest(req) {
  if (!req.users.includes(game.user.id)) return;
  const actor = game.actors.get(req.actorId);
  if (!actor) return;
  const fp = actor.system.fp?.value ?? 0;
  let answered = false;
  const bonus = req.ability ? actor.system.bonus?.[req.ability] ?? 0 : 0;
  const content = `
    <form class="nssq-request-popup">
      <p class="request-who">${L("asked", { gm: game.users.get(req.from)?.name ?? "GM", name: actor.name })}</p>
      <p class="request-what"><b>${describe(req)}</b></p>
      <p class="request-formula">2D6 + B ${bonus}${req.modifier ? ` ${req.modifier > 0 ? "+" : ""}${req.modifier}` : ""}</p>
      ${req.note ? `<p class="request-note">${escape(req.note)}</p>` : ""}
      <div class="form-group"><label>${game.i18n.format("NSSQ.Check.addDiceLabel", { fp })}</label>
        <input type="number" name="addDice" value="0" min="0" max="${fp}"/></div>
      <p class="notes">${game.i18n.localize("NSSQ.Check.addDiceHint")}</p>
    </form>`;
  const dialog = new Dialog({
    title: L("popupTitle"),
    content,
    buttons: {
      roll: {
        icon: '<i class="fas fa-dice"></i>',
        label: L("accept"),
        callback: async (html) => {
          answered = true;
          const n = Math.clamp(Number(html[0].querySelector("[name=addDice]").value) || 0, 0, fp);
          emit("requestResolved", { id: req.id, by: game.user.id });
          await rollCheck(actor, {
            ability: req.ability, modifier: req.modifier, target: req.target, addDice: n,
            rollMode: req.rollMode, request: { id: req.id, from: req.from, note: req.note }
          });
        }
      },
      decline: {
        icon: '<i class="fas fa-times"></i>',
        label: L("decline"),
        callback: () => {
          answered = true;
          emit("requestResolved", { id: req.id, by: game.user.id });
          emit("requestDeclined", { id: req.id, actorId: req.actorId, by: game.user.id, to: req.from, what: describe(req) },
            { local: req.from === game.user.id });
        }
      }
    },
    default: "roll",
    close: () => {
      open.delete(req.id);
      // 창을 그냥 닫으면 거절로 본다(다른 소유자가 이미 응답한 경우는 제외)
      if (!answered && !dialog._resolvedElsewhere) {
        emit("requestResolved", { id: req.id, by: game.user.id });
        emit("requestDeclined", { id: req.id, actorId: req.actorId, by: game.user.id, to: req.from, what: describe(req) },
          { local: req.from === game.user.id });
      }
    }
  }, { classes: ["nssq", "dialog", "nssq-request"], width: 360 });
  open.set(req.id, dialog);
  dialog.render(true);
}

export function registerCheckRequest() {
  onSocket("requestCheck", showRequest);

  // 같은 캐릭터의 다른 소유자가 응답하면 내 팝업은 닫는다
  onSocket("requestResolved", ({ id, by }) => {
    if (by === game.user.id) return;
    const d = open.get(id);
    if (!d) return;
    d._resolvedElsewhere = true;
    d.close();
  });

  onSocket("requestDeclined", ({ actorId, by, to, what }) => {
    if (to !== game.user.id) return;
    const name = game.actors.get(actorId)?.name ?? "?";
    ui.notifications.info(L("declined", { user: game.users.get(by)?.name ?? "?", name, what }));
  });

  // GM 도구: 토큰 컨트롤과 액터 탭 머리
  Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user.isGM) return;
    controls.find((c) => c.name === "token")?.tools.push({
      name: "nssq-request-check",
      title: "NSSQ.Request.title",
      icon: "fas fa-dice-d6",
      button: true,
      onClick: () => openRequestDialog(canvas?.tokens?.controlled?.map((t) => t.actor?.id).filter(Boolean) ?? [])
    });
  });

  Hooks.on("renderActorDirectory", (app, html) => {
    if (!game.user.isGM) return;
    const btn = $(`<button type="button" class="nssq-request-btn"><i class="fas fa-dice-d6"></i> ${L("title")}</button>`);
    btn.on("click", () => openRequestDialog());
    html.find(".directory-header .header-actions").append(btn);
  });
}
