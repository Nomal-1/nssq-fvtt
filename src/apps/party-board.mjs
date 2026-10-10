/**
 * 파티 편성판(사용자 결정, 07 #167)
 * - 전위 3칸·후위 3칸 + 대기석. 원문대로 한 열 3명까지(강제), 정원은 설정 partySize(기본 5, GM이 6까지)
 * - 바꾼 편성을 [제출]하면 이동 투표와 같은 설정(fieldMapMove: 모두/GM만/자유)으로 승인 → 멤버(대기 플래그)와 열·순서를 한꺼번에 적용
 * - 전투 중에는 못 바꾼다(전투 중 배치는 개막 행동). 미궁 진입·전투 시작 때 검사
 */
import { draftFromUnits, ROWS, sameDraft, validateFormation } from "../engine/party.mjs";
import { voteResult } from "../engine/fieldmap.mjs";
import { emit, onSocket } from "../socket.mjs";
import { isActiveGM } from "../combat/apply.mjs";
import { roster } from "./roster.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.PartyBoard.${k}`, d) : game.i18n.localize(`NSSQ.PartyBoard.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const rid = () => foundry.utils.randomID();

export const partySize = () => Math.min(6, Math.max(1, Number(game.settings.get("nssq", "partySize")) || 5));
const proposal = () => game.settings.get("nssq", "partyProposal") ?? {};
const inBattle = () => !!game.combat?.started;

/** 편성 후보: 플레이어가 가진 캐릭터 + 동료 NPC */
function candidates() {
  return game.actors.filter((a) => a.type === "character" && (a.system.npc || game.users.some((u) => !u.isGM && a.testUserPermission(u, "OWNER"))));
}
async function members() { return (await import("./gm-screen.mjs")).partyActors(); }
const unitsOf = (list) => list.map((a) => ({ id: a.id, row: a.system.row ?? "front", order: a.system.order ?? null }));

/** 지금 편성의 문제(미궁 진입·전투 시작 검사용) → 오류 코드 */
export async function partyErrors() {
  const list = await members();
  const errors = [];
  for (const r of ROWS) if (list.filter((a) => (a.system.row ?? "front") === r).length > 3) errors.push(`rowOver.${r}`);
  if (!list.length) errors.push("empty");
  if (list.length > partySize()) errors.push("overMax");
  return errors;
}

/** 미궁 진입 전 검사: 문제가 있으면 알리고 편성판을 연다 → 들어가도 되는가 */
export async function checkBeforeEntry() {
  const errors = await partyErrors();
  if (!errors.length) return true;
  ui.notifications.warn(L("entryBlocked", { list: errors.map((e) => L(`err.${e}`, { n: partySize() })).join(", ") }));
  PartyBoard.open();
  return false;
}

/* ---------------- 창 ---------------- */

let app = null;

export class PartyBoard extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "nssq-party-board", classes: ["nssq", "nq-window", "nssq-party-board"], title: game.i18n.localize("NSSQ.PartyBoard.title"), width: 560, height: "auto"
    });
  }

  static open() { app ??= new PartyBoard(); return app.render(true, { focus: true }); }
  static refresh() { if (app?.rendered) app.render(); }

  async _renderInner() {
    const p = proposal();
    const pending = !!p.id;
    // 명단(플레이어 캐릭터 + 동료 NPC)은 GM이 갱신하는 partyRoster: 권한 없는 액터도 보인다
    const all = await roster();
    const units = all.filter((e) => !e.benched).map((e) => ({ id: e.id, row: e.row, order: e.order }));
    if (!this.draft || this.base !== JSON.stringify(units)) {
      this.base = JSON.stringify(units);
      this.draft = draftFromUnits(units);
      this.sel = null;
    }
    const draft = pending ? p.draft : this.draft;
    const max = partySize();
    const errors = validateFormation(draft, max);
    const placed = new Set(ROWS.flatMap((r) => draft[r]).filter(Boolean));
    const cell = (row, i) => {
      const a = all.find((e) => e.id === draft[row][i]);
      const sel = !pending && this.sel?.row === row && this.sel?.i === i;
      return `<div class="pb-slot ${a ? "filled" : ""} ${sel ? "sel" : ""}" data-slot="${row}:${i}">${a ? `<img src="${esc(a.img)}"/><b>${esc(a.name)}</b><small>Lv${a.level}${a.npc ? " · NPC" : ""}${a.cls ? ` · ${esc(a.cls)}` : ""}</small>` : `<span class="empty">${esc(L("emptySlot"))}</span>`}</div>`;
    };
    const rows = ROWS.map((r) => `<div class="pb-row"><span class="pb-rowname">${esc(game.i18n.localize(`NSSQ.Row.${r}`))}</span>${[0, 1, 2].map((i) => cell(r, i)).join("")}</div>`).join("");
    const bench = all.filter((a) => !placed.has(a.id)).map((a) => `<div class="pb-bench ${!pending && this.sel?.id === a.id ? "sel" : ""}" data-bench="${a.id}"><img src="${esc(a.img)}"/> ${esc(a.name)}</div>`).join("");
    let foot;
    if (pending) {
      const key = game.user.isGM ? "gm" : game.user.id;
      const votes = (p.voters ?? []).map((u) => {
        const ans = p.answers?.[u];
        return `<li class="${ans === true ? "yes" : ans === false ? "no" : "wait"}"><i class="fas ${ans === true ? "fa-check" : ans === false ? "fa-times" : "fa-hourglass-half"}"></i> ${esc(u === "gm" ? "GM" : game.users.get(u)?.name ?? "?")}</li>`;
      }).join("");
      const mine = (p.voters ?? []).includes(key) && p.answers?.[key] === undefined;
      foot = `<div class="pb-vote"><p>${esc(L("proposed", { by: game.users.get(p.by)?.name ?? "?" }))}</p><ul>${votes}</ul>
        ${mine ? `<button type="button" data-pb="yes" class="go"><i class="fas fa-check"></i> ${esc(L("accept"))}</button><button type="button" data-pb="no"><i class="fas fa-times"></i> ${esc(L("decline"))}</button>` : ""}
        ${p.by === game.user.id || game.user.isGM ? `<button type="button" data-pb="cancel">${esc(L("cancel"))}</button>` : ""}</div>`;
    } else {
      const changed = !sameDraft(this.draft, draftFromUnits(units));
      foot = `<div class="pb-acts"><button type="button" data-pb="reset"><i class="fas fa-undo"></i> ${esc(L("reset"))}</button>
        <button type="button" data-pb="submit" class="go" ${errors.length || !changed || inBattle() ? "disabled" : ""}><i class="fas fa-paper-plane"></i> ${esc(L("submit"))}</button></div>
        ${inBattle() ? `<p class="warn">${esc(L("noBattle"))}</p>` : ""}`;
    }
    return $(`<div class="pb-wrap">
      <p class="notes">${esc(L("hint", { n: max }))}</p>
      <p class="pb-count ${placed.size > max ? "warn" : ""}">${esc(L("count", { n: placed.size, max }))}</p>
      ${rows}
      ${errors.length ? `<p class="warn">${esc(errors.map((e) => L(`err.${e}`, { n: max })).join(" · "))}</p>` : ""}
      ${pending ? "" : `<h4>${esc(L("bench"))}</h4><div class="pb-benches" data-bench-area>${bench || `<span class="notes">${esc(L("noBench"))}</span>`}</div>`}
      ${foot}</div>`);
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html[0];
    root.querySelectorAll("[data-slot]").forEach((el) => el.addEventListener("click", () => { const [row, i] = el.dataset.slot.split(":"); this.clickSlot(row, Number(i)); }));
    root.querySelectorAll("[data-bench]").forEach((el) => el.addEventListener("click", (ev) => { ev.stopPropagation(); this.sel = this.sel?.id === el.dataset.bench ? null : { id: el.dataset.bench }; this.render(); }));
    root.querySelector("[data-bench-area]")?.addEventListener("click", () => {
      // 칸을 고른 채 대기석을 누르면 대기석으로
      if (this.sel?.row) { this.draft[this.sel.row][this.sel.i] = null; this.sel = null; this.render(); }
    });
    root.querySelectorAll("[data-pb]").forEach((el) => el.addEventListener("click", () => this.onAct(el.dataset.pb)));
  }

  clickSlot(row, i) {
    if (proposal().id) return;
    const d = this.draft;
    if (!this.sel) { if (d[row][i]) this.sel = { row, i }; return this.render(); }
    if (this.sel.id) {
      // 대기석 → 칸(있던 사람은 대기석으로)
      d[row][i] = this.sel.id;
    } else if (this.sel.row !== row || this.sel.i !== i) {
      // 칸 ↔ 칸 맞바꾸기
      [d[row][i], d[this.sel.row][this.sel.i]] = [d[this.sel.row][this.sel.i], d[row][i]];
    }
    this.sel = null;
    return this.render();
  }

  async onAct(act) {
    switch (act) {
      case "reset": this.draft = null; this.sel = null; return this.render();
      case "submit": return submit(this.draft);
      case "yes": case "no": return vote(act === "yes");
      case "cancel": return vote(false, true);
    }
    return null;
  }
}

/* ---------------- 제안·투표(활성 GM이 기록) ---------------- */

function submit(draft) {
  if (inBattle()) return ui.notifications.warn(L("noBattle"));
  const errors = validateFormation(draft, partySize());
  if (errors.length) return ui.notifications.warn(errors.map((e) => L(`err.${e}`, { n: partySize() })).join(", "));
  const payload = { by: game.user.id, draft };
  if (isActiveGM()) return onPropose(payload);
  if (!game.users.activeGM) return ui.notifications.warn(L("noGM"));
  emit("partyPropose", payload);
  return ui.notifications.info(L("submitted"));
}

function vote(yes, cancel = false) {
  const p = proposal();
  if (!p.id) return null;
  const payload = { id: p.id, key: game.user.isGM ? "gm" : game.user.id, yes, cancel, userId: game.user.id };
  if (isActiveGM()) return onVote(payload);
  return emit("partyVote", payload);
}

async function onPropose({ by, draft }) {
  if (!isActiveGM() || inBattle() || proposal().id) return;
  if (validateFormation(draft, partySize()).length) return;
  const mode = game.settings.get("nssq", "fieldMapMove");
  if (mode === "free") return apply(draft, by);
  const ids = new Set([...ROWS.flatMap((r) => draft[r]).filter(Boolean), ...(await members()).map((a) => a.id)]);
  const owners = game.users.filter((u) => u.active && !u.isGM && [...ids].some((id) => game.actors.get(id)?.testUserPermission(u, "OWNER"))).map((u) => u.id);
  const byKey = game.users.get(by)?.isGM ? "gm" : by;
  const voters = mode === "gm" ? ["gm"] : [...new Set([...owners, byKey, "gm"])];
  const p = { id: rid(), by, draft, voters, answers: { [byKey]: true } };
  if (voteResult(p) === "accepted") return apply(draft, by);
  return game.settings.set("nssq", "partyProposal", p);
}

async function onVote({ id, key, yes, cancel, userId }) {
  if (!isActiveGM()) return;
  const p = foundry.utils.deepClone(proposal());
  if (!p.id || p.id !== id) return;
  if (cancel && (userId === p.by || game.users.get(userId)?.isGM)) {
    await game.settings.set("nssq", "partyProposal", {});
    return ChatMessage.create({ content: `<div class="nssq-party-card">${esc(L("cancelled"))}</div>` });
  }
  if (!p.voters.includes(key)) return;
  p.answers[key] = !!yes;
  const r = voteResult(p);
  if (r === "pending") return game.settings.set("nssq", "partyProposal", p);
  await game.settings.set("nssq", "partyProposal", {});
  if (r === "accepted") return apply(p.draft, p.by);
  return ChatMessage.create({ content: `<div class="nssq-party-card">${esc(L("rejected"))}</div>` });
}

/** 확정: 판에 오른 사람은 참가(열·순서), 판에 없는 후보는 대기 */
async function apply(draft, by) {
  const placed = new Map();
  for (const r of ROWS) draft[r].forEach((id, i) => { if (id) placed.set(id, { row: r, order: i }); });
  for (const a of candidates()) {
    const pos = placed.get(a.id);
    if (pos) {
      await a.update({ "system.row": pos.row, "system.order": pos.order });
      if (a.getFlag("nssq", "benched")) await a.unsetFlag("nssq", "benched");
    } else if (!a.getFlag("nssq", "benched")) await a.setFlag("nssq", "benched", true);
  }
  const line = (r) => draft[r].filter(Boolean).map((id) => game.actors.get(id)?.name ?? "?").join(", ") || "-";
  return ChatMessage.create({ content: `<div class="nssq-party-card"><h3><i class="fas fa-users"></i> ${esc(L("applied"))}</h3><p>${esc(game.i18n.localize("NSSQ.Row.front"))}: ${esc(line("front"))}<br>${esc(game.i18n.localize("NSSQ.Row.back"))}: ${esc(line("back"))}</p><p class="notes">${esc(L("by", { name: game.users.get(by)?.name ?? "?" }))}</p></div>` });
}

/* ---------------- 전투 시작 안전장치 ---------------- */

/** 한 열이 3명을 넘으면 넘치는 사람을 다른 열로 옮기고 GM에게 알린다 */
export async function balanceBeforeBattle(actors) {
  const { balanceRows } = await import("../engine/party.mjs");
  const before = unitsOf(actors);
  const moves = balanceRows(before);
  const moved = moves.filter((m) => before.find((u) => u.id === m.id)?.row !== m.row);
  for (const m of moves) await game.actors.get(m.id)?.update({ "system.row": m.row, "system.order": m.order });
  if (moved.length) ui.notifications.warn(L("balanced", { names: moved.map((m) => game.actors.get(m.id)?.name).join(", ") }));
}

export function registerPartyBoard() {
  game.settings.register("nssq", "partySize", {
    name: "NSSQ.PartyBoard.settingSize", hint: "NSSQ.PartyBoard.settingSizeHint", scope: "world", config: true, type: Number, default: 5,
    choices: { 5: "5", 6: "6" }, onChange: () => PartyBoard.refresh()
  });
  game.settings.register("nssq", "partyProposal", {
    scope: "world", config: false, type: Object, default: {},
    // 투표할 사람에게는 편성판을 연다
    onChange: (p) => {
      const key = game.user.isGM ? "gm" : game.user.id;
      if (p?.id && (p.voters ?? []).includes(key) && p.answers?.[key] === undefined) PartyBoard.open();
      else PartyBoard.refresh();
    }
  });
  onSocket("partyPropose", (p) => onPropose(p));
  onSocket("partyVote", (p) => onVote(p));
  Hooks.on("nssqRoster", () => PartyBoard.refresh());
  for (const h of ["updateActor", "createActor", "deleteActor"]) Hooks.on(h, () => { if (game.user.isGM) PartyBoard.refresh(); });
}
