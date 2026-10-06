/**
 * 스킬 트리 창: 메인·서브 클래스와 커먼 스킬을 트리로 보여 주고, 클릭으로 습득·SL 조정.
 * - 클릭: SL +1(없으면 스킬 팩에서 가져와 SL 1로 습득), 우클릭: SL −1(0이 되면 스킬을 지운다)
 * - 규칙(engine/skills.mjs): 전제 조건, MaxSL(메인/서브), 레벨 상한(Lv+1), 합계 SL 예산, 고유 스킬
 * - GM은 Shift+클릭으로 조건을 무시한다
 * 보기는 시트를 볼 수 있는 누구나, 조작은 소유자.
 */
import { brokenByLowering, canRaise, levelCap, prereqList, skillBudget, treeLayout } from "../engine/skills.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Skill.${k}`, d) : game.i18n.localize(`NSSQ.Skill.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const plain = (html, n = 160) => {
  const t = String(html ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

const COL_W = 200;
const ROW_H = 46;
const NODE_W = 164;
const NODE_H = 32;
const PAD = 12;

/** 스킬 팩 색인(한 번만 읽는다) */
let indexCache = null;
async function skillIndex() {
  if (indexCache) return indexCache;
  const pack = game.packs.get("nssq.skills");
  if (!pack) return [];
  const index = await pack.getIndex({ fields: ["sort", "system.classKey", "system.skillKey", "system.maxSL", "system.unique", "system.prereqs", "system.timing", "system.cost", "system.description"] });
  indexCache = [...index].filter((e) => e.type === "skill").sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  return indexCache;
}

export class SkillTree extends Application {
  constructor(actor, options = {}) {
    super({ id: `nssq-skill-tree-${actor.id}`, ...options });
    this.actor = actor;
    this.tab = null;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["nssq", "nq-window", "nssq-skill-tree"],
      template: "systems/nssq/templates/apps/skill-tree.hbs",
      width: 860,
      height: 680,
      resizable: true
    });
  }

  get title() {
    return L("treeTitle", { name: this.actor.name });
  }

  static open(actor) {
    const app = Object.values(ui.windows).find((w) => w instanceof SkillTree && w.actor === actor) ?? new SkillTree(actor);
    app.render(true, { focus: true });
    return app;
  }

  /** 액터가 바뀌면(스킬 추가·삭제·레벨) 함께 다시 그린다 */
  async _render(force, options) {
    await super._render(force, options);
    this.actor.apps[this.appId] = this;
  }

  async close(options) {
    delete this.actor.apps[this.appId];
    return super.close(options);
  }

  /** 지금 상태: 탭, 가진 스킬, 예산 */
  state() {
    const s = this.actor.system;
    const { main, sub } = s.classItems;
    const tabs = [];
    if (main) tabs.push({ key: "main", classKey: main.system.key, label: `${main.name} · ${L("tabMain")}` });
    if (sub) tabs.push({ key: "sub", classKey: sub.system.key, label: `${sub.name} · ${L("tabSub")}` });
    tabs.push({ key: "common", classKey: "common", label: L("tabCommon") });
    if (!tabs.some((t) => t.key === this.tab)) this.tab = tabs[0].key;
    const owned = this.actor.items.filter((i) => i.type === "skill");
    const slOf = (name) => Math.max(0, ...owned.filter((o) => o.name === name).map((o) => o.system.sl ?? 0));
    const budget = skillBudget({
      level: s.level,
      skills: owned.map((o) => ({ sl: o.system.sl ?? 0, unique: !!o.system.unique, common: o.system.classKey === "common" }))
    });
    return { main, sub, tabs, tab: tabs.find((t) => t.key === this.tab), owned, slOf, budget, level: s.level };
  }

  async getData() {
    const st = this.state();
    const index = await skillIndex();
    const list = index.filter((e) => e.system?.classKey === st.tab.classKey);
    const mainNames = st.main ? new Set(index.filter((e) => e.system?.classKey === st.main.system.key).map((e) => e.name)) : new Set();
    const ownedOf = (e) => st.owned.find((o) => o.system.classKey === e.system.classKey && o.system.skillKey === e.system.skillKey);
    const editable = this.actor.isOwner;

    const nodeData = (e) => {
      const item = ownedOf(e);
      const current = item?.system.sl ?? 0;
      const check = canRaise({
        skill: { name: e.name, maxSL: e.system.maxSL, unique: e.system.unique, prereqs: e.system.prereqs },
        role: st.tab.key, current, slOf: st.slOf, level: st.level, hasSub: !!st.sub,
        budgetLeft: st.budget.left, mainHasSame: st.tab.key === "sub" && mainNames.has(e.name)
      });
      const ms = e.system.maxSL ?? {};
      const prereq = prereqList(e.system.prereqs).map((p) => `${p.any ? `(${L("or")}) ` : ""}${p.skill} SL${p.sl}`).join(", ");
      const cost = e.system.cost?.tp ? `TP ${e.system.cost.tp}` : e.system.cost?.fp ? `FP ${e.system.cost.fp}` : "";
      const tip = [
        `${e.system.unique ? "★ " : ""}${e.name} — ${e.system.timing ?? ""}${cost ? ` · ${cost}` : ""}`,
        prereq ? `${L("prereq")}: ${prereq}` : "",
        plain(e.system.description),
        !check.ok && check.reason !== "maxed" ? `✖ ${L(`reason.${check.reason}`)}` : ""
      ].filter(Boolean).join("\n");
      return {
        id: e._id, name: e.name, unique: !!e.system.unique, current,
        maxText: st.tab.key === "common" ? `${ms.main ?? 1}` : `${ms.main ?? 1}/${ms.sub ?? "-"}`,
        max: check.max,
        state: current >= (check.max ?? 0) && current > 0 ? "maxed" : current > 0 ? "owned" : check.ok ? "open" : "locked",
        canRaise: editable && check.ok,
        tip
      };
    };

    const layout = treeLayout(list.map((e) => ({ name: e.name, prereqs: e.system.prereqs })));
    const byName = new Map(list.map((e) => [e.name, e]));
    const pos = new Map(layout.nodes.map((n) => [n.name, { x: PAD + n.col * COL_W, y: PAD + n.row * ROW_H }]));
    const nodes = layout.nodes.map((n) => ({ ...nodeData(byName.get(n.name)), x: pos.get(n.name).x, y: pos.get(n.name).y }));
    const edges = layout.edges.map((e) => {
      const a = pos.get(e.from);
      const b = pos.get(e.to);
      const x1 = a.x + NODE_W;
      const y1 = a.y + NODE_H / 2;
      const x2 = b.x;
      const y2 = b.y + NODE_H / 2;
      const dx = Math.max(24, (x2 - x1) / 2);
      // SL 배지는 곡선의 70% 지점(자식 쪽)에. 부모가 여럿이어도 겹치지 않는다
      const t = 0.7;
      const bz = (p0, p1, p2, p3) => (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3;
      return {
        d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
        lx: Math.round(bz(x1, x1 + dx, x2 - dx, x2)) - 8, ly: Math.round(bz(y1, y1, y2, y2)) - 8,
        sl: e.sl, any: e.any, met: st.slOf(e.from) >= e.sl
      };
    });
    return {
      tabs: st.tabs.map((t) => ({ ...t, active: t.key === st.tab.key })),
      nodes, edges,
      width: PAD * 2 + Math.max(0, layout.cols - 1) * COL_W + NODE_W,
      height: PAD * 2 + Math.max(0, layout.rows - 1) * ROW_H + NODE_H,
      hasTree: nodes.length > 0,
      independent: layout.independent.map((n) => nodeData(byName.get(n))),
      budget: st.budget,
      budgetText: L("budget", st.budget),
      capText: L("levelCap", { level: st.level, cap: levelCap(st.level) }),
      empty: !list.length,
      noPack: !game.packs.get("nssq.skills"),
      noClass: !st.main,
      editable,
      isGM: game.user.isGM
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.on("click", "[data-tab-key]", (ev) => {
      ev.preventDefault();
      this.tab = ev.currentTarget.dataset.tabKey;
      this.render(false);
    });
    if (!this.actor.isOwner) return;
    html.on("click", ".nq-node[data-skill-id]", (ev) => {
      ev.preventDefault();
      this.raise(ev.currentTarget.dataset.skillId, { force: ev.shiftKey && game.user.isGM });
    });
    html.on("contextmenu", ".nq-node[data-skill-id]", (ev) => {
      ev.preventDefault();
      this.lower(ev.currentTarget.dataset.skillId);
    });
  }

  /** SL +1. 없으면 팩에서 가져와 SL 1로 */
  async raise(id, { force = false } = {}) {
    const index = await skillIndex();
    const e = index.find((x) => x._id === id);
    if (!e) return;
    const st = this.state();
    const item = st.owned.find((o) => o.system.classKey === e.system.classKey && o.system.skillKey === e.system.skillKey);
    const current = item?.system.sl ?? 0;
    if (!force) {
      const mainNames = st.main ? new Set(index.filter((x) => x.system?.classKey === st.main.system.key).map((x) => x.name)) : new Set();
      const check = canRaise({
        skill: { name: e.name, maxSL: e.system.maxSL, unique: e.system.unique, prereqs: e.system.prereqs },
        role: st.tab.key, current, slOf: st.slOf, level: st.level, hasSub: !!st.sub,
        budgetLeft: st.budget.left, mainHasSame: st.tab.key === "sub" && mainNames.has(e.name)
      });
      if (!check.ok) return ui.notifications.warn(`${e.name}: ${L(`reason.${check.reason}`)}`);
    }
    if (item) {
      await item.update({ "system.sl": current + 1 });
    } else {
      const doc = await game.packs.get("nssq.skills").getDocument(id);
      const data = game.items.fromCompendium(doc);
      data.system.sl = 1;
      foundry.utils.setProperty(data, "_stats.compendiumSource", doc.uuid);
      await this.actor.createEmbeddedDocuments("Item", [data]);
    }
  }

  /** SL −1. 0이 되면 지운다. 다른 스킬의 전제가 깨지면 확인 */
  async lower(id) {
    const index = await skillIndex();
    const e = index.find((x) => x._id === id);
    if (!e) return;
    const owned = this.actor.items.filter((i) => i.type === "skill");
    const item = owned.find((o) => o.system.classKey === e.system.classKey && o.system.skillKey === e.system.skillKey);
    if (!item) return;
    const next = (item.system.sl ?? 1) - 1;
    // 같은 이름 스킬이 다른 클래스에도 있으면 그쪽 SL이 전제를 채운다
    const others = owned.filter((o) => o !== item).map((o) => ({ name: o.name, sl: o.system.sl ?? 0, prereqs: o.system.prereqs }));
    const sameElsewhere = Math.max(0, ...others.filter((o) => o.name === item.name).map((o) => o.sl));
    const broken = brokenByLowering(item.name, Math.max(next, sameElsewhere), others.filter((o) => o.name !== item.name));
    if (broken.length) {
      const ok = await Dialog.confirm({
        title: L("tree"),
        content: `<p>${esc(L("brokenConfirm", { name: item.name, list: broken.join(", ") }))}</p>`,
        options: { classes: ["nssq", "dialog"] }
      });
      if (!ok) return;
    }
    if (next <= 0) await item.delete();
    else await item.update({ "system.sl": next });
  }
}
