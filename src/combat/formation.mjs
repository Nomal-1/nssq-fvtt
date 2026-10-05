/**
 * 전투 씬의 칸 배치: 토큰 좌표를 (진영, 열, 칸)으로 계산하고 잠근다.
 * 열·칸이 바뀌면(배치 변경, 전위 전멸 교대) 다시 배치한다. GM 클라이언트에서만 움직인다.
 */
import { LAYOUT, assignPartySlots, formationPositions, partyRowSlots } from "../engine/formation.mjs";
import { isActiveGM } from "./apply.mjs";
import { sideOf } from "./profile.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Combat.${k}`, d) : game.i18n.localize(`NSSQ.Combat.${k}`));

export const isBattleScene = (scene) => !!scene?.getFlag("nssq", "battleCopy");
const isParty = (actor) => actor && actor.type !== "enemy";

/** 씬의 진형 입력값 */
function unitsOf(scene) {
  const party = [];
  const enemies = [];
  for (const t of scene.tokens) {
    const a = t.actor;
    if (!a || a.type === "token") continue; // 토큰 스킬의 유사 NPC는 단계 8
    const u = { id: t.id, row: a.system.row ?? "front", order: a.system.order ?? 0, actor: a };
    (isParty(a) && sideOf(a) !== "enemy" ? party : enemies).push(u);
  }
  return { party, enemies };
}

/** 칸에 맞춰 토큰을 옮기고 잠근다. 파티 칸이 정리되면(겹침·초과) 캐릭터의 열·칸도 맞춘다 */
export async function relayout(scene) {
  if (!scene || !isBattleScene(scene) || !isActiveGM()) return;
  const { party, enemies } = unitsOf(scene);
  const assigned = assignPartySlots(party);
  for (const u of party) {
    const s = assigned.slots[u.id];
    if (s && (s.row !== u.row || s.index !== u.order)) await u.actor.update({ "system.row": s.row, "system.order": s.index }, { nssqLayout: true });
  }
  if (assigned.overflow.length) ui.notifications.warn(L("formationOverflow", { n: assigned.overflow.length }));
  const pos = formationPositions({
    party: party.map((u) => ({ ...u, row: assigned.slots[u.id]?.row ?? u.row, order: assigned.slots[u.id]?.index ?? u.order })),
    enemies
  });
  const g = scene.grid.size || LAYOUT.grid;
  const updates = [];
  for (const t of scene.tokens) {
    const p = pos[t.id];
    if (!p) continue;
    const x = Math.round(p.x - (t.width * g) / 2);
    const y = Math.round(p.y - (t.height * g) / 2);
    if (t.x !== x || t.y !== y || !t.locked) updates.push({ _id: t.id, x, y, locked: true });
  }
  if (updates.length) await scene.updateEmbeddedDocuments("Token", updates, { animate: true });
}

const pendingScenes = new Map();
/** 짧은 시간에 여러 번 바뀌어도 한 번만 다시 배치 */
export function scheduleRelayout(scene) {
  if (!scene || !isBattleScene(scene) || !isActiveGM()) return;
  clearTimeout(pendingScenes.get(scene.id));
  pendingScenes.set(scene.id, setTimeout(() => { pendingScenes.delete(scene.id); relayout(scene); }, 150));
}

/** 이 액터의 토큰이 있는 전투 씬들 */
function battleScenesOf(actor) {
  if (actor.isToken) return isBattleScene(actor.token?.parent) ? [actor.token.parent] : [];
  return game.scenes.filter((s) => isBattleScene(s) && s.tokens.some((t) => t.actorLink && t.actorId === actor.id));
}

/* ---------------- 배치 변경(개막 행동) ---------------- */

/**
 * 파티: 열과 칸을 고른다. 다른 사람이 있는 칸은 고를 수 없다(자기 자신만 움직인다, 01 §3.3).
 * 에너미(GM): 열을 바꾸고 순서를 정한다.
 * @returns {Promise<boolean>} 바꿨는가
 */
export async function changePosition(combatant) {
  const actor = combatant.actor;
  const scene = combatant.parent?.scene ?? game.scenes.get(combatant.sceneId);
  if (!actor) return false;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  if (actor.type === "enemy") {
    const choice = await Dialog.prompt({
      title: L("changeRow"),
      content: `<form><div class="form-group"><label>${L("rowTitle")}</label><select name="row">
        <option value="front" ${actor.system.row !== "back" ? "selected" : ""}>${game.i18n.localize("NSSQ.Row.front")}</option>
        <option value="back" ${actor.system.row === "back" ? "selected" : ""}>${game.i18n.localize("NSSQ.Row.back")}</option></select></div>
        <div class="form-group"><label>${L("orderTitle")}</label><input type="number" name="order" value="${actor.system.order ?? 0}"/></div>
        <p class="notes">${L("enemyOrderHint")}</p></form>`,
      rejectClose: false,
      callback: (html) => ({ row: html[0].querySelector("[name=row]").value, order: Number(html[0].querySelector("[name=order]").value) || 0 })
    });
    if (!choice) return false;
    await actor.update({ "system.row": choice.row, "system.order": choice.order });
    return true;
  }

  const party = scene ? unitsOf(scene).party : [];
  const self = party.find((u) => u.actor === actor || u.actor?.id === actor.id);
  const nameOf = (tokenId) => scene?.tokens.get(tokenId)?.name ?? "";
  const rowsHtml = ["front", "back"].map((row) => {
    const cells = partyRowSlots(party, row, self?.id).map((c) => {
      const mine = c.occupant && c.occupant === self?.id;
      const label = mine ? L("slotSelf") : c.occupant ? esc(nameOf(c.occupant)) : L("slotEmpty");
      return `<label class="slot-cell ${c.free ? "" : "taken"} ${mine ? "mine" : ""}">
        <input type="radio" name="slot" value="${row}:${c.index}" ${mine ? "checked" : ""} ${c.free ? "" : "disabled"}/> ${label}</label>`;
    }).join("");
    return `<div class="slot-row"><span class="row-name">${game.i18n.localize(`NSSQ.Row.${row}`)}</span>${cells}</div>`;
  }).join("");
  const pick = await Dialog.prompt({
    title: `${actor.name} — ${L("changeRow")}`,
    content: `<form class="nssq-slot-picker"><p class="notes">${L("slotPickerHint")}</p>${rowsHtml}</form>`,
    rejectClose: false,
    callback: (html) => html[0].querySelector("[name=slot]:checked")?.value ?? null
  });
  if (!pick) return false;
  const [row, index] = pick.split(":");
  if (row === actor.system.row && Number(index) === actor.system.order) return false;
  await actor.update({ "system.row": row, "system.order": Number(index) });
  return true;
}

export function registerFormation() {
  // 열·칸이 바뀌면 그 액터가 있는 전투 씬을 다시 배치
  Hooks.on("updateActor", (actor, changes) => {
    const sys = changes.system ?? {};
    if (!("row" in sys) && !("order" in sys)) return;
    for (const s of battleScenesOf(actor)) scheduleRelayout(s);
  });
  // 비연결 토큰(에너미)의 액터 변경은 토큰의 delta로 들어온다
  Hooks.on("updateToken", (token, changes) => {
    const sys = changes.delta?.system ?? {};
    if ("row" in sys || "order" in sys) scheduleRelayout(token.parent);
  });
  Hooks.on("createToken", (token) => scheduleRelayout(token.parent));
  Hooks.on("deleteToken", (token) => scheduleRelayout(token.parent));
}
