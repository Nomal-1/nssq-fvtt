/**
 * 세션 결과(단계 9-F, 세션 결과와 성장): 경험점(engine/explore.mjs sessionExp)·보수를 더하고 결과 카드.
 * 레벨은 누적 경험점으로 자동(01 §8), 능력치 성장은 시트의 [성장 굴리기](10의 배수마다)
 */
import { sessionExp } from "../engine/explore.mjs";
import { growthAvailable } from "../engine/derive.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Session.${k}`, d) : game.i18n.localize(`NSSQ.Session.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** 세션 시작 【FP】 보너스(효과 sessionFp: 《핫 스타트》 +1, 《대자연의 은혜》 +2) */
export function sessionFpBonus(actor) {
  return actor.items.filter((i) => i.type === "skill" && (i.system.sl ?? 0) > 0)
    .flatMap((i) => (i.system.effects ?? []).filter((e) => e?.type === "sessionFp").map((e) => ({ name: i.name, value: Number(e.value) || 0 })));
}

export async function openSessionEnd() {
  if (!game.user.isGM) return;
  const party = (await import("./gm-screen.mjs")).partyActors();
  const dl = (await import("./dungeon.mjs")).dungeonState()?.level ?? 1;
  const rows = party.map((a) => `<tr data-id="${a.id}"><td><input type="checkbox" name="p" checked/></td><td>${esc(a.name)} <small>Lv${a.system.level}</small></td>
    <td><input type="number" name="bonus" value="0" min="0" max="3" style="width:4em"/></td><td><input type="number" name="money" value="0" min="0" style="width:6em"/></td></tr>`).join("");
  const got = await Dialog.prompt({
    title: L("endTitle"),
    content: `<form class="nssq-session-end">
      <div class="form-group"><label><input type="checkbox" name="goal"/> ${esc(L("goal"))}</label></div>
      <div class="form-group"><label>${esc(L("dungeonLevel"))}</label><input type="number" name="dl" min="0" value="${dl}"/></div>
      <table><thead><tr><th>${esc(L("participated"))}</th><th></th><th>${esc(L("bonus"))}</th><th>${esc(L("money"))}</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="notes">${esc(L("endHint"))}</p></form>`,
    label: L("endGo"), rejectClose: false,
    callback: (html) => {
      const f = html[0].querySelector("form");
      return { goal: f.goal.checked, dl: Number(f.dl.value) || 0,
        members: [...f.querySelectorAll("tbody tr")].map((tr) => ({ id: tr.dataset.id, participated: tr.querySelector("[name=p]").checked, bonus: Number(tr.querySelector("[name=bonus]").value) || 0, money: Number(tr.querySelector("[name=money]").value) || 0 })) };
    }
  }, { classes: ["nssq", "dialog"], width: 480 });
  if (!got) return;
  return sessionEnd(got);
}

export async function sessionEnd({ goal, dl, members }) {
  const lines = [];
  for (const m of members) {
    const a = game.actors.get(m.id);
    if (!a) continue;
    const lv0 = a.system.level;
    const r = sessionExp({ participated: m.participated, goal, dungeonLevel: dl, level: lv0, bonus: m.bonus });
    await a.update({ "system.exp": (a.system.exp ?? 0) + r.total, "system.money": (a.system.money ?? 0) + Math.max(0, m.money) });
    const fresh = game.actors.get(m.id);
    const g = growthAvailable({ exp: fresh.system.exp, abilities: fresh.system.abilities });
    lines.push(`<li><b>${esc(a.name)}</b>: ${esc(L("expLine", { n: r.total, p: r.parts.participated, g: r.parts.goal, gap: r.parts.gap, b: r.parts.bonus, total: fresh.system.exp }))}`
      + (m.money ? ` · ${esc(L("moneyLine", { n: m.money }))}` : "")
      + (fresh.system.level !== lv0 ? ` · <b>${esc(L("levelUp", { from: lv0, to: fresh.system.level }))}</b>` : "")
      + (g.left > 0 ? ` · ${esc(L("growthLeft", { n: g.left }))}` : "") + `</li>`);
  }
  return ChatMessage.create({ speaker: { alias: L("endTitle") }, content: `<div class="nssq-session-end"><h3><i class="fas fa-trophy"></i> ${esc(L("endTitle"))}</h3><ul>${lines.join("")}</ul></div>` });
}

/* ---------------- 생활비(쇼핑과 생활: 레벨 × 10G, GM이 요구할 때) ---------------- */

export async function openLivingCost() {
  if (!game.user.isGM) return;
  const party = (await import("./gm-screen.mjs")).partyActors();
  const rows = party.map((a) => `<tr data-id="${a.id}"><td><input type="checkbox" name="p" checked/></td><td>${esc(a.name)} <small>Lv${a.system.level}</small></td>
    <td><input type="number" name="cost" value="${livingCost(a.system.level)}" min="0" style="width:6em"/>G</td><td>${a.system.money ?? 0}G</td></tr>`).join("");
  const got = await Dialog.prompt({
    title: L("livingTitle"),
    content: `<form class="nssq-session-end"><table><thead><tr><th></th><th></th><th>${esc(L("livingCost"))}</th><th>${esc(L("livingHave"))}</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="notes">${esc(L("livingHint"))}</p></form>`,
    label: L("livingGo"), rejectClose: false,
    callback: (html) => [...html[0].querySelectorAll("tbody tr")].filter((tr) => tr.querySelector("[name=p]").checked)
      .map((tr) => ({ id: tr.dataset.id, cost: Math.max(0, Number(tr.querySelector("[name=cost]").value) || 0) }))
  }, { classes: ["nssq", "dialog"], width: 460 });
  if (!got?.length) return;
  return payLiving(got);
}

/** 생활비 = 레벨 × 10G */
export const livingCost = (level) => Math.max(1, Number(level) || 1) * 10;

/** [{ id, cost }] → 소지금에서 뺀다(모자라면 0까지 내고 부족분을 카드에 적는다) */
export async function payLiving(list) {
  const lines = [];
  for (const { id, cost } of list) {
    const a = game.actors.get(id);
    if (!a) continue;
    const have = a.system.money ?? 0;
    const paid = Math.min(have, cost);
    await a.update({ "system.money": have - paid });
    lines.push(`<li>${esc(a.name)}: −${paid}G → ${have - paid}G${paid < cost ? ` <b class="warn">${esc(L("livingShort", { n: cost - paid }))}</b>` : ""}</li>`);
  }
  return ChatMessage.create({ speaker: { alias: L("livingTitle") }, content: `<div class="nssq-session-card"><h3><i class="fas fa-home"></i> ${esc(L("livingTitle"))}</h3><ul>${lines.join("")}</ul></div>` });
}
