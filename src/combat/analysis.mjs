/**
 * 에너미 「자세히 보기」(원작의 에너미 정보 화면처럼): 전투 화면에서 에너미 카드를 누르면 뜬다.
 * 공개 범위(07 #47, 사용자 결정)
 * - 「안다」 = 이번 전투에서 식별했거나 도감에 식별·처치 기록이 있다(combat/bestiary.mjs)
 * - 모르면: Lv·【HP】·부능력치·내성은 ???. 지금 걸린 상태 이상·강화·약화는 보인다(눈에 보이는 것)
 * - 스킬: 알고 + 스킬의 「식별 시 공개」가 켜져 있으면, 또는 전투에서 쓴 적이 있으면 이름. 나머지는 ???
 * - DROP: 실제로 얻은 것만(도감). 나머지는 ???
 * - GM: 언제나 모두 보이고, 플레이어에게 감춰진 것은 표시
 */
import { SUB_STATS, RESISTS } from "../engine/derive.mjs";
import { CONDITIONS } from "../engine/conditions.mjs";
import { BUFFS, MAX_KINDS, canonicalBuff } from "../engine/buffs.mjs";
import { buffEffectText, buffLabel, conditionName } from "./status.mjs";
import { bestiaryEntry, knowsEnemy } from "./bestiary.mjs";

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
  const known = knowsEnemy(actor);
  const show = gm || known;
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
    // 이번 전투에서 식별했으면 지금 값(상태·강화 반영), 도감으로만 알면 원래 값(전투 처리는 최소 3)
    const v = s.identified ? s.resistTotal?.[k] : s.resist?.[k];
    const changed = v !== s.resist?.[k] && !!s.identified;
    return `<div class="an-res ${k}"><span>${esc(loc(`NSSQ.Resist.${k}`))}</span><b class="${show && changed ? "changed" : ""}">${show ? esc(v) : Q}</b></div>`;
  };
  const left = `
    <div class="an-hp"><span>HP</span><b>${show ? `${esc(s.hp?.value)} / ${esc(s.hp?.max)}` : Q}</b></div>
    <h4>${esc(A("stats"))}</h4><div class="an-stats">${SUB_STATS.map(stat).join("")}</div>
    <h4>${esc(A("resist"))}</h4><div class="an-resists">${RESISTS.map(resist).join("")}</div>
    ${!s.identified ? `<p class="an-note">${esc(A("unknownNote"))}</p>` : ""}`;

  // 가운데: 스킬·DROP
  const skills = (actor?.items?.contents ?? []).filter((i) => i.type === "skill");
  // 스킬: 이름이 보이는가(플레이어). GM은 모두 보이고 감춰진 것에 눈 표시
  const seen = (i) => (book.skills ?? []).includes(i.name);
  const visible = (i) => seen(i) || (known && i.system.reveal !== false);
  const skillLine = (i) => `<li title="${esc([i.system.timing, i.system.range, i.system.target].filter((x) => x && x !== "-").join(" / ") + (i.system.description ? ` — ${plain(i.system.description)}` : ""))}">${gm && !visible(i) ? `<i class="fas fa-eye-slash" title="${esc(A("hiddenFromPlayers"))}"></i> ` : ""}${esc(i.name)}<small>${esc(i.system.timing ?? "")}</small></li>`;
  const qRow = `<li class="q">${Q}</li>`;
  const skillRows = gm ? skills.map(skillLine)
    : known ? skills.map((i) => (visible(i) ? skillLine(i) : qRow))
      // 모르면 쓴 것만 보이고, 칸 수는 고정(개수도 알 수 없게)
      : [...skills.filter(seen).map(skillLine), ...Array.from({ length: Math.max(0, 3 - skills.filter(seen).length) }, () => qRow)];
  // DROP: 실제로 얻은 것만
  const drops = s.drops ?? [];
  const got = (d) => (book.drops ?? []).includes(`${d.rank ? `R${d.rank} ` : ""}${d.item}`);
  const dropLine = (d) => `<li>${gm && !got(d) ? `<i class="fas fa-eye-slash" title="${esc(A("hiddenFromPlayers"))}"></i> ` : ""}${esc(dropText(d))}</li>`;
  const dropRows = gm ? drops.map(dropLine)
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
      ${gm ? `<span class="gm-note">${esc(known ? A("gmBook", { n: book.defeated ?? 0 }) : A("gmHidden"))}</span>` : ""}
      <a data-pop-close title="${esc(loc("NSSQ.StatusPanel.close"))}"><i class="fas fa-times"></i></a>
    </header>
    <div class="an-cols"><div class="an-col left">${left}</div><div class="an-col mid">${middle}</div><div class="an-col right">${right}</div></div>`;
}
