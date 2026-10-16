/**
 * 추가 컨텐츠 아이템의 「사용」 효과(effects `itemUse`, 03·07 #168). 피해·회복 판정 없이 문서를 바꾸는 것들
 * - boon(「~의 보전」): 그 캐릭터의 능력치 보전 칸 +1(영구). 전투 밖에서만
 * - skillBook(「비전의 서」): 스킬 포인트(skillBonus) +1, 습득 창구를 열고 스킬 트리를 띄운다. 전투 밖에서만
 * - analyze(「해석 글라스」): 적 하나의 모든 정보를 이 전투 동안 공개(식별·희소종 간파 포함, 도감에 식별 기록). 전투 중에만
 * - dissect(「해부용 수용액」): 사용한 턴에 쓰러진 적은 갈무리 뒤 모든 드롭을 1개씩(apps/loot.mjs). 전투 중에만
 * 전투 중 쓸 수 있는 페이즈는 `phases`(기본 메인 페이즈만)
 */
import { emit, onSocket } from "../socket.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.ItemUse.${k}`, d) : game.i18n.localize(`NSSQ.ItemUse.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const FIELD_ONLY = ["boon", "skillBook"];
const SHORT = { str: "STR", tec: "TEC", vit: "VIT", agi: "AGI", luc: "LUC" };

/** 아이템의 itemUse 효과(없으면 null) */
export const itemUseOf = (item) => (item?.system?.effects ?? []).find((e) => e?.type === "itemUse") ?? null;

/** 개막 페이즈에 쓸 수 있는 itemUse 아이템을 가졌는가(전투 화면 개막 줄의 [아이템] 버튼) */
export const hasOpeningItem = (actor) => actor?.items.some((i) => i.type === "consumable" && (i.system.quantity ?? 0) > 0 && !i.system.stored && (itemUseOf(i)?.phases ?? []).includes("opening"));

/**
 * 지금 쓸 수 없는 까닭(NSSQ.SkillUse.reason 키) 또는 null
 * @param {{inCombat: boolean, phase?: string, myTurn?: boolean, openingDone?: boolean}} st
 */
export function itemUseReason(use, { inCombat, phase = null, myTurn = false, openingDone = false }) {
  const field = FIELD_ONLY.includes(use.action);
  if (inCombat && field) return "fieldOnly";
  if (!inCombat) return field ? null : "combatOnly";
  const phases = use.phases ?? ["main"];
  if (!phases.includes(phase)) return phases.length > 1 ? "itemPhase" : "notMain";
  if (phase === "main" && !myTurn) return "notTurn";
  if (phase === "opening" && openingDone) return "openingDone";
  return null;
}

const note = (actor, text) => ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<div class="nssq-combat-note nssq-item-use"><i class="fas fa-flask"></i> ${text}</div>` });

/**
 * 실행(수량은 호출한 쪽이 줄인다)
 * @param {Actor} actor 사용자
 * @param {Item} item
 * @param {{combatant?: Combatant, targets?: Combatant[]}} [ctx]
 */
export async function runItemUse(actor, item, { combatant = null, targets = [] } = {}) {
  const use = itemUseOf(item);
  if (!use) return null;
  switch (use.action) {
    case "boon": {
      const k = use.ability;
      if (!SHORT[k]) return null;
      const from = actor.system.abilities?.[k]?.boon ?? 0;
      await actor.update({ [`system.abilities.${k}.boon`]: from + 1 });
      const { logCreation } = await import("../sheets/character.mjs");
      await logCreation(actor, { type: "edit", ability: k, field: "boon", from, to: from + 1 });
      return note(actor, esc(L("boon", { name: actor.name, item: item.name, ability: SHORT[k] })));
    }
    case "skillBook": {
      await actor.update({ "system.skillBonus": (actor.system.skillBonus ?? 0) + 1, "flags.nssq.skillPick": { level: actor.system.level } });
      await note(actor, esc(L("skillBook", { name: actor.name, item: item.name })));
      const { SkillTree } = await import("../apps/skill-tree.mjs");
      return SkillTree.open(actor);
    }
    case "analyze": {
      const t = targets[0];
      if (!t?.actor) return null;
      requestGm({ action: "analyze", uuid: t.actor.uuid });
      return note(actor, esc(L("analyze", { name: actor.name, item: item.name, target: t.name })));
    }
    case "dissect": {
      const combat = combatant?.combat;
      if (!combat) return null;
      // 쓰기 전에 이미 쓰러진 적은 빼고, 이 턴이 끝날 때 쓰러져 있는 적을 기록한다(finishDissect)
      const before = combat.combatants.filter((c) => c.actor?.type === "enemy" && down(c)).map((c) => c.id);
      await combatant.setFlag("nssq", "dissect", { round: combat.round, before });
      return note(actor, esc(L("dissect", { name: actor.name, item: item.name })));
    }
  }
  return null;
}

const down = (c) => c.defeated || (c.actor?.system.hp?.value ?? 0) <= 0;

/** 활성 GM에게(GM이면 바로) */
function requestGm(p) {
  if (game.users.activeGM?.id === game.user.id) return gmItemUse(p);
  emit("itemUse", p);
}

async function gmItemUse({ action, uuid }) {
  if (action !== "analyze") return;
  const a = await fromUuid(uuid);
  if (a?.type !== "enemy") return;
  await a.update({ "system.identified": true, "system.rareKnown": true, "flags.nssq.analyzed": true });
  const { recordBestiary } = await import("./bestiary.mjs");
  await recordBestiary(a, { identified: true });
}

/**
 * 수용액을 쓴 턴에 쓰러진 적 → 전투 플래그 dissected(전투원 id). 그 턴이 지나면(라운드가 바뀔 때) 확정, 갈무리 때는 진행 중인 턴도
 * @param {boolean} [now] 갈무리: 이번 턴 것도 확정
 * @returns {Promise<Set<string>>}
 */
export async function finishDissect(combat, { now = false } = {}) {
  const got = new Set(combat.getFlag("nssq", "dissected") ?? []);
  let changed = false;
  for (const c of combat.combatants) {
    const d = c.getFlag("nssq", "dissect");
    if (!d) continue;
    if (!now && d.round >= combat.round) continue;
    for (const e of combat.combatants) if (e.actor?.type === "enemy" && down(e) && !d.before.includes(e.id)) got.add(e.id);
    if (!now) { await c.unsetFlag("nssq", "dissect"); changed = true; }
  }
  if (changed) await combat.setFlag("nssq", "dissected", [...got]);
  return got;
}

export function registerItemUse() {
  onSocket("itemUse", (p) => { if (game.users.activeGM?.id === game.user.id) gmItemUse(p); });
  // 라운드가 넘어가면 지난 턴의 수용액을 확정
  Hooks.on("updateCombat", (combat, changes) => {
    if (!("round" in changes) || game.users.activeGM?.id !== game.user.id) return;
    finishDissect(combat).catch((err) => console.error("NSSQ | dissect", err));
  });
}
