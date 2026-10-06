/**
 * 몬스터 도감 창
 * - GM: 모든 종(시스템 에너미 팩 + 월드의 에너미 액터). 식별 여부·처치 수·본 스킬·얻은 DROP을 언제든 고친다
 * - 플레이어(설정 「도감을 플레이어에게 보이기」가 켜져 있을 때, 전투 중에는 열 수 없음). 단계별 공개(07 #48)
 *   0 만난 적 없음: 목록에 없음 / 1 만남: 모습·이름만 / 2 식별한 적 있음: Lv, 「식별 시 공개」 스킬(패시브 포함)과 쓴 스킬의 이름·의존 부위,
 *   얻은 DROP(부능력치·내성·스킬 사양은 없음) / 3 처치 수가 자동 식별 기준 이상: 전부(모든 스킬 사양·모든 DROP)
 * 기록은 combat/bestiary.mjs(월드 설정 nssq.bestiary)
 */
import { SUB_STATS, RESISTS } from "../engine/derive.mjs";
import { autoIdentifyKills, bestiaryEntry, bestiaryKey, bestiaryTier, forgetBestiary, setBestiaryEntry } from "../combat/bestiary.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Bestiary.${k}`, d) : game.i18n.localize(`NSSQ.Bestiary.${k}`));
const A = (k) => game.i18n.localize(`NSSQ.Analysis.${k}`);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const dropName = (d) => `${d.rank ? `R${d.rank} ` : ""}${d.item}`;
const dropRange = (d) => (d.max === null || d.max === undefined ? `${d.min}~` : d.min === d.max ? `${d.min}` : `${d.min}~${d.max}`);
const inBattle = () => game.combats.some((c) => c.started && c.getFlag("nssq", "battle"));

export const bestiaryForPlayers = () => !!game.settings.get("nssq", "bestiaryPlayers");

let app = null;

export class BestiaryApp extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "nssq-bestiary", classes: ["nssq", "nssq-bestiary"], width: 760, height: 620, resizable: true
    });
  }

  get title() {
    return L("title");
  }

  static open() {
    if (!game.user.isGM && !bestiaryForPlayers()) return ui.notifications.warn(L("closed"));
    if (!game.user.isGM && inBattle()) return ui.notifications.warn(L("inBattle"));
    app ??= new BestiaryApp();
    app.render(true);
  }

  /** 종 목록: { key, name, img, level, foe, uuid } (같은 키는 하나) */
  async species() {
    const out = new Map();
    const pack = game.packs.get("nssq.enemies");
    if (pack) {
      const index = await pack.getIndex({ fields: ["type", "system.key", "system.level", "system.isFOE"] });
      for (const e of index) {
        if (e.type !== "enemy") continue;
        const key = e.system?.key || e.name;
        if (!out.has(key)) out.set(key, { key, name: e.name, img: e.img, level: e.system?.level, foe: !!e.system?.isFOE, uuid: e.uuid ?? `Compendium.nssq.enemies.Actor.${e._id}` });
      }
    }
    for (const a of game.actors.filter((x) => x.type === "enemy")) {
      const key = bestiaryKey(a);
      if (!out.has(key)) out.set(key, { key, name: a.name, img: a.img, level: a.system.level, foe: !!a.system.isFOE, uuid: a.uuid });
    }
    return [...out.values()].sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || a.name.localeCompare(b.name, "ko"));
  }

  async _renderInner() {
    const gm = game.user.isGM;
    const all = (await this.species()).map((s) => ({ ...s, entry: bestiaryEntry({ system: { key: s.key }, name: s.name }) }));
    for (const x of all) x.tier = bestiaryTier(x.entry);
    const list = gm ? all : all.filter((x) => x.tier > 0);
    if (!list.some((s) => s.key === this.selected)) this.selected = list[0]?.key ?? null;
    const q = (this.filter ?? "").trim();
    const rows = list.map((s) => `<li class="${s.key === this.selected ? "active" : ""} ${s.tier > 0 ? "known" : ""}" data-key="${esc(s.key)}" data-name="${esc(s.name)}" ${q && !s.name.includes(q) ? "hidden" : ""}>
        <img src="${esc(s.img)}"/><span class="nm">${esc(s.name)}</span><small>${gm || s.tier >= 2 ? `Lv${esc(s.level ?? "?")}` : ""}${s.foe ? " · F.O.E." : ""}</small>
        ${(s.entry.defeated ?? 0) > 0 ? `<b class="kills" title="${esc(L("kills"))}">${s.entry.defeated}</b>` : ""}${s.entry.identified ? `<i class="fas fa-eye" title="${esc(L("identified"))}"></i>` : ""}</li>`).join("");
    const sel = list.find((s) => s.key === this.selected);
    const detail = sel ? await this.detailHtml(sel) : `<p class="none">${esc(gm ? L("empty") : L("emptyPlayer"))}</p>`;
    const auto = autoIdentifyKills();
    return $(`<div class="bestiary-root">
      <aside><input type="search" name="filter" value="${esc(this.filter ?? "")}" placeholder="${esc(L("search"))}"/>
        <ul class="species">${rows || `<li class="none">${esc(L("emptyPlayer"))}</li>`}</ul>
        ${gm ? `<p class="notes">${esc(auto ? L("autoOn", { n: auto }) : L("autoOff"))} · ${esc(bestiaryForPlayers() ? L("playersOn") : L("playersOff"))}</p>` : ""}
      </aside>
      <section class="detail">${detail}</section></div>`);
  }

  async detailHtml(sel) {
    const gm = game.user.isGM;
    const doc = await fromUuid(sel.uuid);
    const s = doc?.system ?? {};
    const e = sel.entry;
    const skills = (doc?.items?.contents ?? []).filter((i) => i.type === "skill");
    const drops = s.drops ?? [];
    const head = `<header><img src="${esc(sel.img)}"/><div><h2>${esc(sel.name)}</h2><span>Lv ${esc(s.level ?? "?")} · HP ${esc(s.hp?.max ?? "?")}${sel.foe ? " · F.O.E." : ""}</span></div></header>`;
    const stats = `<div class="an-stats">${SUB_STATS.map((k) => `<div class="an-stat"><span>${esc(game.i18n.localize(`NSSQ.Analysis.short.${k}`))}</span><b>${esc(s.stats?.[k] ?? "?")}</b></div>`).join("")}</div>
      <div class="an-resists">${RESISTS.map((k) => `<div class="an-res ${k}"><span>${esc(game.i18n.localize(`NSSQ.Resist.${k}`))}</span><b>${esc(s.resist?.[k] ?? "?")}</b></div>`).join("")}</div>`;
    if (gm) {
      const auto = autoIdentifyKills();
      return `${head}
        <form class="bestiary-edit" data-key="${esc(sel.key)}">
          <p class="notes">${esc(L("tierNow", { tier: L(`tier${sel.tier}`) }))}</p>
          <div class="row"><label><input type="checkbox" name="seen" ${e.seen ? "checked" : ""}/> ${esc(L("seen"))}</label>
            <label><input type="checkbox" name="identified" ${e.identified ? "checked" : ""}/> ${esc(L("identified"))}</label>
            <label>${esc(L("kills"))} <input type="number" name="defeated" min="0" value="${e.defeated ?? 0}"/></label>
            ${auto ? `<span class="notes">${esc((e.defeated ?? 0) >= auto ? L("autoMet") : L("autoLeft", { n: auto - (e.defeated ?? 0) }))}</span>` : ""}</div>
          <h4>${esc(L("seenSkills"))}</h4>
          <ul class="checks">${skills.map((i) => `<li><label><input type="checkbox" name="skill" value="${esc(i.name)}" ${(e.skills ?? []).includes(i.name) ? "checked" : ""}/> ${esc(i.name)} <small>${esc(i.system.timing ?? "")}${i.system.reveal === false ? ` · ${esc(L("hiddenSkill"))}` : ""}</small></label></li>`).join("") || `<li class="none">${esc(A("none"))}</li>`}</ul>
          <h4>${esc(L("gotDrops"))}</h4>
          <ul class="checks">${drops.map((d) => `<li><label><input type="checkbox" name="drop" value="${esc(dropName(d))}" ${(e.drops ?? []).includes(dropName(d)) ? "checked" : ""}/> ${esc(dropRange(d))} ${esc(dropName(d))}</label></li>`).join("") || `<li class="none">${esc(A("none"))}</li>`}</ul>
          <div class="buttons"><button type="button" data-forget><i class="fas fa-eraser"></i> ${esc(L("forget"))}</button></div>
        </form>
        <h4>${esc(L("data"))}</h4>${stats}`;
    }
    // 플레이어: 단계별
    const tier = sel.tier;
    const kills = `<p class="notes">${esc(L("record", { kills: e.defeated ?? 0 }))}</p>`;
    if (tier <= 1) return `<header><img src="${esc(sel.img)}"/><div><h2>${esc(sel.name)}</h2></div></header><p class="notes">${esc(L("tier1Note"))}</p>`;
    const spec = (i) => [i.system.timing, i.system.range, i.system.target].filter((x) => x && x !== "-").join(" / ");
    const part = (i) => game.i18n.format("NSSQ.Analysis.part", { part: i.system.part && i.system.part !== "-" ? i.system.part : A("noPart") });
    if (tier >= 3) {
      return `${head}${kills}${stats}
        <h4>SKILL</h4><ul class="an-list">${skills.map((i) => `<li class="spec"><b>${esc(i.name)}</b><small>${esc(spec(i))}</small><div class="desc">${esc(String(i.system.description ?? "").replace(/<[^>]+>/g, " ").trim())}</div></li>`).join("") || `<li class="empty">${esc(A("none"))}</li>`}</ul>
        <h4>DROP</h4><ul class="an-list">${drops.map((d) => `<li>${esc(dropRange(d))} ${esc(dropName(d))}</li>`).join("") || `<li class="empty">${esc(A("none"))}</li>`}</ul>`;
    }
    // 단계 2: 이름·모습·Lv, 「식별 시 공개」 스킬(패시브 포함)과 쓴 스킬의 이름·의존 부위(사양 없음), 얻은 DROP
    // 전투 중 자세히 보기의 식별 성공과 같은 범위(부능력치·내성은 없음)
    const shown = (i) => i.system.reveal !== false || (e.skills ?? []).includes(i.name);
    return `<header><img src="${esc(sel.img)}"/><div><h2>${esc(sel.name)}</h2><span>Lv ${esc(s.level ?? "?")}</span></div></header>${kills}
      <p class="notes">${esc(L("tier2Note"))}</p>
      <h4>SKILL</h4><ul class="an-list">${skills.map((i) => (shown(i) ? `<li>${esc(i.name)}<small>${esc(part(i))}</small></li>` : `<li class="q">???</li>`)).join("") || `<li class="empty">${esc(A("none"))}</li>`}</ul>
      <h4>DROP</h4><ul class="an-list">${drops.map((d) => ((e.drops ?? []).includes(dropName(d)) ? `<li>${esc(dropRange(d))} ${esc(dropName(d))}</li>` : `<li class="q">???</li>`)).join("") || `<li class="empty">${esc(A("none"))}</li>`}</ul>`;
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html[0];
    root.querySelectorAll(".species li[data-key]").forEach((li) => li.addEventListener("click", () => {
      this.selected = li.dataset.key;
      this.render();
    }));
    root.querySelector("[name=filter]")?.addEventListener("input", (ev) => {
      this.filter = ev.currentTarget.value;
      const q = this.filter.trim();
      root.querySelectorAll(".species li[data-key]").forEach((li) => { li.hidden = !!q && !li.dataset.name.includes(q); });
    });
    const form = root.querySelector(".bestiary-edit");
    if (!form) return;
    const save = () => {
      const entry = {
        seen: form.seen.checked,
        identified: form.identified.checked,
        defeated: Math.max(0, Number(form.defeated.value) || 0),
        skills: [...form.querySelectorAll("[name=skill]:checked")].map((x) => x.value),
        drops: [...form.querySelectorAll("[name=drop]:checked")].map((x) => x.value)
      };
      return setBestiaryEntry(form.dataset.key, entry);
    };
    form.addEventListener("change", () => save());
    form.querySelector("[data-forget]")?.addEventListener("click", async () => {
      const ok = await Dialog.confirm({ title: L("forget"), content: `<p>${esc(L("forgetConfirm"))}</p>`, rejectClose: false });
      if (ok) await forgetBestiary(form.dataset.key);
    });
  }
}

export function registerBestiaryApp() {
  // 액터 탭 머리 버튼(GM, 설정이 켜져 있으면 플레이어도)
  Hooks.on("renderActorDirectory", (dir, html) => {
    if (!game.user.isGM && !bestiaryForPlayers()) return;
    const btn = $(`<button type="button" class="nssq-bestiary-btn"><i class="fas fa-dragon"></i> ${L("title")}</button>`);
    btn.on("click", () => BestiaryApp.open());
    html.find(".directory-header .header-actions").append(btn);
  });
  // 토큰 도구(전투 화면 왼쪽 위 도구 막대)
  Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user.isGM && !bestiaryForPlayers()) return;
    controls.find((c) => c.name === "token")?.tools.push({
      name: "nssq-bestiary", title: "NSSQ.Bestiary.title", icon: "fas fa-dragon", button: true, onClick: () => BestiaryApp.open()
    });
  });
  // 플레이어는 전투 중에 도감을 볼 수 없다(전투가 시작되면 닫는다)
  Hooks.on("updateCombat", (combat, changes) => {
    if (!game.user.isGM && changes.started && combat.getFlag("nssq", "battle") && app?.rendered) app.close();
  });
  // 기록이 바뀌면 열린 창을 다시 그린다
  Hooks.on("nssqBestiary", () => { if (app?.rendered) app.render(); });
}
