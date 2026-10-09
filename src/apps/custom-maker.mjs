/**
 * 커스텀 스킬·에너미 제작기(GM). v12 Application(v1) 창.
 * - 스킬: 기본 칸(타이밍·분류·대상·사거리·코스트·최대 SL·부위) + 효과 블록(공격·회복·상태 이상·강화·약화·해제·상시 보정·공격 보정·자원·JSON)
 *   → effects 데이터로 저장. 저장 전에 engine/effects/schema.mjs로 검사. review "manual"(효과 동기화가 덮어쓰지 않음)
 *   저장처: 캐릭터·에너미에서 열면 그 액터의 아이템, 아니면 「커스텀 스킬」 폴더의 월드 아이템. 기존 아이템을 열면 그 아이템을 고친다
 *   「불러오기」: 기존 스킬(컴펜디움 클래스·에너미 스킬, 월드)을 바탕으로 초안을 채운다. 효과 블록은 순서 바꾸기·복제·삭제
 *   「사본으로 저장」: 기존 아이템을 고치지 않고 새 아이템으로
 * - 에너미: 레벨·희소도·F.O.E.·보스·HP·부능력치·내성·공격 속성·드롭·해설 + 스킬 목록(순서 바꾸기·복제·편집·삭제, 아무 스킬이나 가져오기)
 *   「불러오기」: 기존 에너미(월드·컴펜디움)를 바탕으로. 「레벨 평균으로 채우기」: 컴펜디움 같은 레벨 에너미의 평균
 *   저장처: 「커스텀 에너미」 폴더(기존 액터를 열면 그것, 「사본으로 저장」이면 새 액터)
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

/* ---------------- 불러오기 목록 ---------------- */

let skillLib = null;
let enemyLib = null;

/** 불러올 수 있는 스킬: 월드 스킬 아이템·월드 에너미 스킬·컴펜디움 클래스 스킬·컴펜디움 에너미 스킬 → [{ uuid, label }] */
async function skillLibrary() {
  if (!skillLib) {
    const out = [];
    const classes = await game.packs.get("nssq.classes")?.getIndex({ fields: ["system.key"] });
    const className = (k) => (k === "common" ? L("commonSkill") : classes?.find((c) => c.system?.key === k)?.name ?? k);
    const pack = await game.packs.get("nssq.skills")?.getIndex({ fields: ["system.classKey"] });
    for (const i of pack ?? []) out.push({ uuid: i.uuid, label: `${className(i.system?.classKey)} 《${i.name}》` });
    for (const a of await enemyLibrary()) for (const i of a.items.filter((x) => x.type === "skill")) out.push({ uuid: i.uuid, label: `${a.name} / ${i.name}` });
    skillLib = out;
  }
  // 월드 쪽은 바뀔 수 있어 매번 붙인다
  const world = [
    ...game.items.filter((i) => i.type === "skill").map((i) => ({ uuid: i.uuid, label: `${L("world")} 《${i.name}》` })),
    ...game.actors.filter((a) => a.type === "enemy").flatMap((a) => a.items.filter((i) => i.type === "skill").map((i) => ({ uuid: i.uuid, label: `${L("world")} ${a.name} / ${i.name}` })))
  ];
  return [...world, ...skillLib];
}

/** 불러올 수 있는 에너미: 월드 에너미 + 컴펜디움 */
async function enemyLibrary() {
  enemyLib ??= ((await game.packs.get("nssq.enemies")?.getDocuments()) ?? []).filter((a) => a.type === "enemy");
  return enemyLib;
}

/** 검색 칸(datalist) + 불러오기 버튼. 고른 라벨 → uuid는 pickUuid로 */
const pickerHtml = (name, placeholder, action) => `<div class="mk-tools"><input type="text" name="${name}" list="${name}-list" placeholder="${esc(placeholder)}"/><datalist id="${name}-list"></datalist><button type="button" data-mk="${action}"><i class="fas fa-file-import"></i> ${esc(L("load"))}</button></div>`;
function fillPicker(html, name, list) {
  const dl = html[0].querySelector(`#${name}-list`);
  if (dl) dl.innerHTML = list.map((x) => `<option value="${esc(x.label)}"></option>`).join("");
}
const pickUuid = (html, name, list) => {
  const v = html[0].querySelector(`[name=${name}]`)?.value.trim();
  return list.find((x) => x.label === v)?.uuid ?? null;
};
/** 배열 안에서 i를 d만큼 옮긴다 */
const move = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; };

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
    this.load(item);
    this.errors = [];
  }

  /** 스킬(아이템 또는 그 데이터) → draft·blocks. 없으면 빈 새 스킬 */
  load(src) {
    const s = src?.system ?? {};
    // 원본의 저장 데이터(파생값 제외). 데이터 객체면 그대로 복사
    this.base = src?.toObject ? src.toObject().system : foundry.utils.deepClone(s);
    this.draft = {
      name: src?.name ?? L("newSkill"), img: src?.img ?? "icons/svg/book.svg",
      timing: s.timing || "주행동", category: s.category ?? "-", target: s.target ?? "적 단일", range: s.range ?? "-", part: s.part ?? "-",
      tp: s.cost?.tp ?? 0, fp: s.cost?.fp ?? 0, maxMain: s.maxSL?.main ?? 1, maxSub: s.maxSL?.sub ?? "", sl: this.draft?.sl ?? s.sl ?? 1,
      description: (s.description ?? "").replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, ""), note: s.effectsNote ?? ""
    };
    this.blocks = (s.effects ?? []).map(toBlock);
    if (!this.blocks.length) this.blocks.push(toBlock({ type: "attack", kind: "physical" }));
  }

  /** 불러온 스킬로 지금 초안을 바꾼다(저장처는 그대로) */
  async loadFrom(uuid) {
    const src = uuid && (await fromUuid(uuid));
    if (!src) return ui.notifications.warn(L("pickFirst"));
    this.load(src);
    // 지금 고치는 아이템의 키는 유지(원본 스킬과 키가 겹치지 않게)
    this.base.key = this.item?.system?.key ?? "";
    this.loaded = src.name;
    ui.notifications.info(L("loaded", { name: src.name }));
    this.render();
  }

  /** 저장할 system(불러온 원본의 그 밖의 필드는 유지) */
  systemData(list) {
    const d = this.draft;
    const keep = foundry.utils.deepClone(this.base ?? {});
    for (const k of ["sl", "effects", "review", "effectsNote", "description"]) delete keep[k];
    return {
      ...keep, timing: d.timing, category: d.category || "-", target: d.target || "-", range: d.range, part: d.part,
      cost: { tp: d.tp, fp: d.fp }, maxSL: { main: Math.max(1, d.maxMain), sub: d.maxSub === "" ? null : d.maxSub },
      description: d.description ? `<p>${esc(d.description).replace(/\n/g, "<br>")}</p>` : "",
      effects: list, review: d.note ? "partial" : "manual", effectsNote: d.note
    };
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
      <a data-mk="up" data-i="${i}" title="${esc(L("up"))}"><i class="fas fa-arrow-up"></i></a> <a data-mk="down" data-i="${i}" title="${esc(L("down"))}"><i class="fas fa-arrow-down"></i></a>
      <a data-mk="dup" data-i="${i}" title="${esc(L("duplicate"))}"><i class="fas fa-clone"></i></a> <a data-mk="del" data-i="${i}" title="${esc(L("remove"))}"><i class="fas fa-trash"></i></a></legend>
      <div class="mk-fields">${[...BLOCKS[b.type], ...(b.type === "_json" ? [] : COMMON)].map((f) => fieldHtml(i, b, f)).join("")}</div></fieldset>`).join("");
    const errs = this.errors.length ? `<ul class="mk-errors">${this.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : "";
    return $(`<form class="nssq-maker-form" autocomplete="off">
      ${pickerHtml("loadSkill", L("loadSkill"), "loadSkill")}
      ${this.loaded ? `<p class="notes">${esc(L("loadedFrom", { name: this.loaded }))}</p>` : ""}
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
      <footer class="mk-foot"><button type="button" data-mk="preview"><i class="fas fa-code"></i> ${esc(L("previewJson"))}</button>${this.item && !this.noCopy ? `<button type="button" data-mk="saveCopy"><i class="fas fa-copy"></i> ${esc(this.actor ? L("saveCopyTo", { name: this.actor.name }) : L("saveCopy"))}</button>` : ""}<button type="button" data-mk="save"><i class="fas fa-save"></i> ${esc(this.item ? L("update") : this.actor ? L("saveTo", { name: this.actor.name }) : L("saveWorld"))}</button></footer>
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
    skillLibrary().then((lib) => { this._lib = lib; fillPicker(html, "loadSkill", lib); });
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
      const i = Number(ev.currentTarget.dataset.i);
      if (a === "del") { this.blocks.splice(i, 1); return this.render(); }
      if (a === "up" || a === "down") { move(this.blocks, i, a === "up" ? -1 : 1); return this.render(); }
      if (a === "dup") { this.blocks.splice(i + 1, 0, foundry.utils.deepClone(this.blocks[i])); return this.render(); }
      if (a === "loadSkill") return this.loadFrom(pickUuid(html, "loadSkill", this._lib ?? []));
      if (a === "saveCopy") return this.save({ copy: true });
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

  async save({ copy = false } = {}) {
    const { list, errors } = this.effects();
    this.errors = errors;
    if (errors.length) { this.render(); return ui.notifications.warn(L("hasErrors", { n: errors.length })); }
    const d = this.draft;
    const system = this.systemData(list);
    if (this.actor) system.sl = d.sl;
    if (this.item && !copy) await this.item.update({ name: d.name, img: d.img, system });
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
    this.load(actor);
  }

  /** 에너미(액터) → draft·skills. 없으면 빈 새 에너미 */
  load(src) {
    const s = src?.system ?? {};
    // 원본의 저장 데이터(파생값 제외). 데이터 객체면 그대로 복사
    this.base = src?.toObject ? src.toObject().system : foundry.utils.deepClone(s);
    this.draft = {
      name: src?.name ?? L("newEnemy"), img: src?.img ?? "icons/svg/mystery-man.svg",
      level: s.level ?? 1, rarity: s.rarity ?? 0, isFOE: !!s.isFOE, isBoss: !!s.isBoss, hp: s.hpMaxBase ?? s.hp?.max ?? 10,
      stats: { ...Object.fromEntries(SUB_STATS.map((k) => [k, 0])), ...(s.stats ?? {}) },
      resist: { ...Object.fromEntries(RESISTS.map((k) => [k, 3])), ...(s.resist ?? {}) },
      attackElements: [...(s.attackElements ?? ["strike"])],
      drops: foundry.utils.deepClone(s.drops ?? [{ min: 4, max: 7, item: "", rank: 1 }, { min: 8, max: null, item: "", rank: 1 }]),
      description: (s.description ?? "").replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "")
    };
    const own = src && src === this.actor;
    this.skills = (src?.items ?? []).filter((i) => i.type === "skill").sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
      .map((i) => { const o = i.toObject(); if (!own) delete o._id; return o; });
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
    const n = this.skills.length;
    const skills = this.skills.map((s, i) => `<li><span class="mk-skill-name">${esc(s.name)} <small>${esc(s.system.timing)} ${esc(s.system.target)}</small></span>
      <a data-mk="skillUp" data-i="${i}" title="${esc(L("up"))}" ${i ? "" : "class=\"disabled\""}><i class="fas fa-arrow-up"></i></a>
      <a data-mk="skillDown" data-i="${i}" title="${esc(L("down"))}" ${i < n - 1 ? "" : "class=\"disabled\""}><i class="fas fa-arrow-down"></i></a>
      <a data-mk="skillEdit" data-i="${i}" title="${esc(L("edit"))}"><i class="fas fa-edit"></i></a>
      <a data-mk="skillDup" data-i="${i}" title="${esc(L("duplicate"))}"><i class="fas fa-clone"></i></a>
      <a data-mk="skillDel" data-i="${i}" title="${esc(L("remove"))}"><i class="fas fa-trash"></i></a></li>`).join("") || `<li class="notes">${esc(L("noSkills"))}</li>`;
    return $(`<form class="nssq-maker-form" autocomplete="off">
      ${pickerHtml("loadEnemy", L("loadEnemy"), "loadEnemy")}
      ${this.loaded ? `<p class="notes">${esc(L("loadedFrom", { name: this.loaded }))}</p>` : ""}
      <div class="mk-row"><img src="${esc(d.img)}" data-mk="img" width="48" height="48" title="${esc(L("img"))}"/><input type="text" name="name" value="${esc(d.name)}"/></div>
      <div class="mk-grid">
        <label><span>Lv</span><input type="number" name="level" value="${d.level}" min="1"/></label>
        <label><span>${esc(loc("NSSQ.Rarity"))}</span><input type="number" name="rarity" value="${d.rarity}"/></label>
        <label><span>HP</span><input type="number" name="hp" value="${d.hp}" min="1"/></label>
        <label><span>${esc(loc("NSSQ.FOE"))}</span><input type="checkbox" name="isFOE" ${d.isFOE ? "checked" : ""}/></label>
        <label><span>${esc(loc("NSSQ.Boss"))}</span><input type="checkbox" name="isBoss" ${d.isBoss ? "checked" : ""}/></label>
      </div>
      <div class="mk-tools"><button type="button" data-mk="avg"><i class="fas fa-magic"></i> ${esc(L("fillAverage"))}</button></div>
      <h3>${esc(loc("NSSQ.Sub.label"))}</h3>
      <div class="mk-grid">${SUB_STATS.map((k) => `<label><span>${esc(loc(`NSSQ.Sub.${k}`))}</span><input type="number" name="stats.${k}" value="${d.stats[k] ?? 0}"/></label>`).join("")}</div>
      <h3>${esc(loc("NSSQ.Resist.label"))}</h3>
      <div class="mk-grid">${RESISTS.map((k) => `<label><span>${esc(loc(`NSSQ.Resist.${k}`))}</span><input type="number" name="resist.${k}" value="${d.resist[k] ?? 3}"/></label>`).join("")}</div>
      <h3>${esc(L("attackElements"))}</h3>
      <div class="mk-grid">${ELEMENTS.map((k) => `<label><span>${esc(loc(`NSSQ.Resist.${k}`))}</span><input type="checkbox" name="el.${k}" ${d.attackElements.includes(k) ? "checked" : ""}/></label>`).join("")}</div>
      <h3>DROP <a data-mk="dropAdd"><i class="fas fa-plus"></i></a></h3>
      <table class="mk-drops"><thead><tr><th>${esc(L("dropMin"))}</th><th>${esc(L("dropMax"))}</th><th>${esc(L("dropItem"))}</th><th>R</th><th></th></tr></thead><tbody>${drops}</tbody></table>
      <datalist id="mk-items">${items.map((x) => `<option value="${esc(x)}"></option>`).join("")}</datalist>
      <h3>${esc(L("skills"))} <a data-mk="skillNew"><i class="fas fa-plus"></i> ${esc(L("newSkill"))}</a></h3>
      <ul class="mk-skills">${skills}</ul>
      ${pickerHtml("libSkill", L("fromLibrary"), "skillLib")}
      <p class="notes">${esc(L("skillLibHint"))}</p>
      <label class="mk-desc"><span>${esc(L("description"))}</span><textarea name="description" rows="3">${esc(d.description)}</textarea></label>
      <footer class="mk-foot">${this.actor ? `<button type="button" data-mk="saveCopy"><i class="fas fa-copy"></i> ${esc(L("saveCopy"))}</button>` : ""}<button type="button" data-mk="save"><i class="fas fa-save"></i> ${esc(this.actor ? L("update") : L("saveEnemy"))}</button></footer>
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

  /** 불러올 에너미 목록: 월드 + 컴펜디움 */
  async enemyChoices() {
    const world = game.actors.filter((a) => a.type === "enemy").map((a) => ({ uuid: a.uuid, label: `${L("world")} Lv${a.system.level} ${a.name}` }));
    return [...world, ...(await enemyLibrary()).map((a) => ({ uuid: a.uuid, label: `Lv${a.system.level} ${a.name}` }))];
  }

  activateListeners(html) {
    super.activateListeners(html);
    // 목록은 비동기로 채운다
    this.enemyChoices().then((lib) => { this._enemies = lib; fillPicker(html, "loadEnemy", lib); });
    skillLibrary().then((lib) => { this._skills = lib; fillPicker(html, "libSkill", lib); });
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
        case "skillUp": move(this.skills, i, -1); return this.render();
        case "skillDown": move(this.skills, i, 1); return this.render();
        case "skillDup": {
          const o = foundry.utils.deepClone(this.skills[i]);
          delete o._id;
          o.name = L("copyName", { name: o.name });
          o.system.key = `custom.${foundry.utils.randomID(8)}`;
          this.skills.splice(i + 1, 0, o);
          return this.render();
        }
        case "avg": return this.fillAverage();
        case "loadEnemy": return this.loadFrom(pickUuid(html, "loadEnemy", this._enemies ?? []));
        case "skillLib": {
          const src = await fromUuid(pickUuid(html, "libSkill", this._skills ?? []) ?? "");
          if (!src) return ui.notifications.warn(L("pickFirst"));
          const o = src.toObject();
          delete o._id;
          o.system.sl = Math.max(1, o.system.sl ?? 1);
          this.skills.push(o);
          return this.render();
        }
        case "skillNew":
        case "skillEdit": return this.editSkill(a === "skillEdit" ? i : null);
        case "save": return this.save();
        case "saveCopy": return this.save({ copy: true });
      }
    });
  }

  /** 스킬 하나를 제작기로 고친다(i가 null이면 새로). 결과는 목록에만 넣고, 에너미 저장 때 반영 */
  editSkill(i) {
    const data = i === null ? null : this.skills[i];
    const m = new SkillMaker({ item: null });
    m.noCopy = true;
    if (data) { m.load(data); m.draft.sl = data.system.sl ?? 1; }
    m.save = async () => {
      const { list, errors } = m.effects();
      m.errors = errors;
      if (errors.length) { m.render(); return ui.notifications.warn(L("hasErrors", { n: errors.length })); }
      const dd = m.draft;
      const o = { ...(data ?? {}), name: dd.name, img: dd.img, type: "skill",
        system: { ...m.systemData(list), sl: Math.max(1, data?.system?.sl ?? 1), key: data?.system?.key || `custom.${foundry.utils.randomID(8)}` } };
      if (i === null) this.skills.push(o); else this.skills[i] = o;
      m.close();
      this.render();
    };
    return m.render(true);
  }

  /** 기존 에너미를 바탕으로(이름·그림·수치·드롭·스킬 전부). 저장처는 그대로 */
  async loadFrom(uuid) {
    const src = uuid && (await fromUuid(uuid));
    if (!src) return ui.notifications.warn(L("pickFirst"));
    this.load(src);
    this.loaded = src.name;
    ui.notifications.info(L("loaded", { name: src.name }));
    this.render();
  }

  /** 컴펜디움 같은 레벨(없으면 가장 가까운) 일반 에너미의 평균 */
  async fillAverage() {
    const lib = (await enemyLibrary()).filter((a) => !a.system.isFOE);
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

  async save({ copy = false } = {}) {
    const d = this.draft;
    const keep = foundry.utils.deepClone(this.base ?? {});
    for (const k of ["hp", "hpMaxBase"]) delete keep[k];
    const system = {
      ...keep, level: d.level, rarity: d.rarity, isFOE: d.isFOE, isBoss: d.isBoss, hp: { value: d.hp, max: d.hp }, stats: d.stats, resist: d.resist,
      attackElements: d.attackElements.length ? d.attackElements : ["strike"], drops: d.drops.filter((r) => r.item),
      description: d.description ? `<p>${esc(d.description).replace(/\n/g, "<br>")}</p>` : ""
    };
    // 목록 순서 = 시트 순서
    const skills = this.skills.map((s, i) => ({ ...s, sort: (i + 1) * 1000 }));
    const fresh = (s) => { const o = { ...s }; delete o._id; return o; };
    if (this.actor && !copy) {
      await this.actor.update({ name: d.name, img: d.img, system, "prototypeToken.name": d.name, "prototypeToken.texture.src": d.img });
      const keepIds = new Set(skills.map((s) => s._id).filter(Boolean));
      const del = this.actor.items.filter((i) => i.type === "skill" && !keepIds.has(i.id)).map((i) => i.id);
      if (del.length) await this.actor.deleteEmbeddedDocuments("Item", del);
      const upd = skills.filter((s) => s._id && this.actor.items.get(s._id));
      if (upd.length) await this.actor.updateEmbeddedDocuments("Item", upd);
      const add = skills.filter((s) => !s._id || !this.actor.items.get(s._id));
      if (add.length) await this.actor.createEmbeddedDocuments("Item", add.map(fresh));
    } else {
      // 스킬 아닌 아이템(있으면)은 원본 것을 그대로 가져간다
      const others = (this.actor?.items ?? []).filter((i) => i.type !== "skill").map((i) => fresh(i.toObject()));
      this.actor = await Actor.create({
        name: d.name, img: d.img, type: "enemy", system, folder: (await folderFor("Actor", "customEnemies")).id,
        prototypeToken: { name: d.name, texture: { src: d.img }, actorLink: false },
        items: [...skills.map(fresh), ...others],
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
