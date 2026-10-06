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

const GAP = 64;
const LANE = 12;
const ROW_H = 42;
const NODE_W = 164;
const NODE_H = 30;
const OR_W = 46;
const OR_H = 22;
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

/** 이 스킬 항목이 메인·서브·커먼 중 어느 쪽인가 */
function roleOf(e, st) {
  if (e.system.classKey === "common") return "common";
  return st.main && e.system.classKey === st.main.system.key ? "main" : "sub";
}

/**
 * 서브 트리의 스킬이 메인 트리에도 같은 이름으로 있으면 메인 쪽 항목으로 바꾼다(메인 쪽만 유효, SL 합산 불가).
 * 서브 탭에서 눌러도 메인 스킬이 오르내린다.
 */
function effectiveEntry(e, st, index) {
  if (roleOf(e, st) !== "sub" || !st.main) return { entry: e, shared: false };
  const m = index.find((x) => x.system?.classKey === st.main.system.key && x.name === e.name);
  return m ? { entry: m, shared: true } : { entry: e, shared: false };
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

    const nodeData = (orig) => {
      const { entry: e, shared } = effectiveEntry(orig, st, index);
      const role = roleOf(e, st);
      const item = ownedOf(e);
      const current = item?.system.sl ?? 0;
      const check = canRaise({
        skill: { name: e.name, maxSL: e.system.maxSL, unique: e.system.unique, prereqs: e.system.prereqs },
        role, current, slOf: st.slOf, level: st.level, hasSub: !!st.sub,
        budgetLeft: st.budget.left, mainHasSame: role === "sub" && mainNames.has(e.name)
      });
      const ms = e.system.maxSL ?? {};
      const prereq = prereqList(e.system.prereqs).map((p) => `${p.any ? `(${L("or")}) ` : ""}${p.skill} SL${p.sl}`).join(", ");
      const cost = e.system.cost?.tp ? `TP ${e.system.cost.tp}` : e.system.cost?.fp ? `FP ${e.system.cost.fp}` : "";
      const tip = [
        `${e.system.unique ? "★ " : ""}${e.name} — ${e.system.timing ?? ""}${cost ? ` · ${cost}` : ""}`,
        prereq ? `${L("prereq")}: ${prereq}` : "",
        plain(e.system.description),
        shared ? L("sharedHint") : "",
        !check.ok && check.reason !== "maxed" ? `✖ ${L(`reason.${check.reason}`)}` : ""
      ].filter(Boolean).join("\n");
      return {
        id: e._id, name: e.name, unique: !!e.system.unique, current, shared,
        maxText: role === "common" || shared ? `${ms.main ?? 1}` : `${ms.main ?? 1}/${ms.sub ?? "-"}`,
        max: check.max,
        state: current >= (check.max ?? 0) && current > 0 ? "maxed" : current > 0 ? "owned" : check.ok ? "open" : "locked",
        canRaise: editable && check.ok,
        tip
      };
    };

    const layout = treeLayout(list.map((e) => ({ name: e.name, prereqs: e.system.prereqs })));
    const byName = new Map(list.map((e) => [e.name, e]));

    // 열 너비: 스킬이 있는 열은 NODE_W, 「또는」 분기점만 있는 열은 OR_W. 열 사이 GAP
    const colW = Array.from({ length: layout.cols }, (_, c) => (layout.nodes.some((n) => n.col === c && n.kind === "skill") ? NODE_W : OR_W));
    const colX = [];
    // 열 사이 간격: 그 열에서 갈라지는 부모 수만큼 세로 통로를 둔다
    const colOf = new Map(layout.nodes.map((n) => [n.id, n.col]));
    const srcCount = colW.map((_, c) => new Set(layout.edges.filter((e) => colOf.get(e.from) === c).map((e) => e.from)).size);
    const gapAfter = srcCount.map((n) => Math.max(GAP, 44 + LANE * Math.max(0, n - 1)));
    colW.forEach((w, c) => colX.push(c ? colX[c - 1] + colW[c - 1] + gapAfter[c - 1] : PAD));
    const box = new Map(layout.nodes.map((n) => {
      const or = n.kind === "or";
      const h = or ? OR_H : NODE_H;
      return [n.id, { x: colX[n.col], y: PAD + n.row * ROW_H + (NODE_H - h) / 2, w: or ? OR_W : NODE_W, h, col: n.col }];
    }));
    const keyOf = new Map(layout.nodes.map((n, i) => [n.id, `n${i}`]));
    const orMet = (n) => n.alts.some((q) => st.slOf(q.skill) >= (q.sl ?? 1));
    const nodes = layout.nodes.map((n) => {
      const b = box.get(n.id);
      if (n.kind === "or") {
        return { key: keyOf.get(n.id), or: true, x: b.x, y: b.y, met: orMet(n), tip: `${L("or")}: ${n.alts.map((q) => `${q.skill}${q.sl ? ` SL${q.sl}` : ""}`).join(" / ")}` };
      }
      return { ...nodeData(byName.get(n.name)), key: keyOf.get(n.id), x: b.x, y: b.y };
    });

    // 선: 부모 오른쪽 → 부모 열 뒤의 세로 통로(부모마다 자기 줄) → 자식 왼쪽. 자식에 들어오는 선이 여럿이면 높이를 나눈다
    const sourcesByCol = {};
    for (const e of layout.edges) {
      const c = box.get(e.from).col;
      sourcesByCol[c] ??= [];
      if (!sourcesByCol[c].includes(e.from)) sourcesByCol[c].push(e.from);
    }
    for (const srcs of Object.values(sourcesByCol)) srcs.sort((p, q) => box.get(p).y - box.get(q).y);
    const incoming = {};
    for (const e of layout.edges) (incoming[e.to] ??= []).push(e);
    for (const ins of Object.values(incoming)) ins.sort((p, q) => box.get(p.from).y - box.get(q.from).y);
    const edges = layout.edges.map((e) => {
      const a = box.get(e.from);
      const b = box.get(e.to);
      const srcs = sourcesByCol[a.col];
      const lane = srcs.indexOf(e.from);
      const mx = Math.round(colX[a.col] + colW[a.col] + 14 + lane * LANE);
      const ins = incoming[e.to];
      const k = ins.indexOf(e);
      const spread = ins.length > 1 ? Math.min(8, (b.h - 8) / (ins.length - 1)) : 0;
      const x1 = a.x + a.w;
      const y1 = Math.round(a.y + a.h / 2);
      const x2 = b.x;
      const y2 = Math.round(b.y + b.h / 2 + (k - (ins.length - 1) / 2) * spread);
      const met = e.from.startsWith("or:")
        ? orMet(layout.nodes.find((n) => n.id === e.from))
        : st.slOf(e.from) >= (e.sl ?? 1);
      return {
        d: `M ${x1} ${y1} H ${mx} V ${y2} H ${x2}`,
        from: keyOf.get(e.from), to: keyOf.get(e.to),
        sl: e.sl, any: e.any, met,
        // 부모마다 조금씩 다른 색(아직 못 채운 선). 채운 선은 금색
        hue: (205 + lane * 47) % 360,
        lx: x2 - 20 - (ins.length - 1 - k) * 18, ly: y2 - 8
      };
    });
    const right = layout.cols ? colX[layout.cols - 1] + colW[layout.cols - 1] : 0;
    this._links = edges.map((e) => [e.from, e.to]);
    return {
      tabs: st.tabs.map((t) => ({ ...t, active: t.key === st.tab.key })),
      nodes, edges,
      width: right + PAD,
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
    // 마우스를 올린 스킬의 선행(조상)·후속(자손) 사슬만 밝히고 나머지는 흐리게
    const tree = html[0].querySelector(".nq-tree");
    if (tree) {
      const walk = (start, forward) => {
        const seen = new Set([start]);
        const stack = [start];
        while (stack.length) {
          const n = stack.pop();
          for (const [a, b] of this._links ?? []) {
            const [from, to] = forward ? [a, b] : [b, a];
            if (from === n && !seen.has(to)) {
              seen.add(to);
              stack.push(to);
            }
          }
        }
        return seen;
      };
      tree.querySelectorAll("[data-key]").forEach((el) => {
        el.addEventListener("mouseenter", () => {
          const k = el.dataset.key;
          const on = new Set([...walk(k, false), ...walk(k, true)]);
          tree.classList.add("focus");
          tree.querySelectorAll("[data-key]").forEach((n) => n.classList.toggle("hl", on.has(n.dataset.key)));
          tree.querySelectorAll("[data-from]").forEach((p) => p.classList.toggle("hl", on.has(p.dataset.from) && on.has(p.dataset.to)));
        });
        el.addEventListener("mouseleave", () => tree.classList.remove("focus"));
      });
    }
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
    const st = this.state();
    const found = index.find((x) => x._id === id);
    if (!found) return;
    const e = effectiveEntry(found, st, index).entry;
    id = e._id;
    const role = roleOf(e, st);
    const item = st.owned.find((o) => o.system.classKey === e.system.classKey && o.system.skillKey === e.system.skillKey);
    const current = item?.system.sl ?? 0;
    if (!force) {
      const mainNames = st.main ? new Set(index.filter((x) => x.system?.classKey === st.main.system.key).map((x) => x.name)) : new Set();
      const check = canRaise({
        skill: { name: e.name, maxSL: e.system.maxSL, unique: e.system.unique, prereqs: e.system.prereqs },
        role, current, slOf: st.slOf, level: st.level, hasSub: !!st.sub,
        budgetLeft: st.budget.left, mainHasSame: role === "sub" && mainNames.has(e.name)
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
