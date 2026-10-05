/**
 * 능력치 굴리기: 3D6×5를 채팅에 공개하고, 배정 창에서 순서대로·랜덤·직접 배치한다.
 * 계산은 engine/chargen.mjs.
 */
import { ABILITIES, deriveCharacter } from "../engine/derive.mjs";
import {
  applyAssignment, initialMoney, isValidAssignment, orderedAssignment, randomAssignment
} from "../engine/chargen.mjs";

const TEMPLATE = "systems/nssq/templates/chat/ability-roll.hbs";
const L = (k, d) => (d ? game.i18n.format(`NSSQ.AbilityRoll.${k}`, d) : game.i18n.localize(`NSSQ.AbilityRoll.${k}`));

/** 3D6을 5번 굴려 채팅에 올리고 배정 창을 연다 */
export async function rollAbilities(actor) {
  const rolls = [];
  for (let i = 0; i < 5; i++) rolls.push(await new Roll("3d6").evaluate());
  const results = rolls.map((r) => ({ dice: r.dice[0].results.map((x) => x.result), total: r.total }));
  const totals = results.map((r) => r.total);
  const content = await renderTemplate(TEMPLATE, {
    results: results.map((r, i) => ({ ...r, n: i + 1 })),
    sum: totals.reduce((a, b) => a + b, 0),
    money: initialMoney(totals)
  });
  const message = await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    rolls,
    sound: CONFIG.sounds.dice,
    flags: { nssq: { abilityRoll: { actorUuid: actor.uuid, totals } } }
  });
  // 주사위 연출이 끝난 뒤 배정 창
  if (game.dice3d) await game.dice3d.waitFor3DAnimationByMessageID?.(message.id);
  return assignDialog(actor, totals);
}

/** 배정 창 */
export async function assignDialog(actor, totals) {
  const hasValues = ABILITIES.some((k) => (actor.system.abilities?.[k] ?? 0) > 0);
  const slotOptions = (selected) => totals
    .map((t, i) => `<option value="${i}" ${i === selected ? "selected" : ""}>${L("slot", { n: i + 1, total: t })}</option>`).join("");
  const initial = orderedAssignment();
  const rows = ABILITIES.map((k, i) => `
    <div class="form-group assign-row">
      <label>${game.i18n.localize(`NSSQ.Ability.${k}`)}</label>
      <select name="${k}">${slotOptions(initial[i])}</select>
      <span class="assign-bonus"></span>
    </div>`).join("");
  const content = `
    <form class="nssq-assign">
      <p class="assign-values">${totals.map((t, i) => `<span>${i + 1}. <b>${t}</b></span>`).join("")}</p>
      <div class="assign-tools">
        <button type="button" data-assign="ordered"><i class="fas fa-list-ol"></i> ${L("ordered")}</button>
        <button type="button" data-assign="random"><i class="fas fa-random"></i> ${L("random")}</button>
      </div>
      ${rows}
      <p class="assign-error" hidden>${L("duplicate")}</p>
      <div class="form-group"><label><input type="checkbox" name="setMoney" checked/> ${L("setMoney", { money: initialMoney(totals) })}</label></div>
      ${hasValues ? `<p class="notes warn">${L("overwrite")}</p>` : ""}
      <p class="notes">${L("classNote")}</p>
    </form>`;

  return new Promise((resolve) => {
    const dialog = new Dialog({
      title: `${actor.name} — ${L("title")}`,
      content,
      buttons: {
        apply: { icon: '<i class="fas fa-check"></i>', label: L("apply"), callback: (html) => resolve(apply(actor, totals, html[0])) },
        cancel: { icon: '<i class="fas fa-times"></i>', label: game.i18n.localize("Cancel"), callback: () => resolve(null) }
      },
      default: "apply",
      close: () => resolve(null),
      render: (html) => {
        const form = html[0].querySelector("form") ?? html[0].closest(".app")?.querySelector("form");
        const app = form.closest(".app");
        const selects = ABILITIES.map((k) => form.querySelector(`[name=${k}]`));
        const refresh = () => {
          const slots = selects.map((s) => Number(s.value));
          const valid = isValidAssignment(slots);
          const counts = slots.reduce((m, s) => m.set(s, (m.get(s) ?? 0) + 1), new Map());
          selects.forEach((s, i) => {
            s.classList.toggle("dup", counts.get(slots[i]) > 1);
            s.closest(".assign-row").querySelector(".assign-bonus").textContent = `B ${Math.floor(totals[slots[i]] / 5)}`;
          });
          form.querySelector(".assign-error").hidden = valid;
          const btn = app?.querySelector(".dialog-button.apply");
          if (btn) btn.disabled = !valid;
        };
        const set = (slots) => { selects.forEach((s, i) => { s.value = String(slots[i]); }); refresh(); };
        form.querySelector("[data-assign=ordered]").addEventListener("click", () => set(orderedAssignment()));
        form.querySelector("[data-assign=random]").addEventListener("click", () => set(randomAssignment(Math.random)));
        selects.forEach((s) => s.addEventListener("change", refresh));
        refresh();
      }
    }, { classes: ["nssq", "dialog"], width: 380 });
    dialog.render(true);
  });
}

async function apply(actor, totals, root) {
  const form = root.querySelector("form") ?? root.closest(".app")?.querySelector("form");
  const slots = ABILITIES.map((k) => Number(form.querySelector(`[name=${k}]`).value));
  if (!isValidAssignment(slots)) {
    ui.notifications.error(L("duplicate"));
    return null;
  }
  const abilities = applyAssignment(totals, slots);
  const d = deriveCharacter({ abilities, level: actor.system.level });
  const update = {
    "system.abilities": abilities,
    "system.abilityRolls": totals,
    "system.hp.value": d.hpMax,
    "system.tp.value": d.tpMax
  };
  if (form.querySelector("[name=setMoney]").checked) update["system.money"] = initialMoney(totals);
  await actor.update(update);
  ui.notifications.info(L("applied", { name: actor.name }));
  return abilities;
}

/** 채팅 카드의 [배정하기] 버튼: 창을 닫았어도 다시 열 수 있다 */
export function registerAbilityRollHooks() {
  Hooks.on("renderChatMessage", (message, html) => {
    const data = message.getFlag("nssq", "abilityRoll");
    if (!data) return;
    const btn = html[0].querySelector("[data-nssq-action=assign]");
    if (!btn) return;
    if (!(message.isAuthor || game.user.isGM)) return btn.remove();
    btn.addEventListener("click", async () => {
      const actor = await fromUuid(data.actorUuid);
      if (actor?.isOwner) assignDialog(actor, data.totals);
    });
  });
}
