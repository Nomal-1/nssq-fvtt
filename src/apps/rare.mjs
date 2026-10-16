/**
 * 희소종 만들기·해제(GM). 토큰 시트에서 하면 그 토큰만, 액터 시트에서 하면 그 액터.
 * 원래 값을 flags.nssq.rareOriginal에 남겨 해제할 때 되돌린다.
 */
import { RARE_BOOST, rareTransform } from "../engine/rare.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Rare.${k}`, d) : game.i18n.localize(`NSSQ.Rare.${k}`));

export async function makeRare(actor) {
  if (!game.user.isGM || actor.type !== "enemy" || actor.system.isRare) return;
  const opts = await Dialog.prompt({
    title: `${actor.name} — ${L("on")}`,
    content: `<form>
      <div class="form-group"><label>${L("hpMultiplier")}</label><select name="m"><option value="2">×2</option><option value="3">×3</option></select></div>
      <fieldset><legend>${L("boost")}</legend>
        ${Object.entries(RARE_BOOST).map(([k, v]) => `<label class="rare-boost"><input type="checkbox" name="boost" value="${k}"/> ${game.i18n.localize(`NSSQ.Sub.${k}`)} +${v} <span class="notes">(${actor.system.stats[k]} → ${actor.system.stats[k] + v})</span></label>`).join("")}
      </fieldset>
      <p class="notes">${L("rule")}</p>
      <p class="notes">${L("gmOnly")}</p>
    </form>`,
    label: L("on"),
    rejectClose: false,
    callback: (html) => ({
      multiplier: Number(html[0].querySelector("[name=m]").value),
      boost: [...html[0].querySelectorAll("[name=boost]:checked")].map((i) => i.value)
    })
  });
  if (!opts) return;
  const s = actor.system;
  const original = { hp: { ...s.hp }, stats: { ...s.stats }, resist: { ...s.resist } };
  const r = rareTransform(s, opts);
  // 이미 받은 대미지는 남긴다(난입으로 넣은 뒤 바꾸거나 전투 중에 바꿔도)
  const hp = { max: r.hp.max, value: Math.max(0, r.hp.max - Math.max(0, (s.hp?.max ?? 0) - (s.hp?.value ?? 0))) };
  await actor.update({
    "system.isRare": true,
    "system.hp": hp, "system.stats": r.stats, "system.resist": r.resist,
    "flags.nssq.rareOriginal": original
  });
}

export async function removeRare(actor) {
  if (!game.user.isGM || actor.type !== "enemy" || !actor.system.isRare) return;
  const o = actor.getFlag("nssq", "rareOriginal");
  const update = { "system.isRare": false, "flags.nssq.-=rareOriginal": null };
  // 받은 대미지는 남긴다(희소종으로 바꾼 뒤 깎인 만큼)
  const s = actor.system;
  const lost = Math.max(0, (s.hp?.max ?? 0) - (s.hp?.value ?? 0));
  if (o) Object.assign(update, { "system.hp": { max: o.hp.max, value: Math.max(0, o.hp.max - lost) }, "system.stats": o.stats, "system.resist": o.resist });
  await actor.update(update);
}
