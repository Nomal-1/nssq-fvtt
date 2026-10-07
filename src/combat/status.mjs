/**
 * 상태 이상·봉인·강화·약화의 표시와 GM 부여·해제 창(단계 5).
 * 계산은 engine/conditions.mjs·engine/buffs.mjs, 저장은 actor.system.conditions·buffs.
 * 스킬 효과로 자동 부여하는 것은 단계 6. 지금은 GM이 전투 화면 카드의 [상태]로 건다.
 */
import { CONDITIONS, CONDITION_IDS, addCondition, contestInflict, removeCondition, resistCheck } from "../engine/conditions.mjs";
import { BUFFS, BUFF_IDS, IMBUE_ELEMENTS, addBuff, canonicalBuff, paramElements, removeBuff } from "../engine/buffs.mjs";
import { RESISTS } from "../engine/derive.mjs";
import { combatProfile } from "./profile.mjs";
import { onInflicted } from "./turn-status.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Conditions.${k}`, d) : game.i18n.localize(`NSSQ.Conditions.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const loc = (k) => game.i18n.localize(k);

/* ---------------- 이름 ---------------- */

export const conditionName = (id) => loc(`NSSQ.Status.${id}`);

/** 「독 (심도 12)」 */
export function conditionLabel(c) {
  const name = conditionName(c.id);
  return c.depth === null || c.depth === undefined ? name : `${name} (${game.i18n.format("NSSQ.StatusHint.depth", { n: c.depth })})`;
}

/** 속성 param 표기: 〈염〉 / 〈염〉〈빙〉〈뇌〉 / 전체 */
const elementText = (param) => (param === "all" ? loc("NSSQ.Buff.paramAll") : paramElements(param).map((k) => loc(`NSSQ.Resist.${k}`)).join(""));

const paramText = (b) => {
  const def = BUFFS[b.id];
  if (!def?.param || !b.param) return "";
  return def.param === "text" ? b.param : elementText(b.param);
};

/** 「물리 공격 상승: 2」·「내성 부여: 〈염〉」 */
export function buffLabel(raw) {
  const b = { ...raw, id: canonicalBuff(raw.id) };
  const def = BUFFS[b.id];
  const name = loc(`NSSQ.Buff.${b.id}`);
  const extra = def?.param ? paramText(b) : def?.value ? String(b.value) : "";
  return extra ? `${name}: ${extra}` : name;
}

/** 강화·약화가 실제로 하는 일: 「【물리 공격】 +2」·「〈염〉 내성 +1」 등 */
export function buffEffectText(raw) {
  const b = { ...raw, id: canonicalBuff(raw.id) };
  const def = BUFFS[b.id];
  if (!def) return "";
  const B = (k, d) => game.i18n.format(`NSSQ.Buff.${k}`, d);
  const signed = (n) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);
  const v = (def.sign ?? 1) * (Number(b.value) || 0);
  if (def.stats) return def.stats.map((k) => (k === "hpMax" ? B("effHpMax", { n: signed(v) }) : B("effStat", { stat: loc(`NSSQ.Sub.${k}`), n: signed(v) }))).join(" · ");
  const delta = { resistGrant: 1, resistUp: 1, weaknessGrant: -1, resistDown: -1 }[b.id];
  if (delta) return B("effResist", { el: elementText(b.param), n: signed(delta) });
  if (b.id === "elemImbue") return B("effImbue", { el: elementText(b.param) });
  if (b.id === "hpRegen" || b.id === "tpRegen") return B("effRegen", { res: b.id === "hpRegen" ? "【HP】" : "【TP】", n: b.value });
  if (b.id === "chase") return B("effChase", { target: b.param || "-" });
  if (b.id === "critUp") return B("effCrit");
  return "";
}

/** 전투원 상태 자세히(전투 화면에서 카드를 누르면 뜨는 창의 내용) */
export function statusDetailHtml(actor, name) {
  const s = actor?.system ?? {};
  const T = (k, d) => (d ? game.i18n.format(`NSSQ.StatusPanel.${k}`, d) : game.i18n.localize(`NSSQ.StatusPanel.${k}`));
  const conds = (s.conditions ?? []).filter((c) => CONDITIONS[c.id]);
  const buffs = (s.buffs ?? []).filter((b) => BUFFS[canonicalBuff(b.id)]);
  const section = (title, cls, rows) => (rows.length ? `<h4 class="${cls}">${esc(title)}</h4><ul>${rows.join("")}</ul>` : "");
  const condRows = (kind) => conds.filter((c) => CONDITIONS[c.id].kind === kind).map((c) =>
    `<li class="${kind}"><b>${esc(kind === "bind" ? conditionName(c.id) : `[${conditionName(c.id)}]`)}</b>${c.depth === null || c.depth === undefined ? "" : ` <span class="meta">${esc(game.i18n.format("NSSQ.StatusHint.depth", { n: c.depth }))}</span>`}<div class="eff">${esc(loc(`NSSQ.StatusHint.${c.id}`))}</div></li>`);
  const buffRows = (kind) => buffs.filter((b) => BUFFS[canonicalBuff(b.id)].kind === kind).map((b) =>
    `<li class="${kind}"><b>『${esc(buffLabel(b))}』</b> <span class="meta">${esc(T("turnsLeft", { n: b.turns }))}</span><div class="eff">${esc(buffEffectText(b))}</div></li>`);
  const body = [
    section(T("ailments"), "ailment", condRows("ailment")),
    section(T("binds"), "bind", condRows("bind")),
    section(T("buffs"), "buff", buffRows("buff")),
    section(T("debuffs"), "debuff", buffRows("debuff"))
  ].join("");
  return `<header><span class="name">${esc(name)}</span><a data-pop-close title="${esc(T("close"))}"><i class="fas fa-times"></i></a></header>
    ${body || `<p class="none">${esc(T("none"))}</p>`}`;
}

/** 시트용 목록: { cls, label, hint } */
export function statusListOf(actor) {
  const s = actor?.system ?? {};
  return [
    ...(s.conditions ?? []).filter((c) => CONDITIONS[c.id]).map((c) => ({ cls: CONDITIONS[c.id].kind, label: conditionLabel(c), hint: loc(`NSSQ.StatusHint.${c.id}`) })),
    ...(s.buffs ?? []).filter((b) => BUFFS[canonicalBuff(b.id)]).map((b) => ({
      cls: BUFFS[canonicalBuff(b.id)].kind,
      label: `${buffLabel(b)} · ${game.i18n.format("NSSQ.Buff.turns", { n: b.turns })}`,
      hint: buffEffectText(b)
    }))
  ];
}

/* ---------------- 칩(전투 화면·시트) ---------------- */

/** 상태 칩 HTML. 상태 이상(빨강)·봉인(주황)·강화(파랑)·약화(보라) */
export function statusChips(actor) {
  const s = actor?.system;
  if (!s) return "";
  const chips = [];
  for (const c of s.conditions ?? []) {
    const def = CONDITIONS[c.id];
    if (!def) continue;
    const depth = c.depth === null || c.depth === undefined ? "" : `<b>${c.depth}</b>`;
    chips.push(`<span class="nb-chip ${def.kind}" title="${esc(`${conditionLabel(c)} — ${loc(`NSSQ.StatusHint.${c.id}`)}`)}">${esc(conditionName(c.id))}${depth}</span>`);
  }
  for (const b of s.buffs ?? []) {
    const def = BUFFS[b.id];
    if (!def) continue;
    const turns = game.i18n.format("NSSQ.Buff.turns", { n: b.turns });
    chips.push(`<span class="nb-chip ${def.kind}" title="${esc(`${loc(`NSSQ.Buff.${def.kind}`)}: ${buffLabel(b)} (${turns}) — ${buffEffectText(b)}`)}">${esc(buffLabel(b))}<b>${esc(turns)}</b></span>`);
  }
  return chips.length ? `<div class="nb-chips">${chips.join("")}</div>` : "";
}

/**
 * 에너미 카드용 짧은 표시: 상태 이상 이름, 봉인 수, 강화·약화 수(▲n ▼n). 자세한 것은 카드를 눌러 자세히 보기
 * 그림 크기와 관계없이 이름·【HP】 막대와 한 줄에 들어가도록 칩 대신 쓴다
 */
export function statusMarks(actor) {
  const s = actor?.system;
  if (!s) return "";
  const conds = (s.conditions ?? []).filter((c) => CONDITIONS[c.id]);
  const buffs = (s.buffs ?? []).filter((b) => BUFFS[canonicalBuff(b.id)]);
  const ail = conds.filter((c) => CONDITIONS[c.id].kind === "ailment");
  const binds = conds.filter((c) => CONDITIONS[c.id].kind === "bind");
  const up = buffs.filter((b) => BUFFS[canonicalBuff(b.id)].kind === "buff");
  const down = buffs.filter((b) => BUFFS[canonicalBuff(b.id)].kind === "debuff");
  const marks = [
    ...ail.map((c) => `<span class="mk ailment" title="${esc(conditionLabel(c))}">${esc(conditionName(c.id))}</span>`),
    binds.length ? `<span class="mk bind" title="${esc(binds.map(conditionLabel).join(", "))}"><i class="fas fa-link"></i>${binds.length}</span>` : "",
    up.length ? `<span class="mk buff" title="${esc(up.map(buffLabel).join(", "))}">▲${up.length}</span>` : "",
    down.length ? `<span class="mk debuff" title="${esc(down.map(buffLabel).join(", "))}">▼${down.length}</span>` : ""
  ].filter(Boolean);
  return marks.length ? `<div class="nb-marks">${marks.join("")}</div>` : "";
}

/* ---------------- 적용 ---------------- */

const note = (content) => ChatMessage.create({
  speaker: { alias: game.i18n.localize("NSSQ.Combat.tracker") },
  content: `<div class="nssq-combat-note nssq-status-note">${content}</div>`
});

const nameOf = (actor) => actor.token?.name ?? actor.name;

/** 상태 이상·봉인을 건다(이미 판정이 끝난 뒤). 결과를 채팅에 */
export async function inflictCondition(actor, { id, depth = null, source = null, rollText = "" }) {
  const suppAtk = source ? combatProfile(source).suppAtk : 0;
  const r = addCondition(actor.system.conditions, { id, depth, source: source?.uuid ?? "", sourceSuppAtk: suppAtk });
  const changed = !["ignored", "blocked"].includes(r.result);
  if (changed) await actor.update({ "system.conditions": r.list });
  const label = conditionName(id);
  const line = r.result === "ignored" ? L("ignored", { name: esc(nameOf(actor)) })
    : r.result === "blocked" ? L("blocked", { name: esc(nameOf(actor)), label: esc(label), by: esc(conditionName(r.blockedBy.id)) })
      : L("inflicted", { name: esc(nameOf(actor)), label: esc(label), depth: CONDITIONS[id]?.depth ? depth : "-" })
        + (r.replaced ? ` ${L("replaced", { label: esc(conditionName(r.replaced.id)) })}` : "");
  await note(`<i class="fas fa-skull-crossbones"></i> ${line}${rollText ? `<p class="notes">${rollText}</p>` : ""}`);
  // 부여 순간의 1D6([혼란]·[마비]·[공포]), [스턴]의 대기 취소
  if (changed) await onInflicted(actor, id);
  return r;
}

export async function grantBuff(actor, entry) {
  const r = addBuff(actor.system.buffs, entry);
  if (["added", "updated", "countered", "replaced"].includes(r.result)) await actor.update({ "system.buffs": r.list });
  const label = buffLabel({ ...entry, value: Number(entry.value) || 0 });
  const kind = loc(`NSSQ.Buff.${BUFFS[entry.id]?.kind ?? "buff"}`);
  const other = r.removed ? buffLabel(r.removed) : "";
  const icon = BUFFS[entry.id]?.kind === "debuff" ? "fa-arrow-down" : "fa-arrow-up";
  await note(`<i class="fas ${icon}"></i> ${L(r.result === "replaced" ? "buffReplaced" : r.result, { name: esc(nameOf(actor)), label: esc(label), other: esc(other), kind })}`);
  return r;
}

export async function clearCondition(actor, id) {
  await actor.update({ "system.conditions": removeCondition(actor.system.conditions, id) });
  await note(`<i class="fas fa-check"></i> ${L("removed", { name: esc(nameOf(actor)), label: esc(conditionName(id)) })}`);
}

export async function clearBuff(actor, index) {
  const b = actor.system.buffs?.[index];
  if (!b) return;
  await actor.update({ "system.buffs": removeBuff(actor.system.buffs, index) });
  await note(`<i class="fas fa-check"></i> ${L("removed", { name: esc(nameOf(actor)), label: esc(buffLabel(b)) })}`);
}

/* ---------------- 판정 ---------------- */

async function roll2d6() {
  const r = await new Roll("2d6").evaluate();
  if (game.dice3d) await game.dice3d.showForRoll(r, game.user, true);
  return r.dice[0].results.map((x) => x.result);
}

/** 고정 목표값: 대상이 2D6 + 【억제 방어】로 막는다 */
async function inflictFixed(actor, id, target, source) {
  const d = combatProfile(actor);
  const dice = await roll2d6();
  const r = resistCheck({ dice, suppDef: d.suppDef, target });
  const rollText = L("fixedRoll", { dice: `[${r.check.used.join(", ")}]`, mod: d.suppDef, total: r.check.total, target });
  if (r.resisted) return note(`<i class="fas fa-shield-alt"></i> ${L("resisted", { name: esc(nameOf(actor)), label: esc(conditionName(id)) })}<p class="notes">${rollText}</p>`);
  return inflictCondition(actor, { id, depth: r.depth, source, rollText });
}

/** 대결 판정: 건 자 【억제 공격】 vs 대상 【억제 방어】 */
async function inflictContest(actor, id, source) {
  const a = combatProfile(source);
  const d = combatProfile(actor);
  const atkDice = await roll2d6();
  const defDice = await roll2d6();
  const r = contestInflict({ atkDice, suppAtk: a.suppAtk, defDice, suppDef: d.suppDef });
  const rollText = L("contestRoll", {
    atk: esc(nameOf(source)), atkDice: `[${r.atk.used.join(", ")}]`, atkMod: a.suppAtk, atkTotal: r.atk.total,
    def: esc(nameOf(actor)), defDice: `[${r.def.used.join(", ")}]`, defMod: d.suppDef, defTotal: r.def.total
  });
  if (r.resisted) return note(`<i class="fas fa-shield-alt"></i> ${L("resisted", { name: esc(nameOf(actor)), label: esc(conditionName(id)) })}<p class="notes">${rollText}</p>`);
  return inflictCondition(actor, { id, depth: r.depth, source, rollText });
}

/* ---------------- GM 창 ---------------- */

const openApps = new Map();

/** GM: 한 전투원의 상태를 보고 걸고 푸는 창 */
export class StatusApp extends Application {
  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["nssq", "nssq-status-app"],
      width: 420,
      height: "auto",
      resizable: true
    });
  }

  get id() {
    return `nssq-status-${this.actor.uuid.replace(/\./g, "-")}`;
  }

  get title() {
    return L("title", { name: nameOf(this.actor) });
  }

  static open(actor) {
    if (!game.user.isGM || !actor) return;
    const app = openApps.get(actor.uuid) ?? new StatusApp(actor);
    openApps.set(actor.uuid, app);
    app.render(true);
  }

  async close(options) {
    openApps.delete(this.actor.uuid);
    return super.close(options);
  }

  /** 다른 전투원(대결 판정·독의 건 자) */
  sources() {
    return (game.combat?.combatants.contents ?? []).filter((c) => c.actor && c.actor !== this.actor).map((c) => ({ uuid: c.actor.uuid, name: c.name }));
  }

  async _renderInner() {
    const s = this.actor.system;
    const opt = (v, label, sel = false) => `<option value="${esc(v)}" ${sel ? "selected" : ""}>${esc(label)}</option>`;
    const current = [
      ...(s.conditions ?? []).map((c) => `<li class="${CONDITIONS[c.id]?.kind ?? ""}"><span>${esc(conditionLabel(c))}</span><a data-remove-condition="${esc(c.id)}" title="${esc(L("remove"))}"><i class="fas fa-times"></i></a></li>`),
      ...(s.buffs ?? []).map((b, i) => `<li class="${BUFFS[b.id]?.kind ?? ""}"><span>${esc(buffLabel(b))} · ${esc(game.i18n.format("NSSQ.Buff.turns", { n: b.turns }))}</span><a data-remove-buff="${i}" title="${esc(L("remove"))}"><i class="fas fa-times"></i></a></li>`)
    ];
    const sources = this.sources();
    const groups = ["buff", "debuff"].map((kind) => `<optgroup label="${esc(loc(`NSSQ.Buff.${kind}`))}">${BUFF_IDS.filter((id) => BUFFS[id].kind === kind && !BUFFS[id].custom).map((id) => opt(id, loc(`NSSQ.Buff.${id}`))).join("")}</optgroup>`).join("");
    const html = `<div class="nssq-status-form">
      <h3>${esc(L("current"))}</h3>
      <ul class="status-current">${current.join("") || `<li class="none">${esc(L("none"))}</li>`}</ul>
      <h3>${esc(L("ailmentSection"))}</h3>
      <form data-form="condition">
        <div class="form-group"><label>${esc(L("condition"))}</label><select name="kind">${CONDITION_IDS.map((id) => opt(id, conditionName(id))).join("")}</select></div>
        <div class="form-group"><label>${esc(L("mode"))}</label><select name="mode">
          ${opt("direct", L("modeDirect"))}${opt("fixed", L("modeFixed"))}${sources.length ? opt("contest", L("modeContest")) : ""}</select></div>
        <div class="form-group" data-show="direct fixed"><label data-label-direct="${esc(L("depth"))}" data-label-fixed="${esc(L("target"))}">${esc(L("depth"))}</label><input type="number" name="amount" value="10"/></div>
        <div class="form-group"><label>${esc(L("attacker"))}</label><select name="source">${opt("", L("attackerNone"))}${sources.map((x) => opt(x.uuid, x.name)).join("")}</select></div>
        <button type="submit"><i class="fas fa-skull-crossbones"></i> ${esc(L("apply"))}</button>
      </form>
      <h3>${esc(L("buffSection"))}</h3>
      <form data-form="buff">
        <div class="form-group"><label>${esc(L("buff"))}</label><select name="kind">${groups}</select></div>
        <div class="form-group" data-buff-value><label>${esc(L("value"))}</label><input type="number" name="amount" value="1"/></div>
        <div class="form-group" data-buff-param="element"><label>${esc(L("param"))}</label><select name="paramElement">${[...RESISTS, IMBUE_ELEMENTS.join(","), "all"].map((k) => opt(k, elementText(k))).join("")}</select></div>
        <div class="form-group" data-buff-param="imbue"><label>${esc(L("param"))}</label><select name="paramImbue">${IMBUE_ELEMENTS.map((k) => opt(k, loc(`NSSQ.Resist.${k}`))).join("")}</select></div>
        <div class="form-group" data-buff-param="text"><label>${esc(L("paramText"))}</label><input type="text" name="paramText" value=""/></div>
        <div class="form-group"><label>${esc(L("turns"))}</label><input type="number" name="turns" value="3" min="1"/></div>
        <button type="submit"><i class="fas fa-arrow-up"></i> ${esc(L("apply"))}</button>
      </form>
    </div>`;
    return $(html);
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html[0];
    const condForm = root.querySelector("[data-form=condition]");
    const buffForm = root.querySelector("[data-form=buff]");
    // 부여 방식에 따라 심도/목표값 칸
    const syncCond = () => {
      const mode = condForm.mode.value;
      const box = condForm.querySelector("[data-show]");
      box.style.display = mode === "contest" ? "none" : "";
      const label = box.querySelector("label");
      label.textContent = mode === "fixed" ? label.dataset.labelFixed : label.dataset.labelDirect;
      const noDepth = !CONDITIONS[condForm.kind.value]?.depth && mode === "direct";
      box.style.opacity = noDepth ? "0.4" : "";
    };
    // 강화 종류에 따라 수치·속성 칸
    const syncBuff = () => {
      const def = BUFFS[buffForm.kind.value];
      buffForm.querySelector("[data-buff-value]").style.display = def?.value ? "" : "none";
      buffForm.querySelectorAll("[data-buff-param]").forEach((el) => { el.style.display = el.dataset.buffParam === def?.param ? "" : "none"; });
    };
    condForm.addEventListener("change", syncCond);
    buffForm.addEventListener("change", syncBuff);
    syncCond();
    syncBuff();

    condForm.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const id = condForm.kind.value;
      const mode = condForm.mode.value;
      const value = Number(condForm.amount.value) || 0;
      const source = condForm.source.value ? await fromUuid(condForm.source.value) : null;
      if (mode === "fixed") await inflictFixed(this.actor, id, value, source);
      else if (mode === "contest" && source) await inflictContest(this.actor, id, source);
      else await inflictCondition(this.actor, { id, depth: value, source });
      this.render();
    });
    buffForm.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const id = buffForm.kind.value;
      const def = BUFFS[id];
      const param = def?.param === "element" ? buffForm.paramElement.value : def?.param === "imbue" ? buffForm.paramImbue.value : def?.param === "text" ? buffForm.paramText.value.trim() : "";
      await grantBuff(this.actor, { id, value: Number(buffForm.amount.value) || 0, turns: Number(buffForm.turns.value) || 1, param });
      this.render();
    });
    root.querySelectorAll("[data-remove-condition]").forEach((a) => a.addEventListener("click", async () => {
      await clearCondition(this.actor, a.dataset.removeCondition);
      this.render();
    }));
    root.querySelectorAll("[data-remove-buff]").forEach((a) => a.addEventListener("click", async () => {
      await clearBuff(this.actor, Number(a.dataset.removeBuff));
      this.render();
    }));
  }
}
