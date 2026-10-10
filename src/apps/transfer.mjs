/**
 * 캐릭터끼리 아이템·돈 건네기(사용자 요청). 전투 중에는 못 한다(던전 캠프·필드·마을 어디서나 가능)
 * - 주는 캐릭터의 소유자가 연다. 장비 중·창고에 있는 것은 못 준다
 * - 받는 캐릭터도 소유하면 바로, 아니면 활성 GM이 처리한다(소켓 transfer)
 * - 받는 쪽은 획득 규칙(acquireItems: 소지 한도 넘으면 받는 쪽 플레이어가 고른다)을 따른다. 못 받은 것은 주는 쪽에 남는다
 */
import { emit, onSocket } from "../socket.mjs";
import { isActiveGM } from "../combat/apply.mjs";
import { isPhysical, isStored } from "../engine/equipment.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Transfer.${k}`, d) : game.i18n.localize(`NSSQ.Transfer.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const inBattle = () => !!game.combat?.started;
const givable = (i) => isPhysical(i) && !isStored(i) && !i.system.equipped;

/** 건네기 창 */
export async function openTransfer(from, preItemId = null) {
  if (!from?.isOwner || from.type !== "character") return null;
  if (inBattle()) return ui.notifications.warn(L("noBattle"));
  const targets = game.actors.filter((a) => a.type === "character" && a.id !== from.id && !a.getFlag("nssq", "benched"));
  if (!targets.length) return ui.notifications.warn(L("noTarget"));
  const items = from.items.filter(givable).sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name, "ko"));
  const rows = items.map((i) => {
    const q = i.system.quantity ?? 1;
    const stack = "quantity" in i.system;
    return `<tr><td><input type="checkbox" name="pick" value="${i.id}" ${i.id === preItemId ? "checked" : ""}/></td>
      <td><img src="${esc(i.img)}" width="24" height="24" style="border:none;vertical-align:middle"/> ${esc(i.name)}${i.system.rank ? ` R${i.system.rank}` : ""}</td>
      <td>${stack && q > 1 ? `<input type="number" name="qty-${i.id}" min="1" max="${q}" value="${q}" style="width:56px"/> / ${q}` : "1"}</td></tr>`;
  }).join("");
  const content = `<form class="nssq-transfer">
    <div class="form-group"><label>${esc(L("to"))}</label><select name="to">${targets.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select></div>
    <div class="form-group"><label>${esc(L("money"))}</label><input type="number" name="money" min="0" max="${from.system.money ?? 0}" value="0"/> <span>/ ${from.system.money ?? 0}G</span></div>
    ${items.length ? `<table class="nssq-transfer-items"><tbody>${rows}</tbody></table>` : `<p class="notes">${esc(L("noItems"))}</p>`}
    <p class="notes">${esc(L("hint"))}</p></form>`;
  const req = await Dialog.prompt({
    title: L("title", { name: from.name }), content, label: L("give"), rejectClose: false,
    options: { classes: ["nssq", "dialog"], width: 460 },
    callback: (html) => {
      const f = html[0].querySelector("form");
      const picks = [...f.querySelectorAll("[name=pick]:checked")].map((c) => ({ id: c.value, qty: Number(f.querySelector(`[name="qty-${c.value}"]`)?.value) || 1 }));
      return { fromId: from.id, toId: f.querySelector("[name=to]").value, money: Math.max(0, Number(f.querySelector("[name=money]").value) || 0), items: picks };
    }
  });
  if (!req || (!req.items.length && !req.money)) return null;
  const to = game.actors.get(req.toId);
  if (game.user.isGM || to?.isOwner) return doTransfer(req, game.user.id);
  if (!game.users.activeGM) return ui.notifications.warn(L("noGM"));
  emit("transfer", { ...req, userId: game.user.id });
  return ui.notifications.info(L("sent", { name: to?.name ?? "" }));
}

/** 실제로 옮긴다(주는 캐릭터 소유자 확인) */
async function doTransfer({ fromId, toId, money = 0, items = [] }, userId) {
  const from = game.actors.get(fromId);
  const to = game.actors.get(toId);
  const user = game.users.get(userId);
  if (!from || !to || from === to || !user || !from.testUserPermission(user, "OWNER")) return;
  if (inBattle()) { if (user.id === game.user.id) ui.notifications.warn(L("noBattle")); return; }
  const { acquireItems } = await import("./acquire.mjs");
  const moved = [];
  for (const { id, qty } of items) {
    const it = from.items.get(id);
    if (!it || !givable(it)) continue;
    const stack = "quantity" in it.system;
    const have = stack ? it.system.quantity ?? 1 : 1;
    const n = Math.clamp(Math.floor(qty) || 1, 1, have);
    const data = it.toObject();
    delete data._id;
    if (stack) data.system.quantity = n;
    data.system.equipped = false;
    data.system.stored = false;
    const { taken } = await acquireItems(to, [data], { source: "gift", reason: L("reason", { name: from.name }) });
    if (!taken?.length) continue;
    if (stack && n < have) await it.update({ "system.quantity": have - n });
    else await it.delete();
    moved.push(`${it.name}${n > 1 ? ` ×${n}` : ""}`);
  }
  const m = Math.min(Math.max(0, Math.floor(money)), from.system.money ?? 0);
  if (m) {
    await from.update({ "system.money": (from.system.money ?? 0) - m });
    await to.update({ "system.money": (to.system.money ?? 0) + m });
    moved.push(`${m}G`);
  }
  if (!moved.length) return;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: from }),
    content: `<div class="nssq-transfer-card"><i class="fas fa-hand-holding"></i> ${esc(L("done", { from: from.name, to: to.name }))}<br><small>${esc(moved.join(", "))}</small></div>`
  });
}

export function registerTransfer() {
  onSocket("transfer", (p) => { if (isActiveGM()) doTransfer(p, p.userId); });
}
