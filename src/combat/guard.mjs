/**
 * 가드·도발·반사·오라를 공격 흐름에 연결(단계 8-C). 계산은 engine/guards.mjs
 * 통상 공격(attack.mjs)·스킬 공격(skill-use.mjs)이 공격 롤 전에 guardAttack → 대상 교체·방어 값 보정,
 * 공격 롤 뒤 commit(명중한 대상) → 횟수 차감과 안내 한 줄
 */
import { applySpends, planGuards } from "../engine/guards.mjs";
import { combatProfile, sideOf } from "./profile.mjs";
import { actionState } from "./turn-status.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Guard.${k}`, d) : game.i18n.localize(`NSSQ.Guard.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const alive = (c) => !!c?.actor && !c.defeated && (c.actor.system.hp?.value ?? 0) > 0;
const unitSide = (actor) => (sideOf(actor) === "enemy" ? "enemy" : "party");

const pass = (targets) => ({ targets, apply: () => {}, commit: async () => {}, reflected: false });

/**
 * @param {object} p
 * @param {Actor} p.attacker
 * @param {Combatant[]} p.targets 대상 전투원(순서대로)
 * @param {"physical"|"elemental"} p.kind
 * @param {string[]} p.elements
 * @param {boolean} p.single 단일 대상 공격(도발 대상)
 * @param {boolean} [p.noRedirect] 무작위 대상 등: 대상은 바꾸지 않고 방어 값만
 * @returns {Promise<{ targets: Combatant[], apply: (profile) => void, commit: (hitIds: Set<string>) => Promise<void>, reflected: boolean }>}
 */
export async function guardAttack({ attacker, targets, kind, elements, single, noRedirect = false }) {
  const combat = game.combat;
  if (!combat?.started || !targets.length) return pass(targets);
  const me = combat.combatants.find((c) => c.actor?.uuid === attacker.uuid);
  if (!me) return pass(targets);
  const units = combat.combatants.filter((c) => c.actor).map((c) => ({
    id: c.id, side: unitSide(c.actor), row: c.actor.system.row ?? "front",
    ko: !alive(c) || actionState(c).noAction,
    defense: combatProfile(c.actor, c).defense,
    stances: c.getFlag("nssq", "stances") ?? [],
    autoTrigger: c.actor.getFlag("nssq", "autoTrigger") ?? {}
  }));
  if (!units.some((u) => u.stances.length)) return pass(targets);
  // 《디바이드 모드》(대신 받을지 고름): 에너미의 공격은 GM 화면에서 굴리므로 이 화면에서 묻는다
  const decide = async ({ holder, stance, target }) => {
    const h = combat.combatants.get(holder.id);
    if (!h?.actor?.isOwner) return false;
    return Dialog.confirm({
      title: L("coverTitle"),
      content: `<p>${esc(L("coverAsk", { holder: h.name, skill: `《${stance.name}》`, target: combat.combatants.get(target.id)?.name ?? "" }))}</p>`,
      rejectClose: false
    });
  };
  const plan = await planGuards({
    attack: { kind, elements, single, noRedirect }, attacker: { id: me.id, side: unitSide(attacker) },
    targets: targets.map((c) => c.id), units, decide
  });
  const name = (id) => combat.combatants.get(id)?.name ?? "?";
  return {
    reflected: !!plan.reflected,
    targets: plan.targets.map((id) => combat.combatants.get(id)).filter(Boolean),
    /** 대상 프로필(unitProfile·combatProfile)에 반감·【방어】·【내성】 보정 */
    apply(profile) {
      const m = plan.mods[profile.id];
      if (!m) return;
      if (m.half) profile.guardHalf = true;
      if (m.defense) profile.defense = m.defense.value;
      if (m.resist) {
        const add = (r) => {
          const out = { ...(r ?? {}) };
          for (const [k, v] of Object.entries(m.resist)) out[k] = (out[k] ?? 0) + v;
          return out;
        };
        profile.resist = add(profile.resist);
        if (profile.resistAwake) profile.resistAwake = add(profile.resistAwake);
      }
    },
    /** 공격 롤 뒤: 횟수 차감(반감·【방어】는 명중한 대상만) + 안내 */
    async commit(hitIds = new Set()) {
      const spends = [...plan.spendNow, ...Object.entries(plan.spendOnHit).filter(([id]) => hitIds.has(id)).flatMap(([, l]) => l)];
      const next = applySpends(spends, (id) => combat.combatants.get(id)?.getFlag("nssq", "stances") ?? []);
      for (const [id, list] of next) await combat.combatants.get(id)?.setFlag("nssq", "stances", list);
      const lines = plan.notes.map((n) => L(n.type === "reflect" && n.nullified ? "reflectNullify" : n.type, { skill: `《${n.name}》`, holder: name(n.holder), from: name(n.from), to: name(n.to), n: n.nullified ?? 0 }));
      for (const [id, m] of Object.entries(plan.mods)) {
        if (!hitIds.has(id)) continue;
        if (m.half) lines.push(L("half", { skill: `《${m.half.name}》`, holder: name(m.half.unitId), target: name(id) }));
        if (m.defense) lines.push(L("defense", { skill: `《${m.defense.name}》`, holder: name(m.defense.unitId), target: name(id), n: m.defense.value }));
      }
      // 【내성】 보정은 그 속성이 든 공격일 때만 안내
      for (const [id, m] of Object.entries(plan.mods)) {
        const rel = Object.entries(m.resist ?? {}).filter(([k]) => (elements ?? []).includes(k));
        if (rel.length) lines.push(L("resist", { target: name(id), list: rel.map(([k, v]) => `${game.i18n.localize(`NSSQ.Resist.${k}`)} +${v}`).join(", ") }));
      }
      if (!lines.length) return;
      await ChatMessage.create({ speaker: { alias: game.i18n.localize("NSSQ.Combat.tracker") }, content: `<div class="nssq-combat-note"><i class="fas fa-shield-alt"></i> ${lines.map(esc).join("<br>")}</div>` });
    }
  };
}
