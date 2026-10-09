/**
 * 커스텀 스킬·에너미 제작기(GM). v12 Application(v1) 창.
 * - 스킬: 기본 칸(타이밍·분류·대상·사거리·코스트·최대 SL·부위) + 효과 블록(공격·회복·상태 이상·강화·약화·해제·상시 보정·공격 보정·자원·JSON)
 *   → effects 데이터로 저장. 저장 전에 engine/effects/schema.mjs로 검사. review "manual"(효과 동기화가 덮어쓰지 않음)
 *   저장처: 캐릭터·에너미에서 열면 그 액터의 아이템, 아니면 「커스텀 스킬」 폴더의 월드 아이템. 기존 아이템을 열면 그 아이템을 고친다
 * - 에너미: 레벨·희소도·F.O.E.·보스·HP·부능력치·내성·공격 속성·드롭·해설 + 스킬(컴펜디움 에너미 스킬에서 가져오기 / 새로 만들기)
 *   「레벨 평균으로 채우기」: 컴펜디움 같은 레벨 에너미의 평균. 저장처: 「커스텀 에너미」 폴더(기존 액터를 열면 그것)
 */
import { checkEffects, MOD_PATHS } from "../engine/effects/schema.mjs";
import { CONDITIONS } from "../engine/conditions.mjs";
import { BUFFS } from "../engine/buffs.mjs";
import { RESISTS, SUB_STATS } from "../engine/derive.mjs";
import { CHECK_KINDS } from "../chat/check-mods.mjs";
import tables from "../generated/tables.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Maker.${k}`, d) : game.i18n.localize(`NSSQ.Maker.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const loc = (k) => game.i18n.localize(k);
const ELEMENTS = ["slash", "strike", "pierce", "fire", "ice", "volt"];
const opt = (v, cur, label) => `<option value="${esc(v)}" ${String(v) === String(cur ?? "") ? "selected" : ""}>${esc(label)}</option>`;

async function folderFor(type, flag) {
  let f = game.folders.find((x) => x.type === type && x.getFlag("nssq", flag));
  f ??= await Folder.create({ name: L(flag), type, flags: { nssq: { [flag]: true } } });
  return f;
}

/* ---------------- 효과 블록 ---------------- */

/** 블록 종류 → 칸 [경로, 입력 종류, 선택지] */
const BLOCKS = {
  attack: [["kind", "select", ["physical", "elemental"]], ["element", "element"], ["diceMod", "formula"], ["hitMod", "formula"], ["times", "formula"], ["onHit.condition", "condition"], ["onHit.target", "formula"]],
  heal: [["resource", "select", ["hp", "tp"]], ["mode", "select", ["roll", "fixed", "full", "percent"]], ["bonus", "formula"], ["amount", "formula"], ["revive", "bool"]],
  inflict: [["condition", "condition"], ["check.type", "select", ["fixed", "contest", "forced", ""]], ["check.target", "formula"], ["check.atkMod", "formula"], ["depth", "formula"]],
  buff: [["id", "buff"], ["value", "formula"], ["turns", "formula"], ["param", "text"]],
  debuff: [["id", "debuff"], ["value", "formula"], ["turns", "formula"], ["param", "text"]],
  cure: [["kind", "select", ["", "ailment", "bind", "buff", "debuff"]], ["count", "formula"]],
  modifier: [["path", "modpath"], ["value", "formula"]],
  attackBonus: [["hitMod", "formula"], ["diceMod", "formula"], ["atkMod", "formula"], ["critUp", "bool"]],
  resource: [["resource", "select", ["hp", "tp"]], ["delta", "formula"]],
  _json: [["json", "json"]]
};
const COMMON = [["toSelf", "bool"], ["when", "whenJson"]];

const getPath = (o, p) => p.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);
const num = (v) => (v !== "" && v !== null && v !== undefined && !Number.isNaN(Number(v)) ? Number(v) : v);

/** 효과 → 블록(편집용 평면 값) */
function toBlock(e) {
  const t = e?.type;
  if (!BLOCKS[t] || t === "_json") return { type: "_json", json: JSON.stringify(e, null, 1) };
  const b = { type: t };
  for (const [p] of [...BLOCKS[t], ...COMMON]) {
    let v = p.startsWith("onHit.") ? getPath((e.onHit ?? []).find((x) => x.type === "inflict"), p === "onHit.condition" ? "condition" : "check.target") : getPath(e, p);
    if (p === "element") v = Array.isArray(v) ? v[0] : v;
    if (p === "when") v = v ? JSON.stringify(v) : "";
    b[p] = v ?? "";
  }
  // 블록 칸에 없는 필드가 있으면 JSON으로(손실 방지)
  const known = new Set(["type", ...[...BLOCKS[t], ...COMMON].map(([p]) => p.split(".")[0])]);
  if (Object.keys(e).some((k) => !known.has(k)) || (e.onHit ?? []).length > 1) return { type: "_json", json: JSON.stringify(e, null, 1) };
  return b;
}

/** 블록 → 효과(빈 칸은 뺀다). JSON이 틀리면 { error } */
function toEffect(b) {
  if (b.type === "_json") {
    try { return JSON.parse(b.json || "{}"); } catch (err) { return { error: L("jsonBad", { msg: err.message }) }; }
  }
  const e = { type: b.type };
  const set = (p, v) => {
    const ks = p.split(".");
    let o = e;
    ks.slice(0, -1).forEach((k) => { o[k] ??= {}; o = o[k]; });
    o[ks.at(-1)] = v;
  };
  for (const [p, kind] of [...BLOCKS[b.type], ...COMMON]) {
    const v = b[p];
    if (p.startsWith("onHit.")) continue;
    if (kind === "bool") { if (v === true || v === "true") set(p, true); continue; }
    if (v === "" || v === undefined || v === null) continue;
    if (kind === "element") { set(p, [v]); continue; }
    if (kind === "whenJson") { try { e.when = JSON.parse(v); } catch (err) { return { error: L("jsonBad", { msg: err.message }) }; } continue; }
    set(p, kind === "formula" ? num(v) : v);
  }
  if (b.type === "attack" && b["onHit.condition"]) {
    e.onHit = [{ type: "inflict", condition: b["onHit.condition"], check: { type: "fixed", target: num(b["onHit.target"] || "@self.suppAtk+7") } }];
  }
  if (e.check && !e.check.type) delete e.check;
  return e;
}

function fieldHtml(i, b, [p, kind, choices]) {
  const name = `b.${i}.${p}`;
  const label = esc(L(`f.${p}`));
  const v = b[p] ?? "";
  let input;
  switch (kind) {
    case "select": input = `<select name="${name}">${choices.map((c) => opt(c, v, c ? L(`v.${c}`) : L("none"))).join("")}</select>`; break;
    case "element": input = `<select name="${name}">${opt("", v, L("weaponElement"))}${opt("none", v, loc("NSSQ.Combat.noElement"))}${ELEMENTS.map((x) => opt(x, v, loc(`NSSQ.Resist.${x}`))).join("")}</select>`; break;
    case "condition": input = `<select name="${name}">${opt("", v, L("none"))}${Object.keys(CONDITIONS).map((x) => opt(x, v, loc(`NSSQ.Status.${x}`))).join("")}</select>`; break;
    case "buff": case "debuff": input = `<select name="${name}">${Object.entries(BUFFS).filter(([, d]) => d.kind === kind).map(([x]) => opt(x, v, loc(`NSSQ.Buff.${x}`))).join("")}</select>`; break;
    case "modpath": {
      const paths = [...MOD_PATHS, ...CHECK_KINDS.map((k) => `checks.${k}`)];
      input = `<select name="${name}">${paths.map((x) => opt(x, v, pathLabel(x))).join("")}</select>`;
      break;
    }
    case "bool": input = `<input type="checkbox" name="${name}" ${v === true || v === "true" ? "checked" : ""}/>`; break;
    case "json": return `<label class="mk-json"><span>${label}</span><textarea name="${name}" rows="4">${esc(v)}</textarea></label>`;
    default: input = `<input type="text" name="${name}" value="${esc(v)}" placeholder="${kind === "formula" ? esc(L("formulaHint")) : ""}"/>`;
  }
  return `<label><span>${label}</span>${input}</label>`;
}

function pathLabel(p) {
  if (p.startsWith("checks.")) return `${loc("NSSQ.Maker.checkPrefix")} ${loc(`NSSQ.Check.kind.${p.slice(7)}`)}`;
  const [a, b] = p.split(".");
  if (a === "abilities") return loc(`NSSQ.Ability.${b}`);
  if (a === "resist") return `${loc("NSSQ.Resist.label")} ${loc(`NSSQ.Resist.${b}`)}`;
  return SUB_STATS.includes(p) ? loc(`NSSQ.Sub.${p}`) : L(`p.${p}`);
}

/* ---------------- 스킬 제작기 ---------------- */

export class SkillMaker extends Application {
  /** @param {{ item?: Item, actor?: Actor }} o */
  constructor({ item = null, actor = null } = {}, options = {}) {
    super(options);
    this.item = item;
    this.actor = actor ?? item?.parent ?? null;
    const s = item?.system ?? {};
    this.draft = {
      name: item?.name ?? L("newSkill"), img: item?.img ?? "icons/svg/book.svg",
      timing: s.timing || "주행동", category: s.category ?? "-", target: s.target ?? "적 단일", range: s.range ?? "-", part: s.part ?? "-",
      tp: s.cost?.tp ?? 0, fp: s.cost?.fp ?? 0, maxMain: s.maxSL?.main ?? 1, maxSub: s.maxSL?.sub ?? "", sl: s.sl ?? 1,
      description: (s.description ?? "").replace(/<[^>]+>/g, ""), note: s.effectsNote ?? ""
    };
    this.blocks = (s.effects ?? []).map(toBlock);
    if (!this.blocks.length) this.blocks.push(toBlock({ type: "attack", kind: "physical" }));
    this.errors = [];
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, { classes: ["nssq", "nq-window", "nssq-maker"], width: 640, height: 720, resizable: true });
  }

  get title() { return this.item ? L("editSkill", { name: this.item.name }) : L("skillTitle"); }

  async _renderInner() {
    const d = this.draft;
    const timings = ["주행동", "개막", "상시", "수동", "특수"];
    const targets = ["적 단일", "적 열", "적 전체", "적 무작위", "아군 단일", "아군 열", "아군 전체", "자신"];
    const blocks = this.blocks.map((b, i) => `<fieldset class="mk-block"><legend><select name="b.${i}.type" data-btype>${Object.keys(BLOCKS).map((t) => opt(t, b.type, L(`t.${t}`))).join("")}</select>
      <a data-mk="del" data-i="${i}" title="${esc(L("remove"))}"><i class="fas fa-trash"></i></a></legend>
      <div class="mk-fields">${[...BLOCKS[b.type], ...(b.type === "_json" ? [] : COMMON)].map((f) => fieldHtml(i, b, f)).join("")}</div></fieldset>`).join("");
    const errs = this.errors.length ? `<ul class="mk-errors">${this.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : "";
    return $(`<form class="nssq-maker-form" autocomplete="off">
      <div class="mk-row"><img src="${esc(d.img)}" data-mk="img" width="40" height="40" title="${esc(L("img"))}"/><input type="text" name="name" value="${esc(d.name)}"/></div>
      <div class="mk-grid">
        <label><span>${esc(L("timing"))}</span><select name="timing">${timings.map((t) => opt(t, d.timing, t)).join("")}</select></label>
        <label><span>${esc(L("category"))}</span><input type="text" name="category" value="${esc(d.category)}" list="mk-cats"/></label>
        <label><span>${esc(L("target"))}</span><input type="text" name="target" value="${esc(d.target)}" list="mk-targets"/></label>
        <label><span>${esc(L("range"))}</span><select name="range">${["-", "근", "원"].map((r) => opt(r, d.range, r)).join("")}</select></label>
        <label><span>${esc(L("part"))}</span><select name="part">${["-", "머리", "팔", "다리"].map((r) => opt(r, d.part, r)).join("")}</select></label>
        <label><span>TP</span><input type="number" name="tp" value="${d.tp}" min="0"/></label>
        <label><span>FP</span><input type="number" name="fp" value="${d.fp}" min="0"/></label>
        <label><span>${esc(L("maxMain"))}</span><input type="number" name="maxMain" value="${d.maxMain}" min="1"/></label>
        <label><span>${esc(L("maxSub"))}</span><input type="number" name="maxSub" value="${d.maxSub}" min="0"/></label>
        ${this.actor ? `<label><span>SL</span><input type="number" name="sl" value="${d.sl}" min="0"/></label>` : ""}
      </div>
      <datalist id="mk-cats">${["백병", "사격", "술식", "주언", "회복", "방어", "무용", "주가", "호령", "-"].map((c) => `<option value="${c}"></option>`).join("")}</datalist>
      <datalist id="mk-targets">${targets.map((c) => `<option value="${c}"></option>`).join("")}</datalist>
      <label class="mk-desc"><span>${esc(L("description"))}</span><textarea name="description" rows="3">${esc(d.description)}</textarea></label>
      <h3>${esc(L("effects"))} <a data-mk="add"><i class="fas fa-plus"></i> ${esc(L("addBlock"))}</a></h3>
      <p class="notes">${esc(L("effectsHint"))}</p>
      ${blocks}
      <label class="mk-desc"><span>${esc(L("gmNote"))}</span><input type="text" name="note" value="${esc(d.note)}" placeholder="${esc(L("gmNoteHint"))}"/></label>
      ${errs}
      <footer class="mk-foot"><button type="button" data-mk="preview"><i class="fas fa-code"></i> ${esc(L("previewJson"))}</button><button type="button" data-mk="save"><i class="fas fa-save"></i> ${esc(this.item ? L("update") : this.actor ? L("saveTo", { name: this.actor.name }) : L("saveWorld"))}</button></footer>
    </form>`);
  }

  /** 입력값 → draft·blocks */
  read(html) {
    const f = html[0].querySelector("form") ?? html[0];
    const el = (n) => f.querySelector(`[name="${n}"]`);
    const d = this.draft;
    for (const k of ["name", "timing", "category", "target", "range", "part", "description", "note"]) if (el(k)) d[k] = el(k).value;
    for (const k of ["tp", "fp", "maxMain", "sl"]) if (el(k)) d[k] = Number(el(k).value) || 0;
    if (el("maxSub")) d.maxSub = el("maxSub").value === "" ? "" : Number(el("maxSub").value);
    f.querySelectorAll("[name^='b.']").forEach((el) => {
      const [, i, ...rest] = el.name.split(".");
      const p = rest.join(".");
      const b = this.blocks[Number(i)];
      if (!b || p === "type") return;
      b[p] = el.type === "checkbox" ? el.checked : el.value;
    });
  }

  effects() {
    const list = this.blocks.map(toEffect);
    const bad = list.filter((e) => e?.error).map((e) => e.error);
    const errors = bad.length ? bad : checkEffects(list, this.draft.name, []);
    return { list, errors };
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.on("change", "[data-btype]", (ev) => {
      this.read(html);
      const i = Number(ev.currentTarget.name.split(".")[1]);
      this.blocks[i] = toBlock({ type: ev.currentTarget.value });
      if (ev.currentTarget.value === "_json") this.blocks[i] = { type: "_json", json: "{\n \"type\": \"\"\n}" };
      this.render();
    });
    html.on("click", "[data-mk]", async (ev) => {
      const a = ev.currentTarget.dataset.mk;
      this.read(html);
      if (a === "add") { this.blocks.push(toBlock({ type: "attack", kind: "physical" })); return this.render(); }
      if (a === "del") { this.blocks.splice(Number(ev.currentTarget.dataset.i), 1); return this.render(); }
      if (a === "img") return new FilePicker({ type: "image", current: this.draft.img, callback: (p) => { this.draft.img = p; this.render(); } }).render(true);
      if (a === "preview") {
        const { list, errors } = this.effects();
        this.errors = errors;
        this.render();
        return Dialog.prompt({ title: L("previewJson"), content: `<pre class="mk-pre">${esc(JSON.stringify(list, null, 1))}</pre>`, rejectClose: false });
      }
      if (a === "save") return this.save();
    });
  }

  async save() {
    const { list, errors } = this.effects();
    this.errors = errors;
    if (errors.length) { this.render(); return ui.notifications.warn(L("hasErrors", { n: errors.length })); }
    const d = this.draft;
    const system = {
      timing: d.timing, category: d.category || "-", target: d.target || "-", range: d.range, part: d.part,
      cost: { tp: d.tp, fp: d.fp }, maxSL: { main: Math.max(1, d.maxMain), sub: d.maxSub === "" ? null : d.maxSub },
      description: d.description ? `<p>${esc(d.description).replace(/\n/g, "<br>")}</p>` : "",
      effects: list, review: d.note ? "partial" : "manual", effectsNote: d.note
    };
    if (this.actor) system.sl = d.sl;
    if (this.item) await this.item.update({ name: d.name, img: d.img, system });
    else {
      const data = { name: d.name, img: d.img, type: "skill", system: { ...system, key: `custom.${foundry.utils.randomID(8)}` } };
      this.item = this.actor ? (await this.actor.createEmbeddedDocuments("Item", [data]))[0] : await Item.create({ ...data, folder: (await folderFor("Item", "customSkills")).id });
    }
    ui.notifications.info(L("saved", { name: d.name }));
    this.onSaved?.(this.item);
    return this.close();
  }
}

/* ---------------- 에너미 제작기 ---------------- */

export class EnemyMaker extends Application {
  constructor({ actor = null } = {}, options = {}) {
    super(options);
    this.actor = actor;
    const s = actor?.system ?? {};
    this.draft = {
      name: actor?.name ?? L("newEnemy"), img: actor?.img ?? "icons/svg/mystery-man.svg",
      level: s.level ?? 1, rarity: s.rarity ?? 0, isFOE: !!s.isFOE, isBoss: !!s.isBoss, hp: s.hpMaxBase ?? s.hp?.max ?? 10,
      stats: { ...Object.fromEntries(SUB_STATS.map((k) => [k, 0])), ...(s.stats ?? {}) },
      resist: { ...Object.fromEntries(RESISTS.map((k) => [k, 3])), ...(s.resist ?? {}) },
      attackElements: [...(s.attackElements ?? ["strike"])],
      drops: foundry.utils.deepClone(s.drops ?? [{ min: 4, max: 7, item: "", rank: 1 }, { min: 8, max: null, item: "", rank: 1 }]),
      description: (s.description ?? "").replace(/<[^>]+>/g, "")
    };
    this.skills = actor ? actor.items.filter((i) => i.type === "skill").map((i) => i.toObject()) : [];
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, { classes: ["nssq", "nq-window", "nssq-maker"], width: 640, height: 760, resizable: true });
  }

  get title() { return this.actor ? L("editEnemy", { name: this.actor.name }) : L("enemyTitle"); }

  async _renderInner() {
    const d = this.draft;
    const items = [...new Set([...tables.materials, ...(game.packs.get("nssq.items")?.index?.map((i) => i.name) ?? [])])];
    const drops = d.drops.map((r, i) => `<tr><td><input type="number" name="drop.${i}.min" value="${r.min}"/></td><td><input type="number" name="drop.${i}.max" value="${r.max ?? ""}" placeholder="~"/></td>
      <td><input type="text" name="drop.${i}.item" value="${esc(r.item)}" list="mk-items"/></td><td><input type="number" name="drop.${i}.rank" value="${r.rank ?? ""}"/></td><td><a data-mk="dropDel" data-i="${i}"><i class="fas fa-trash"></i></a></td></tr>`).join("");
    const skills = this.skills.map((s, i) => `<li>${esc(s.name)} <small>${esc(s.system.timing)} ${esc(s.system.target)}</small> <a data-mk="skillEdit" data-i="${i}" title="${esc(L("edit"))}"><i class="fas fa-edit"></i></a> <a data-mk="skillDel" data-i="${i}"><i class="fas fa-trash"></i></a></li>`).join("") || `<li class="notes">${esc(L("noSkills"))}</li>`;
    return $(`<form class="nssq-maker-form" autocomplete="off">
      <div class="mk-row"><img src="${esc(d.img)}" data-mk="img" width="48" height="48" title="${esc(L("img"))}"/><input type="text" name="name" value="${esc(d.name)}"/></div>
      <div class="mk-grid">
        <label><span>Lv</span><input type="number" name="level" value="${d.level}" min="1"/></label>
        <label><span>${esc(loc("NSSQ.Rarity"))}</span><input type="number" name="rarity" value="${d.rarity}"/></label>
        <label><span>HP</span><input type="number" name="hp" value="${d.hp}" min="1"/></label>
        <label><span>${esc(loc("NSSQ.FOE"))}</span><input type="checkbox" name="isFOE" ${d.isFOE ? "checked" : ""}/></label>
        <label><span>${esc(loc("NSSQ.Boss"))}</span><input type="checkbox" name="isBoss" ${d.isBoss ? "checked" : ""}/></label>
      </div>
      <div class="mk-tools"><button type="button" data-mk="avg"><i class="fas fa-magic"></i> ${esc(L("fillAverage"))}</button>
        <select name="copyFrom"><option value="">${esc(L("copyFrom"))}</option></select><button type="button" data-mk="copy">${esc(L("copy"))}</button></div>
      <h3>${esc(loc("NSSQ.Sub.label"))}</h3>
      <div class="mk-grid">${SUB_STATS.map((k) => `<label><span>${esc(loc(`NSSQ.Sub.${k}`))}</span><input type="number" name="stats.${k}" value="${d.stats[k] ?? 0}"/></label>`).join("")}</div>
      <h3>${esc(loc("NSSQ.Resist.label"))}</h3>
      <div class="mk-grid">${RESISTS.map((k) => `<label><span>${esc(loc(`NSSQ.Resist.${k}`))}</span><input type="number" name="resist.${k}" value="${d.resist[k] ?? 3}"/></label>`).join("")}</div>
      <h3>${esc(L("attackElements"))}</h3>
      <div class="mk-grid">${ELEMENTS.map((k) => `<label><span>${esc(loc(`NSSQ.Resist.${k}`))}</span><input type="checkbox" name="el.${k}" ${d.attackElements.includes(k) ? "checked" : ""}/></label>`).join("")}</div>
      <h3>DROP <a data-mk="dropAdd"><i class="fas fa-plus"></i></a></h3>
      <table class="mk-drops"><thead><tr><th>${esc(L("dropMin"))}</th><th>${esc(L("dropMax"))}</th><th>${esc(L("dropItem"))}</th><th>R</th><th></th></tr></thead><tbody>${drops}</tbody></table>
      <datalist id="mk-items">${items.map((n) => `<option value="${esc(n)}"></option>`).join("")}</datalist>
      <h3>${esc(L("skills"))} <a data-mk="skillNew"><i class="fas fa-plus"></i> ${esc(L("newSkill"))}</a></h3>
      <ul class="mk-skills">${skills}</ul>
      <div class="mk-tools"><select name="libSkill"><option value="">${esc(L("fromLibrary"))}</option></select><button type="button" data-mk="skillLib">${esc(L("addSkill"))}</button></div>
      <label class="mk-desc"><span>${esc(L("description"))}</span><textarea name="description" rows="3">${esc(d.description)}</textarea></label>
      <footer class="mk-foot"><button type="button" data-mk="save"><i class="fas fa-save"></i> ${esc(this.actor ? L("update") : L("saveEnemy"))}</button></footer>
    </form>`);
  }

  read(html) {
    const f = html[0].querySelector("form") ?? html[0];
    const el = (n) => f.querySelector(`[name="${n}"]`);
    const d = this.draft;
    d.name = el("name").value; d.description = el("description").value;
    d.level = Number(el("level").value) || 1; d.rarity = Number(el("rarity").value) || 0; d.hp = Math.max(1, Number(el("hp").value) || 1);
    d.isFOE = el("isFOE").checked; d.isBoss = el("isBoss").checked;
    for (const k of SUB_STATS) d.stats[k] = Number(el(`stats.${k}`).value) || 0;
    for (const k of RESISTS) d.resist[k] = Number(el(`resist.${k}`).value) || 0;
    d.attackElements = ELEMENTS.filter((k) => el(`el.${k}`).checked);
    d.drops.forEach((r, i) => {
      r.min = Number(el(`drop.${i}.min`).value) || 0;
      r.max = el(`drop.${i}.max`).value === "" ? null : Number(el(`drop.${i}.max`).value);
      r.item = el(`drop.${i}.item`).value.trim();
      r.rank = el(`drop.${i}.rank`).value === "" ? null : Number(el(`drop.${i}.rank`).value);
    });
  }

  async libraryEnemies() {
    this._lib ??= ((await game.packs.get("nssq.enemies")?.getDocuments()) ?? []).filter((a) => a.type === "enemy");
    return this._lib;
  }

  activateListeners(html) {
    super.activateListeners(html);
    // 컴펜디움 목록은 비동기로 채운다
    this.libraryEnemies().then((lib) => {
      const copy = html[0].querySelector("[name=copyFrom]");
      const skill = html[0].querySelector("[name=libSkill]");
      for (const a of lib) copy?.insertAdjacentHTML("beforeend", opt(a.id, "", `Lv${a.system.level} ${a.name}`));
      for (const a of lib) for (const i of a.items.filter((x) => x.type === "skill")) skill?.insertAdjacentHTML("beforeend", opt(`${a.id}.${i.id}`, "", `${a.name} / ${i.name}`));
    });
    html.on("click", "[data-mk]", async (ev) => {
      const a = ev.currentTarget.dataset.mk;
      const i = Number(ev.currentTarget.dataset.i);
      this.read(html);
      const d = this.draft;
      switch (a) {
        case "img": return new FilePicker({ type: "image", current: d.img, callback: (p) => { d.img = p; this.render(); } }).render(true);
        case "dropAdd": d.drops.push({ min: (d.drops.at(-1)?.max ?? 7) + 1, max: null, item: "", rank: d.level }); return this.render();
        case "dropDel": d.drops.splice(i, 1); return this.render();
        case "skillDel": this.skills.splice(i, 1); return this.render();
        case "avg": return this.fillAverage();
        case "copy": return this.copyFrom(html[0].querySelector("[name=copyFrom]").value);
        case "skillLib": {
          const [aid, iid] = String(html[0].querySelector("[name=libSkill]").value).split(".");
          const src = (await this.libraryEnemies()).find((x) => x.id === aid)?.items.get(iid);
          if (src) { const o = src.toObject(); delete o._id; this.skills.push(o); }
          return this.render();
        }
        case "skillNew":
        case "skillEdit": {
          const data = a === "skillEdit" ? this.skills[i] : null;
          // 아직 저장 전인 에너미의 스킬은 임시 아이템 없이 제작기 결과를 받아 목록에 넣는다
          const temp = data ? new Item.implementation(data) : null;
          const m = new SkillMaker({ item: null });
          if (temp) { const t = new SkillMaker({ item: temp }); m.draft = t.draft; m.blocks = t.blocks; }
          m.save = async () => {
            const { list, errors } = m.effects();
            m.errors = errors;
            if (errors.length) { m.render(); return ui.notifications.warn(L("hasErrors", { n: errors.length })); }
            const dd = m.draft;
            const o = { ...(data ?? {}), name: dd.name, img: dd.img, type: "skill", system: { ...(data?.system ?? {}), timing: dd.timing, category: dd.category || "-", target: dd.target || "-", range: dd.range, part: dd.part, cost: { tp: dd.tp, fp: dd.fp }, maxSL: { main: Math.max(1, dd.maxMain), sub: dd.maxSub === "" ? null : dd.maxSub }, sl: 1, description: dd.description ? `<p>${esc(dd.description)}</p>` : "", effects: list, review: dd.note ? "partial" : "manual", effectsNote: dd.note, key: data?.system?.key || `custom.${foundry.utils.randomID(8)}` } };
            if (a === "skillEdit") this.skills[i] = o; else this.skills.push(o);
            m.close();
            this.render();
          };
          return m.render(true);
        }
        case "save": return this.save();
      }
    });
  }

  /** 컴펜디움 같은 레벨(없으면 가장 가까운) 일반 에너미의 평균 */
  async fillAverage() {
    const lib = (await this.libraryEnemies()).filter((a) => !a.system.isFOE);
    const lvs = [...new Set(lib.map((a) => a.system.level))];
    const lv = lvs.sort((x, y) => Math.abs(x - this.draft.level) - Math.abs(y - this.draft.level))[0];
    const same = lib.filter((a) => a.system.level === lv);
    if (!same.length) return;
    const avg = (f) => Math.round(same.reduce((n, a) => n + f(a), 0) / same.length);
    this.draft.hp = avg((a) => a.system.hp.max);
    for (const k of SUB_STATS) this.draft.stats[k] = avg((a) => a.system.stats[k] ?? 0);
    for (const k of RESISTS) this.draft.resist[k] = avg((a) => a.system.resist[k] ?? 3);
    ui.notifications.info(L("averaged", { lv, n: same.length }));
    this.render();
  }

  async copyFrom(id) {
    const a = (await this.libraryEnemies()).find((x) => x.id === id);
    if (!a) return;
    const s = a.system;
    Object.assign(this.draft, { level: s.level, rarity: s.rarity, isFOE: s.isFOE, hp: s.hp.max, stats: { ...s.stats }, resist: { ...s.resist }, attackElements: [...s.attackElements], drops: foundry.utils.deepClone(s.drops), img: a.img });
    this.skills = a.items.filter((i) => i.type === "skill").map((i) => { const o = i.toObject(); delete o._id; return o; });
    this.render();
  }

  async save() {
    const d = this.draft;
    const system = {
      level: d.level, rarity: d.rarity, isFOE: d.isFOE, isBoss: d.isBoss, hp: { value: d.hp, max: d.hp }, stats: d.stats, resist: d.resist,
      attackElements: d.attackElements.length ? d.attackElements : ["strike"], drops: d.drops.filter((r) => r.item),
      description: d.description ? `<p>${esc(d.description).replace(/\n/g, "<br>")}</p>` : ""
    };
    if (this.actor) {
      await this.actor.update({ name: d.name, img: d.img, system, "prototypeToken.name": d.name, "prototypeToken.texture.src": d.img });
      const keep = new Set(this.skills.map((s) => s._id).filter(Boolean));
      const del = this.actor.items.filter((i) => i.type === "skill" && !keep.has(i.id)).map((i) => i.id);
      if (del.length) await this.actor.deleteEmbeddedDocuments("Item", del);
      const upd = this.skills.filter((s) => s._id && this.actor.items.get(s._id));
      if (upd.length) await this.actor.updateEmbeddedDocuments("Item", upd);
      const add = this.skills.filter((s) => !s._id || !this.actor.items.get(s._id));
      if (add.length) await this.actor.createEmbeddedDocuments("Item", add.map((s) => { const o = { ...s }; delete o._id; return o; }));
    } else {
      this.actor = await Actor.create({
        name: d.name, img: d.img, type: "enemy", system, folder: (await folderFor("Actor", "customEnemies")).id,
        prototypeToken: { name: d.name, texture: { src: d.img }, actorLink: false },
        items: this.skills.map((s) => { const o = { ...s }; delete o._id; return o; }),
        flags: { nssq: { custom: true } }
      });
    }
    ui.notifications.info(L("saved", { name: d.name }));
    this.close();
    return this.actor;
  }
}

export const openSkillMaker = (o = {}) => game.user.isGM && new SkillMaker(o).render(true);
export const openEnemyMaker = (o = {}) => game.user.isGM && new EnemyMaker(o).render(true);
