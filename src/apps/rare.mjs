/**
 * 희소종 만들기·해제(GM). 토큰 시트에서 하면 그 토큰만, 액터 시트에서 하면 그 액터.
 * 원래 값을 flags.nssq.rareOriginal에 남겨 해제할 때 되돌린다.
 */
import { rareTransform } from "../engine/rare.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Rare.${k}`, d) : game.i18n.localize(`NSSQ.Rare.${k}`));

export async function makeRare(actor) {
  if (!game.user.isGM || actor.type !== "enemy" || actor.system.isRare) return;
  const opts = await Dialog.prompt({
    title: `${actor.name} — ${L("on")}`,
    content: `<form>
      <div class="form-group"><label>${L("hpMultiplier")}</label><select name="m"><option value="2">×2</option><option value="3">×3</option></select></div>
      <div class="form-group"><label><input type="checkbox" name="boost"/> ${L("boost")}</label></div>
      <p class="notes">${L("rule")}</p>
      <p class="notes">${L("gmOnly")}</p>
    </form>`,
    label: L("on"),
    rejectClose: false,
    callback: (html) => ({ multiplier: Number(html[0].querySelector("[name=m]").value), boost: html[0].querySelector("[name=boost]").checked })
  });
  if (!opts) return;
  const s = actor.system;
  const original = { hp: { ...s.hp }, stats: { ...s.stats }, resist: { ...s.resist } };
  const r = rareTransform(s, opts);
  await actor.update({
    "system.isRare": true,
    "system.hp": r.hp, "system.stats": r.stats, "system.resist": r.resist,
    "flags.nssq.rareOriginal": original
  });
}

export async function removeRare(actor) {
  if (!game.user.isGM || actor.type !== "enemy" || !actor.system.isRare) return;
  const o = actor.getFlag("nssq", "rareOriginal");
  const update = { "system.isRare": false, "flags.nssq.-=rareOriginal": null };
  if (o) Object.assign(update, { "system.hp": o.hp, "system.stats": o.stats, "system.resist": o.resist });
  await actor.update(update);
}
