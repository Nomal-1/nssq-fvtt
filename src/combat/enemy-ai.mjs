/**
 * 에너미 랜덤 행동(GM 보조): 메인 페이즈 에너미 차례에 [랜덤 행동]을 누르면
 * 통상 공격과 그 에너미의 「주행동」 스킬 중 하나를 같은 확률로 고르고, 사거리 안의 대상도 무작위로 고른다.
 * - 통상 공격: 바로 실행(공격 카드)
 * - 스킬: 아직 효과 자동화 전이므로(로드맵 6~7단계) 고른 스킬·대상·해설을 카드로 보이고 GM이 처리한다
 */
import { inRange, pickRandom } from "../engine/combat.mjs";
import { normalAttack } from "./attack.mjs";
import { combatProfile, friendly } from "./profile.mjs";
import { recordBestiary } from "./bestiary.mjs";
import { enemyUseSkill } from "./skill-use.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.EnemyAI.${k}`, d) : game.i18n.localize(`NSSQ.EnemyAI.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const rng = () => CONFIG.Dice.randomUniform();
const alive = (c) => !c.defeated && (c.actor?.system.hp?.value ?? 0) > 0;

/** 사거리 안의 상대 편(range: 근·원·-) */
function targetsInRange(combat, me, range) {
  const row = me.actor.system.row ?? "front";
  return combat.combatants.filter((c) => c.actor && alive(c) && !friendly(me.actor, c.actor))
    .filter((c) => range === "-" || range === "" || inRange(range, row, c.actor.system.row ?? "front"));
}

/** 대상 문구: 「적 단일」 등은 무작위 하나, 그 밖(전체·열·자신)은 문구 그대로 */
function pickTarget(combat, me, skill) {
  const t = skill.system.target ?? "";
  if (/자신/.test(t)) return { text: me.name, token: null };
  if (/단일|단체|1체/.test(t)) {
    const c = pickRandom(targetsInRange(combat, me, skill.system.range ?? "-"), rng);
    return c ? { text: c.name, token: c.token } : null;
  }
  return { text: t || "-", token: null };
}

export async function randomEnemyAction(combat) {
  const me = combat?.combatant;
  if (!game.user.isGM || !me?.actor || me.actor.type !== "enemy" || !alive(me)) return;
  const skills = me.actor.items.filter((i) => i.type === "skill" && i.system.timing === "주행동");
  const choice = pickRandom([{ kind: "attack" }, ...skills.map((s) => ({ kind: "skill", skill: s }))], rng);
  if (choice.kind === "attack") {
    const a = combatProfile(me.actor, me);
    const target = pickRandom(targetsInRange(combat, me, a.range), rng);
    if (!target) return ui.notifications.warn(L("noTarget", { name: me.name }));
    await ChatMessage.create({
      speaker: { alias: game.i18n.localize("NSSQ.Combat.tracker") },
      content: `<div class="nssq-combat-note"><i class="fas fa-dice"></i> ${L("chosenAttack", { name: esc(me.name), target: esc(target.name) })}</div>`
    });
    return normalAttack(me.actor, { target: target.token });
  }
  const skill = choice.skill;
  // 효과 데이터가 있는 스킬은 사용 흐름으로 자동 처리(단계 6)
  if (skill.system.effects?.length) {
    await ChatMessage.create({
      speaker: { alias: game.i18n.localize("NSSQ.Combat.tracker") },
      content: `<div class="nssq-combat-note"><i class="fas fa-dice"></i> ${L("chosenSkill", { name: esc(me.name), skill: esc(skill.name) })}</div>`
    });
    return enemyUseSkill(combat, me, skill);
  }
  // 사용한 스킬은 플레이어에게 공개(도감)
  await recordBestiary(me.actor, { skill: skill.name });
  const target = pickTarget(combat, me, skill);
  await ChatMessage.create({
    speaker: { alias: game.i18n.localize("NSSQ.Combat.tracker") },
    content: `<div class="nssq-combat-note nssq-enemy-skill"><b><i class="fas fa-dice"></i> ${L("chosenSkill", { name: esc(me.name), skill: esc(skill.name) })}</b>
      <p>${L("target")}: <b>${esc(target?.text ?? L("noOne"))}</b> · ${L("range")} ${esc(skill.system.range ?? "-")} · ${esc(skill.system.target ?? "")}</p>
      ${skill.system.description ?? ""}
      <p class="notes">${L("manual")}</p></div>`
  });
}
