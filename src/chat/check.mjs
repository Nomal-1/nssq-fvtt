/**
 * 일반 행위 판정·대항 판정의 Foundry 연결부: 대화창, 채팅 카드, 【FP】 버튼.
 * 계산은 전부 engine/check.mjs가 한다.
 */
import { ABILITIES } from "../engine/derive.mjs";
import { contestWinner, evaluateCheck } from "../engine/check.mjs";

const TEMPLATE = "systems/nssq/templates/chat/check-card.hbs";
const REROLL_COST = 1; // OPEN-QUESTION #18

/** n개의 D6을 Foundry Roll로 굴린다(Dice So Nice 등이 보이도록) */
async function rollD6(n) {
  if (n <= 0) return { roll: null, dice: [] };
  const roll = await new Roll(`${n}d6`).evaluate();
  return { roll, dice: roll.dice[0].results.map((r) => r.result) };
}

async function show3d(roll) {
  if (roll && game.dice3d) await game.dice3d.showForRoll(roll, game.user, true);
}

function abilityLabel(ability) {
  return ability ? game.i18n.localize(`NSSQ.Ability.${ability}`) : game.i18n.localize("NSSQ.Check.custom");
}

/** 판정 전 대화창. 취소하면 null */
export async function promptCheck(actor, { ability = null, contestOf = null } = {}) {
  const fp = actor.system.fp?.value ?? 0;
  const active = contestOf ? game.messages.get(contestOf) : null;
  const contestNote = active && stateOf(active)
    ? `<p class="notes">${game.i18n.format("NSSQ.Check.contestTargetNote", { name: active.speaker.alias, total: resultOf(active).total })}</p>`
    : "";
  const abilityOptions = ABILITIES.map(
    (k) => `<option value="${k}" ${k === ability ? "selected" : ""}>${abilityLabel(k)} (B ${actor.system.bonus?.[k] ?? 0})</option>`
  ).join("");
  const content = `
    <form class="nssq-check-dialog">
      <div class="form-group"><label>${game.i18n.localize("NSSQ.Check.ability")}</label>
        <select name="ability">${abilityOptions}<option value="" ${ability ? "" : "selected"}>${abilityLabel(null)}</option></select></div>
      <div class="form-group"><label>${game.i18n.localize("NSSQ.Check.modifier")}</label>
        <input type="number" name="modifier" value="0"/></div>
      ${contestNote}
      ${contestOf ? "" : `<div class="form-group"><label>${game.i18n.localize("NSSQ.Check.target")}</label>
        <input type="number" name="target" placeholder="${game.i18n.localize("NSSQ.Check.targetNone")}"/></div>`}
      <div class="form-group"><label>${game.i18n.format("NSSQ.Check.addDiceLabel", { fp })}</label>
        <input type="number" name="addDice" value="0" min="0" max="${fp}"/></div>
      <p class="notes">${game.i18n.localize("NSSQ.Check.addDiceHint")}</p>
    </form>`;
  return Dialog.prompt({
    title: `${actor.name} — ${game.i18n.localize(contestOf ? "NSSQ.Check.contestTitle" : "NSSQ.Check.title")}`,
    content,
    label: game.i18n.localize("NSSQ.Check.roll"),
    rejectClose: false,
    callback: (html) => {
      const f = html[0].querySelector("form");
      const target = f.target?.value === "" || !f.target ? null : Number(f.target.value);
      return {
        ability: f.ability.value || null,
        modifier: Number(f.modifier.value) || 0,
        target,
        addDice: Math.clamp(Number(f.addDice.value) || 0, 0, fp)
      };
    }
  });
}

/**
 * 판정을 굴려 채팅 카드를 만든다
 * @param {Actor} actor
 * @param {object} o { ability, modifier, target, addDice, contestOf }
 */
export async function rollCheck(actor, { ability = null, modifier = 0, target = null, addDice = 0, contestOf = null, rollMode = null, request = null } = {}) {
  const bonus = ability ? actor.system.bonus?.[ability] ?? 0 : 0;
  const added = Math.max(0, addDice);
  const { roll, dice } = await rollD6(2 + added);
  const state = {
    actorUuid: actor.uuid, ability, bonus, modifier, target,
    dice, selected: null, added, rerolled: false, fpGained: 0,
    request: request ? { note: request.note ?? "" } : null
  };
  const result = evaluateCheck({ ...state, modifier: bonus + modifier });
  state.selected = result.selected;
  state.fpGained = result.fpGain;
  await changeFP(actor, result.fpGain - added);

  const flags = { nssq: { check: state } };
  if (contestOf) flags.nssq.contest = { of: contestOf };
  if (request) flags.nssq.request = request;
  const data = {
    speaker: ChatMessage.getSpeaker({ actor }),
    content: await renderCard(state, { contest: !!contestOf }),
    rolls: roll ? [roll] : [],
    sound: CONFIG.sounds.dice,
    flags
  };
  ChatMessage.applyRollMode(data, rollMode ?? game.settings.get("core", "rollMode"));
  return ChatMessage.create(data);
}

async function changeFP(actor, delta) {
  if (!delta) return;
  const value = Math.max(0, (actor.system.fp?.value ?? 0) + delta);
  await actor.update({ "system.fp.value": value });
}

async function renderCard(state, { contest = false } = {}) {
  const r = evaluateCheck({ ...state, modifier: state.bonus + state.modifier });
  const many = state.dice.length > 2;
  const data = {
    label: abilityLabel(state.ability),
    contest,
    request: state.request,
    dice: state.dice.map((v, i) => ({
      v, i,
      used: r.selected.includes(i),
      one: v === 1,
      six: v === 6
    })),
    many,
    bonus: state.bonus,
    modifier: state.modifier,
    total: r.total,
    target: state.target,
    hasTarget: state.target !== null && state.target !== undefined,
    success: r.success,
    absSuccess: r.absSuccess,
    absFailure: r.absFailure,
    fpGained: state.fpGained,
    added: state.added,
    rerolled: state.rerolled,
    canReroll: !state.rerolled
  };
  return renderTemplate(TEMPLATE, data);
}

/* ---------------- 카드 버튼 ---------------- */

function stateOf(message) {
  return message.getFlag("nssq", "check");
}

async function actorOf(state) {
  return fromUuid(state.actorUuid);
}

async function updateCard(message, state) {
  await message.update({
    content: await renderCard(state, { contest: !!message.getFlag("nssq", "contest") }),
    "flags.nssq.check": state
  });
}

/** 【FP】로 다시 굴리기(판정당 1회). 늘린 개수는 유지(FAQ 4) */
async function onReroll(message) {
  const state = foundry.utils.deepClone(stateOf(message));
  if (state.rerolled) return;
  const actor = await actorOf(state);
  if (!actor) return;
  if ((actor.system.fp?.value ?? 0) < REROLL_COST) return ui.notifications.warn(game.i18n.localize("NSSQ.Check.notEnoughFP"));
  const { roll, dice } = await rollD6(state.dice.length);
  await show3d(roll);
  state.dice = dice;
  state.rerolled = true;
  state.selected = null;
  const r = evaluateCheck({ ...state, modifier: state.bonus + state.modifier });
  state.selected = r.selected;
  await changeFP(actor, -REROLL_COST + (r.fpGain - state.fpGained));
  state.fpGained = r.fpGain;
  await updateCard(message, state);
}

/** 3개 이상 굴렸을 때 쓸 주사위를 고른다: 고르지 않은 눈을 누르면 먼저 고른 것과 바뀐다 */
async function onSelect(message, index) {
  const state = foundry.utils.deepClone(stateOf(message));
  if (state.dice.length <= 2 || state.selected.includes(index)) return;
  state.selected = [state.selected[1], index].sort((a, b) => a - b);
  await updateCard(message, state);
}

/** 이 판정에 수동 측으로 대항 */
async function onContest(message) {
  const actor = await pickActor();
  if (!actor) return;
  const opts = await promptCheck(actor, { ability: stateOf(message).ability, contestOf: message.id });
  if (!opts) return;
  await rollCheck(actor, { ...opts, contestOf: message.id });
}

/** 판정할 캐릭터: 지정 캐릭터 → 선택한 토큰 → 소유 캐릭터가 하나면 그것 → 고르기 */
async function pickActor() {
  const controlled = canvas?.tokens?.controlled?.map((t) => t.actor).filter((a) => a?.type === "character") ?? [];
  if (controlled.length === 1) return controlled[0];
  if (game.user.character) return game.user.character;
  const owned = game.actors.filter((a) => a.type === "character" && a.isOwner);
  if (owned.length === 1) return owned[0];
  if (!owned.length) {
    ui.notifications.warn(game.i18n.localize("NSSQ.Check.noActor"));
    return null;
  }
  const id = await Dialog.prompt({
    title: game.i18n.localize("NSSQ.Check.pickActor"),
    content: `<form><div class="form-group"><select name="id">${owned.map((a) => `<option value="${a.id}">${a.name}</option>`).join("")}</select></div></form>`,
    rejectClose: false,
    callback: (html) => html[0].querySelector("[name=id]").value
  });
  return id ? game.actors.get(id) : null;
}

/* ---------------- 대항 결과 표시 ---------------- */

function resultOf(message) {
  const s = stateOf(message);
  return { ...evaluateCheck({ ...s, modifier: s.bonus + s.modifier }), name: message.speaker.alias };
}

/** 수동 측 카드에는 상대와 승패를, 능동 측 카드에는 대항한 쪽들의 승패를 붙인다 */
function renderContest(message, el) {
  const lines = [];
  const of = message.getFlag("nssq", "contest")?.of;
  if (of) {
    const active = game.messages.get(of);
    if (active && stateOf(active)) {
      const a = resultOf(active);
      const p = resultOf(message);
      lines.push({ active: a, passive: p, winner: contestWinner(a, p) });
    }
  }
  if (!of) {
    for (const m of game.messages.filter((m) => m.getFlag("nssq", "contest")?.of === message.id)) {
      const a = resultOf(message);
      const p = resultOf(m);
      lines.push({ active: a, passive: p, winner: contestWinner(a, p) });
    }
  }
  if (!lines.length) return;
  const box = document.createElement("div");
  box.className = "nssq-contest";
  box.innerHTML = lines.map(({ active, passive, winner }) => {
    const win = winner === "active" ? active.name : passive.name;
    return `<div class="contest-line">
      ${game.i18n.format("NSSQ.Check.contestLine", { active: active.name, target: active.total, passive: passive.name, total: passive.total })}
      → <b class="winner">${game.i18n.format("NSSQ.Check.contestWinner", { name: win })}</b></div>`;
  }).join("");
  el.querySelector(".nssq-check")?.append(box);
}

/* ---------------- 훅 ---------------- */

export function registerCheckHooks() {
  Hooks.on("renderChatMessage", (message, html) => {
    if (!stateOf(message)) return;
    const el = html[0];
    renderContest(message, el);
    // 판정을 고칠 수 있는 사람: 메시지 작성자 또는 GM
    const canEdit = message.isAuthor || game.user.isGM;
    el.querySelectorAll("[data-owner-only]").forEach((b) => { if (!canEdit) b.remove(); });
    el.querySelectorAll("[data-nssq-action]").forEach((b) => {
      b.addEventListener("click", (ev) => {
        ev.preventDefault();
        const action = b.dataset.nssqAction;
        if (action === "reroll") onReroll(message);
        else if (action === "select" && canEdit) onSelect(message, Number(b.dataset.index));
        else if (action === "contest") onContest(message);
      });
    });
  });

  // 판정이 바뀌면 그 판정과 대항한 카드도 다시 그린다
  Hooks.on("updateChatMessage", (message) => {
    if (!stateOf(message)) return;
    const of = message.getFlag("nssq", "contest")?.of;
    const related = game.messages.filter((m) => m.getFlag("nssq", "contest")?.of === message.id || m.id === of);
    for (const m of related) ui.chat.updateMessage(m);
  });
}
