/**
 * 드롭 판정·갈무리 풀(단계 9-A)
 * 전투 승리 → 쓰러뜨린 에너미마다 2D6(engine/loot.mjs) → 「갈무리」 채팅 카드
 * - 조작 스킬(《스캐빈저》 등)이 있으면 에너미마다 [−][+]로 달성값을 고치고 [확정]
 * - 확정하면 드롭 아이템이 풀에 들어간다(같은 이름·랭크는 합침). 《사냥꾼의 후각》은 보유자가 고기·생선·알 중 고른다
 * - [가져가기]: 캐릭터를 고르면 활성 GM이 acquireItems(…, { source: "loot" })로 넣는다(넘치면 소유자에게 정리 창). 두고 간 것은 풀에 남는다
 * - [갈무리 종료](GM): 남은 것은 버린 것으로 본다
 * 카드 상태는 메시지 플래그 nssq.loot, 바꾸는 것은 활성 GM만(소켓 "loot")
 */
import { judgeDrop, partyDropSkills } from "../engine/loot.mjs";
import { acquireItems } from "./acquire.mjs";
import { recordBestiary } from "../combat/bestiary.mjs";
import { isActiveGM } from "../combat/apply.mjs";
import { emit, onSocket } from "../socket.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Loot.${k}`, d) : game.i18n.localize(`NSSQ.Loot.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const label = (e) => `${e.name}${e.rank ? ` R${e.rank}` : ""}`;

/** 활성 GM: 전투가 승리로 끝날 때(전투를 지우기 전에) */
export async function startLoot(combat) {
  if (!isActiveGM() || !combat) return null;
  const foes = combat.combatants.filter((c) => c.actor?.type === "enemy" && (c.defeated || (c.actor.system.hp?.value ?? 0) <= 0));
  const party = combat.combatants.filter((c) => c.actor?.type === "character").map((c) => c.actor);
  const uniq = [...new Map(party.map((a) => [a.uuid, a])).values()];
  const skills = partyDropSkills(uniq.map((a) => ({
    uuid: a.uuid, name: a.name,
    skills: a.items.filter((i) => i.type === "skill").map((i) => ({ name: i.name, sl: i.system.sl ?? 0, effects: i.system.effects ?? [] }))
  })));
  const rolls = [];
  const rows = [];
  for (const c of foes) {
    const roll = await new Roll("2d6").evaluate();
    rolls.push(roll);
    rows.push({ name: c.name, img: c.actor.img, uuid: c.actor.uuid, drops: foundry.utils.deepClone(c.actor.system.drops ?? []), dice: roll.dice[0].results.map((x) => x.result), adjust: 0 });
  }
  const card = {
    state: "adjust", range: skills.range, rangeBy: skills.rangeBy, doubleUp: skills.doubleUp,
    adjusters: uniq.filter((a) => skills.rangeBy.some((x) => x.startsWith(a.name))).map((a) => a.uuid),
    rows, extras: skills.extras.map((x) => ({ ...x, choice: null })),
    party: uniq.map((a) => ({ uuid: a.uuid, name: a.name })), pool: [], log: []
  };
  if (!rows.length) card.state = "open";
  else if (!card.range) await finalize(card);
  return ChatMessage.create({
    speaker: { alias: L("title") }, content: render(card), rolls, sound: rolls.length ? CONFIG.sounds.dice : undefined,
    flags: { nssq: { loot: card } }
  });
}

/* ---------------- 계산 ---------------- */

let itemIndex = null;
async function itemData(name, rank) {
  itemIndex ??= (await game.packs.get("nssq.items")?.getDocuments()) ?? [];
  const doc = itemIndex.find((i) => i.name === name && i.type === "material") ?? itemIndex.find((i) => i.name === name);
  if (!doc) return null;
  const o = doc.toObject();
  delete o._id;
  if (o.type === "material" && rank) o.system.rank = rank;
  return o;
}

async function addToPool(card, name, rank, qty, from) {
  const key = `${name}|${rank ?? ""}`;
  const cur = card.pool.find((p) => p.key === key);
  if (cur) { cur.qty += qty; cur.from = [...new Set([...cur.from, from])]; return; }
  card.pool.push({ id: foundry.utils.randomID(), key, name, rank: rank ?? null, qty, from: [from], data: await itemData(name, rank) });
}

/** 조작을 확정: 에너미마다 드롭 → 풀, 도감 기록 */
async function finalize(card) {
  for (const r of card.rows) {
    const j = judgeDrop({ drops: r.drops, dice: r.dice, adjust: r.adjust, doubleUp: card.doubleUp.length > 0 });
    Object.assign(r, { total: j.total, item: j.drop?.item ?? null, rank: j.rank, doubled: j.doubled });
    if (!j.drop) continue;
    await addToPool(card, j.drop.item, j.rank, 1, r.name);
    const a = await fromUuid(r.uuid);
    if (a) await recordBestiary(a, { drop: `${j.drop.rank ? `R${j.drop.rank} ` : ""}${j.drop.item}` });
  }
  card.state = "open";
}

/* ---------------- 그리기 ---------------- */

function render(card) {
  const head = `<header class="check-header"><span class="check-label"><i class="fas fa-box-open"></i> ${esc(L("title"))}</span></header>`;
  const adj = card.state === "adjust";
  const rows = card.rows.map((r, i) => {
    const dice = `${r.dice.join("+")}${r.adjust ? ` ${r.adjust > 0 ? "+" : "−"}${Math.abs(r.adjust)}` : ""} = <b>${r.dice[0] + r.dice[1] + r.adjust}</b>`;
    const res = adj ? "" : r.item ? `→ <b>${esc(label({ name: r.item, rank: r.rank }))}</b>${r.doubled && card.doubleUp.length ? ` <em>${esc(L("doubleUp"))}</em>` : ""}` : `→ ${esc(L("nothing"))}`;
    const btn = adj ? ` <button type="button" data-loot="adj" data-i="${i}" data-d="-1">−</button><button type="button" data-loot="adj" data-i="${i}" data-d="1">+</button>` : "";
    return `<li><img src="${esc(r.img)}" width="20" height="20"/> ${esc(r.name)}: ${dice} ${res}${btn}</li>`;
  }).join("");
  const adjNote = adj ? `<p class="notes">${esc(L("adjustHint", { n: card.range, by: card.rangeBy.join(", ") }))}</p><button type="button" data-loot="confirm"><i class="fas fa-check"></i> ${esc(L("confirm"))}</button>` : "";
  const extras = card.state === "adjust" ? "" : card.extras.map((x, j) => {
    const body = x.choice === "-" ? esc(L("extraSkipped")) : x.choice ? esc(L("extraTaken", { item: x.choice, n: x.count }))
      : x.choices.map((c) => `<button type="button" data-loot="extra" data-j="${j}" data-c="${esc(c)}">${esc(c)} ×${x.count}</button>`).join("")
        + `<button type="button" data-loot="extra" data-j="${j}" data-c="-">${esc(L("extraNo"))}</button>`;
    return `<li>${esc(L("extraLine", { name: x.name, skill: x.skill }))} ${body}</li>`;
  }).join("");
  const open = card.state === "open";
  const options = card.party.map((p) => `<option value="${esc(p.uuid)}">${esc(p.name)}</option>`).join("");
  const pool = card.state === "adjust" ? "" : card.pool.filter((p) => p.qty > 0).map((p) => `<li data-entry="${p.id}"><b>${esc(label(p))}</b> ×${p.qty}${p.data ? "" : ` <em>${esc(L("noData"))}</em>`}
    ${open && p.data ? `<select data-loot-who>${options}</select><button type="button" data-loot="take" data-e="${p.id}">${esc(L("take"))}</button>` : ""}</li>`).join("") || `<li>${esc(L(card.state === "closed" ? "closedEmpty" : "empty"))}</li>`;
  const log = card.log.length ? `<ul class="loot-log">${card.log.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : "";
  const close = open ? `<button type="button" data-loot="close" data-gm-only><i class="fas fa-times"></i> ${esc(L("close"))}</button>` : card.state === "closed" ? `<p class="notes">${esc(L("closed"))}</p>` : "";
  return `<div class="nssq-loot">${head}<ul class="loot-rows">${rows || `<li>${esc(L("noEnemies"))}</li>`}</ul>${adjNote}
    ${extras ? `<ul class="loot-extras">${extras}</ul>` : ""}
    ${card.state === "adjust" ? "" : `<h4>${esc(L("pool"))}</h4><ul class="loot-pool">${pool}</ul>`}${log}${close}</div>`;
}

/* ---------------- 조작(활성 GM) ---------------- */

let queue = Promise.resolve();
const enqueue = (fn) => (queue = queue.then(fn, fn));

async function save(message, card) {
  await message.update({ content: render(card), "flags.nssq.loot": card });
}

function handle({ messageId, action, i, d, j, c, e, who }) {
  return enqueue(async () => {
    const message = game.messages.get(messageId);
    const card = foundry.utils.deepClone(message?.getFlag("nssq", "loot"));
    if (!card) return;
    if (action === "adj" && card.state === "adjust") {
      const r = card.rows[i];
      if (!r) return;
      r.adjust = Math.max(-card.range, Math.min(card.range, r.adjust + Number(d)));
      return save(message, card);
    }
    if (action === "confirm" && card.state === "adjust") { await finalize(card); return save(message, card); }
    if (action === "extra" && card.state === "open") {
      const x = card.extras[j];
      if (!x || x.choice) return;
      x.choice = c;
      if (c !== "-") await addToPool(card, c, null, x.count, `${x.name}《${x.skill}》`);
      return save(message, card);
    }
    if (action === "take" && card.state === "open") {
      const p = card.pool.find((y) => y.id === e);
      const actor = who ? await fromUuid(who) : null;
      if (!p?.data || !p.qty || !actor) return;
      const data = foundry.utils.deepClone(p.data);
      data.system.quantity = p.qty;
      const r = await acquireItems(actor, [data], { source: "loot", reason: L("reason") });
      const left = r.left.reduce((n, x) => n + (x.system?.quantity ?? 1), 0);
      const got = p.qty - left;
      // 다른 사람이 그 사이 고친 카드를 덮어쓰지 않게 다시 읽는다
      const fresh = foundry.utils.deepClone(game.messages.get(messageId)?.getFlag("nssq", "loot"));
      const q = fresh?.pool.find((y) => y.id === e);
      if (!q) return;
      q.qty = Math.max(0, q.qty - got);
      if (got) fresh.log.push(L("took", { name: actor.name, item: label(q), n: got }));
      return save(message, fresh);
    }
    if (action === "close" && card.state === "open") { card.state = "closed"; return save(message, card); }
  });
}

const send = (payload) => (isActiveGM() ? handle(payload) : emit("loot", payload));

/** 버튼 권한: 조작은 GM·조작 스킬 보유자 소유자, 《사냥꾼의 후각》은 GM·보유자 소유자, 가져가기는 GM·그 캐릭터 소유자 */
function decorate(message, html) {
  const card = message.getFlag("nssq", "loot");
  if (!card) return;
  const el = html[0];
  const owns = (uuid) => !!fromUuidSync(uuid)?.isOwner;
  el.querySelectorAll("[data-loot]").forEach((b) => {
    const a = b.dataset.loot;
    const ok = game.user.isGM || (a === "adj" || a === "confirm" ? card.adjusters.some(owns) : a === "extra" ? owns(card.extras[Number(b.dataset.j)]?.uuid) : a === "take");
    if (!ok || (b.hasAttribute("data-gm-only") && !game.user.isGM)) return b.remove();
    b.addEventListener("click", () => {
      const payload = { messageId: message.id, action: a, i: Number(b.dataset.i), d: Number(b.dataset.d), j: Number(b.dataset.j), c: b.dataset.c, e: b.dataset.e };
      if (a === "take") {
        payload.who = b.closest("li")?.querySelector("[data-loot-who]")?.value;
        if (!game.user.isGM && !owns(payload.who)) return ui.notifications.warn(L("notYours"));
      }
      send(payload);
    });
  });
  // 플레이어: 고를 수 있는 캐릭터는 자기 것만(처음 것을 고른 상태로)
  if (!game.user.isGM) {
    el.querySelectorAll("[data-loot-who]").forEach((s) => {
      [...s.options].forEach((o) => { if (!owns(o.value)) o.remove(); });
      if (!s.options.length) s.closest("li")?.querySelector("[data-loot=take]")?.remove();
      if (!s.options.length) s.remove();
    });
  }
}

export function registerLoot() {
  onSocket("loot", (p) => { if (isActiveGM()) handle(p); });
  Hooks.on("renderChatMessage", (message, html) => decorate(message, html));
}
