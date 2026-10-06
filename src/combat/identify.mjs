/**
 * 식별 판정(01 §3.1): 플레이어가 굴린 【TEC】 판정 중 가장 높은 달성값을 GM이 넣으면,
 * 전투에 나온 에너미마다 【희소도】와 비교해 식별·희소종 간파를 정한다(engine identifyResult).
 * 식별 실패한 에너미는 내성을 최소 3으로 취급한다(profile.mjs). 눈 아이콘으로 하나씩 바꾸는 것도 그대로 된다.
 */
import { identifyResult } from "../engine/combat.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Identify.${k}`, d) : game.i18n.localize(`NSSQ.Identify.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** 한 에너미(토큰 액터)에 달성값을 적용 → 결과 */
export async function identifyEnemy(actor, value) {
  const s = actor.system;
  const r = identifyResult(value, { rarity: s.rarity ?? 0, isRare: !!s.isRare });
  const u = {};
  if (!!s.identified !== r.identified) u["system.identified"] = r.identified;
  if (!!s.rareKnown !== r.rareRevealed) u["system.rareKnown"] = r.rareRevealed;
  if (Object.keys(u).length) await actor.update(u);
  return r;
}

/** 전투의 모든 에너미에 적용하고 결과 카드를 올린다 */
export async function applyIdentify(combat, value) {
  if (!game.user.isGM || !combat) return;
  await combat.setFlag("nssq", "battle.identifyValue", value);
  const rows = [];
  for (const c of combat.combatants.filter((x) => x.actor?.type === "enemy")) {
    const r = await identifyEnemy(c.actor, value);
    rows.push(`<li class="${r.identified ? "ok" : "ng"}"><i class="fas ${r.identified ? "fa-eye" : "fa-eye-slash"}"></i> ${esc(c.name)} — ${r.identified ? L("success") : L("failure")}${r.rareRevealed ? ` <b class="rare">★ ${L("rare")}</b>` : ""}</li>`);
  }
  await ChatMessage.create({
    speaker: { alias: game.i18n.localize("NSSQ.Combat.tracker") },
    content: `<div class="nssq-combat-note nssq-identify"><b><i class="fas fa-search"></i> ${L("result", { value })}</b><ul>${rows.join("")}</ul>
      <p class="notes">${L("failNote")}</p></div>`
  });
}

/** GM: 달성값 입력 창 */
export async function identifyDialog(combat) {
  if (!game.user.isGM || !combat) return;
  const prev = combat.getFlag("nssq", "battle")?.identifyValue ?? "";
  const value = await Dialog.prompt({
    title: L("title"),
    content: `<form><div class="form-group"><label>${L("value")}</label><input type="number" name="v" value="${prev}" autofocus/></div>
      <p class="notes">${L("hint")}</p></form>`,
    label: L("button"),
    rejectClose: false,
    callback: (html) => html[0].querySelector("[name=v]").value
  });
  if (value === null || value === undefined || value === "") return;
  return applyIdentify(combat, Number(value));
}
