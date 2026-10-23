/**
 * 스킬·아이템 결과 카드 HTML(combat/skill-use.mjs가 만들고 다시 내보낸다)
 */
import { CONDITIONS } from "../engine/conditions.mjs";
import { BUFFS } from "../engine/buffs.mjs";
import { buffLabel, conditionName } from "./status.mjs";
import { fpNote, rerollButton } from "./fp-dice.mjs";
import { esc } from "../util.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.SkillUse.${k}`, d) : game.i18n.localize(`NSSQ.SkillUse.${k}`));
// 상태 이상은 [독], 봉인은 이름 그대로([팔] 봉인)
const condLabel = (id) => (CONDITIONS[id]?.kind === "bind" ? conditionName(id) : `[${conditionName(id)}]`);

/** 같은 다회 공격에서 나온 카드 메시지(회차 순) */
export function groupMessages(card) {
  if (!card?.group) return [];
  return game.messages.filter((m) => m.getFlag("nssq", "skillCard")?.group?.id === card.group.id)
    .sort((a, b) => a.getFlag("nssq", "skillCard").group.index - b.getFlag("nssq", "skillCard").group.index);
}

/* ---------------- 카드 ---------------- */

function entryLines(e, card) {
  const out = [];
  const hits = e.hits ?? [];
  // 타격마다 나눈 카드는 머리에 회차를 보이므로 줄마다 붙이지 않는다
  const multi = !card.group && (card.entries ?? []).reduce((n, x) => n + (x.hits?.length ?? 0), 0) > 1;
  // 부여·강화·확률 실패: 어느 명중에서 생겼는지(seq)가 있으면 그 공격 아래에
  // 억제 판정: 대결이면 양쪽, 고정 목표값이면 방어 쪽 주사위·달성값(01 #47: 모르는 에너미의 값은 ?)
  //   (공격 카드처럼 주사위만 보이고 보정·달성값을 가린다. 보정이 보이면 달성값을 계산할 수 있다)
  const chk = (c, side = "user") => {
    const mask = side === "user" ? `data-mask="${esc(card.kind)}"` : "data-mask-def";
    const mod = c ? c.total - c.sum : 0;
    return `${(c?.used ?? []).join("+")}${mod ? `${mod >= 0 ? "+" : "−"}<span ${mask}>${Math.abs(mod)}</span>` : ""} = <span ${mask}>${c?.total ?? "-"}</span>`;
  };
  const rollText = (i) => (i.contest ? esc(L("contestRoll", { atk: "\u0001", def: "\u0002" })).replace("\u0001", chk(i.contest.atk)).replace("\u0002", chk(i.contest.def, "target"))
    : i.fixed ? esc(L("fixedRoll", { def: "\u0002", target: i.fixed.target })).replace("\u0002", chk(i.fixed.check, "target"))
      : i.forced ? esc(L("forcedRoll", { atk: "\u0001" })).replace("\u0001", chk(i.forced.atk)) : "");
  const inflictLi = (i) => `<li class="${i.resisted || i.broken ? "resist" : "inflict"}">${esc(i.resisted ? L("inflictResisted", { label: condLabel(i.id) }) : i.id === "death" || CONDITIONS[i.id]?.depth === false ? condLabel(i.id) : L("inflictLine", { label: condLabel(i.id), depth: i.depth ?? "-" }))}${i.broken ? ` <em class="woke">${esc(L("brokenAt", { n: i.broken }))}</em>` : ""}${rollText(i) ? `<div class="supp-roll">${rollText(i)}</div>` : ""}</li>`;
  const buffLi = (b) => `<li class="${BUFFS[b.id]?.kind ?? "buff"}">${esc(L("buffLine", { label: buffLabel(b), turns: b.turns }))}</li>`;
  const chanceLi = (x) => `<li class="miss">${esc(L("chanceFailed", { die: x.die }))}</li>`;
  const sub = (seq) => [
    ...(e.inflicts ?? []).filter((i) => i.seq === seq).map(inflictLi),
    ...(e.buffs ?? []).filter((b) => b.seq === seq).map(buffLi),
    ...(e.resource ?? []).filter((x) => x.chanceFailed && x.seq === seq).map(chanceLi)
  ].join("");
  for (const h of hits) {
    const no = multi && h.seq ? `<b class="seq">${esc(L("hitNo", { n: h.seq }))}</b> ` : "";
    if (h.skipped) { out.push(`<li class="miss">${no}${esc(L("skipped"))}</li>`); continue; }
    // 달성값은 모르는 에너미면 ?로 바꾸므로 span에 넣고, 나머지 글자만 이스케이프한다
    const [pre, post] = L(h.hit ? "hitLine" : h.nullified ? "nullLine" : "missLine", { total: "\u0000", dice: h.dice?.join("+") ?? "" }).split("\u0000");
    let line = `${no}${esc(pre)}<span data-mask="${esc(card.kind)}">${h.total ?? "-"}</span>${esc(post ?? "")}`;
    if (h.hit && multi) line += ` — ${esc(L("damageLine", { n: h.final, count: h.diceCount }))}${h.crit ? ` <b class="crit">${esc(L("crit"))}</b>` : ""}`;
    line += fpNote(h);
    if (h.woke) line += ` <em class="woke">${esc(L("woke"))}</em>`;
    if (h.params && !h.rerolled) line += ` ${rerollButton(`data-seq="${h.seq}"`)}`;
    // 대미지 주사위(내성보다 큰 눈이 밝게, 크리티컬 추가분은 + 뒤에) — 사용자 요청
    const dice = (h.dmg ?? []).length || (h.critDmg ?? []).length
      ? `<div class="sk-dmg-dice"><small>${esc(L("damageDiceHead", { count: h.diceCount ?? (h.dmg ?? []).length, resist: "\u0000" })).replace("\u0000", `<span data-mask-def>${h.resist ?? "?"}</span>`)}</small> ${(h.dmg ?? []).map((v) => `<span class="die-s ${v > (h.resist ?? 99) ? "over" : ""}">${v}</span>`).join("")}${(h.critDmg ?? []).length ? ` + ${h.critDmg.map((v) => `<span class="die-s crit ${v > (h.resist ?? 99) ? "over" : ""}">${v}</span>`).join("")}` : ""}</div>` : "";
    // 한 번 공격이면 대미지를 「명중」처럼 큰 칸으로(여러 번이면 아래 합계를 크게)
    const big = !multi ? `<div class="hit-result ${h.hit ? "success" : "failure"}">${esc(h.hit ? L("damageBig", { n: h.final }) : L(h.nullified ? "nullBig" : "missBig"))}${h.crit ? ` <b class="crit">${esc(L("crit"))}</b>` : ""}</div>` : "";
    const inner = h.seq ? sub(h.seq) : "";
    out.push(`<li class="${h.hit ? "hit" : "miss"}">${line}${h.hit ? dice : ""}${big}${inner ? `<ul class="per-hit">${inner}</ul>` : ""}</li>`);
  }
  if (e.extra) {
    // 더한 대미지 다이스(《금단의 술식》 등): 공격 카드와 같은 주사위 줄 + 더한 대미지를 큰 칸으로
    const x = e.extra;
    const r = x.resist ?? null;
    const die = (v, cls = "") => `<span class="die-s ${cls} ${r !== null && v > r ? "over" : ""}">${v}</span>`;
    const head = esc(L("extraDiceHead", { count: x.count, resist: "\u0000" })).replace("\u0000", `<span data-mask-def>${r ?? "?"}</span>`);
    out.push(`<li class="hit"><div class="sk-dmg-dice"><small>${head}</small> ${(x.dice ?? []).map((v) => die(v)).join("")}${(x.critExtra ?? []).length ? ` + ${x.critExtra.map((v) => die(v, "crit")).join("")}` : ""}</div>
      <div class="hit-result success">${esc(L("extraBig", { n: x.add }))}${x.crit ? ` <b class="crit">${esc(L("crit"))}</b>` : ""}</div></li>`);
  }
  if (e.damage && hits.length > 1) out.push(`<li class="total"><div class="hit-result success">${esc(L("damageTotal", { n: e.damage }))}</div></li>`);
  for (const x of e.resource ?? []) if (x.recoil) out.push(`<li class="hit">${esc(L("recoil", { n: x.recoil }))}</li>`);
  // 자원 변화(《무사의 마음가짐》 【TP】 +1 등). 회복(heal)·반동·확률 실패는 따로
  for (const x of e.resource ?? []) {
    if (!x.resource || x.chanceFailed) continue;
    const res = x.resource === "tp" ? "TP" : "HP";
    if (x.set !== undefined) out.push(`<li class="state">${esc(L("resourceSet", { res, n: x.set }))}</li>`);
    else if (x.delta) out.push(`<li class="${x.delta > 0 ? "heal" : "hit"}">${esc(L("resourceDelta", { res, n: `${x.delta > 0 ? "+" : ""}${x.delta}` }))}</li>`);
  }
  // 회복 롤의 주사위(기준 이상이 회복량, 사용자 요청)
  // 회복: 굴린 주사위(4 이상이 밝게) + 회복량을 대미지처럼 큰 글씨로(사용자 요청)
  const healDice = (res) => (e.resource ?? []).filter((x) => x.heal === res && x.dice?.length).map((x) => `<div class="nssq-heal-dice"><small>${esc(L("healDiceHead", { count: x.dice.length, min: x.min ?? 4 }))}</small> ${x.dice.map((v) => `<span class="die-s ${v >= (x.min ?? 4) ? "over" : ""}">${v}</span>`).join("")}</div>`).join("");
  for (const res of ["hp", "tp"]) {
    if (e.heal?.[res]) out.push(`<li class="heal">${healDice(res)}<div class="hit-result success">${esc(L(res === "hp" ? "healHp" : "healTp", { n: e.heal[res] }))}</div></li>`);
  }
  for (const i of e.inflicts ?? []) if (!i.seq) out.push(inflictLi(i));
  for (const b of e.buffs ?? []) if (!b.seq) out.push(buffLi(b));
  for (const st of e.states ?? []) out.push(`<li class="state">${esc(L("stateLine", { name: st.name, mods: stateModText(st.mods) }))}</li>`);
  for (const st of e.stances ?? []) {
    // wait: false(《도발》·《캐슬링》 등 「그 턴 동안」)는 대기 상태가 아님
    const key = st.waiting === false ? (st.left ? "keepLineCount" : "keepLine") : st.left ? "stanceLineCount" : "stanceLine";
    out.push(`<li class="state">${esc(L(key, { name: st.name, n: st.left }))}</li>`);
  }
  if (e.revive) out.push(`<li class="heal">${esc(L("revive"))}</li>`);
  if (e.command) out.push(`<li class="state">${esc(L(`command.${e.command}`))}</li>`);
  for (const x of e.resource ?? []) {
    if (x.noEffect) out.push(`<li class="miss">${esc(L("noEffect"))}</li>`);
    if (x.forceRow) out.push(`<li class="${x.resisted ? "resist" : "inflict"}">${esc(L(x.resisted ? "forceRowResisted" : "forceRow", { row: game.i18n.localize(`NSSQ.Row.${x.forceRow}`) }))}${x.fixed ? `<div class="supp-roll">${rollText({ fixed: x.fixed })}</div>` : ""}</li>`);
    if (x.spread) out.push(`<li class="${x.spread.won ? "inflict" : "resist"}">${esc(L(x.spread.won ? "spreadWon" : "spreadLost", { label: x.spread.ids.map(condLabel).join("") || "-" }))}<div class="supp-roll">${rollText({ contest: x.spread })}</div></li>`);
  }
  for (const c of e.cures ?? []) out.push(`<li class="cure">${esc(L(`cure.${c.kind ?? "all"}`))}${c.pick ? `: ${esc(c.pick.map(conditionName).join(", "))}` : c.count !== undefined ? ` ${esc(L("cureCount", { n: c.count }))}` : ""}</li>`);
  for (const x of e.resource ?? []) if (x.chanceFailed && !x.seq) out.push(chanceLi(x));
  return out.join("");
}

/** { physAtk: 2 } → 「물리 공격 +2」 */
export const stateModText = (mods) => Object.entries(mods ?? {}).filter(([, v]) => v).map(([k, v]) => `${game.i18n.localize(`NSSQ.Inventory.${k}`)} ${v >= 0 ? "+" : ""}${v}`).join(", ");

export const renderSkillCard = (card) => renderCard(card);

/** 받침이 있으면 a, 없으면 b(한글·숫자 끝 글자 기준) */
export function josa(word, a, b) {
  const c = String(word ?? "").trim().slice(-1);
  const code = c.charCodeAt(0) - 0xac00;
  if (code >= 0 && code <= 11171) return (code % 28 ? a : b);
  return "013678".includes(c) ? a : b;
}

export function renderCard(card) {
  const head = `<header class="check-header"><span class="check-label"><img src="${esc(card.img)}" width="20" height="20"/> ${esc(card.name)}${card.sl ? ` <small>SL${card.sl}</small>` : ""}${card.group ? ` <b class="seq">${esc(L("hitOf", { n: card.group.index, count: card.group.count }))}</b>` : ""}${["chase", "counter", "delayed", "repeat"].includes(card.followup?.type) ? ` <b class="seq">${esc(L(`followup.${card.followup.type}`))}</b>` : ""}</span><span class="check-kind">${esc(card.userName)}</span></header>`;
  const act = card.activation ? `<p class="activation ${card.activation.ok ? "ok" : "ng"}">${esc(L(card.activation.ok ? "activationOk" : "activationFail", { dice: card.activation.dice.join("+") }))}</p>` : "";
  const fp = card.fpGain ? `<p class="fp-gain">FP +${card.fpGain}</p>` : "";
  // 해설(데이터의 HTML)은 접어 둔다
  const desc = card.description ? `<details class="sk-desc"><summary>${esc(L("description"))}</summary>${card.description}</details>` : "";
  if (card.failed) return `<div class="nssq-skill-card">${head}${desc}${act}${fp}</div>`;
  const rows = card.entries.map((e, i) => `<section class="sk-target" data-index="${i}"><div class="target-name"><i class="fas fa-bullseye"></i> ${esc(e.name)}</div><ul>${entryLines(e, card)}</ul><div class="sk-status"></div></section>`).join("");
  const gm = [
    ...(card.gm ?? []).map((g) => L("gmNeeded", { what: game.i18n.localize(`NSSQ.SkillUse.type.${String(g).split(":")[0]}`) })),
    ...(card.partial ? [L("gmNeeded", { what: card.partial })] : []),
    ...(card.unknownScope ? [L("gmScope")] : [])
  ];
  return `<div class="nssq-skill-card">${head}${desc}${act}${rows}${fp}${gm.map((g) => `<p class="gm-needed"><i class="fas fa-exclamation-triangle"></i> ${esc(g)}</p>`).join("")}
    <div class="sk-apply"><span class="apply-status"></span><span class="apply-buttons"><button type="button" data-sk-apply><i class="fas fa-check"></i> ${esc(L("apply"))}</button><button type="button" data-sk-undo><i class="fas fa-undo"></i> ${esc(L("undo"))}</button></span></div></div>`;
}
