/**
 * 스킬: 전투/비전투 분류, 스킬 트리 배치, 습득 규칙 (01 §6, 세션 결과와 성장). Foundry 비의존 순수 함수.
 */

/** 이 말이 해설에 있으면 전투 스킬로 본다 */
const COMBAT_WORDS = /【(물리 명중|속성 명중|물리 공격|속성 공격|방어|회피|억제 공격|억제 방어|속도|HP|TP)】|내성|대미지|공격 롤|전투|명중|강화 효과|약화 효과|상태 이상|봉인|크리티컬|추격|반격|회복량|회복 효과|분류|토큰|오버히트|대기 상태|스킬 공격|방진|라운드|턴|도주|능동 회피/;

/**
 * 전투 스킬인가 비전투(탐색) 스킬인가. GM이 스킬 시트에서 정한 값(usage)이 있으면 그것.
 * 자동 판정: 커먼 스킬은 비전투. 그 밖에는 타이밍이 「상시」·「특수」이고 해설에 전투 관련 말이 없으면 비전투.
 * @returns {"combat"|"explore"}
 */
export function skillUsage({ usage = "", timing = "", description = "", classKey = "" } = {}) {
  if (usage === "combat" || usage === "explore") return usage;
  if (classKey === "common") return "explore"; // 커먼 스킬은 지식·채집·요리
  // 「상시」「특수」는 해설로 판정(특수는 탐색·교섭용이 많다). 주행동·개막·수동은 전투
  if (timing !== "상시" && timing !== "특수") return "combat";
  const text = String(description).replace(/<[^>]*>/g, " ");
  return COMBAT_WORDS.test(text) ? "combat" : "explore";
}

/** 전제 조건을 평평한 목록으로: [{ skill, sl, group }] (group이 같으면 「또는」) */
export function prereqList(prereqs) {
  const out = [];
  (prereqs?.all ?? []).forEach((p, i) => {
    if (p.any) for (const q of p.any) out.push({ skill: q.skill, sl: q.sl, group: i, any: true });
    else out.push({ skill: p.skill, sl: p.sl, group: i, any: false });
  });
  return out;
}

/** 전제 조건 충족 여부. slOf(name) = 가진 SL */
export function prereqsMet(prereqs, slOf) {
  return (prereqs?.all ?? []).every((p) => (p.any ? p.any.some((q) => slOf(q.skill) >= q.sl) : slOf(p.skill) >= p.sl));
}

/**
 * 스킬 트리 배치. 전제 조건이 있는 스킬은 왼쪽(뿌리)에서 오른쪽으로 깊이별 열에 놓고,
 * 전제도 없고 다른 스킬의 전제도 아닌 스킬은 「독립 스킬」로 따로 뺀다.
 * 「A 또는 B 또는 C」 전제는 「또는」 분기점(kind "or") 하나로 묶는다. 같은 후보 묶음을 쓰는 스킬들은 분기점을 함께 쓴다
 * (예: 다크 헌터의 검·세검·채찍 마스터리 → 분기점 → 각 스킬).
 * @param {{name, prereqs}[]} skills 한 클래스의 스킬(데이터 순서)
 * @returns {{
 *   nodes: {id, kind: "skill"|"or", name?, alts?: {skill, sl}[], col, row}[],
 *   edges: {from, to, sl: number|null, any}[],
 *   independent: string[], cols, rows, outside: {[name]: {skill, sl}[]}
 * }}
 */
export function treeLayout(skills) {
  const names = new Set(skills.map((s) => s.name));
  const edges = [];
  const outside = {};
  const ors = new Map();
  for (const s of skills) {
    for (const p of s.prereqs?.all ?? []) {
      if (!p.any) {
        if (names.has(p.skill) && p.skill !== s.name) edges.push({ from: p.skill, to: s.name, sl: p.sl, any: false });
        else (outside[s.name] ??= []).push({ skill: p.skill, sl: p.sl });
        continue;
      }
      const alts = p.any.filter((q) => names.has(q.skill) && q.skill !== s.name);
      for (const q of p.any.filter((q) => !alts.includes(q))) (outside[s.name] ??= []).push({ skill: q.skill, sl: q.sl });
      if (!alts.length) continue;
      if (alts.length === 1) {
        edges.push({ from: alts[0].skill, to: s.name, sl: alts[0].sl, any: true });
        continue;
      }
      const sameSL = alts.every((q) => q.sl === alts[0].sl);
      const key = `or:${alts.map((q) => (sameSL ? q.skill : `${q.skill}@${q.sl}`)).sort().join("|")}`;
      if (!ors.has(key)) ors.set(key, { id: key, kind: "or", alts: alts.map((q) => ({ skill: q.skill, sl: sameSL ? null : q.sl })), sameSL });
      edges.push({ from: key, to: s.name, sl: sameSL ? alts[0].sl : null, any: true });
    }
  }
  for (const o of ors.values()) for (const q of o.alts) edges.push({ from: q.skill, to: o.id, sl: q.sl, any: true });

  const linked = new Set(edges.flatMap((e) => [e.from, e.to]));
  const independent = skills.filter((s) => !linked.has(s.name)).map((s) => s.name);
  const tree = [...skills.filter((s) => linked.has(s.name)).map((s) => s.name), ...ors.keys()];

  // 깊이 = 가장 긴 전제 사슬
  const parentsOf = {};
  for (const e of edges) (parentsOf[e.to] ??= []).push(e.from);
  const parents = (n) => parentsOf[n] ?? [];
  const depth = {};
  const visit = (n, seen = new Set()) => {
    if (depth[n] !== undefined) return depth[n];
    if (seen.has(n)) return 0; // 순환 방지
    seen.add(n);
    const ps = parents(n);
    depth[n] = ps.length ? Math.max(...ps.map((p) => visit(p, seen))) + 1 : 0;
    return depth[n];
  };
  tree.forEach((n) => visit(n));
  const cols = tree.length ? Math.max(...tree.map((n) => depth[n])) + 1 : 0;

  // 행: 뿌리는 데이터 순서(자식을 함께 쓰는 뿌리끼리 붙인다), 그 뒤 열은 부모 행의 평균에 가깝게
  const row = {};
  let rows = 0;
  const childrenOf = (n) => edges.filter((e) => e.from === n).map((e) => e.to);
  for (let c = 0; c < cols; c++) {
    let inCol = tree.filter((n) => depth[n] === c);
    const want = (n) => {
      const ps = parents(n).filter((p) => row[p] !== undefined);
      return ps.length ? ps.reduce((a, p) => a + row[p], 0) / ps.length : Infinity;
    };
    if (c === 0) {
      // 같은 자식(또는 분기점)을 가진 뿌리를 이어 놓는다
      const ordered = [];
      for (const n of inCol) {
        if (ordered.includes(n)) continue;
        ordered.push(n);
        const kids = new Set(childrenOf(n));
        for (const m of inCol) if (!ordered.includes(m) && childrenOf(m).some((k) => kids.has(k))) ordered.push(m);
      }
      inCol = ordered;
    } else inCol = [...inCol].sort((a, b) => want(a) - want(b) || tree.indexOf(a) - tree.indexOf(b));
    let next = 0;
    for (const n of inCol) {
      const w = want(n);
      row[n] = c === 0 ? next : Math.max(next, Number.isFinite(w) ? Math.round(w) : next);
      next = row[n] + 1;
    }
    // 한 덩어리로 아래로 밀렸으면 원하는 위치의 가운데로 끌어올린다
    if (c > 0 && inCol.length) {
      const wanted = inCol.map(want).filter(Number.isFinite);
      if (wanted.length) {
        const shift = Math.round(wanted.reduce((a, b) => a + b, 0) / wanted.length - inCol.reduce((a, n) => a + row[n], 0) / inCol.length);
        const up = Math.max(shift, -Math.min(...inCol.map((n) => row[n])));
        if (up < 0) for (const n of inCol) row[n] += up;
        next = Math.max(...inCol.map((n) => row[n])) + 1;
      }
    }
    rows = Math.max(rows, next);
  }
  const nodes = tree.map((id) => (ors.has(id)
    ? { id, kind: "or", alts: ors.get(id).alts, col: depth[id], row: row[id] }
    : { id, kind: "skill", name: id, col: depth[id], row: row[id] }));
  return { nodes, edges, independent, cols, rows, outside };
}

/** 한 스킬이 가질 수 있는 최대 SL: Lv1은 2, 레벨업마다 1씩(한 번에 1까지) → Lv + 1 */
export function levelCap(level) {
  return Math.max(1, Number(level) || 1) + 1;
}

/**
 * 쓸 수 있는 합계 SL. 작성 5 + 레벨업마다 3 + GM 보너스. 커먼 스킬 1개(SL1)는 작성 때 따로 받는다. 고유 스킬은 무료.
 * @param {{level, skills: {sl, unique, common}[]}} p
 */
export function skillBudget({ level = 1, skills = [], bonus = 0 }) {
  // GM이 보상으로 준 보너스 SL(bonus)도 더한다
  const total = 5 + 3 * (Math.max(1, Number(level) || 1) - 1) + (Number(bonus) || 0);
  let spent = 0;
  let common = 0;
  for (const s of skills) {
    if (s.unique) continue;
    if (s.common) common += s.sl;
    else spent += s.sl;
  }
  // 작성 때 받는 커먼 스킬 1SL은 예산 밖
  spent += Math.max(0, common - 1);
  return { total, spent, left: total - spent };
}

/**
 * 스킬 하나를 1 올릴 수 있는가.
 * @param {object} p
 * @param {{name, maxSL: {main, sub}, unique, prereqs}} p.skill
 * @param {"main"|"sub"|"common"} p.role 이 트리가 메인/서브/커먼 중 무엇인가
 * @param {number} p.current 지금 SL(없으면 0)
 * @param {(name: string) => number} p.slOf 가진 스킬의 SL(이름 기준, 메인·서브 같은 이름은 같은 스킬)
 * @param {number} p.level
 * @param {boolean} p.hasSub 서브 클래스가 있는가
 * @param {number} p.budgetLeft 남은 합계 SL
 * @param {boolean} [p.mainHasSame] 서브 트리에서: 메인 클래스에 같은 이름 스킬이 있다(메인 쪽만 유효)
 * @returns {{ok: boolean, max: number|null, reason?: string}}
 */
export function canRaise({ skill, role, current = 0, slOf, level = 1, hasSub = false, budgetLeft = 0, mainHasSame = false }) {
  const max = role === "sub" ? skill.maxSL?.sub ?? null : skill.maxSL?.main ?? 1;
  // 고유 스킬은 서브 클래스가 없으면 자동으로 습득된다(손으로 찍지 않는다)
  if (skill.unique) {
    if (role !== "main") return { ok: false, max, reason: "uniqueMainOnly" };
    return { ok: false, max, reason: hasSub ? "uniqueWithSub" : "uniqueAuto" };
  }
  if (mainHasSame) return { ok: false, max, reason: "sameInMain" };
  if (max === null) return { ok: false, max, reason: "subNotAllowed" };
  if (current >= max) return { ok: false, max, reason: "maxed" };
  if (!skill.unique && current + 1 > levelCap(level)) return { ok: false, max, reason: "levelCap" };
  if (current === 0 && !prereqsMet(skill.prereqs, slOf)) return { ok: false, max, reason: "prereq" };
  if (!skill.unique && budgetLeft <= 0) return { ok: false, max, reason: "budget" };
  return { ok: true, max };
}

/**
 * 고유 스킬 자동 습득: 서브 클래스가 없으면 메인 클래스의 고유 스킬(★)을 가진다, 있으면 없앤다.
 * @param {{mainKey: string|null, hasSub: boolean, uniques: {classKey, skillKey}[], owned: {id, classKey, skillKey, unique}[]}} p
 *   uniques = 스킬 팩의 고유 스킬 목록, owned = 액터가 가진 스킬
 * @returns {{remove: string[], add: {classKey, skillKey}[]}} remove는 아이템 id
 */
export function uniqueSkillPlan({ mainKey, hasSub, uniques, owned }) {
  const want = !hasSub && mainKey ? uniques.filter((u) => u.classKey === mainKey) : [];
  const has = owned.filter((o) => o.unique);
  const same = (a, b) => a.classKey === b.classKey && a.skillKey === b.skillKey;
  return {
    remove: has.filter((o) => !want.some((w) => same(w, o))).map((o) => o.id),
    add: want.filter((w) => !has.some((o) => same(w, o)))
  };
}

/**
 * SL을 1 내릴 때 전제 조건이 깨지는 다른 스킬(가진 것 중)
 * @param {string} name 내릴 스킬
 * @param {number} newSL
 * @param {{name, sl, prereqs}[]} owned
 */
export function brokenByLowering(name, newSL, owned) {
  const slOf = (n) => (n === name ? newSL : Math.max(0, ...owned.filter((o) => o.name === n).map((o) => o.sl)));
  return owned.filter((o) => o.name !== name && o.sl > 0 && prereqList(o.prereqs).some((p) => p.skill === name) && !prereqsMet(o.prereqs, slOf)).map((o) => o.name);
}

/**
 * 커스텀 직업 정의 검사(커스텀 직업 제작기). 선행조건은 같은 직업 안의 스킬 이름으로 건다.
 * @param {{ skills: {name, maxSL: {main, sub}, unique, prereqs}[] }} def
 * @returns {{ errors: {code, name?, detail?}[], warnings: {code, name?}[] }}
 */
export function validateClassDef({ skills = [] }) {
  const errors = [];
  const warnings = [];
  const byName = new Map();
  for (const s of skills) {
    const n = String(s.name ?? "").trim();
    if (!n) { errors.push({ code: "emptyName" }); continue; }
    if (byName.has(n)) errors.push({ code: "dupName", name: n });
    byName.set(n, s);
  }
  if (!skills.length) warnings.push({ code: "noSkills" });
  if (skills.filter((s) => s.unique).length > 1) errors.push({ code: "manyUnique" });
  for (const s of skills) {
    const main = Number(s.maxSL?.main);
    const sub = s.maxSL?.sub;
    if (!s.unique && !(main >= 1)) errors.push({ code: "badMax", name: s.name });
    if (!s.unique && sub != null && sub !== "" && Number(sub) > main) errors.push({ code: "subOverMain", name: s.name });
    const list = prereqList(s.prereqs);
    if (s.unique && list.length) warnings.push({ code: "uniquePrereq", name: s.name });
    for (const p of list) {
      if (p.skill === s.name) { warnings.push({ code: "selfPrereq", name: s.name }); continue; }
      const t = byName.get(p.skill);
      if (!t) errors.push({ code: "missingPrereq", name: s.name, detail: p.skill });
      else if (!t.unique && Number(p.sl) > Number(t.maxSL?.main ?? 1)) errors.push({ code: "prereqOverMax", name: s.name, detail: `${p.skill} SL${p.sl}` });
    }
  }
  // 순환: 선행 그래프(이름 → 선행 이름들)에서 DFS
  const deps = new Map(skills.map((s) => [s.name, prereqList(s.prereqs).map((p) => p.skill).filter((x) => x !== s.name && byName.has(x))]));
  const state = new Map();
  const cyc = new Set();
  const visit = (n, path) => {
    if (state.get(n) === 2) return;
    if (state.get(n) === 1) { path.slice(path.indexOf(n)).forEach((x) => cyc.add(x)); return; }
    state.set(n, 1);
    for (const d of deps.get(n) ?? []) visit(d, [...path, d]);
    state.set(n, 2);
  };
  for (const n of deps.keys()) visit(n, [n]);
  if (cyc.size) errors.push({ code: "cycle", detail: [...cyc].join(" → ") });
  const nonUnique = skills.filter((s) => !s.unique);
  if (nonUnique.length && !nonUnique.some((s) => !prereqList(s.prereqs).length)) warnings.push({ code: "noRoot" });
  return { errors, warnings };
}

/** 스킬 이름을 바꿀 때 다른 스킬의 선행조건 이름도 바꾼다(새 배열) */
export function renamePrereqs(skills, from, to) {
  const fix = (p) => (p.any ? { ...p, any: p.any.map((q) => (q.skill === from ? { ...q, skill: to } : q)) } : p.skill === from ? { ...p, skill: to } : p);
  return skills.map((s) => (s.prereqs?.all?.length ? { ...s, prereqs: { ...s.prereqs, all: s.prereqs.all.map(fix) } } : s));
}
