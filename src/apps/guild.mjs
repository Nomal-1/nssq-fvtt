/**
 * 길드(07 #167, 사용자 결정): 마을의 길드 시설에서
 * - 내 캐릭터: 여러 캐릭터를 두고 파티 참가·대기(플래그 nssq.benched), 대표 캐릭터 지정, 새 캐릭터 작성
 * - 스킬 재분배: 경험점 −n(설정 guildCost, 기본 3)으로 클래스 스킬을 모두 SL 0으로 돌리고 스킬 트리를 연다(★·커먼은 그대로)
 * - 직업 변경: 경험점 −n으로 메인·서브 클래스를 바꾸고 클래스 스킬을 돌려받는다(★는 새 클래스 것으로 자동)
 * 경험점이 줄어 레벨이 내려가면 확인 창에 미리 보인다
 */
import { levelFromExp } from "../engine/derive.mjs";
import tables from "../generated/tables.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Guild.${k}`, d) : game.i18n.localize(`NSSQ.Guild.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const opt = (v, cur, label) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(label)}</option>`;

export const guildCost = () => Math.max(0, Number(game.settings.get("nssq", "guildCost")) || 0);

/** 클래스 목록: 컴펜디움 + 월드(커스텀 직업) */
let classCache = null;
async function classList() {
  classCache ??= ((await game.packs.get("nssq.classes")?.getDocuments()) ?? []).filter((c) => c.type === "class");
  return [...classCache, ...game.items.filter((i) => i.type === "class")];
}

/** 이 사용자의 캐릭터(GM은 파티 전원) */
function myCharacters() {
  return game.actors.filter((a) => a.type === "character" && (game.user.isGM ? true : a.testUserPermission(game.user, "OWNER")));
}

/** 경험점을 n 줄였을 때의 레벨 */
function levelAfter(actor, cost) {
  return levelFromExp(Math.max(0, (actor.system.exp ?? 0) - cost), tables.levelExp?.levels);
}

/** 클래스 스킬을 돌려받는다(★·커먼은 남김) */
async function refundSkills(actor) {
  const ids = actor.items.filter((i) => i.type === "skill" && !i.system.unique && i.system.classKey !== "common").map((i) => i.id);
  // 길드 재분배·직업 변경은 공식 경로라 「스킬 되돌리기 금지」에 걸리지 않는다
  if (ids.length) await actor.deleteEmbeddedDocuments("Item", ids, { nssqRespec: true });
  return ids.length;
}

async function confirmCost(actor, title, body) {
  const cost = guildCost();
  if ((actor.system.exp ?? 0) < cost) { ui.notifications.warn(L("noExp", { n: cost })); return false; }
  const lv = levelAfter(actor, cost);
  return Dialog.confirm({
    title, rejectClose: false,
    content: `<p>${body}</p><p>${esc(L("costLine", { name: actor.name, n: cost, from: actor.system.exp ?? 0, to: (actor.system.exp ?? 0) - cost }))}</p>${lv < actor.system.level ? `<p class="warn">${esc(L("levelDown", { from: actor.system.level, to: lv }))}</p>` : ""}`
  });
}

/** 스킬 재분배 */
export async function respec(actor) {
  if (!actor?.isOwner) return null;
  if (!(await confirmCost(actor, L("respec"), esc(L("respecBody"))))) return null;
  const n = await refundSkills(actor);
  await actor.update({ "system.exp": (actor.system.exp ?? 0) - guildCost() });
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<div class="nssq-town-card"><i class="fas fa-sitemap"></i> ${esc(L("respecDone", { name: actor.name, n, cost: guildCost() }))}</div>` });
  return (await import("./skill-tree.mjs")).SkillTree.open(actor);
}

/** 직업 변경(메인·서브). sub: null이면 서브 없음, undefined면 그대로 */
export async function changeClass(actor, mainUuid, subUuid) {
  if (!actor?.isOwner) return null;
  const main = mainUuid ? await fromUuid(mainUuid) : null;
  const sub = subUuid ? await fromUuid(subUuid) : null;
  if (!main) return ui.notifications.warn(L("pickMain"));
  const cur = actor.system.classItems;
  if (cur.main?.system.key === main.system.key && (cur.sub?.system.key ?? null) === (sub?.system.key ?? null)) return ui.notifications.info(L("same"));
  const body = esc(L("classBody", { main: main.name, sub: sub?.name ?? L("noSub") }));
  if (!(await confirmCost(actor, L("classChange"), body))) return null;
  const keep = [main, sub && sub.system.key !== main.system.key ? sub : null].filter(Boolean);
  const del = actor.items.filter((i) => i.type === "class").map((i) => i.id);
  if (del.length) await actor.deleteEmbeddedDocuments("Item", del);
  await actor.createEmbeddedDocuments("Item", keep.map((c) => { const d = c.toObject(); delete d._id; return d; }));
  const n = await refundSkills(actor);
  // ★ 스킬은 unique-skill.mjs 훅이 새 메인 클래스 것으로 맞춘다
  await actor.update({ "system.mainClass": main.system.key, "system.subClass": keep[1]?.system.key ?? null, "system.exp": (actor.system.exp ?? 0) - guildCost() });
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<div class="nssq-town-card"><i class="fas fa-exchange-alt"></i> ${esc(L("classDone", { name: actor.name, main: main.name, sub: keep[1]?.name ?? L("noSub"), n, cost: guildCost() }))}</div>` });
  return (await import("./skill-tree.mjs")).SkillTree.open(actor);
}

let app = null;

export class GuildApp extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "nssq-guild", classes: ["nssq", "nq-window", "nssq-guild"], title: game.i18n.localize("NSSQ.Guild.title"), width: 760, height: 660, resizable: true, scrollY: [".guild-wrap"]
    });
  }

  static open(title = null) {
    app ??= new GuildApp();
    if (title) app.options.title = title;
    return app.render(true, { focus: true });
  }

  static refresh() { if (app?.rendered) app.render(); }

  async _renderInner() {
    const chars = myCharacters();
    if (!chars.find((a) => a.id === this.actorId)) this.actorId = game.user.character?.id ?? chars[0]?.id ?? null;
    const sel = game.actors.get(this.actorId);
    const classes = await classList();
    const { main, sub } = sel?.system.classItems ?? {};
    // 캐릭터 카드: 카드를 누르면 고르고, 버튼은 참가/대기·대표·시트
    const rows = chars.map((a) => {
      const c = a.system.classItems;
      const benched = !!a.getFlag("nssq", "benched");
      const rep = game.user.character?.id === a.id;
      const hp = a.system.hp ?? {};
      return `<div class="gc ${a.id === this.actorId ? "sel" : ""} ${benched ? "benched" : ""}" data-aid="${a.id}" data-g="pick">
        <img src="${esc(a.img)}" alt=""/>
        <div class="gc-info"><b>${esc(a.name)}</b>${rep ? ` <span class="tag">${esc(L("rep"))}</span>` : ""}
          <span>Lv${a.system.level} · ${esc(c.main?.name ?? "-")}${c.sub ? ` / ${esc(c.sub.name)}` : ""}</span>
          <span class="sub">EXP ${a.system.exp ?? 0} · HP ${hp.value ?? 0}/${hp.max ?? 0}</span></div>
        <div class="gc-acts">
          <button type="button" data-g="bench" class="${benched ? "" : "on"}" title="${esc(L("charsHint"))}"><i class="fas ${benched ? "fa-bed" : "fa-flag"}"></i> ${esc(benched ? L("benched") : L("inParty"))}</button>
          ${game.user.isGM || rep ? "" : `<a data-g="rep" title="${esc(L("makeRep"))}"><i class="fas fa-user-check"></i></a>`}
          <a data-g="sheet" title="${esc(L("sheet"))}"><i class="fas fa-id-card"></i></a></div></div>`;
    }).join("");
    const clsOpts = (cur) => classes.map((c) => opt(c.uuid, cur, c.name)).join("");
    return $(`<div class="guild-wrap">
      <section><h3>${esc(L("chars"))} <button type="button" data-g="new"><i class="fas fa-user-plus"></i> ${esc(L("newChar"))}</button></h3>
        <div class="guild-cards">${rows || `<p class="notes">${esc(L("noChars"))}</p>`}</div>
        <p class="notes">${esc(L("charsHint"))}</p></section>
      ${sel ? `<section><h3>${esc(L("forChar", { name: sel.name }))}</h3>
        <div class="guild-box"><b><i class="fas fa-sitemap"></i> ${esc(L("respec"))}</b><p class="notes">${esc(L("respecHint", { n: guildCost() }))}</p>
          <button type="button" data-g="tree"><i class="fas fa-sitemap"></i> ${esc(L("tree"))}</button><button type="button" data-g="respec" class="go">${esc(L("respecDo", { n: guildCost() }))}</button></div>
        <div class="guild-box"><b><i class="fas fa-exchange-alt"></i> ${esc(L("classChange"))}</b><p class="notes">${esc(L("classHint", { n: guildCost() }))}</p>
          <div class="form-group"><label>${esc(L("main"))}</label><select data-cls="main">${clsOpts(classes.find((c) => c.system.key === main?.system.key)?.uuid ?? "")}</select></div>
          <div class="form-group"><label>${esc(L("sub"))}</label><select data-cls="sub">${opt("", "", L("noSub"))}${clsOpts(classes.find((c) => c.system.key === sub?.system.key)?.uuid ?? "")}</select></div>
          <button type="button" data-g="class" class="go">${esc(L("classDo", { n: guildCost() }))}</button></div></section>` : ""}
    </div>`);
  }

  activateListeners(html) {
    super.activateListeners(html);
    html[0].querySelectorAll("[data-g]").forEach((el) => el.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.onAct(el.dataset.g, el.closest("[data-aid]")?.dataset.aid);
    }));
  }

  async onAct(act, aid) {
    const a = game.actors.get(aid ?? this.actorId);
    switch (act) {
      case "pick": this.actorId = aid; return this.render();
      case "bench": if (!a?.isOwner) return null; await a.setFlag("nssq", "benched", !a.getFlag("nssq", "benched")); return this.render();
      case "rep": await game.user.update({ character: a.id }); return this.render();
      case "sheet": return a?.sheet.render(true);
      case "new": return game.nssq.openChargen();
      case "tree": return (await import("./skill-tree.mjs")).SkillTree.open(a);
      case "respec": return respec(a);
      case "class": {
        const root = this.element[0];
        return changeClass(a, root.querySelector("[data-cls=main]").value, root.querySelector("[data-cls=sub]").value || null);
      }
    }
    return null;
  }
}

export function registerGuild() {
  game.settings.register("nssq", "guildCost", {
    name: "NSSQ.Settings.guildCost.name", hint: "NSSQ.Settings.guildCost.hint",
    scope: "world", config: true, type: Number, default: 3
  });
  for (const h of ["updateActor", "createActor", "deleteActor", "updateUser"]) Hooks.on(h, () => GuildApp.refresh());
  // 스킬 되돌리기 금지(사용자 결정): 작성을 마친 캐릭터는 플레이어가 스킬 SL을 낮추거나 지울 수 없다.
  // 작성 중·GM·길드 재분배/직업 변경(nssqRespec)·★ 스킬(클래스에 따라 자동)은 예외
  const locked = (item) => !game.user.isGM && item.type === "skill" && !item.system.unique
    && item.parent?.type === "character" && !!item.parent.system.creation?.locked;
  Hooks.on("preUpdateItem", (item, changes, options) => {
    if (options.nssqRespec || !locked(item)) return true;
    const sl = foundry.utils.getProperty(changes, "system.sl");
    if (sl === undefined || sl >= (item.system.sl ?? 0)) return true;
    ui.notifications.warn(L("noRollback"));
    return false;
  });
  Hooks.on("preDeleteItem", (item, options) => {
    if (options.nssqRespec || !locked(item)) return true;
    ui.notifications.warn(L("noRollback"));
    return false;
  });
}
