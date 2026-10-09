/**
 * 일반 행위 판정의 종류별 보정·선언·도움(단계 9-E)
 * - 판정 종류(복수 선택): 장비·상시 스킬 modifier `checks.<종류>`를 더한다(《괴물 지식》 식별 +2 등)
 * - 선언(자신의 특수 스킬, 효과 checkBonus { kinds, value, ability? }): 코스트를 내고 +value, ability가 있으면 그 능력치로(《육분의 관측》)
 * - 도움(다른 사람의 특수 스킬, 효과 checkAssist { value }): 그 사람이 코스트를 내고 +value(《별 읽기》·《왕의 격려》)
 * 판정 뒤 조작(카드 버튼)은 chat/check.mjs: 효과 checkFlip(《트릭스터》), checkExtraDie(《호운의 가호》), rerollBonus(《행운의 여신》)
 */
import { emit, onSocket } from "../socket.mjs";

export const CHECK_KINDS = ["identify", "knowledge", "lore", "danger", "sight", "senses", "stealth", "tracking", "mapping", "athletic", "riding", "piloting", "machinery", "escape", "negotiation", "rope", "foeEvade"];

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Check.${k}`, d) : game.i18n.localize(`NSSQ.Check.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const effOf = (i, type) => (i.system.effects ?? []).find((e) => e?.type === type);
const skills = (a, type) => (a?.items ?? []).filter((i) => i.type === "skill" && (i.system.sl ?? 0) > 0 && effOf(i, type));
const canPay = (a, cost = {}) => (cost.tp ?? 0) <= (a.system.tp?.value ?? 0) && (cost.fp ?? 0) <= (a.system.fp?.value ?? 0);
const costText = (c = {}) => [c.tp ? `TP ${c.tp}` : "", c.fp ? `FP ${c.fp}` : ""].filter(Boolean).join(" ");

/** 판정 대화창에 넣을 HTML(종류·선언·도움). preset: GM 판정 요청 등이 미리 고른 종류(펼쳐서 보인다) */
export function checkModsHtml(actor, { kinds: preset = [] } = {}) {
  const mods = actor.system.equipment?.mods ?? {};
  const kinds = CHECK_KINDS.map((k) => {
    const v = Number(mods[`checks.${k}`]) || 0;
    return `<label class="choice"><input type="checkbox" name="kind" value="${k}" ${preset.includes(k) ? "checked" : ""}/> ${esc(L(`kind.${k}`))}${v ? ` <b>${v > 0 ? "+" : ""}${v}</b>` : ""}</label>`;
  }).join("");
  const decl = skills(actor, "checkBonus").map((i) => {
    const e = effOf(i, "checkBonus");
    const ok = canPay(actor, i.system.cost);
    return `<label class="choice"><input type="checkbox" name="declare" value="${i.id}" ${ok ? "" : "disabled"}/> 《${esc(i.name)}》 +${e.value}${e.ability ? `(${esc(game.i18n.localize(`NSSQ.Ability.${e.ability}`))})` : ""} <small>${esc((e.kinds ?? []).map((k) => L(`kind.${k}`)).join("·"))} ${esc(costText(i.system.cost))}</small></label>`;
  }).join("");
  const helpers = game.actors.filter((a) => a.type === "character" && a.id !== actor.id).flatMap((a) => skills(a, "checkAssist").map((i) => ({ a, i })));
  const assist = helpers.map(({ a, i }) => {
    const ok = canPay(a, i.system.cost);
    return `<label class="choice"><input type="checkbox" name="assist" value="${a.uuid}|${i.id}" ${ok ? "" : "disabled"}/> ${esc(a.name)} 《${esc(i.name)}》 +${effOf(i, "checkAssist").value} <small>${esc(costText(i.system.cost))}</small></label>`;
  }).join("");
  return `<details class="nssq-check-mods" ${preset.length ? "open" : ""}><summary>${esc(L("kindTitle"))}</summary><div class="kinds">${kinds}</div>
    ${decl ? `<p><b>${esc(L("declareTitle"))}</b></p><div>${decl}</div>` : ""}
    ${assist ? `<p><b>${esc(L("assistTitle"))}</b></p><div>${assist}</div>` : ""}
    <p class="notes">${esc(L("kindHint"))}</p></details>`;
}

/** 대화창 form → { kinds, declares, assists } */
export function readCheckMods(form) {
  const all = (n) => [...form.querySelectorAll(`[name=${n}]:checked`)].map((x) => x.value);
  return { kinds: all("kind"), declares: all("declare"), assists: all("assist") };
}

/**
 * 보정 계산 + 코스트 지불
 * @returns {Promise<{ modifier: number, ability: string|null, notes: string[] }>}
 */
export async function applyCheckMods(actor, { kinds = [], declares = [], assists = [] } = {}) {
  const mods = actor.system.equipment?.mods ?? {};
  let modifier = 0;
  let ability = null;
  const notes = [];
  for (const k of kinds) {
    const v = Number(mods[`checks.${k}`]) || 0;
    modifier += v;
    notes.push(v ? `${L(`kind.${k}`)} ${v > 0 ? "+" : ""}${v}` : L(`kind.${k}`));
  }
  for (const id of declares) {
    const i = actor.items.get(id);
    const e = i && effOf(i, "checkBonus");
    if (!e || !canPay(actor, i.system.cost)) continue;
    await pay(actor, i.system.cost);
    modifier += Number(e.value) || 0;
    if (e.ability) ability = e.ability;
    notes.push(`《${i.name}》 +${e.value}${e.ability ? `(${game.i18n.localize(`NSSQ.Ability.${e.ability}`)})` : ""}`);
  }
  for (const key of assists) {
    const [uuid, id] = key.split("|");
    const a = await fromUuid(uuid);
    const i = a?.items.get(id);
    const e = i && effOf(i, "checkAssist");
    if (!e || !canPay(a, i.system.cost)) continue;
    await pay(a, i.system.cost);
    modifier += Number(e.value) || 0;
    notes.push(`${a.name}《${i.name}》 +${e.value}`);
  }
  return { modifier, ability, notes };
}

/** 코스트: 내 캐릭터면 바로, 아니면 활성 GM에게 */
export async function pay(actor, cost = {}) {
  if (!cost.tp && !cost.fp) return;
  if (!actor.isOwner) return emit("checkPay", { uuid: actor.uuid, cost });
  const upd = {};
  if (cost.tp) upd["system.tp.value"] = Math.max(0, (actor.system.tp?.value ?? 0) - cost.tp);
  if (cost.fp) upd["system.fp.value"] = Math.max(0, (actor.system.fp?.value ?? 0) - cost.fp);
  await actor.update(upd);
}

/** 판정 뒤 조작 스킬(카드 버튼): checkFlip·checkExtraDie·rerollBonus */
export const postSkill = (actor, type) => skills(actor, type)[0] ?? null;

export function registerCheckMods() {
  onSocket("checkPay", async ({ uuid, cost }) => {
    if (game.users.activeGM?.id !== game.user.id) return;
    const a = await fromUuid(uuid);
    if (a) await pay(a, cost);
  });
}
