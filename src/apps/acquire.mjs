/**
 * 아이템 받기·창고 이동의 공통 흐름.
 * - 소지 수를 넘으면 「버릴 것(또는 창고로 보낼 것)」을 고르는 창을 띄운다
 * - 던전에서 얻는 것(시트에 끌어 놓기·드롭)은 창고로 보낼 수 없다(allowStore=false)
 * - GM이 넣어 준 것이 넘치면 그 캐릭터를 소유한 접속 중 플레이어에게 창을 넘긴다
 */
import { carryUnits, checkOverflowPlan, exceedsOwnLimit, isPhysical, stackKey } from "../engine/equipment.mjs";
import { emit, onSocket } from "../socket.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Storage.${k}`, d) : game.i18n.localize(`NSSQ.Storage.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** 창고 기능이 이 캐릭터에서 켜져 있는가: 월드 설정 + GM이 캐릭터마다 허용 */
export function storageActive(actor) {
  return !!game.settings.get("nssq", "storage") && actor?.type === "character" && !!actor.system.storageEnabled;
}

const itemLabel = (i) => {
  const r = ["weapon", "armor", "material"].includes(i.type) ? ` R${i.system.rank}` : "";
  return `${i.name}${r}`;
};

/* ---------------- 수량 분할·합치기 ---------------- */

/** 아이템 n개를 stored 상태로 옮긴다(나머지는 그대로). 같은 쪽에 같은 묶음이 있으면 합친다 */
export async function moveUnits(actor, item, n, stored) {
  const qty = item.system.quantity ?? 1;
  n = Math.clamp(n, 0, qty);
  if (!n) return;
  const key = stackKey(item);
  const target = key ? actor.items.find((i) => i.id !== item.id && !!i.system.stored === stored && stackKey(i) === key) : null;
  if (target) {
    await target.update({ "system.quantity": (target.system.quantity ?? 1) + n });
    if (n >= qty) await item.delete();
    else await item.update({ "system.quantity": qty - n });
    return;
  }
  if (n >= qty || !key) {
    await item.update({ "system.stored": stored, "system.equipped": false });
    return;
  }
  const copy = item.toObject();
  delete copy._id;
  copy.system.quantity = n;
  copy.system.stored = stored;
  copy.system.equipped = false;
  await item.update({ "system.quantity": qty - n });
  await actor.createEmbeddedDocuments("Item", [copy]);
}

async function discardUnits(item, n) {
  const qty = item.system.quantity ?? 1;
  if (n >= qty) await item.delete();
  else if (n > 0) await item.update({ "system.quantity": qty - n });
}

/* ---------------- 소지 수 초과 정리 창 ---------------- */

/**
 * @returns {Promise<object|null>} plan { [itemId]: { discard, store } } 또는 취소 시 null
 */
export function overflowDialog(actor, { incoming, incomingNames = [], allowStore = false, reason = "", reserved = {} }) {
  const items = actor.items.contents.filter((i) => carryUnits(i) - (reserved[i.id] ?? 0) > 0);
  const capacity = actor.system.carry;
  // reserved: 이번 거래에 쓸 소재 등, 버리거나 옮길 수 없는 개수
  const rows = items.map((i) => {
    const max = carryUnits(i) - (reserved[i.id] ?? 0);
    return `
    <tr data-id="${i.id}">
      <td class="name">${esc(itemLabel(i))}${reserved[i.id] ? ` <span class="notes">(${L("reserved", { n: reserved[i.id] })})</span>` : ""}</td>
      <td class="units">${carryUnits(i)}</td>
      <td><input type="number" name="discard" min="0" max="${max}" value="0"/></td>
      ${allowStore ? `<td><input type="number" name="store" min="0" max="${max}" value="0"/></td>` : ""}
    </tr>`;
  }).join("");
  const content = `
    <form class="nssq-overflow">
      <p>${reason ? `${esc(reason)}<br/>` : ""}${L("overflowIntro", { carried: actor.system.carried, capacity, incoming })}</p>
      ${incomingNames.length ? `<p class="incoming"><b>${L("incoming")}</b>: ${incomingNames.map(esc).join(", ")}</p>` : ""}
      <table>
        <thead><tr><th>${L("item")}</th><th>${L("units")}</th><th>${L("discard")}</th>${allowStore ? `<th>${L("toStorage")}</th>` : ""}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="overflow-status"></p>
      ${allowStore ? "" : `<p class="notes">${L("noStoreInDungeon")}</p>`}
    </form>`;
  return new Promise((resolve) => {
    let plan = null;
    const read = (root) => {
      const p = {};
      root.querySelectorAll("tr[data-id]").forEach((tr) => {
        const discard = Number(tr.querySelector("[name=discard]")?.value) || 0;
        const store = Number(tr.querySelector("[name=store]")?.value) || 0;
        if (discard || store) p[tr.dataset.id] = { discard, store };
      });
      return p;
    };
    new Dialog({
      title: L("overflowTitle", { name: actor.name }),
      content,
      buttons: {
        ok: { icon: '<i class="fas fa-check"></i>', label: L("overflowOk"), callback: (html) => { plan = read(html[0]); } },
        cancel: { icon: '<i class="fas fa-times"></i>', label: L("overflowCancel") }
      },
      default: "ok",
      close: () => resolve(plan),
      render: (html) => {
        const root = html[0];
        const app = root.closest(".app");
        root.querySelectorAll("input[type=number]").forEach((i) => i.addEventListener("change", () => {
          i.value = String(Math.clamp(Number(i.value) || 0, 0, Number(i.max)));
        }));
        const refresh = () => {
          const r = checkOverflowPlan(actor.items.contents, capacity, incoming, read(root));
          const status = root.querySelector(".overflow-status");
          status.textContent = L("overflowStatus", { after: r.after, capacity, need: r.need });
          status.classList.toggle("over", !r.ok);
          const btn = app?.querySelector(".dialog-button.ok");
          if (btn) btn.disabled = !r.ok;
        };
        root.querySelectorAll("input").forEach((i) => i.addEventListener("input", refresh));
        refresh();
      }
    }, { classes: ["nssq", "dialog"], width: allowStore ? 460 : 400 }).render(true);
  });
}

async function applyPlan(actor, plan) {
  for (const [id, p] of Object.entries(plan)) {
    const item = actor.items.get(id);
    if (!item) continue;
    const units = carryUnits(item);
    const store = Math.min(units, p.store ?? 0);
    const discard = Math.min(units - store, p.discard ?? 0);
    if (store) await moveUnits(actor, item, store, true);
    const after = actor.items.get(id);
    if (discard && after) await discardUnits(after, discard);
  }
}

/* ---------------- 받기 ---------------- */

/** 아이템 데이터들을 캐릭터의 소지품으로 넣는다(같은 묶음은 합친다) */
async function addItems(actor, dataList) {
  const created = [];
  for (const raw of dataList) {
    const data = foundry.utils.deepClone(raw);
    delete data._id;
    data.system = { ...data.system, stored: false, equipped: false };
    const key = stackKey(data);
    const existing = key ? actor.items.find((i) => !i.system.stored && stackKey(i) === key) : null;
    if (existing) {
      await existing.update({ "system.quantity": (existing.system.quantity ?? 1) + (data.system.quantity ?? 1) });
      created.push(existing);
    } else created.push(...(await actor.createEmbeddedDocuments("Item", [data])));
  }
  return created;
}

/** 이 사용자 대신 정리 창을 볼 플레이어(접속 중 소유자). 내가 그 플레이어면 null */
function delegateTo(actor) {
  if (!game.user.isGM) return null;
  const players = game.users.filter((u) => u.active && !u.isGM && actor.testUserPermission(u, "OWNER"));
  return players[0] ?? null;
}

/**
 * 아이템 받기. 소지 수를 넘으면 정리 창. 취소하면 받지 않는다.
 * @param {Actor} actor
 * @param {object[]} dataList 아이템 데이터
 * @param {{allowStore?: boolean, reason?: string, delegate?: boolean}} opts
 * @returns {Promise<Item[]|null>} 받은 아이템, 받지 않았으면 null
 */
export async function acquireItems(actor, dataList, { allowStore = false, reason = "", delegate = true, reserved = {} } = {}) {
  if (actor.type !== "character") return actor.createEmbeddedDocuments("Item", dataList);
  // 『백팩』처럼 소지 개수 제한이 있는 것
  dataList = dataList.filter((d) => {
    if (!exceedsOwnLimit(actor.items.contents, d)) return true;
    ui.notifications.warn(game.i18n.format("NSSQ.Shop.ownLimit", { name: d.name }));
    return false;
  });
  if (!dataList.length) return null;
  const physical = dataList.filter(isPhysical);
  const incoming = physical.reduce((n, d) => n + carryUnits({ ...d, system: { ...d.system, equipped: false, stored: false } }), 0);
  if (actor.system.carried + incoming > actor.system.carry) {
    const player = delegate ? delegateTo(actor) : null;
    if (player) {
      emit("resolveOverflow", { actorId: actor.id, user: player.id, dataList, allowStore: allowStore && storageActive(actor), reason });
      ui.notifications.info(L("delegated", { user: player.name, name: actor.name }));
      return null;
    }
    const plan = await overflowDialog(actor, {
      incoming, incomingNames: physical.map((d) => itemLabel(d)), allowStore: allowStore && storageActive(actor), reason, reserved
    });
    if (!plan) {
      ui.notifications.info(L("notReceived", { name: actor.name }));
      return null;
    }
    await applyPlan(actor, plan);
  }
  return addItems(actor, dataList);
}

/* ---------------- 창고 이동 ---------------- */

async function askQuantity(item, title) {
  const qty = item.system.quantity ?? 1;
  if (qty <= 1) return qty;
  return Dialog.prompt({
    title,
    content: `<form><div class="form-group"><label>${esc(itemLabel(item))} (${qty})</label><input type="number" name="n" min="1" max="${qty}" value="${qty}"/></div></form>`,
    rejectClose: false,
    callback: (html) => Math.clamp(Number(html[0].querySelector("[name=n]").value) || 0, 0, qty)
  });
}

export async function storeItem(actor, item) {
  if (!storageActive(actor) || item.system.equipped) return;
  const n = await askQuantity(item, L("toStorage"));
  if (n) await moveUnits(actor, item, n, true);
}

/** 꺼내기: 소지 수를 넘으면 정리 창(창고로 보내는 것도 가능) */
export async function retrieveItem(actor, item) {
  if (!item.system.stored) return;
  const n = await askQuantity(item, L("retrieve"));
  if (!n) return;
  const probe = { ...item.toObject(), system: { ...item.system.toObject(), quantity: n, stored: false, equipped: false } };
  const incoming = carryUnits(probe);
  if (actor.system.carried + incoming > actor.system.carry) {
    const plan = await overflowDialog(actor, { incoming, incomingNames: [`${itemLabel(item)} ×${n}`], allowStore: storageActive(actor) });
    if (!plan) return;
    await applyPlan(actor, plan);
  }
  const fresh = actor.items.get(item.id);
  if (fresh) await moveUnits(actor, fresh, n, false);
}

export function registerAcquire() {
  onSocket("resolveOverflow", async ({ actorId, user, dataList, allowStore, reason }) => {
    if (user !== game.user.id) return;
    const actor = game.actors.get(actorId);
    if (actor) await acquireItems(actor, dataList, { allowStore, reason, delegate: false });
  });
}
