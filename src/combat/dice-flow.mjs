/**
 * 플레이어 공격의 굴리기 팝업(사용자 요청): 스킬·통상 공격 → 대상 → [명중 팝업] 식·목표값(+【FP】 주사위) → 굴리기
 * → [대미지 팝업] kD6, 내성보다 큰 눈의 개수 = 대미지 → 굴리기 → 결과 카드
 * - 대상·회차가 여럿이면 한 팝업에 모아 한 번에 굴린다
 * - 식별하지 못한 적(간파하지 못한 희소종 포함)의 회피·내성은 ???
 * - 엔진(resolveEffects·resolveAttack)은 부작용이 없으므로 같은 주사위로 여러 번 돌려 굴릴 것을 미리 알아낸다:
 *   1차(명중 목록) → 명중 팝업·굴림 → 2차(대미지 목록) → 대미지 팝업·굴림 → 마지막(실제 결과).
 *   그 밖의 굴림(부여 저항 등)과 무작위(rng)는 2차에서 굴린 값을 마지막에 그대로 쓴다. 크리티컬 추가 다이스는 마지막에 바로 굴린다
 * 클라이언트 설정 rollPopup(기본 켬)으로 끈다
 */
const L = (k, d) => (d ? game.i18n.format(`NSSQ.DiceFlow.${k}`, d) : game.i18n.localize(`NSSQ.DiceFlow.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const sign = (n) => (n >= 0 ? `+${n}` : `${n}`);

/** 이 공격에 팝업을 쓰는가: 플레이어가 가진 캐릭터의 공격(추격·반격 제외), 그 화면에서 */
export function usePopup(actor, { followup = null } = {}) {
  if (followup || actor?.type !== "character" || !actor.hasPlayerOwner || !actor.isOwner) return false;
  try { return game.settings.get("nssq", "rollPopup") !== false; } catch { return true; }
}

async function rollDice(n, rolls) {
  if (!n) return [];
  const r = await new Roll(`${n}d6`).evaluate();
  rolls?.push(r);
  return r.dice[0].results.map((x) => x.result);
}

/** 같은 순서로 다시 쓰는 값 목록(없으면 새로 만들어 기록) */
function replayer(make) {
  const vals = [];
  return { vals, start() { let i = 0; return () => (i < vals.length ? vals[i++] : (vals[i++] = make())); } };
}

/** 팝업 하나(닫아도 굴린다). fp: 【FP】 칸을 보일 때 { value, max } */
function popup({ title, head, lines, fp = null }) {
  const content = `<div class="nssq-dice-flow">
    <p class="head">${head}</p>
    <ul class="lines">${lines.map((l) => `<li>${l}</li>`).join("")}</ul>
    ${fp ? `<div class="form-group fp"><label>${esc(L("fpLabel", { max: fp.max }))}</label><input type="number" name="fp" min="0" max="${fp.max}" value="${fp.value}"/></div><p class="notes">${esc(L("fpHint"))}</p>` : ""}
  </div>`;
  return new Promise((resolve) => {
    const read = (html) => {
      const v = Number((html?.[0] ?? html)?.querySelector?.("[name=fp]")?.value ?? 0) || 0;
      return Math.max(0, Math.min(fp?.max ?? 0, Math.floor(v)));
    };
    let el = null;
    new Dialog({
      title, content,
      buttons: { roll: { icon: '<i class="fas fa-dice"></i>', label: L("roll"), callback: (html) => resolve(read(html)) } },
      default: "roll",
      render: (html) => { el = html; },
      close: () => resolve(read(el))
    }, { classes: ["nssq", "dialog", "nssq-dice-flow-dialog"], width: 420 }).render(true);
  });
}

/**
 * @param {(roll: Function, rng: Function, fp: number) => Promise<object>} run 엔진 호출(부작용 없음). fp = 판정마다 더할 【FP】 주사위
 * @param {object} o
 * @param {string} o.title 팝업 제목(스킬·아이템 이름)
 * @param {number} o.fpDeclared 전투 화면에서 선언해 둔 수(기본값)
 * @param {number} o.fpAvail 쓸 수 있는 【FP】
 * @param {(id: string) => string} o.nameOf 대상 이름
 * @param {(id: string) => boolean} o.known 대상의 회피·내성을 보여도 되는가
 * @param {object[]} o.rolls 결과 카드에 붙일 Roll(주사위 표시)
 * @returns {Promise<{ result: object, fp: number }>}
 */
export async function resolveWithPopups(run, { title, fpDeclared = 0, fpAvail = 0, nameOf = () => "", known = () => true, rolls = [] }) {
  const rand = replayer(() => CONFIG.Dice.randomUniform());
  const d6 = () => Math.ceil((1 - CONFIG.Dice.randomUniform()) * 6) || 1;

  // 1차: 명중 판정 목록(주사위는 아무 값)
  const hits = [];
  await run(async (n, m) => {
    if (m?.kind === "hit") hits.push(m);
    return Array.from({ length: n }, () => 3);
  }, rand.start(), fpDeclared);
  if (!hits.length) {
    // 명중 판정이 없는 행동(회복 등)은 지금처럼 바로
    return { result: await run((n) => rollDice(n, rolls), rand.start(), fpDeclared), fp: fpDeclared };
  }

  // 명중 팝업
  const hitLines = hits.map((m) => esc(L("hitLine", { name: nameOf(m.targetId), mod: sign(m.mod), target: known(m.targetId) ? m.target : "???" })));
  const fpMax = Math.max(0, fpAvail);
  const fp = await popup({ title, head: esc(L("hitHead")), lines: hitLines, fp: fpMax > 0 ? { value: Math.min(fpDeclared, fpMax), max: fpMax } : null });
  // 판정마다 fp개, 남은 【FP】까지(engine resolve.mjs fpTake와 같은 배분)
  let left = fpAvail;
  const takes = hits.map(() => { const t = Math.min(fp, Math.max(0, left)); left -= t; return t; });
  const all = await rollDice(takes.reduce((s, t) => s + 2 + t, 0), rolls);
  const hitQ = [];
  let at = 0;
  for (const t of takes) { hitQ.push(all.slice(at, at + 2 + t)); at += 2 + t; }
  const serveHit = (n) => { const q = hitQ.shift(); return q && q.length === n ? q : Array.from({ length: n }, (_, i) => q?.[i] ?? d6()); };

  // 2차: 대미지 목록(그 밖의 굴림은 여기서 굴린 값을 마지막에도 쓴다)
  const dmg = [];
  const other = replayer(d6);
  {
    const hq = [...hitQ.map((x) => [...x])];
    const serve = (n) => { const q = hq.shift(); return q && q.length === n ? q : Array.from({ length: n }, (_, i) => q?.[i] ?? d6()); };
    const o = other.start();
    await run(async (n, m) => {
      if (m?.kind === "hit") return serve(n);
      if (m?.kind === "damage") { dmg.push(m); return Array.from({ length: n }, () => 1); }
      if (m?.kind === "crit") return Array.from({ length: n }, () => 1);
      return Array.from({ length: n }, () => o());
    }, rand.start(), fp);
  }

  // 대미지 팝업
  let dmgQ = [];
  if (dmg.length) {
    const lines = dmg.map((m) => esc(known(m.targetId)
      ? L("dmgLine", { name: nameOf(m.targetId), count: m.count, resist: m.resist, need: m.resist + 1 })
      : L("dmgLineHidden", { name: nameOf(m.targetId), count: m.count })));
    await popup({ title, head: esc(L("dmgHead")), lines });
    const dd = await rollDice(dmg.reduce((s, m) => s + m.count, 0), rolls);
    let p = 0;
    dmgQ = dmg.map((m) => { const x = dd.slice(p, p + m.count); p += m.count; return x; });
  }

  // 마지막: 실제 결과
  const o = other.start();
  const result = await run(async (n, m) => {
    if (m?.kind === "hit") return serveHit(n);
    if (m?.kind === "damage") { const q = dmgQ.shift(); return q && q.length === n ? q : rollDice(n, rolls); }
    if (m?.kind === "crit") return rollDice(n, rolls);
    return Array.from({ length: n }, () => o());
  }, rand.start(), fp);
  return { result, fp };
}
