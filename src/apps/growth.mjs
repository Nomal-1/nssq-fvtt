/**
 * 능력치 성장: 누적 경험점이 10의 배수에 도달할 때마다 1D6(1 STR, 2 TEC, 3 VIT, 4 AGI, 5 LUC, 6 선택) +1.
 * 플레이어는 굴릴 수 있는 횟수가 남았을 때만 [성장 굴리기]로 올린다. GM은 능력치 편집 창에서 「성장」을 직접 고친다.
 */
import { ABILITIES, growthAbility, growthAvailable } from "../engine/derive.mjs";
import { logCreation } from "../sheets/character.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Growth.${k}`, d) : game.i18n.localize(`NSSQ.Growth.${k}`));
const abilityName = (k) => game.i18n.localize(`NSSQ.Ability.${k}`);

/** 6이 나왔을 때 올릴 능력치 고르기 */
async function chooseAbility(actor) {
  const buttons = Object.fromEntries(ABILITIES.map((k) => [k, { label: abilityName(k), callback: () => k }]));
  return Dialog.wait({
    title: `${actor.name} — ${L("choose")}`,
    content: `<p class="nssq-growth-choose">${L("chooseHint")}</p>`,
    buttons,
    close: () => null
  }, { classes: ["nssq", "dialog"] });
}

export async function rollGrowth(actor) {
  const g = growthAvailable({ exp: actor.system.exp, abilities: actor.system.abilities });
  if (g.left <= 0 && !game.user.isGM) return ui.notifications.warn(L("none"));
  const roll = await new Roll("1d6").evaluate();
  const die = roll.total;
  let key = growthAbility(die);
  const message = await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    rolls: [roll],
    sound: CONFIG.sounds.dice,
    content: `<div class="nssq-growth"><div class="check-label">${L("title")}</div>
      <div class="growth-die">${die}</div>
      <p>${key ? L("result", { ability: abilityName(key) }) : L("resultChoose")}</p></div>`
  });
  if (game.dice3d) await game.dice3d.waitFor3DAnimationByMessageID?.(message.id);
  key ??= await chooseAbility(actor);
  if (!key) return;
  const from = actor.system.abilities[key].growth ?? 0;
  await actor.update({ [`system.abilities.${key}.growth`]: from + 1 });
  await logCreation(actor, { type: "growth", ability: key, die });
  if (!growthAbility(die)) await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<div class="nssq-growth"><p>${L("result", { ability: abilityName(key) })}</p></div>` });
}
