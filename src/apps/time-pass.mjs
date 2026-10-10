/**
 * 탐색 시간 경과(07 #164, 사용자 결정): 1시간(랜덤 던전 1턴 = 베이직 던전 1세그먼트)마다 파티의
 *  - [독] 대미지 → 자연 회복(심도를 목표값으로 억제 방어 롤) → 심도 −1 (종료 페이즈와 같은 순서, engine/end-phase.mjs)
 *  - 오버히트 −1(원문 「랜덤 던전 1턴당·베이직 던전 1세그먼트당 1씩 회복」)
 * 상태 이상 결과는 종료 페이즈 카드와 같은 모양(flags.nssq.endPhase)이라 [적용]·[되돌리기]·「자동 적용」 설정을 그대로 따른다.
 * 오버히트는 바로 줄인다.
 */
import { endPhaseFor } from "../engine/end-phase.mjs";
import { CONDITIONS } from "../engine/conditions.mjs";
import { combatProfile } from "../combat/profile.mjs";
import { autoApplyMode } from "../combat/apply.mjs";
import { applyEndPhase, logLine, roll2d6 } from "../combat/turn-status.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.TimePass.${k}`, d) : game.i18n.localize(`NSSQ.TimePass.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * 전투 중 흐른 시간(원작 세계수의 미궁: 1걸음·전투 1턴 = 2분, 07 #165): 라운드가 지날 때마다 2분을 쌓고 60분이면 시각 +1시간.
 * 상태 이상·오버히트는 전투의 종료 페이즈가 처리하므로 여기서는 시각(필드 지도·랜덤 던전)과 시간대, 어둠만 바꾼다
 */
export async function battleMinutes(combat, minutes = 2) {
  if (!game.user.isGM) return;
  let m = Number(game.settings.get("nssq", "battleMinutes") ?? 0) + minutes;
  const hours = Math.floor(m / 60);
  m -= hours * 60;
  await game.settings.set("nssq", "battleMinutes", m);
  if (hours > 0) await advanceClock(hours, combat);
}

/** 시각만 h시간(필드 지도·랜덤 던전의 시각과 시간대). 진행 중인 전투의 어둠(자동)도 따라 바뀐다 */
export async function advanceClock(hours, combat = null) {
  const { timeOfDayAt } = await import("../engine/dungeon.mjs");
  let hour = await (await import("./fieldmap.mjs")).shiftHour(hours);
  const dg = game.settings.get("nssq", "dungeon") ?? {};
  if (dg.active) {
    hour = ((dg.hour ?? 0) + hours) % 24;
    await game.settings.set("nssq", "dungeon", { ...dg, hour });
  }
  if (hour === null || hour === undefined) {
    return ChatMessage.create({ speaker: { alias: L("speaker") }, content: `<div class="nssq-combat-note"><i class="fas fa-clock"></i> ${esc(L("battleHourNoClock", { n: hours }))}</div>` });
  }
  const tod = timeOfDayAt(hour);
  if (tod !== game.settings.get("nssq", "timeOfDay")) await game.settings.set("nssq", "timeOfDay", tod);
  const info = combat?.getFlag("nssq", "battle");
  let darkNote = "";
  if (info?.darkAuto && !!info.dark !== (tod === "night")) {
    await combat.setFlag("nssq", "battle", { ...info, dark: tod === "night" });
    darkNote = ` ${L(tod === "night" ? "darkStart" : "darkEnd")}`;
  }
  return ChatMessage.create({ speaker: { alias: L("speaker") }, content: `<div class="nssq-combat-note"><i class="fas fa-clock"></i> ${esc(L("battleHour", { n: hours, h: hour, tod: game.i18n.localize(`NSSQ.Dungeon.tod.${tod}`) }) + darkNote)}</div>` });
}

/** 시간으로 처리할 상태 이상이 있는가(심도가 있는 것, [스턴]) */
const ticking = (list) => (list ?? []).some((c) => CONDITIONS[c.id]?.depth || c.id === "stun");

/**
 * @param {number} hours 지난 시간(세그먼트·턴)
 * @param {{ noAilments?: boolean }} [opts] noAilments: 상태 이상은 처리하지 않는다(《약효 요리》가 있는 캠프: 캠프 카드가 먼저 고친다)
 */
export async function timePasses(hours = 1, { noAilments = false } = {}) {
  if (!game.user.isGM || !(hours > 0)) return null;
  const members = (await import("./gm-screen.mjs")).partyActors();
  for (const a of members) {
    const v = Number(a.getFlag("nssq", "overheat") ?? 0);
    if (v > 0) await (v > hours ? a.setFlag("nssq", "overheat", v - hours) : a.unsetFlag("nssq", "overheat"));
  }
  if (noAilments) return null;
  const rolls = [];
  const updates = [];
  const blocks = [];
  for (const a of members) {
    const s = a.system;
    if (!ticking(s.conditions)) continue;
    const p = combatProfile(a, null);
    let hp = s.hp?.value ?? 0;
    let conditions = s.conditions ?? [];
    const lines = [];
    for (let h = 1; h <= hours && ticking(conditions); h++) {
      // 독을 건 자는 전투에 없으니 걸 때 기록한 【억제 공격】(07 #43)
      const r = await endPhaseFor({ hp: { value: hp, max: s.hp?.max ?? hp }, tp: null, suppDef: p.suppDef, condResist: p.condResist, conditions, buffs: [] }, () => roll2d6(rolls));
      for (const e of r.log) lines.push(`${hours > 1 ? `${L("hour", { h })} ` : ""}${logLine(e)}`);
      hp = r.hp;
      conditions = r.conditions;
    }
    if (!lines.length) continue;
    updates.push({
      uuid: a.uuid,
      after: { hp, tp: null, conditions, buffs: s.buffs ?? [] },
      before: { hp: s.hp?.value ?? 0, tp: null, conditions: s.conditions ?? [], buffs: s.buffs ?? [] }
    });
    blocks.push(`<li><b>${esc(a.name)}</b><ul>${lines.map((x) => `<li>${esc(x)}</li>`).join("")}</ul><span class="hp-line">${esc(game.i18n.format("NSSQ.Turn.hpLine", { before: s.hp?.value ?? 0, after: hp }))}</span></li>`);
  }
  if (!updates.length) return null;
  const body = `<ul class="end-units">${blocks.join("")}</ul>`;
  const content = `<div class="nssq-end-phase"><header class="check-header"><span class="check-label"><i class="fas fa-hourglass-half"></i> ${esc(L("title", { n: hours }))}</span></header>
    ${body}
    <div class="end-apply"><span class="apply-status"></span><span class="apply-buttons"><button type="button" data-end-apply><i class="fas fa-check"></i> ${esc(game.i18n.localize("NSSQ.Turn.apply"))}</button><button type="button" data-end-undo><i class="fas fa-undo"></i> ${esc(game.i18n.localize("NSSQ.Turn.undo"))}</button></span></div>
  </div>`;
  const message = await ChatMessage.create({
    speaker: { alias: L("speaker") },
    rolls, sound: rolls.length ? CONFIG.sounds.dice : undefined,
    content,
    flags: { nssq: { endPhase: { updates, applied: false, round: null, combatId: null, field: true, body } } }
  });
  if (autoApplyMode() === "auto") await applyEndPhase(message.id);
  return message;
}
