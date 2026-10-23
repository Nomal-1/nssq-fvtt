/**
 * 플레이어 공격의 굴리기 팝업(사용자 요청): 스킬·통상 공격 → 대상 → [명중 팝업] 식·목표값(+【FP】 주사위) → 굴리기
 * → [대미지 팝업] kD6, 내성보다 큰 눈의 개수 = 대미지 → 굴리기 → 결과 카드
 * - 대상·회차가 여럿이면 한 팝업에 모아 한 번에 굴린다
 * - 식별하지 못한 적(간파하지 못한 희소종 포함)의 회피·내성은 ???
 * - 엔진(resolveEffects·resolveAttack)은 부작용이 없으므로 같은 주사위로 여러 번 돌려 굴릴 것을 미리 알아낸다:
 *   1차(명중 목록) → 명중 팝업·굴림 → 2차(대미지 목록) → 대미지 팝업·굴림 → 마지막(실제 결과).
 *   그 밖의 굴림(부여 저항 등)과 무작위(rng)는 2차에서 굴린 값을 마지막에 그대로 쓴다. 크리티컬 추가 다이스는 마지막에 바로 굴린다
 * - GM 화면에서 실행되는 플레이어의 행동(후발 행동·지연 공격·메인 페이즈 개시 선언 등)은 그 캐릭터의 접속한 플레이어에게
 *   팝업을 보내(소켓 diceAsk) 그 화면에서 굴린 주사위를 받아 쓴다(diceAnswer). 접속한 플레이어가 없으면 바로 굴린다
 * 클라이언트 설정 rollPopup(기본 켬, 굴리는 사람의 설정)으로 끈다
 */
import { emit, onSocket } from "../socket.mjs";
import { ownerUser } from "./ask-owner.mjs";
import { esc } from "../util.mjs";
const L = (k, d) => (d ? game.i18n.format(`NSSQ.DiceFlow.${k}`, d) : game.i18n.localize(`NSSQ.DiceFlow.${k}`));
const sign = (n) => (n >= 0 ? `+${n}` : `${n}`);

const popupOn = () => { try { return game.settings.get("nssq", "rollPopup") !== false; } catch { return true; } };

/**
 * 이 공격에 팝업을 쓰는가: 플레이어가 가진 캐릭터의 공격. 추격·반격·발동은 제외(지연 공격은 그 사람의 행동이라 포함)
 * 플레이어 화면이면 그 화면에서, GM 화면이면 접속한 그 플레이어에게 보낸다
 */
export function usePopup(actor, { followup = null } = {}) {
  if ((followup && followup.type !== "delayed") || actor?.type !== "character" || !actor.hasPlayerOwner) return false;
  if (!game.user.isGM) return actor.isOwner && popupOn();
  return !!ownerUser(actor);
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
 * 명중 판정 결과 카드(결과 카드보다 먼저): 대상마다 굴린 눈·달성값 → 명중/빗나감. 메시지 플래그 nssq.hitCheck로 전투 화면이 MISS·HIT 연출
 * 목표값은 식별하지 못한 대상이면 ???
 */
async function postHitCard({ actor, title, checks, nameOf, known, uuidOf, roll }) {
  const { evaluateCheck } = await import("../engine/check.mjs");
  const rows = checks.map(({ m, dice }) => {
    const c = evaluateCheck({ dice, modifier: m.mod, target: m.target, added: m.fp ?? 0 });
    // 「명중 판정 눈 n 이하는 절대 실패」(engine resolveAttack과 같게)
    if (m.failAt && c.sum <= m.failAt && !c.absSuccess) { c.success = false; c.absFailure = true; }
    return { uuid: uuidOf(m.targetId), name: nameOf(m.targetId), hit: !!c.success, total: c.total, used: c.used, abs: c.absSuccess ? "absSuccess" : c.absFailure ? "absFailure" : null, target: known(m.targetId) ? m.target : null };
  });
  const li = rows.map((r) => `<li class="${r.hit ? "hit" : "miss"}"><b>${esc(r.name)}</b> ${esc(r.used.join("+"))} → <b>${r.total}</b> <span class="vs">(${esc(L("vsTarget", { target: r.target ?? "???" }))})</span>${r.abs ? ` <em>${esc(game.i18n.localize(`NSSQ.Check.${r.abs}`))}</em>` : ""}<div class="hit-result ${r.hit ? "success" : "failure"}">${esc(L(r.hit ? "hit" : "miss"))}</div></li>`).join("");
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="nssq-hit-card"><header class="check-header"><span class="check-label"><i class="fas fa-bullseye"></i> ${esc(L("hitCardTitle", { name: title }))}</span></header><ul>${li}</ul></div>`,
    ...(roll ? { rolls: [roll], sound: CONFIG.sounds.dice } : {}),
    flags: { nssq: { hitCheck: { targets: rows.map((r) => ({ uuid: r.uuid, hit: r.hit })) } } }
  });
}

/** 판정마다 fp개, 남은 【FP】까지(engine resolve.mjs fpTake와 같은 배분) */
const takesFor = (checks, fp, avail) => { let left = avail; return Array.from({ length: checks }, () => { const t = Math.min(fp, Math.max(0, left)); left -= t; return t; }); };

/**
 * 팝업 한 단계를 이 화면에서: 팝업(설정이 꺼져 있으면 건너뜀) → 굴림
 * @param {{ title, head, lines, fp?: {value,max}|null, checks?: number, fpAvail?: number, count?: number }} q checks가 있으면 명중 단계
 * @returns {Promise<{ fp: number, dice: number[], roll: object|null }>}
 */
async function askHere(q) {
  const fp = popupOn() ? await popup(q) : (q.fp?.value ?? 0);
  const n = q.checks ? takesFor(q.checks, fp, q.fpAvail ?? 0).reduce((s, t) => s + 2 + t, 0) : q.count;
  const rolls = [];
  const dice = await rollDice(n, rolls);
  return { fp, dice, roll: rolls[0]?.toJSON() ?? null };
}

const waiting = new Map();
/** 팝업 한 단계: 내 화면 또는(GM이 실행 중이면) 그 플레이어 화면. 답이 없으면(2분) 여기서 굴린다 */
async function ask(actor, q, rolls) {
  // rolls가 null이면 굴린 Roll을 돌려준다(명중 카드에 따로 붙인다)
  const u = game.user.isGM ? ownerUser(actor) : null;
  let a;
  if (!u) a = await askHere(q);
  else {
    const reqId = foundry.utils.randomID();
    a = await new Promise((resolve) => {
      const timer = setTimeout(() => { waiting.delete(reqId); resolve(null); }, 120000);
      waiting.set(reqId, (ans) => { clearTimeout(timer); waiting.delete(reqId); resolve(ans); });
      emit("diceAsk", { reqId, userId: u.id, q });
    });
    if (!a) a = await askHere(q);
  }
  if (a.roll) { try { const r = Roll.fromData(a.roll); if (rolls) rolls.push(r); else a.rollObj = r; } catch { /* 표시만 빠진다 */ } }
  return a;
}

/** 대상이 식별되지 않았는가(회피·내성을 ???로): 에너미이고 식별 전이거나 간파 전 희소종 */
export const hiddenStats = (a) => a?.type === "enemy" && (!a.system.identified || (a.system.isRare && !a.system.rareKnown));

/**
 * 대미지 다이스만 더 굴릴 때(《풀 게인》 등 「명중했을 때 선언, 대미지 다이스 +n」): 대미지 팝업 하나 → 굴림
 * @returns {Promise<number[]>}
 */
export async function damageDicePopup(actor, { title, name, count, resist, known = true }, rolls) {
  const line = esc(known ? L("dmgLine", { name, count, resist, need: resist + 1 }) : L("dmgLineHidden", { name, count }));
  return (await ask(actor, { title, head: esc(L("dmgHead")), lines: [line], count }, rolls)).dice;
}

export function registerDiceFlow() {
  onSocket("diceAsk", async ({ reqId, userId, q }) => {
    if (userId !== game.user.id) return;
    const a = await askHere(q);
    emit("diceAnswer", { reqId, ...a });
  });
  onSocket("diceAnswer", ({ reqId, ...a }) => waiting.get(reqId)?.(a));
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
 * @param {Actor} o.actor 공격하는 캐릭터(팝업을 보낼 플레이어를 찾는다)
 * @param {(id: string) => string|null} [o.uuidOf] 대상 액터 uuid(명중 카드의 전투 화면 연출)
 * @param {string} [o.scope] 스킬의 대상 문구(회복 팝업의 「아군 전체를 …」)
 * @returns {Promise<{ result: object, fp: number }>}
 */
export async function resolveWithPopups(run, opts) {
  const { title, fpDeclared = 0, fpAvail = 0, nameOf = () => "", known = () => true, rolls = [], actor = null, uuidOf = () => null } = opts;
  const rand = replayer(() => CONFIG.Dice.randomUniform());
  const d6 = () => Math.ceil((1 - CONFIG.Dice.randomUniform()) * 6) || 1;

  // 1차: 명중 판정 목록(주사위는 아무 값)
  const hits = [];
  await run(async (n, m) => {
    if (m?.kind === "hit") hits.push(m);
    return Array.from({ length: n }, () => 3);
  }, rand.start(), fpDeclared);
  if (!hits.length) {
    // 회복 롤(사용자 요청): 「(범위)를 nD6(4 이상)+k만큼 【HP】 회복」 팝업 → 굴림. 그 밖의 굴림(발동 판정 등)은 미리 굴린 값을 그대로
    const heals = [];
    const other = replayer(d6);
    const o0 = other.start();
    const dry = await run(async (n, m) => {
      if (m?.kind === "heal") { heals.push(m); return Array.from({ length: n }, () => 1); }
      return Array.from({ length: n }, () => o0());
    }, rand.start(), fpDeclared);
    // 명중 판정도 회복 롤도 없는 행동은 지금처럼 바로
    if (!heals.length) return { result: await run((n) => rollDice(n, rolls), rand.start(), fpDeclared), fp: fpDeclared };
    const { josa } = await import("./skill-use.mjs");
    const resLabel = (r) => (r === "tp" ? "【TP】" : "【HP】");
    // 굴림 없이 더하는 회복(《리인포스》 등): 1차 결과에서 그 대상의 고정 회복 합
    const plus = (m) => (dry.results?.get(m.targetId)?.resource ?? []).filter((x) => x.heal === (m.resource ?? "hp") && !x.dice?.length && !x.drain).reduce((n, x) => n + (x.amount ?? 0), 0);
    const formula = (m) => `${m.count}D6(${L("healMin", { min: m.min ?? 4 })})${plus(m) ? `+${plus(m)}` : ""}`;
    const scope = String(opts.scope ?? "").trim();
    const first = heals[0];
    const target = scope && scope !== "-" ? scope : nameOf(first.targetId);
    const head = L("healHead", { target: `${target}${josa(target, "을", "를")}`, formula: formula(first), res: resLabel(first.resource) });
    const lines = heals.map((m) => esc(L("healLine", { name: nameOf(m.targetId), formula: formula(m), res: resLabel(m.resource) })));
    const dd = (await ask(actor, { title, head: `${esc(head)}<br><small>${esc(L("healRule", { min: first.min ?? 4 }))}</small>`, lines, count: heals.reduce((n, m) => n + m.count, 0) }, rolls)).dice;
    let p = 0;
    const healQ = heals.map((m) => { const x = dd.slice(p, p + m.count); p += m.count; return x; });
    const o1 = other.start();
    const result = await run(async (n, m) => {
      if (m?.kind === "heal") { const q = healQ.shift(); return q && q.length === n ? q : rollDice(n, rolls); }
      return Array.from({ length: n }, () => o1());
    }, rand.start(), fpDeclared);
    return { result, fp: fpDeclared };
  }

  // 명중 팝업
  const hitLines = hits.map((m) => esc(L("hitLine", { name: nameOf(m.targetId), mod: sign(m.mod), target: known(m.targetId) ? m.target : "???" })));
  const fpMax = Math.max(0, fpAvail);
  // 명중 주사위는 결과 카드가 아니라 먼저 올리는 명중 카드에 붙인다
  const h = await ask(actor, { title, head: esc(L("hitHead")), lines: hitLines, fp: fpMax > 0 ? { value: Math.min(fpDeclared, fpMax), max: fpMax } : null, checks: hits.length, fpAvail }, null);
  const fp = h.fp;
  const takes = takesFor(hits.length, fp, fpAvail);
  const all = h.dice;
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
    const checks = [];
    await run(async (n, m) => {
      if (m?.kind === "hit") { const d = serve(n); checks.push({ m, dice: d }); return d; }
      if (m?.kind === "damage") { dmg.push(m); return Array.from({ length: n }, () => 1); }
      if (m?.kind === "crit") return Array.from({ length: n }, () => 1);
      return Array.from({ length: n }, () => o());
    }, rand.start(), fp);
    // 명중 결과를 먼저 채팅 카드로(주사위·전투 화면 연출). 대미지 팝업은 그다음
    await postHitCard({ actor, title, checks, nameOf, known, uuidOf, roll: h.rollObj });
  }

  // 대미지 팝업
  let dmgQ = [];
  if (dmg.length) {
    const lines = dmg.map((m) => esc(known(m.targetId)
      ? L("dmgLine", { name: nameOf(m.targetId), count: m.count, resist: m.resist, need: m.resist + 1 })
      : L("dmgLineHidden", { name: nameOf(m.targetId), count: m.count })));
    const dd = (await ask(actor, { title, head: esc(L("dmgHead")), lines, count: dmg.reduce((s, m) => s + m.count, 0) }, rolls)).dice;
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
  return { result, fp, hitShown: true };
}
