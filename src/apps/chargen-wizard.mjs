/**
 * 캐릭터 작성 마법사(단계 10, data/raw/character/캐릭터-작성-(Character-Generation).md)
 * 1 기본 → 2 능력치(3D6×5 배정) → 3 클래스(메인·서브) → 4 스킬(SL 5·커먼 1) → 5 장비(작성 모드 상점) → 6 경력(D666) → 7 확인
 * 실제 액터 하나를 대상으로 하고, 단계는 액터 플래그 nssq.chargen.step에 남긴다(다시 열면 이어 감).
 * 기존 부품을 쓴다: 능력치 굴리기·배정(ability-roll.mjs), 스킬 트리(skill-tree.mjs), ★ 자동(unique-skill.mjs), 상점 작성 모드(shop.mjs).
 * 검사는 engine/chargen.mjs validateCreation. [완료]: HP·TP 최대, FP 1, 작성 잠금
 */
import { ABILITIES } from "../engine/derive.mjs";
import { creationReady, initialMoney, isValidAssignment, orderedAssignment, randomAssignment, rollCareer, validateCreation } from "../engine/chargen.mjs";
import { levelCap, prereqsMet, skillBudget } from "../engine/skills.mjs";
import { canEquip, equippedSlot, isPhysical } from "../engine/equipment.mjs";
import { isActiveGM } from "../combat/apply.mjs";
import { emit, onSocket } from "../socket.mjs";
import tables from "../generated/tables.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Chargen.${k}`, d) : game.i18n.localize(`NSSQ.Chargen.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ab = (k) => game.i18n.localize(`NSSQ.Ability.${k}`);
const STEPS = ["basic", "abilities", "class", "skills", "equipment", "history", "confirm"];

/** 클래스 목록: 컴펜디움 + 월드 클래스 아이템(커스텀 직업) */
let classCache = null;
async function classList() {
  classCache ??= ((await game.packs.get("nssq.classes")?.getDocuments()) ?? []).filter((c) => c.type === "class");
  return [...classCache, ...game.items.filter((i) => i.type === "class")];
}

/** 커먼 스킬 목록 */
let commonCache = null;
async function commonSkills() {
  commonCache ??= ((await game.packs.get("nssq.skills")?.getDocuments()) ?? []).filter((s) => s.type === "skill" && s.system.classKey === "common");
  return commonCache;
}

export class ChargenWizard extends Application {
  constructor(actor, options = {}) {
    super({ id: `nssq-chargen-${actor.id}`, ...options });
    this.actor = actor;
    const saved = actor.getFlag("nssq", "chargen") ?? {};
    this.step = Math.max(0, STEPS.indexOf(saved.step ?? "basic"));
    this.slots = orderedAssignment();
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, { classes: ["nssq", "nq-window", "nssq-chargen"], width: 760, height: 720, resizable: true });
  }

  get title() { return L("title", { name: this.actor.name }); }

  static open(actor) {
    if (!actor?.isOwner || actor.type !== "character") return null;
    const app = Object.values(ui.windows).find((w) => w instanceof ChargenWizard && w.actor === actor) ?? new ChargenWizard(actor);
    app.render(true, { focus: true });
    return app;
  }

  get locked() { return !!this.actor.system.creation?.locked && !game.user.isGM; }

  async _renderInner() {
    const nav = STEPS.map((s, i) => `<a class="cg-step ${i === this.step ? "active" : ""} ${i < this.step ? "done" : ""}" data-cg-go="${i}"><b>${i + 1}</b> ${esc(L(`step.${s}`))}</a>`).join("");
    const body = await this[`render_${STEPS[this.step]}`]();
    const last = this.step === STEPS.length - 1;
    return $(`<div class="cg-wrap">
      <nav class="cg-steps">${nav}</nav>
      ${this.locked ? `<p class="cg-locked"><i class="fas fa-lock"></i> ${esc(L("lockedNote"))}</p>` : ""}
      <section class="cg-body">${body}</section>
      <footer class="cg-foot">
        <button type="button" data-cg="prev" ${this.step ? "" : "disabled"}><i class="fas fa-arrow-left"></i> ${esc(L("prev"))}</button>
        ${last ? "" : `<button type="button" data-cg="next">${esc(L("next"))} <i class="fas fa-arrow-right"></i></button>`}
      </footer></div>`);
  }

  /* ---------- 1 기본 ---------- */
  async render_basic() {
    const a = this.actor;
    const p = a.system.profile ?? {};
    const f = (k) => `<label><span>${esc(L(`profile.${k}`))}</span><input type="text" data-cg-field="system.profile.${k}" value="${esc(p[k])}"/></label>`;
    return `<p class="notes">${esc(L("basicHint"))}</p>
      <div class="cg-basic"><img src="${esc(a.img)}" data-cg="img" title="${esc(L("img"))}"/>
        <div class="cg-grid"><label class="wide"><span>${esc(L("name"))}</span><input type="text" data-cg-field="name" value="${esc(a.name)}"/></label>
        ${["gender", "age", "hair", "build"].map(f).join("")}</div></div>`;
  }

  /* ---------- 2 능력치 ---------- */
  async render_abilities() {
    const s = this.actor.system;
    const rolls = s.abilityRolls ?? [];
    if (rolls.length !== 5) {
      return `<p>${esc(L("rollHint"))}</p><button type="button" class="cg-big" data-cg="roll" ${this.locked ? "disabled" : ""}><i class="fas fa-dice"></i> ${esc(L("roll"))}</button>`;
    }
    // 이미 배정했으면 그 배정을, 아니면 순서대로
    const assigned = ABILITIES.map((k) => s.abilities[k].base);
    if (assigned.every((v) => v > 0) && !this._slotsTouched) {
      const used = new Set();
      this.slots = assigned.map((v) => { const i = rolls.findIndex((r, j) => r === v && !used.has(j)); used.add(i); return i; });
      if (!isValidAssignment(this.slots)) this.slots = orderedAssignment();
    }
    const parts = s.abilityParts;
    const rows = ABILITIES.map((k, i) => {
      const v = rolls[this.slots[i]] ?? 0;
      const cls = parts[k].total - parts[k].base;
      return `<tr><th>${esc(ab(k))}</th><td><select data-cg-slot="${i}">${rolls.map((t, j) => `<option value="${j}" ${j === this.slots[i] ? "selected" : ""}>${j + 1}. ${t}</option>`).join("")}</select></td>
        <td>${cls ? `+${cls}` : "—"}</td><td><b>${v + cls}</b></td><td>B ${Math.floor((v + cls) / 5)}</td></tr>`;
    }).join("");
    const valid = isValidAssignment(this.slots);
    const moneySet = !!this.actor.getFlag("nssq", "chargen")?.moneySet;
    return `<p class="cg-rolls">${rolls.map((t, i) => `<span>${i + 1}. <b>${t}</b></span>`).join("")} <small>${esc(L("sum", { sum: rolls.reduce((a, b) => a + b, 0), money: initialMoney(rolls) }))}</small></p>
      <div class="cg-tools"><button type="button" data-cg="ordered"><i class="fas fa-list-ol"></i> ${esc(game.i18n.localize("NSSQ.AbilityRoll.ordered"))}</button>
        <button type="button" data-cg="random"><i class="fas fa-random"></i> ${esc(game.i18n.localize("NSSQ.AbilityRoll.random"))}</button>
        ${game.user.isGM ? `<button type="button" data-cg="reroll"><i class="fas fa-dice"></i> ${esc(L("reroll"))}</button>` : ""}</div>
      <table class="cg-table"><thead><tr><th></th><th>${esc(L("rolled"))}</th><th>${esc(L("classBonus"))}</th><th>${esc(L("total"))}</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      ${valid ? "" : `<p class="cg-err">${esc(game.i18n.localize("NSSQ.AbilityRoll.duplicate"))}</p>`}
      <button type="button" class="cg-big" data-cg="assign" ${valid && !this.locked ? "" : "disabled"}><i class="fas fa-check"></i> ${esc(L("assign"))}</button>
      <p class="notes">${esc(L(moneySet ? "moneyAlready" : "moneyFirst", { money: initialMoney(rolls) }))}</p>`;
  }

  /* ---------- 3 클래스 ---------- */
  async render_class() {
    const list = await classList();
    const s = this.actor.system;
    const { main, sub } = s.classItems;
    const card = (c, role) => {
      const sel = (role === "main" ? main : sub)?.system.key === c.system.key;
      const other = (role === "main" ? sub : main)?.system.key === c.system.key;
      const b = c.system.abilityBonus ?? {};
      return `<button type="button" class="cg-class ${sel ? "selected" : ""}" data-cg-class="${role}" data-key="${esc(c.system.key)}" data-uuid="${c.uuid}" ${other ? "disabled" : ""}>
        <img src="${esc(c.img)}"/><span class="txt"><b>${esc(c.name)}</b>
        ${role === "main" ? `<small>${ABILITIES.map((k) => `${ab(k)}+${b[k] ?? 0}`).join(" ")}</small>` : ""}
        <small>${esc(L("weapons"))}: ${esc((c.system.weapons ?? []).join("·"))}</small>
        <small>${esc(L(role === "main" ? "armors" : "shieldOnly"))}: ${esc(role === "main" ? (c.system.armors ?? []).join("·") : (c.system.armors ?? []).includes("방패") ? "방패" : "—")}</small>
        <small>${esc([...(c.system.role ?? []), c.system.position].filter(Boolean).join(" · "))}</small></span></button>`;
    };
    const uniq = main ? await uniqueName(main.system.key) : null;
    return `<h3>${esc(L("mainClass"))}</h3><div class="cg-classes">${list.map((c) => card(c, "main")).join("")}</div>
      <h3>${esc(L("subClass"))} <small>${esc(L("subOptional"))}</small></h3>
      <p class="notes">${esc(L("subHint"))}${uniq ? ` ${esc(L("loseUnique", { name: uniq }))}` : ""}</p>
      <div class="cg-tools"><button type="button" data-cg="noSub" class="${sub ? "" : "selected"}">${esc(L("noSub"))}</button></div>
      <div class="cg-classes sub">${main ? list.map((c) => card(c, "sub")).join("") : `<p class="notes">${esc(L("pickMainFirst"))}</p>`}</div>`;
  }

  /* ---------- 4 스킬 ---------- */
  async render_skills() {
    const s = this.actor.system;
    const skills = this.actor.items.filter((i) => i.type === "skill");
    const isCommon = (i) => i.system.classKey === "common";
    const b = skillBudget({ level: s.level, skills: skills.map((i) => ({ sl: i.system.sl ?? 0, unique: !!i.system.unique, common: isCommon(i) })), bonus: s.skillBonus ?? 0 });
    const commons = await commonSkills();
    const mine = skills.find(isCommon);
    const rows = skills.filter((i) => (i.system.sl ?? 0) > 0 || i.system.unique).map((i) => `<li>${i.system.unique ? "★ " : ""}《${esc(i.name)}》 <b>${i.system.unique ? "★" : `SL ${i.system.sl}`}</b>${isCommon(i) ? ` <small>${esc(L("common"))}</small>` : ""}</li>`).join("");
    const pct = Math.min(100, Math.round((b.spent / Math.max(1, b.total)) * 100));
    return `<div class="cg-budget"><div class="bar"><i style="width:${pct}%"></i></div><span>${esc(L("budget", { spent: b.spent, total: b.total, left: b.left }))}</span></div>
      <p class="notes">${esc(L("skillHint"))}</p>
      <button type="button" class="cg-big" data-cg="tree" ${s.mainClass ? "" : "disabled"}><i class="fas fa-sitemap"></i> ${esc(L("openTree"))}</button>
      <p class="cg-sub">${esc(L("commonPick"))}</p>
      <div class="cg-commons">${commons.map((c) => `<button type="button" class="cg-common ${mine?.system.skillKey === c.system.skillKey ? "selected" : ""}" data-cg-common="${c.uuid}" title="${esc((c.system.description ?? "").replace(/<[^>]+>/g, ""))}">${esc(c.name)}</button>`).join("")}</div>
      <h3>${esc(L("learned"))}</h3><ul class="cg-skills">${rows || `<li class="notes">${esc(L("none"))}</li>`}</ul>`;
  }

  /* ---------- 5 장비 ---------- */
  async render_equipment() {
    const s = this.actor.system;
    const items = this.actor.items.contents;
    const slot = (k) => {
      const it = items.find((i) => equippedSlot(i) === k);
      return `<li><b>${esc(game.i18n.localize(`NSSQ.Slot.${k}`))}</b> ${it ? `${esc(it.name)}${it.system.rank ? ` R${it.system.rank}` : ""}${(it.system.refinements ?? []).length ? ` [${it.system.refinements.length}]` : ""}` : `<span class="notes">${esc(L("empty"))}</span>`}</li>`;
    };
    const goods = items.filter((i) => isPhysical(i) && !i.system.equipped && !i.system.stored);
    return `<p class="cg-money"><i class="fas fa-coins"></i> ${s.money}G <small>${esc(L("moneyNote"))}</small></p>
      <p class="notes">${esc(L("equipHint"))}</p>
      <div class="cg-tools"><button type="button" class="cg-big" data-cg="shop"><i class="fas fa-store"></i> ${esc(L("openShop"))}</button>
        <button type="button" data-cg="sheet"><i class="fas fa-id-card"></i> ${esc(L("openSheet"))}</button></div>
      <h3>${esc(L("slots"))}</h3><ul class="cg-slots">${["weapon", "armor", "other"].map(slot).join("")}</ul>
      <h3>${esc(L("carried", { n: s.carried, max: s.carry }))}</h3><ul class="cg-goods">${goods.map((i) => `<li>${esc(i.name)}${(i.system.quantity ?? 1) > 1 ? ` ×${i.system.quantity}` : ""}</li>`).join("") || `<li class="notes">${esc(L("none"))}</li>`}</ul>`;
  }

  /* ---------- 6 경력 ---------- */
  async render_history() {
    const h = this.actor.system.history ?? [];
    return `<p class="notes">${esc(L("historyHint"))}</p>
      <div class="cg-tools"><button type="button" data-cg="career"><i class="fas fa-dice"></i> ${esc(L("rollCareer"))}</button></div>
      <ol class="cg-history">${h.map((t, i) => `<li>${esc(t)} <a data-cg-delhist="${i}" title="${esc(L("remove"))}"><i class="fas fa-times"></i></a></li>`).join("")}</ol>
      <div class="cg-tools"><input type="text" data-cg-histtext placeholder="${esc(L("historyFree"))}"/><button type="button" data-cg="addHist"><i class="fas fa-plus"></i></button></div>
      <label class="cg-desc"><span>${esc(L("description"))}</span><textarea data-cg-field="system.description" rows="4">${esc((this.actor.system.description ?? "").replace(/<[^>]+>/g, ""))}</textarea></label>`;
  }

  /* ---------- 7 확인 ---------- */
  checks() {
    const a = this.actor;
    const s = a.system;
    const { main, sub } = s.classItems;
    const skills = a.items.filter((i) => i.type === "skill").map((i) => ({
      name: i.name, sl: i.system.sl ?? 0, unique: !!i.system.unique, common: i.system.classKey === "common",
      classKey: i.system.classKey, maxSL: i.system.maxSL, prereqs: i.system.prereqs
    }));
    return validateCreation({
      rolls: s.abilityRolls ?? [], abilities: Object.fromEntries(ABILITIES.map((k) => [k, s.abilities[k].base])),
      mainClass: main?.system.key ?? null, subClass: sub?.system.key ?? null, skills,
      equipped: a.items.filter((i) => i.system?.equipped).map((i) => ({ name: i.name, type: i.type, system: i.system })),
      classes: { main: main?.system ?? null, sub: sub?.system ?? null },
      carried: s.carried, capacity: s.carry, money: s.money, level: s.level, bonus: s.skillBonus ?? 0,
      canEquip, skillRules: { skillBudget, levelCap, prereqsMet }
    });
  }

  async render_confirm() {
    const s = this.actor.system;
    const checks = this.checks();
    const ready = creationReady(checks);
    const row = (c) => `<li class="${c.ok ? "ok" : c.level}"><i class="fas ${c.ok ? "fa-check" : c.level === "error" ? "fa-times" : "fa-exclamation-triangle"}"></i> ${esc(L(`check.${c.code}`))}${!c.ok && c.detail ? ` <small>(${esc(c.detail)})</small>` : ""}</li>`;
    const { main, sub } = s.classItems;
    const done = !!this.actor.getFlag("nssq", "chargen")?.done;
    return `<div class="cg-summary"><img src="${esc(this.actor.img)}"/><div>
        <h2>${esc(this.actor.name)}</h2><p>${esc(main?.name ?? "—")}${sub ? ` / ${esc(sub.name)}` : ""} · Lv${s.level}</p>
        <p>${ABILITIES.map((k) => `${ab(k)} <b>${s.abilityParts[k].total}</b>`).join(" · ")}</p>
        <p>【HP】 ${s.hp.max} · 【TP】 ${s.tp.max} · 【FP】 1 · ${esc(L("moneyLeft", { g: s.money }))}</p></div></div>
      <ul class="cg-checks">${checks.map(row).join("")}</ul>
      ${done ? `<p class="cg-done"><i class="fas fa-flag-checkered"></i> ${esc(L("alreadyDone"))}</p>` : ""}
      <button type="button" class="cg-big" data-cg="finish" ${ready && !this.locked ? "" : "disabled"}><i class="fas fa-flag-checkered"></i> ${esc(L("finish"))}</button>
      ${!ready && game.user.isGM ? `<button type="button" data-cg="finishForce">${esc(L("finishForce"))}</button>` : ""}
      <p class="notes">${esc(L(ready ? "finishHint" : "fixFirst"))}</p>`;
  }

  /* ---------- 입력 ---------- */

  activateListeners(html) {
    super.activateListeners(html);
    html.on("change", "[data-cg-field]", (ev) => this.setField(ev.currentTarget.dataset.cgField, ev.currentTarget.value));
    html.on("change", "[data-cg-slot]", (ev) => { this.slots[Number(ev.currentTarget.dataset.cgSlot)] = Number(ev.currentTarget.value); this._slotsTouched = true; this.render(); });
    html.on("click", "[data-cg-go]", (ev) => this.go(Number(ev.currentTarget.dataset.cgGo)));
    html.on("click", "[data-cg-class]", (ev) => this.pickClass(ev.currentTarget.dataset.cgClass, ev.currentTarget.dataset.uuid));
    html.on("click", "[data-cg-common]", (ev) => this.pickCommon(ev.currentTarget.dataset.cgCommon));
    html.on("click", "[data-cg-delhist]", (ev) => this.setHistory((h) => h.filter((_, i) => i !== Number(ev.currentTarget.dataset.cgDelhist))));
    html.on("click", "[data-cg]", (ev) => this.onAction(ev.currentTarget.dataset.cg, html));
  }

  async go(i) {
    this.step = Math.max(0, Math.min(STEPS.length - 1, i));
    if (this.actor.isOwner) await this.actor.setFlag("nssq", "chargen", { ...(this.actor.getFlag("nssq", "chargen") ?? {}), step: STEPS[this.step] });
    this.render();
  }

  async setField(path, value) {
    if (path === "system.description") value = value ? `<p>${esc(value).replace(/\n/g, "<br>")}</p>` : "";
    await this.actor.update({ [path]: value });
  }

  async setHistory(fn) {
    await this.actor.update({ "system.history": fn([...(this.actor.system.history ?? [])]) });
  }

  async onAction(a, html) {
    const actor = this.actor;
    switch (a) {
      case "prev": return this.go(this.step - 1);
      case "next": return this.go(this.step + 1);
      case "img": return new FilePicker({ type: "image", current: actor.img, callback: (p) => actor.update({ img: p }) }).render(true);
      case "roll": case "reroll": {
        if (a === "reroll" && !(await Dialog.confirm({ title: L("reroll"), content: `<p>${esc(L("rerollAsk"))}</p>`, rejectClose: false }))) return;
        const { rollAbilityTotals } = await import("./ability-roll.mjs");
        const totals = await rollAbilityTotals(actor);
        if (totals) { await actor.update({ "system.abilityRolls": totals }); this.slots = orderedAssignment(); this._slotsTouched = true; }
        return this.render();
      }
      case "ordered": this.slots = orderedAssignment(); this._slotsTouched = true; return this.render();
      case "random": this.slots = randomAssignment(Math.random); this._slotsTouched = true; return this.render();
      case "assign": {
        if (!isValidAssignment(this.slots)) return;
        const flag = actor.getFlag("nssq", "chargen") ?? {};
        const { applyAbilities } = await import("./ability-roll.mjs");
        // 초기 소지금은 처음 배정할 때만(구입한 뒤 다시 배정해도 소지금이 되돌아가지 않게)
        await applyAbilities(actor, actor.system.abilityRolls, this.slots, { setMoney: !flag.moneySet });
        await actor.setFlag("nssq", "chargen", { ...flag, moneySet: true });
        this._slotsTouched = false;
        ui.notifications.info(L("assigned"));
        return this.render();
      }
      case "noSub": return this.setClasses({ sub: null });
      case "tree": return (await import("./skill-tree.mjs")).SkillTree.open(actor);
      case "shop": return (await import("./shop.mjs")).openShop(actor, { creation: true });
      case "sheet": return actor.sheet.render(true);
      case "career": {
        const r = rollCareer(() => Math.ceil(CONFIG.Dice.randomUniform() * 6), tables.history ?? []);
        await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<div class="nssq-chargen-card"><b>${esc(L("careerHead"))}</b> D666 = ${r.roll}<br>${esc(r.entry?.text ?? "?")}</div>` });
        if (r.entry) await this.setHistory((h) => [...h, r.entry.text]);
        return;
      }
      case "addHist": {
        const t = html[0].querySelector("[data-cg-histtext]")?.value.trim();
        if (t) await this.setHistory((h) => [...h, t]);
        return;
      }
      case "finish": case "finishForce": return this.finish();
    }
  }

  /** 메인·서브 클래스 지정: 클래스 아이템을 맞추고 mainClass·subClass를 고친다(★·HP·TP는 unique-skill.mjs 훅이 맞춘다) */
  async pickClass(role, uuid) {
    const src = await fromUuid(uuid);
    if (!src) return;
    return this.setClasses(role === "main" ? { main: src } : { sub: src });
  }

  async setClasses({ main, sub }) {
    if (this.locked) return;
    const actor = this.actor;
    const cur = actor.system.classItems;
    const want = { main: main === undefined ? cur.main : main, sub: sub === undefined ? cur.sub : sub };
    if (want.sub && want.main && want.sub.system.key === want.main.system.key) want.sub = null;
    const keep = [want.main, want.sub].filter(Boolean).map((c) => c.system.key);
    const del = actor.items.filter((i) => i.type === "class" && !keep.includes(i.system.key)).map((i) => i.id);
    if (del.length) await actor.deleteEmbeddedDocuments("Item", del);
    const have = new Set(actor.items.filter((i) => i.type === "class").map((i) => i.system.key));
    const add = [want.main, want.sub].filter((c) => c && !have.has(c.system.key)).map((c) => { const d = c.toObject(); delete d._id; return d; });
    if (add.length) await actor.createEmbeddedDocuments("Item", add);
    // 클래스가 바뀌면 그 클래스에 속하지 않게 된 스킬은 지운다(커먼·★ 제외는 ★ 동기화가 맞춘다)
    const okKeys = new Set(["common", ...keep]);
    const stray = actor.items.filter((i) => i.type === "skill" && !i.system.unique && !okKeys.has(i.system.classKey)).map((i) => i.id);
    if (stray.length) await actor.deleteEmbeddedDocuments("Item", stray);
    await actor.update({ "system.mainClass": want.main?.system.key ?? "", "system.subClass": want.sub?.system.key ?? null });
    if (stray.length) ui.notifications.info(L("strayRemoved", { n: stray.length }));
  }

  /** 커먼 스킬(선택) 1개 SL1: 다른 커먼 스킬은 지운다. 고른 것을 다시 누르면 지운다 */
  async pickCommon(uuid) {
    if (this.locked) return;
    const src = await fromUuid(uuid);
    if (!src) return;
    const actor = this.actor;
    const owned = actor.items.filter((i) => i.type === "skill" && i.system.classKey === "common");
    const same = owned.some((i) => i.system.skillKey === src.system.skillKey);
    if (owned.length) await actor.deleteEmbeddedDocuments("Item", owned.map((i) => i.id));
    if (same) return;
    const d = game.items.fromCompendium(src);
    d.system.sl = 1;
    foundry.utils.setProperty(d, "_stats.compendiumSource", src.uuid);
    await actor.createEmbeddedDocuments("Item", [d]);
  }

  async finish() {
    const actor = this.actor;
    const s = actor.system;
    await actor.update({ "system.hp.value": s.hp.max, "system.tp.value": s.tp.max, "system.fp.value": 1, "system.creation.locked": true });
    await actor.setFlag("nssq", "chargen", { ...(actor.getFlag("nssq", "chargen") ?? {}), done: true, step: "confirm" });
    const { main, sub } = actor.system.classItems;
    const skills = actor.items.filter((i) => i.type === "skill" && ((i.system.sl ?? 0) > 0 || i.system.unique)).map((i) => `《${i.name}》${i.system.unique ? "★" : i.system.sl}`).join(" ");
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="nssq-chargen-card"><h3><i class="fas fa-flag-checkered"></i> ${esc(L("finished", { name: actor.name }))}</h3>
        <p>${esc(main?.name ?? "")}${sub ? ` / ${esc(sub.name)}` : ""} · ${ABILITIES.map((k) => `${ab(k)} ${actor.system.abilityParts[k].total}`).join(" · ")}</p>
        <p>【HP】 ${actor.system.hp.max} · 【TP】 ${actor.system.tp.max} · ${actor.system.money}G</p><p><small>${esc(skills)}</small></p></div>`
    });
    ui.notifications.info(L("finished", { name: actor.name }));
    this.render();
  }
}

async function uniqueName(classKey) {
  const idx = await game.packs.get("nssq.skills")?.getIndex({ fields: ["system.classKey", "system.unique"] });
  return idx?.find((e) => e.system?.classKey === classKey && e.system?.unique)?.name ?? null;
}

/* ---------------- 새 캐릭터 ---------------- */

/** [캐릭터 작성]: GM·액터 생성 권한이 있으면 바로, 아니면 활성 GM에게 맡긴다 */
export async function newCharacter() {
  if (game.user.isGM || game.user.can("ACTOR_CREATE")) {
    const actor = await Actor.create({ name: L("newName"), type: "character", ownership: game.user.isGM ? {} : { [game.user.id]: 3 } });
    return ChargenWizard.open(actor);
  }
  if (!game.users.activeGM) return ui.notifications.warn(L("noGM"));
  emit("chargenCreate", { userId: game.user.id });
  ui.notifications.info(L("requested"));
}

export function registerChargen() {
  // 플레이어 대신 GM이 만든다 → 그 플레이어에게 마법사를 연다
  onSocket("chargenCreate", async ({ userId }) => {
    if (!isActiveGM()) return;
    const user = game.users.get(userId);
    if (!user) return;
    const actor = await Actor.create({ name: L("newNameOf", { user: user.name }), type: "character", ownership: { default: 0, [userId]: 3 } });
    emit("chargenOpen", { userId, actorId: actor.id });
  });
  onSocket("chargenOpen", ({ userId, actorId }) => {
    if (userId !== game.user.id) return;
    const open = () => { const a = game.actors.get(actorId); if (a?.isOwner) ChargenWizard.open(a); else setTimeout(open, 300); };
    open();
  });
  Hooks.on("renderActorDirectory", (_app, html) => {
    const btn = $(`<button type="button" class="nssq-chargen-btn"><i class="fas fa-user-plus"></i> ${esc(L("newButton"))}</button>`);
    btn.on("click", () => newCharacter());
    html.find(".directory-header .header-actions").append(btn);
  });
  // 액터·아이템이 바뀌면 열린 마법사를 다시 그린다
  const refresh = (actor) => { for (const w of Object.values(ui.windows)) if (w instanceof ChargenWizard && w.actor === actor) w.render(false); };
  Hooks.on("updateActor", (actor) => refresh(actor));
  for (const h of ["createItem", "updateItem", "deleteItem"]) Hooks.on(h, (item) => { if (item.parent) refresh(item.parent); });
}
