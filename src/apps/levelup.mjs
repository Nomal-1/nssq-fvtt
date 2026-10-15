/**
 * 수동 레벨업(사용자 요청 묶음D, 01 §5).
 * - 레벨은 저장값. 누적 경험점이 다음 레벨 값에 닿으면 system.levelReady → 시트 [레벨업]
 * - 레벨업: Lv +1(능력치의 클래스 보정·HP·TP는 레벨로 다시 계산), 올라간 최대 HP·TP만큼 현재 값도 올림,
 *   그때의 스킬 SL을 플래그 nssq.levelUp에 남겨 스킬 트리가 「한 스킬 +1까지」를 지키게 한다
 * - 플레이어는 레벨·경험점을 직접 못 바꾼다(preUpdateActor). 예외: 레벨업 버튼(nssqLevelUp)·길드 비용(nssqGuild)
 */
import tables from "../generated/tables.mjs";
import { levelFromExp } from "../engine/derive.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Level.${k}`, d) : game.i18n.localize(`NSSQ.Level.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export async function levelUp(actor) {
  if (!actor?.isOwner || actor.type !== "character") return null;
  if (game.combat?.started && game.combat.combatants.some((c) => c.actor?.id === actor.id)) return ui.notifications.warn(L("noBattle"));
  const s = actor.system;
  if (!s.levelReady) return ui.notifications.warn(L("notReady"));
  const from = s.level;
  const to = from + 1;
  const sl = {};
  for (const i of actor.items) if (i.type === "skill" && !i.system.unique) sl[`${i.system.classKey}:${i.system.skillKey}`] = i.system.sl ?? 0;
  const hp0 = s.hp?.max ?? 0;
  const tp0 = s.tp?.max ?? 0;
  await actor.update({ "system.level": to, "flags.nssq.levelUp": { level: to, sl } }, { nssqLevelUp: true });
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
  Hooks.on("preUpdateActor", (actor, change, options) => {
    if (game.user.isGM || actor.type !== "character") return;
    const sys = change.system ?? {};
    const src = actor._source.system ?? {};
    const lvChanged = "level" in sys && sys.level !== src.level;
    const exChanged = "exp" in sys && sys.exp !== src.exp;
    if (!lvChanged && !exChanged) return;
    const okLevel = options.nssqLevelUp && !exChanged && sys.level === src.level + 1
      && levelFromExp(src.exp, tables.levelExp?.levels) >= sys.level;
    const okGuild = options.nssqGuild && !lvChanged && sys.exp <= src.exp;
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
