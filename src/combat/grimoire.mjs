/**
 * 추가 컨텐츠 「그리모어」(07 #168, 사용자 결정): 퀘스트·탐색 보상 전용 「텅 빈 그리모어 광석」(도구, effects type "grimoire")
 * - 소지품에서 [활성화](동시에 하나, 전투 중에는 바꿀 수 없다. 책과는 따로). 액터 플래그 nssq.activeGrimoire = 아이템 id
 * - 처음 활성화할 때 지금 습득한 스킬 하나와 그 SL을 기록한다(★·SL 0 제외) → 「Lv{SL}의 그리모어: 《이름》」. 기록은 GM만 지울 수 있다
 * - 활성화 중, 기록한 스킬이 메인·서브 클래스(와 커먼)로 얻을 수 없는 스킬이고 같은 이름 스킬이 없으면,
 *   그 스킬의 복사본(플래그 nssq.grimoireOf = 그리모어 id)을 캐릭터에 넣는다 → 전투·판정은 습득한 스킬과 똑같이 처리
 * - 복사본은 SL 예산·스킬 트리 선행조건·길드 반환에 치지 않는다(isGrimoireSkill)
 * - 대가: 전투 중 종료 페이즈마다 【TP】 −SL(사용자 결정 D, combat/turn-status.mjs grimoireUpkeep)
 */
const L = (k, d) => (d ? game.i18n.format(`NSSQ.Grimoire.${k}`, d) : game.i18n.localize(`NSSQ.Grimoire.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** 그리모어 아이템인가 */
export const isGrimoire = (item) => item?.type === "tool" && (item.system.effects ?? []).some((e) => e?.type === "grimoire");
/** 그리모어가 넣은 스킬 복사본인가(예산·선행조건·반환에서 뺀다) */
export const isGrimoireSkill = (item) => !!item?.flags?.nssq?.grimoireOf;
/** 기록 { name, sl, classKey, data } 또는 null */
export const recordOf = (item) => item?.flags?.nssq?.grimoire ?? null;

export function activeGrimoire(actor) {
  const id = actor?.getFlag?.("nssq", "activeGrimoire");
  const item = id ? actor.items.get(id) : null;
  return item && isGrimoire(item) && !item.system.stored ? item : null;
}

const inCombat = (actor) => !!game.combat?.started && game.combat.combatants.some((c) => c.actor?.uuid === actor.uuid);

/** 기록할 수 있는 스킬: 지금 습득한 것(SL 1 이상), ★·복사본 제외 */
const recordable = (actor) => actor.items.filter((i) => i.type === "skill" && (i.system.sl ?? 0) > 0 && !i.system.unique && !isGrimoireSkill(i))
  .sort((a, b) => a.name.localeCompare(b.name, "ko"));

/** 처음 활성화: 스킬 하나를 골라 기록 */
async function record(actor, item) {
  const list = recordable(actor);
  if (!list.length) return ui.notifications.warn(L("noSkill")) && null;
  const options = list.map((s) => `<option value="${s.id}">《${esc(s.name)}》 SL${s.system.sl}</option>`).join("");
  const id = await Dialog.prompt({
    title: L("recordTitle"),
    content: `<p>${esc(L("recordHint"))}</p><form><div class="form-group"><select name="s">${options}</select></div></form>`,
    label: L("record"), rejectClose: false,
    callback: (html) => html[0].querySelector("[name=s]").value
  });
  const skill = id ? actor.items.get(id) : null;
  if (!skill) return null;
  const data = skill.toObject();
  delete data._id;
  delete data.folder;
  const rec = { name: skill.name, sl: skill.system.sl, classKey: skill.system.classKey, data };
  await item.update({ name: L("name", { sl: rec.sl, skill: rec.name }), "flags.nssq.grimoire": rec });
  return rec;
}

/** [활성화]·[끄기] */
export async function toggleGrimoire(actor, item) {
  if (!isGrimoire(item)) return null;
  if (inCombat(actor)) return ui.notifications.warn(L("noCombat"));
  if (actor.getFlag("nssq", "activeGrimoire") === item.id) {
    await actor.unsetFlag("nssq", "activeGrimoire");
    return syncGrimoire(actor);
  }
  if (!recordOf(item) && !(await record(actor, item))) return null;
  await actor.setFlag("nssq", "activeGrimoire", item.id);
  const r = await syncGrimoire(actor);
  if (r?.reason) ui.notifications.warn(L(`why.${r.reason}`, { skill: recordOf(item).name }));
  return r;
}

/** GM: 기록 지우기(다시 텅 빈 광석으로) */
export async function clearGrimoire(item) {
  if (!game.user.isGM || !isGrimoire(item)) return;
  const actor = item.parent;
  if (actor?.getFlag("nssq", "activeGrimoire") === item.id) await actor.unsetFlag("nssq", "activeGrimoire");
  await item.update({ name: L("empty"), "flags.nssq.-=grimoire": null });
  if (actor) await syncGrimoire(actor);
}

/**
 * 기록한 스킬을 지금 쓸 수 있는가 → { ok, reason }
 * reason: ownClass(메인·서브·커먼 스킬) / owned(같은 이름 스킬을 가짐)
 */
export function grimoireUsable(actor, rec) {
  const { main, sub } = actor.system.classItems ?? {};
  const own = new Set(["common", main?.system.key, sub?.system.key].filter(Boolean));
  if (own.has(rec.classKey)) return { ok: false, reason: "ownClass" };
  if (actor.items.some((i) => i.type === "skill" && !isGrimoireSkill(i) && i.name === rec.name)) return { ok: false, reason: "owned" };
  return { ok: true };
}

/** 복사본을 지금 상태에 맞춘다(넣기·빼기·바꾸기) */
export async function syncGrimoire(actor) {
  if (actor?.type !== "character") return null;
  const g = activeGrimoire(actor);
  const rec = g ? recordOf(g) : null;
  const copies = actor.items.filter(isGrimoireSkill);
  const check = rec ? grimoireUsable(actor, rec) : { ok: false };
  const keep = check.ok ? copies.find((c) => c.flags.nssq.grimoireOf === g.id && c.name === rec.name) : null;
  const drop = copies.filter((c) => c !== keep).map((c) => c.id);
  if (drop.length) await actor.deleteEmbeddedDocuments("Item", drop, { nssqRespec: true, nssqGrimoire: true });
  if (check.ok && !keep) {
    const data = foundry.utils.deepClone(rec.data);
    foundry.utils.setProperty(data, "system.sl", rec.sl);
    foundry.utils.setProperty(data, "flags.nssq.grimoireOf", g.id);
    await actor.createEmbeddedDocuments("Item", [data], { nssqGrimoire: true });
  }
  return { ok: check.ok, reason: check.reason ?? null };
}

export function registerGrimoire() {
  // 스킬·클래스가 바뀌면(길드 재분배·직업 변경 등) 그 변경을 한 사용자가 다시 맞춘다
  let busy = false;
  const resync = (item, options, userId) => {
    const actor = item.parent;
    if (busy || userId !== game.user.id || options?.nssqGrimoire || actor?.type !== "character") return;
    if (!["skill", "class", "tool"].includes(item.type)) return;
    if (!activeGrimoire(actor) && !actor.items.some(isGrimoireSkill)) return;
    busy = true;
    syncGrimoire(actor).catch((err) => console.error("NSSQ | grimoire", err)).finally(() => { busy = false; });
  };
  for (const h of ["createItem", "updateItem", "deleteItem"]) Hooks.on(h, resync);
}
