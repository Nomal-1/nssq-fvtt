/**
 * 아이템 받기·창고 이동의 공통 흐름.
 *
 * acquireItems(actor, dataList, { source }) → { taken, left }
 * - 소지 수를 넘으면 정리 창: 새로 들어올 것 중 「두고 가기」, 지금 가진 것 「버리기」(·「창고로」)
 * - source가 창고 허용 여부와 두고 가기 허용 여부를 정한다(SOURCES)
 * - GM이 넣어 주는 것이 넘치면 그 캐릭터를 소유한 접속 중 플레이어에게 창을 넘기고, 결과를 소켓으로 돌려받는다
 * - 두고 간 것(left)은 호출한 쪽이 처리한다. 전투 후 갈무리(단계 9)는 이것을 갈무리 풀에 되돌린다
 */
import { carryUnits, checkOverflowPlan, exceedsOwnLimit, isPhysical, splitIncoming, stackKey } from "../engine/equipment.mjs";
import { emit, onSocket } from "../socket.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Storage.${k}`, d) : game.i18n.localize(`NSSQ.Storage.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * 출처별 규칙
 * - store: 정리할 때 창고로 보낼 수 있는가(던전에서 얻은 것은 불가)
 * - leave: 들어올 것을 일부만 챙기고 나머지를 두고 갈 수 있는가(구입·꺼내기는 전부 아니면 취소)
 */
export const SOURCES = {
  loot: { store: false, leave: true }, // 전투 후 갈무리·채집(단계 9)
  gift: { store: false, leave: true }, // 시트에 끌어 놓기, 다른 캐릭터가 건넴
  shop: { store: true, leave: false },
  storage: { store: true, leave: false } // 창고에서 꺼내기
};

/** 창고 기능이 이 캐릭터에서 켜져 있는가: 월드 설정 + GM이 캐릭터마다 허용 */
export function storageActive(actor) {
  return !!game.settings.get("nssq", "storage") && actor?.type === "character" && !!actor.system.storageEnabled;
}

const itemLabel = (i) => {
  const r = ["weapon", "armor", "material"].includes(i.type) ? ` R${i.system.rank}` : "";
  return `${i.name}${r}`;
};
const asCarried = (d) => ({ ...d, system: { ...d.system, equipped: false, stored: false } });

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
 * @param {Actor} actor
 * @param {object[]} incomingList 들어올 아이템 데이터
 * @param {{ store: boolean, leave: boolean, reason?: string, reserved?: object }} opts
 * @returns {Promise<{plan: object, leave: number[]}|null>} null이면 전부 두고 감(취소)
 */
export function overflowDialog(actor, incomingList, { store = false, leave = false, reason = "", reserved = {} }) {
  const capacity = actor.system.carry;
  const units = incomingList.map((d) => carryUnits(asCarried(d)));
  const incoming = units.reduce((a, b) => a + b, 0);
  const owned = actor.items.contents.filter((i) => carryUnits(i) - (reserved[i.id] ?? 0) > 0);

  const incomingRows = incomingList.map((d, i) => `
    <tr data-incoming="${i}">
      <td class="name">${esc(itemLabel(d))}</td>
      <td class="units">${units[i]}</td>
      <td>${leave && units[i] ? `<input type="number" name="leave" min="0" max="${units[i]}" value="0"/>` : "-"}</td>
    </tr>`).join("");
  const ownedRows = owned.map((i) => {
    const max = carryUnits(i) - (reserved[i.id] ?? 0);
    return `
    <tr data-id="${i.id}">
      <td class="name">${esc(itemLabel(i))}${reserved[i.id] ? ` <span class="notes">(${L("reserved", { n: reserved[i.id] })})</span>` : ""}</td>
      <td class="units">${carryUnits(i)}</td>
      <td><input type="number" name="discard" min="0" max="${max}" value="0"/></td>
      ${store ? `<td><input type="number" name="store" min="0" max="${max}" value="0"/></td>` : ""}
    </tr>`;
  }).join("");
  const content = `
    <form class="nssq-overflow">
      <p>${reason ? `${esc(reason)}<br/>` : ""}${L("overflowIntro", { carried: actor.system.carried, capacity, incoming })}</p>
      <h4>${L("incoming")}</h4>
      <table class="incoming">
        <thead><tr><th>${L("item")}</th><th>${L("units")}</th><th>${L("leave")}</th></tr></thead>
        <tbody>${incomingRows}</tbody>
      </table>
      <h4>${L("owned")}</h4>
      <table>
        <thead><tr><th>${L("item")}</th><th>${L("units")}</th><th>${L("discard")}</th>${store ? `<th>${L("toStorage")}</th>` : ""}</tr></thead>
        <tbody>${ownedRows}</tbody>
      </table>
      <p class="overflow-status"></p>
      ${store ? "" : `<p class="notes">${L("noStoreInDungeon")}</p>`}
    </form>`;

  return new Promise((resolve) => {
    let result = null;
    const read = (root) => {
      const plan = {};
      root.querySelectorAll("tr[data-id]").forEach((tr) => {
        const discard = Number(tr.querySelector("[name=discard]")?.value) || 0;
        const st = Number(tr.querySelector("[name=store]")?.value) || 0;
        if (discard || st) plan[tr.dataset.id] = { discard, store: st };
      });
      const lv = incomingList.map((_, i) => Number(root.querySelector(`tr[data-incoming="${i}"] [name=leave]`)?.value) || 0);
      return { plan, leave: lv };
    };
    new Dialog({
      title: L("overflowTitle", { name: actor.name }),
      content,
      buttons: {
        ok: { icon: '<i class="fas fa-check"></i>', label: L("overflowOk"), callback: (html) => { result = read(html[0]); } },
        cancel: { icon: '<i class="fas fa-times"></i>', label: leave ? L("leaveAll") : L("overflowCancel") }
      },
      default: "ok",
      close: () => resolve(result),
      render: (html) => {
        const root = html[0];
        const app = root.closest(".app");
        root.querySelectorAll("input[type=number]").forEach((i) => i.addEventListener("change", () => {
          i.value = String(Math.clamp(Number(i.value) || 0, 0, Number(i.max)));
        }));
        const refresh = () => {
          const { plan, leave: lv } = read(root);
          const left = lv.reduce((n, x, i) => n + Math.min(x, units[i]), 0);
          const r = checkOverflowPlan(actor.items.contents, capacity, incoming, plan, left);
          const status = root.querySelector(".overflow-status");
          status.textContent = L("overflowStatus", { after: r.after, capacity, need: r.need });
          status.classList.toggle("over", !r.ok);
          const btn = app?.querySelector(".dialog-button.ok");
          // 전부 두고 가는 것은 [두고 가기] 버튼으로
          if (btn) btn.disabled = !r.ok || left >= incoming;
        };
        root.querySelectorAll("input").forEach((i) => i.addEventListener("input", refresh));
        refresh();
      }
    }, { classes: ["nssq", "dialog"], width: store ? 480 : 420 }).render(true);
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

/** 아이템 데이터들을 소지품으로 넣는다(같은 묶음은 합친다) */
async function addItems(actor, dataList) {
  const taken = [];
  for (const raw of dataList) {
    const data = foundry.utils.deepClone(raw);
    delete data._id;
    data.system = { ...data.system, stored: false, equipped: false };
    const key = stackKey(data);
    const existing = key ? actor.items.find((i) => !i.system.stored && stackKey(i) === key) : null;
    if (existing) {
      await existing.update({ "system.quantity": (existing.system.quantity ?? 1) + (data.system.quantity ?? 1) });
      taken.push(existing);
    } else taken.push(...(await actor.createEmbeddedDocuments("Item", [data])));
  }
  return taken;
}

/** 정리 창을 대신 볼 플레이어(GM이 다른 캐릭터에게 넣어 줄 때, 접속 중인 소유자) */
function delegateTo(actor) {
  if (!game.user.isGM) return null;
  return game.users.find((u) => u.active && !u.isGM && actor.testUserPermission(u, "OWNER")) ?? null;
}

const pending = new Map(); // requestId → resolve
const DELEGATE_TIMEOUT = 15 * 60 * 1000;

/**
 * 아이템 받기
 * @param {Actor} actor
 * @param {object[]} dataList 아이템 데이터
 * @param {object} opts
 * @param {"loot"|"gift"|"shop"|"storage"} [opts.source] 출처(SOURCES)
 * @param {string} [opts.reason] 정리 창에 보일 사유(예: 「숲쥐의 드롭」)
 * @param {boolean} [opts.delegate] GM이 부를 때 소유 플레이어에게 넘길지
 * @param {object} [opts.reserved] 정리 대상에서 뺄 { itemId: 개수 }
 * @returns {Promise<{ taken: Item[], left: object[] }>} 받은 아이템, 두고 간 아이템 데이터
 */
export async function acquireItems(actor, dataList, { source = "gift", reason = "", delegate = true, reserved = {} } = {}) {
  if (actor.type !== "character") return { taken: await actor.createEmbeddedDocuments("Item", dataList), left: [] };
  const rule = SOURCES[source] ?? SOURCES.gift;
  const left = [];
  // 『백팩』처럼 소지 개수 제한이 있는 것은 두고 간다
  dataList = dataList.filter((d) => {
    if (!exceedsOwnLimit(actor.items.contents, d)) return true;
    ui.notifications.warn(game.i18n.format("NSSQ.Shop.ownLimit", { name: d.name }));
    left.push(d);
    return false;
  });
  if (!dataList.length) return { taken: [], left };

  const incoming = dataList.filter(isPhysical).reduce((n, d) => n + carryUnits(asCarried(d)), 0);
  if (actor.system.carried + incoming <= actor.system.carry) return { taken: await addItems(actor, dataList), left };

  const player = delegate ? delegateTo(actor) : null;
  if (player) {
    ui.notifications.info(L("delegated", { user: player.name, name: actor.name }));
    const id = foundry.utils.randomID();
    const result = await new Promise((resolve) => {
      pending.set(id, resolve);
      emit("resolveOverflow", { id, actorId: actor.id, user: player.id, dataList, source, reason, reserved });
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        emit("overflowCancel", { id });
        ui.notifications.warn(L("delegateTimeout", { user: player.name }));
        resolve({ takenIds: [], left: dataList });
      }, DELEGATE_TIMEOUT);
    });
    return { taken: result.takenIds.map((i) => actor.items.get(i)).filter(Boolean), left: [...left, ...result.left] };
  }

  const choice = await overflowDialog(actor, dataList, { store: rule.store && storageActive(actor), leave: rule.leave, reason, reserved });
  if (!choice) {
    ui.notifications.info(L("notReceived", { name: actor.name }));
    return { taken: [], left: [...left, ...dataList] };
  }
  const { take, left: leftHere } = splitIncoming(dataList, choice.leave);
  await applyPlan(actor, choice.plan);
  return { taken: await addItems(actor, take), left: [...left, ...leftHere] };
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
  if (!storageActive(actor) || item.system.equipped || item.system.stored) return;
  const n = await askQuantity(item, L("toStorage"));
  if (n) await moveUnits(actor, item, n, true);
}

/** 꺼내기: 소지 수를 넘으면 정리 창(창고로 보내는 것도 가능). 창고 기능이 꺼져 있으면 아무것도 하지 않는다 */
export async function retrieveItem(actor, item) {
  if (!storageActive(actor) || !item.system.stored) return;
  const n = await askQuantity(item, L("retrieve"));
  if (!n) return;
  const probe = { ...item.toObject(), system: { ...item.system.toObject(), quantity: n } };
  const incoming = carryUnits(asCarried(probe));
  if (actor.system.carried + incoming > actor.system.carry) {
    const choice = await overflowDialog(actor, [probe], { store: true, leave: false });
    if (!choice) return;
    await applyPlan(actor, choice.plan);
  }
  const fresh = actor.items.get(item.id);
  if (fresh) await moveUnits(actor, fresh, n, false);
}

/* ---------------- 소켓 ---------------- */

const openDelegated = new Map(); // id → true(진행 중)

export function registerAcquire() {
  // 플레이어 쪽: GM이 넘긴 정리 창
  onSocket("resolveOverflow", async ({ id, actorId, user, dataList, source, reason, reserved }) => {
    if (user !== game.user.id) return;
    const actor = game.actors.get(actorId);
    if (!actor) return emit("overflowResolved", { id, takenIds: [], left: dataList });
    openDelegated.set(id, true);
    const r = await acquireItems(actor, dataList, { source, reason, reserved, delegate: false });
    if (!openDelegated.delete(id)) return; // 시간 초과로 취소됨
    emit("overflowResolved", { id, takenIds: r.taken.map((i) => i.id), left: r.left });
  });
  // GM 쪽: 결과 받기
  onSocket("overflowResolved", ({ id, takenIds, left }) => {
    const resolve = pending.get(id);
    if (!resolve) return;
    pending.delete(id);
    resolve({ takenIds, left });
  });
  onSocket("overflowCancel", ({ id }) => {
    if (!openDelegated.delete(id)) return;
    ui.notifications.warn(L("delegateCancelled"));
  });
}
