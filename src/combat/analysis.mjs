/**
 * 에너미 「자세히 보기」(원작의 에너미 정보 화면처럼): 전투 화면에서 에너미 카드를 누르면 뜬다.
 * 공개 범위(07 #47·#48, 사용자 결정) — 도감 기록과 관계없이 이번 전투의 식별 결과대로. 예외: 처치 수가 자동 식별 기준 이상
 * - 기준 이상(자동 식별): Lv·【HP】·부능력치·내성·모든 스킬 사양·모든 DROP
 * - 식별 성공: Lv·【HP】·부능력치·내성, 「식별 시 공개」 스킬과 쓴 적 있는 스킬은 이름·의존 부위만, 얻은 적 있는 DROP
 * - 식별 실패: 모두 ???. 지금 걸린 상태 이상·강화·약화는 보인다(눈에 보이는 것)
 * - GM: 언제나 모두 보이고, 플레이어에게 감춰진 스킬·DROP에 눈 감은 아이콘
 */
import { SUB_STATS, RESISTS } from "../engine/derive.mjs";
import { CONDITIONS } from "../engine/conditions.mjs";
import { BUFFS, MAX_KINDS, canonicalBuff } from "../engine/buffs.mjs";
import { buffEffectText, buffLabel, conditionName } from "./status.mjs";
import { bestiaryEntry, meetsAutoIdentify } from "./bestiary.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const loc = (k) => game.i18n.localize(k);
const A = (k, d) => (d ? game.i18n.format(`NSSQ.Analysis.${k}`, d) : game.i18n.localize(`NSSQ.Analysis.${k}`));
const plain = (html) => String(html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const Q = "???";

/** DROP 한 줄: 「5~9 R2 깃털」 */
const dropText = (d) => `${d.max === null || d.max === undefined ? `${d.min}~` : d.min === d.max ? `${d.min}` : `${d.min}~${d.max}`} ${d.rank ? `R${d.rank} ` : ""}${d.item}`;

export function enemyAnalysisHtml(actor, name) {
  const s = actor?.system ?? {};
  const gm = game.user.isGM;
  // 공개 단계(07 #47·#48): full = 도감 처치 수가 자동 식별 기준 이상(전부), known = 이번 전투 식별 성공
  const full = meetsAutoIdentify(actor);
  const known = !!s.identified;
  const show = gm || full || known;
  const book = bestiaryEntry(actor);
  const rare = s.isRare && (gm || s.rareKnown);

  // 왼쪽: Lv·HP·부능력치·내성
  const cs = s.combatStats ?? s.stats ?? {};
  const stat = (k) => {
    const v = cs[k];
    const changed = v !== s.stats?.[k];
    return `<div class="an-stat"><span>${esc(A(`short.${k}`))}</span><b class="${show && changed ? "changed" : ""}">${show ? esc(v) : Q}</b></div>`;
  };
  const resist = (k) => {
    const v = s.resistTotal?.[k];
    const changed = v !== s.resist?.[k] && known;
    return `<div class="an-res ${k}"><span>${esc(loc(`NSSQ.Resist.${k}`))}</span><b class="${show && changed ? "changed" : ""}">${show ? esc(v) : Q}</b></div>`;
  };
  const left = `
    <div class="an-hp"><span>HP</span><b>${show ? `${esc(s.hp?.value)} / ${esc(s.hp?.max)}` : Q}</b></div>
    <h4>${esc(A("stats"))}</h4><div class="an-stats">${SUB_STATS.map(stat).join("")}</div>
    <h4>${esc(A("resist"))}</h4><div class="an-resists">${RESISTS.map(resist).join("")}</div>
    ${!known ? `<p class="an-note">${esc(A("unknownNote"))}</p>` : ""}`;

  // 가운데: 스킬·DROP
  const skills = (actor?.items?.contents ?? []).filter((i) => i.type === "skill");
  const seen = (i) => (book.skills ?? []).includes(i.name);
  // 식별 성공: 간파로 공개되는 스킬(스킬의 「식별 시 공개」)과 쓴 스킬의 이름·의존 부위만
  const partial = (i) => known && (i.system.reveal !== false || seen(i));
  const spec = (i) => [i.system.timing, i.system.range, i.system.target].filter((x) => x && x !== "-").join(" / ") + (i.system.description ? ` — ${plain(i.system.description)}` : "");
  const fullLine = (i, mark = false) => `<li title="${esc(spec(i))}">${mark ? `<i class="fas fa-eye-slash" title="${esc(A("hiddenFromPlayers"))}"></i> ` : ""}${esc(i.name)}<small>${esc(i.system.timing ?? "")}</small></li>`;
  const partLine = (i) => `<li>${esc(i.name)}<small>${esc(A("part", { part: i.system.part && i.system.part !== "-" ? i.system.part : A("noPart") }))}</small></li>`;
  const qRow = `<li class="q">${Q}</li>`;
  const skillRows = gm ? skills.map((i) => fullLine(i, !full && !partial(i)))
    : full ? skills.map((i) => fullLine(i))
      : known ? skills.map((i) => (partial(i) ? partLine(i) : qRow))
        // 식별 실패: 전부 감춤(칸 수도 고정)
        : Array.from({ length: 3 }, () => qRow);
  // DROP: 전부 공개 단계면 전부, 식별 성공이면 얻은 적이 있는 것만
  const drops = s.drops ?? [];
  const got = (d) => (book.drops ?? []).includes(`${d.rank ? `R${d.rank} ` : ""}${d.item}`);
  const dropLine = (d, mark = false) => `<li>${mark ? `<i class="fas fa-eye-slash" title="${esc(A("hiddenFromPlayers"))}"></i> ` : ""}${esc(dropText(d))}</li>`;
  const dropRows = gm ? drops.map((d) => dropLine(d, !full && !(known && got(d))))
    : full ? drops.map((d) => dropLine(d))
      : known ? drops.map((d) => (got(d) ? dropLine(d) : qRow))
        : Array.from({ length: 2 }, () => qRow);
  const middle = `
    <h4>SKILL</h4><ul class="an-list">${skillRows.join("") || `<li class="empty">${esc(A("none"))}</li>`}</ul>
    <h4>DROP</h4><ul class="an-list">${dropRows.join("") || `<li class="empty">${esc(A("none"))}</li>`}</ul>`;

  // 오른쪽: 강화 3칸·약화 3칸·상태 이상·봉인(눈에 보이므로 식별과 관계없이)
  const buffs = (s.buffs ?? []).filter((b) => BUFFS[canonicalBuff(b.id)]);
  const slots = (kind) => {
    const list = buffs.filter((b) => BUFFS[canonicalBuff(b.id)].kind === kind);
    const rows = list.map((b) => `<li class="${kind}" title="${esc(buffEffectText(b))}"><span>『${esc(buffLabel(b))}』</span><small>${esc(A("turns", { n: b.turns }))}</small></li>`);
    while (rows.length < MAX_KINDS) rows.push(`<li class="slot">— — — — —</li>`);
    return rows.join("");
  };
  const conds = (s.conditions ?? []).filter((c) => CONDITIONS[c.id]);
  const condRows = conds.map((c) => {
    const bind = CONDITIONS[c.id].kind === "bind";
    const label = bind ? conditionName(c.id) : `[${conditionName(c.id)}]`;
    const depth = c.depth === null || c.depth === undefined ? "" : `<small>${esc(game.i18n.format("NSSQ.StatusHint.depth", { n: c.depth }))}</small>`;
    return `<li class="${CONDITIONS[c.id].kind}" title="${esc(loc(`NSSQ.StatusHint.${c.id}`))}"><span>${esc(label)}</span>${depth}</li>`;
  });
  const right = `
    <h4 class="buff">${esc(loc("NSSQ.StatusPanel.buffs"))}</h4><ul class="an-slots">${slots("buff")}</ul>
    <h4 class="debuff">${esc(loc("NSSQ.StatusPanel.debuffs"))}</h4><ul class="an-slots">${slots("debuff")}</ul>
    <h4 class="ailment">${esc(A("conditions"))}</h4><ul class="an-slots">${condRows.join("") || `<li class="slot">${esc(A("none"))}</li>`}</ul>`;

  return `<header>
      <span class="name">${rare ? `<span class="rare">★</span>` : ""}${esc(name)}</span>
      <span class="lv">Lv ${show ? esc(s.level) : Q}</span>${s.isFOE ? `<span class="foe">F.O.E.</span>` : ""}
      ${gm ? `<span class="gm-note">${esc(full ? A("gmFull", { n: book.defeated ?? 0 }) : known ? A("gmKnown") : A("gmHidden"))}</span>` : ""}
      <a data-pop-close title="${esc(loc("NSSQ.StatusPanel.close"))}"><i class="fas fa-times"></i></a>
    </header>
    <div class="an-cols"><div class="an-col left">${left}</div><div class="an-col mid">${middle}</div><div class="an-col right">${right}</div></div>`;
}
