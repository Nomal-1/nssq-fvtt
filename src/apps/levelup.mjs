/**
 * 수동 레벨업(사용자 요청 묶음D, 01 §5).
 * - 레벨은 저장값. 누적 경험점이 다음 레벨 값에 닿으면 system.levelReady → 시트 [레벨업]
 * - 레벨업: Lv +1(능력치의 클래스 보정·HP·TP는 레벨로 다시 계산), 올라간 최대 HP·TP만큼 현재 값도 올림,
 *   그때의 스킬 SL을 플래그 nssq.levelUp에 남겨 스킬 트리가 「한 스킬 +1까지」를 지키게 한다
 * - 플레이어는 레벨·경험점을 직접 못 바꾼다(preUpdateActor). 예외: 레벨업 버튼(nssqLevelUp)·길드 비용(nssqGuild: 경험점 감소·Lv1로)
 */
import tables from "../generated/tables.mjs";
import { levelFromExp } from "../engine/derive.mjs";

/**
 * 스킬 습득 창구(사용자 결정): 플레이어는 캐릭터 작성 중, 레벨업한 그 레벨, 길드 재분배·직업 변경(Lv1로 돌아감) 직후에만 스킬을 찍는다.
 * 창구는 플래그 nssq.skillPick = { level }(그 레벨인 동안 열림). GM은 언제나
 */
export function skillPickOpen(actor, user = game.user) {
  if (user?.isGM || actor?.type !== "character") return true;
  if (!actor.system.creation?.locked) return true;
  return actor.getFlag("nssq", "skillPick")?.level === actor.system.level;
}

/** 남은 SL(습득 창구가 열려 있을 때만 의미가 있다) */
export async function skillLeft(actor) {
  const { skillBudget } = await import("../engine/skills.mjs");
  const skills = actor.items.filter((i) => i.type === "skill" && !i.flags?.nssq?.grimoireOf).map((i) => ({ sl: i.system.sl ?? 0, unique: !!i.system.unique, common: i.system.classKey === "common" }));
  return skillBudget({ level: actor.system.level, skills, bonus: actor.system.skillBonus ?? 0 }).left;
}

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Level.${k}`, d) : game.i18n.localize(`NSSQ.Level.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const leveling = new Set(); // 진행 중인 액터 id(빠른 두 번 클릭으로 HP·TP 증가가 두 번 들어가지 않게)

export async function levelUp(actor) {
  if (!actor?.isOwner || actor.type !== "character" || leveling.has(actor.id)) return null;
  leveling.add(actor.id);
  try { return await doLevelUp(actor); } finally { leveling.delete(actor.id); }
}

async function doLevelUp(actor) {
  if (game.combat?.started && game.combat.combatants.some((c) => c.actor?.id === actor.id)) return ui.notifications.warn(L("noBattle"));
  const s = actor.system;
  if (!s.levelReady) return ui.notifications.warn(L("notReady"));
  // 지난 레벨(또는 재분배)의 SL을 다 찍기 전에는 다음 레벨업을 못 한다(창구가 닫혀 SL이 사라지지 않게). GM은 확인 후 가능
  if (s.creation?.locked && actor.getFlag("nssq", "skillPick")?.level === s.level) {
    const left = await skillLeft(actor);
    if (left > 0) {
      if (!game.user.isGM) return ui.notifications.warn(L("spendFirst", { n: left }));
      if (!(await Dialog.confirm({ title: L("up"), content: `<p>${esc(L("spendFirstGM", { n: left }))}</p>`, rejectClose: false }))) return null;
    }
  }
  const from = s.level;
  const to = from + 1;
  const sl = {};
  for (const i of actor.items) if (i.type === "skill" && !i.system.unique && !i.flags?.nssq?.grimoireOf) sl[`${i.system.classKey}:${i.system.skillKey}`] = i.system.sl ?? 0;
  const hp0 = s.hp?.max ?? 0;
  const tp0 = s.tp?.max ?? 0;
  await actor.update({ "system.level": to, "flags.nssq.levelUp": { level: to, sl }, "flags.nssq.skillPick": { level: to } }, { nssqLevelUp: true });
  const n = actor.system;
  const dh = Math.max(0, (n.hp?.max ?? 0) - hp0);
  const dt = Math.max(0, (n.tp?.max ?? 0) - tp0);
  if (dh || dt) await actor.update({ "system.hp.value": (n.hp?.value ?? 0) + dh, "system.tp.value": (n.tp?.value ?? 0) + dt });
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="nssq-levelup-card"><i class="fas fa-level-up-alt"></i> <b>${esc(L("card", { name: actor.name, from, to, sl: 3 }))}</b>`
      + `<br><small>HP ${hp0} → ${n.hp?.max ?? 0} · TP ${tp0} → ${n.tp?.max ?? 0}</small></div>`
  });
  const { SkillTree } = await import("./skill-tree.mjs");
  new SkillTree(actor).render(true);
  return to;
}

export function registerLevelUp() {
  // 창구가 닫혀 있으면 플레이어는 스킬을 새로 배우거나 SL을 올릴 수 없다(★ 자동 스킬·GM 예외)
  // 그리모어 복사본(combat/grimoire.mjs)은 예외
  const closed = (item) => item.type === "skill" && !item.system.unique && !item.flags?.nssq?.grimoireOf && item.parent?.type === "character" && !skillPickOpen(item.parent);
  Hooks.on("preCreateItem", (item) => {
    if (!closed(item)) return true;
    ui.notifications.warn(L("pickClosed"));
    return false;
  });
  Hooks.on("preUpdateItem", (item, changes, options) => {
    const sl = foundry.utils.getProperty(changes, "system.sl");
    if (options.nssqRespec || sl === undefined || sl <= (item.system.sl ?? 0) || !closed(item)) return true;
    ui.notifications.warn(L("pickClosed"));
    return false;
  });
  Hooks.on("preUpdateActor", (actor, change, options) => {
    if (game.user.isGM || actor.type !== "character") return;
    const sys = change.system ?? {};
    const src = actor._source.system ?? {};
    const lvChanged = "level" in sys && sys.level !== src.level;
    const exChanged = "exp" in sys && sys.exp !== src.exp;
    if (!lvChanged && !exChanged) return;
    const okLevel = options.nssqLevelUp && !exChanged && sys.level === src.level + 1
      && levelFromExp(src.exp, tables.levelExp?.levels) >= sys.level;
    const okGuild = options.nssqGuild && (!exChanged || sys.exp <= src.exp) && (!lvChanged || sys.level === 1);
    if (okLevel || okGuild) return;
    delete sys.level;
    delete sys.exp;
    ui.notifications.warn(L("locked"));
  });
}

/** v0.29.0: 레벨이 경험점으로 정해지던 때의 캐릭터는 저장된 레벨을 지금 경험점의 레벨로 맞춘다(한 번, 활성 GM) */
export async function migrateManualLevel() {
  if (game.settings.get("nssq", "levelManualMigrated")) return;
  const levels = tables.levelExp?.levels ?? [];
  const updates = [];
  for (const a of game.actors.filter((x) => x.type === "character")) {
    const lv = levelFromExp(a.system.exp, levels);
    if ((Number(a._source.system?.level) || 1) !== lv) updates.push({ _id: a.id, "system.level": lv });
  }
  if (updates.length) await Actor.updateDocuments(updates);
  await game.settings.set("nssq", "levelManualMigrated", true);
  if (updates.length) ui.notifications.info(L("manualMigrated", { n: updates.length }));
}
