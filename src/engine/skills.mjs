/**
 * 스킬: 전투/비전투 분류, 스킬 트리 배치, 습득 규칙 (01 §6, 세션 결과와 성장). Foundry 비의존 순수 함수.
 */

/** 이 말이 해설에 있으면 전투 스킬로 본다 */
const COMBAT_WORDS = /【(물리 명중|속성 명중|물리 공격|속성 공격|방어|회피|억제 공격|억제 방어|속도|HP|TP)】|내성|대미지|공격 롤|전투|명중|강화 효과|약화 효과|상태 이상|봉인|크리티컬|추격|반격|회복량|회복 효과|분류|토큰|오버히트|대기 상태|스킬 공격|방진|라운드|턴/;

/**
 * 전투 스킬인가 비전투(탐색) 스킬인가. GM이 스킬 시트에서 정한 값(usage)이 있으면 그것.
 * 자동 판정: 커먼 스킬은 비전투. 그 밖에는 타이밍이 「상시」이고 해설에 전투 관련 말이 없으면 비전투.
 * @returns {"combat"|"explore"}
 */
export function skillUsage({ usage = "", timing = "", description = "", classKey = "" } = {}) {
  if (usage === "combat" || usage === "explore") return usage;
  if (classKey === "common") return "explore"; // 커먼 스킬은 지식·채집·요리
  if (timing !== "상시") return "combat";
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
 * @param {{name, prereqs}[]} skills 한 클래스의 스킬(데이터 순서)
 * @returns {{nodes: {name, col, row}[], edges: {from, to, sl, any}[], independent: string[], cols, rows, outside: {[name]: {skill, sl}[]}}}
 */
export function treeLayout(skills) {
  const names = new Set(skills.map((s) => s.name));
  const edges = [];
  const outside = {};
  for (const s of skills) {
    for (const p of prereqList(s.prereqs)) {
      if (names.has(p.skill) && p.skill !== s.name) edges.push({ from: p.skill, to: s.name, sl: p.sl, any: p.any });
      else (outside[s.name] ??= []).push({ skill: p.skill, sl: p.sl });
    }
  }
  const linked = new Set(edges.flatMap((e) => [e.from, e.to]));
  const independent = skills.filter((s) => !linked.has(s.name)).map((s) => s.name);
  const tree = skills.filter((s) => linked.has(s.name)).map((s) => s.name);

  // 깊이 = 가장 긴 전제 사슬
  const parents = (n) => edges.filter((e) => e.to === n).map((e) => e.from);
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

  // 행: 뿌리는 데이터 순서, 그 뒤 열은 부모 행의 평균에 가깝게(겹치지 않게 아래로 민다)
  const row = {};
  let rows = 0;
  for (let c = 0; c < cols; c++) {
    const inCol = tree.filter((n) => depth[n] === c);
    const want = (n) => {
      const ps = parents(n).filter((p) => row[p] !== undefined);
      return ps.length ? ps.reduce((a, p) => a + row[p], 0) / ps.length : Infinity;
    };
    const order = c === 0 ? inCol : [...inCol].sort((a, b) => want(a) - want(b) || tree.indexOf(a) - tree.indexOf(b));
    let next = 0;
    for (const n of order) {
      const w = want(n);
      row[n] = c === 0 ? next : Math.max(next, Number.isFinite(w) ? Math.round(w) : next);
      next = row[n] + 1;
    }
    rows = Math.max(rows, next);
  }
  return { nodes: tree.map((n) => ({ name: n, col: depth[n], row: row[n] })), edges, independent, cols, rows, outside };
}

/** 한 스킬이 가질 수 있는 최대 SL: Lv1은 2, 레벨업마다 1씩(한 번에 1까지) → Lv + 1 */
export function levelCap(level) {
  return Math.max(1, Number(level) || 1) + 1;
}

/**
 * 쓸 수 있는 합계 SL. 작성 5 + 레벨업마다 3. 커먼 스킬 1개(SL1)는 작성 때 따로 받는다. 고유 스킬은 무료.
 * @param {{level, skills: {sl, unique, common}[]}} p
 */
export function skillBudget({ level = 1, skills = [] }) {
  const total = 5 + 3 * (Math.max(1, Number(level) || 1) - 1);
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
  if (skill.unique) {
    if (role !== "main") return { ok: false, max, reason: "uniqueMainOnly" };
    if (hasSub) return { ok: false, max, reason: "uniqueWithSub" };
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
 * SL을 1 내릴 때 전제 조건이 깨지는 다른 스킬(가진 것 중)
 * @param {string} name 내릴 스킬
 * @param {number} newSL
 * @param {{name, sl, prereqs}[]} owned
 */
export function brokenByLowering(name, newSL, owned) {
  const slOf = (n) => (n === name ? newSL : Math.max(0, ...owned.filter((o) => o.name === n).map((o) => o.sl)));
  return owned.filter((o) => o.name !== name && o.sl > 0 && prereqList(o.prereqs).some((p) => p.skill === name) && !prereqsMet(o.prereqs, slOf)).map((o) => o.name);
}
