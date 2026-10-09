/**
 * 전투 중 아무 때나 쓰는 『특수』 스킬(효과 `anytime`): 전투 화면 파티 카드의 ★ 버튼
 * - swapRow: 자신의 전위↔후위(동료 1명과 맞바꾸기 가능, 팔랑크스 《체인지 스텝》)
 * - retarget: 대기 상태(skillKey)의 대상 아군 바꾸기(《디바이드 체인지》 → 《디바이드 가드》)
 * 코스트는 사용자가 낸다. 남의 캐릭터를 움직이는 부분은 활성 GM에게 맡긴다(소켓 "special")
 */
import { changePosition } from "./formation.mjs";
import { friendly } from "./profile.mjs";
import { isActiveGM } from "./apply.mjs";
import { emit, onSocket } from "../socket.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Special.${k}`, d) : game.i18n.localize(`NSSQ.Special.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const alive = (c) => !!c?.actor && !c.defeated && (c.actor.system.hp?.value ?? 0) > 0;
const anytimeOf = (item) => (item.system.effects ?? []).find((e) => e?.type === "anytime");

/** 이 액터가 지금 쓸 수 있는 아무 때나 스킬 */
export function anytimeSkills(actor) {
  return actor.items.filter((i) => i.type === "skill" && i.system.timing === "특수" && (i.system.sl ?? 0) > 0 && anytimeOf(i));
}

const note = (actor, html) => ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<div class="nssq-combat-note"><i class="fas fa-star"></i> ${html}</div>` });

/** ★ 버튼: 고르기 → 코스트 → 실행 */
export async function useAnytime(combat, combatant, itemId) {
  const actor = combatant.actor;
  const item = actor?.items.get(itemId);
  const fx = item && anytimeOf(item);
  if (!fx || !combat?.started || !alive(combatant)) return;
  const cost = item.system.cost ?? {};
  if ((cost.tp ?? 0) > (actor.system.tp?.value ?? 0) || (cost.fp ?? 0) > (actor.system.fp?.value ?? 0)) return ui.notifications.warn(L("noCost"));
  const allies = combat.combatants.filter((c) => c !== combatant && alive(c) && friendly(c.actor, actor) && c.actor.type !== "token");
  let job = null;
  if (fx.action === "swapRow") {
    const opts = [`<option value="">${esc(L("selfOnly"))}</option>`, ...allies.map((c) => `<option value="${c.id}">${esc(L("swapWith", { name: c.name, row: game.i18n.localize(`NSSQ.Row.${c.actor.system.row ?? "front"}`) }))}</option>`)].join("");
    const pick = await Dialog.prompt({
      title: `${actor.name} — 《${item.name}》`, content: `<form><select name="who">${opts}</select></form>`, label: L("go"), rejectClose: false,
      callback: (html) => html[0].querySelector("[name=who]").value
    });
    if (pick === null || pick === undefined) return;
    if (!pick) {
      if (!(await changePosition(combatant))) return;
      job = { action: "noteSelf" };
    } else job = { action: "swap", a: combatant.id, b: pick };
  } else if (fx.action === "retarget") {
    const st = (combatant.getFlag("nssq", "stances") ?? []).find((s) => s.key === fx.skillKey);
    if (!st) return ui.notifications.warn(L("noStance"));
    const list = allies.filter((c) => !(st.guardTargets ?? []).includes(c.id));
    if (!list.length) return ui.notifications.warn(L("noAlly"));
    const pick = await Dialog.prompt({
      title: `${actor.name} — 《${item.name}》`, content: `<form><p>${esc(L("retargetHint", { skill: st.name }))}</p><select name="who">${list.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></form>`,
      label: L("go"), rejectClose: false, callback: (html) => html[0].querySelector("[name=who]").value
    });
    if (!pick) return;
    job = { action: "retarget", a: combatant.id, stanceId: st.id, to: pick };
  }
  if (!job) return;
  const upd = {};
  if (cost.tp) upd["system.tp.value"] = (actor.system.tp?.value ?? 0) - cost.tp;
  if (cost.fp) upd["system.fp.value"] = (actor.system.fp?.value ?? 0) - cost.fp;
  if (Object.keys(upd).length) await actor.update(upd);
  const payload = { combatId: combat.id, item: item.name, ...job };
  if (job.action === "noteSelf") return note(actor, esc(L("moved", { skill: item.name, name: combatant.name })));
  if (isActiveGM()) return runJob(payload);
  emit("special", payload);
}

async function runJob({ combatId, item, action, a, b, stanceId, to }) {
  const combat = game.combats.get(combatId);
  const ca = combat?.combatants.get(a);
  if (!ca) return;
  if (action === "swap") {
    const cb = combat.combatants.get(b);
    if (!cb) return;
    const sa = { row: ca.actor.system.row ?? "front", order: ca.actor.system.order ?? 0 };
    const sb = { row: cb.actor.system.row ?? "front", order: cb.actor.system.order ?? 0 };
    await ca.actor.update({ "system.row": sb.row, "system.order": sb.order });
    await cb.actor.update({ "system.row": sa.row, "system.order": sa.order });
    return note(ca.actor, esc(L("swapped", { skill: item, a: ca.name, b: cb.name })));
  }
  if (action === "retarget") {
    const list = (ca.getFlag("nssq", "stances") ?? []).map((s) => (s.id === stanceId ? { ...s, guardTargets: [to] } : s));
    await ca.setFlag("nssq", "stances", list);
    return note(ca.actor, esc(L("retargeted", { skill: item, name: ca.name, to: combat.combatants.get(to)?.name ?? "" })));
  }
}

export function registerSpecial() {
  onSocket("special", (p) => { if (isActiveGM()) runJob(p); });
}
