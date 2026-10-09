/**
 * 고유 스킬(★) 자동 습득: 서브 클래스가 없으면 메인 클래스의 고유 스킬을 가지고, 서브 클래스를 정하면 없어진다.
 * 클래스를 바꾼 사람의 화면에서 한 번 맞춘다(계획은 engine uniqueSkillPlan).
 */
import { uniqueSkillPlan } from "../engine/skills.mjs";

let uniqueCache = null;
async function uniqueIndex() {
  if (!uniqueCache) {
    const pack = game.packs.get("nssq.skills");
    const index = pack ? await pack.getIndex({ fields: ["system.classKey", "system.skillKey", "system.unique"] }) : [];
    uniqueCache = [...index].filter((e) => e.system?.unique).map((e) => ({ id: e._id, classKey: e.system.classKey, skillKey: e.system.skillKey }));
  }
  // 커스텀 직업(월드 클래스 아이템)의 ★ 스킬
  const customKeys = new Set(game.items.filter((i) => i.type === "class").map((i) => i.system.key).filter(Boolean));
  const world = game.items.filter((i) => i.type === "skill" && i.system.unique && customKeys.has(i.system.classKey))
    .map((i) => ({ id: i.id, uuid: i.uuid, classKey: i.system.classKey, skillKey: i.system.skillKey }));
  return [...uniqueCache, ...world];
}

export async function syncUniqueSkill(actor) {
  if (actor?.type !== "character" || !actor.isOwner) return;
  const { main, sub } = actor.system.classItems;
  const uniques = await uniqueIndex();
  const owned = actor.items.filter((i) => i.type === "skill").map((i) => ({ id: i.id, classKey: i.system.classKey, skillKey: i.system.skillKey, unique: !!i.system.unique }));
  const plan = uniqueSkillPlan({ mainKey: main?.system.key ?? null, hasSub: !!sub, uniques, owned });
  if (plan.remove.length) await actor.deleteEmbeddedDocuments("Item", plan.remove);
  if (plan.add.length) {
    const pack = game.packs.get("nssq.skills");
    const data = [];
    for (const a of plan.add) {
      const entry = uniques.find((u) => u.classKey === a.classKey && u.skillKey === a.skillKey);
      const doc = entry.uuid ? game.items.get(entry.id) : await pack.getDocument(entry.id);
      const d = game.items.fromCompendium(doc);
      d.system.sl = 1;
      foundry.utils.setProperty(d, "_stats.compendiumSource", doc.uuid);
      data.push(d);
    }
    await actor.createEmbeddedDocuments("Item", data);
  }
}

/** 작성 중(잠기기 전·경험점 0)에 클래스가 바뀌면 【HP】·【TP】를 새 최대치로(클래스 보정이 최대치를 바꾼다) */
async function fillOnCreation(actor) {
  const s = actor.system;
  if (s.creation?.locked || (s.exp ?? 0) > 0) return;
  if (s.hp.value !== s.hp.max || s.tp.value !== s.tp.max) await actor.update({ "system.hp.value": s.hp.max, "system.tp.value": s.tp.max });
}

/** 클래스 추가와 메인 클래스 지정이 연달아 오므로 잠깐 모아서 한 번만 맞춘다 */
const timers = new Map();
function scheduleSync(actor) {
  clearTimeout(timers.get(actor.id));
  timers.set(actor.id, setTimeout(() => {
    timers.delete(actor.id);
    syncUniqueSkill(actor).then(() => fillOnCreation(actor));
  }, 250));
}

export function registerUniqueSkillHooks() {
  const mine = (userId) => userId === game.user.id;
  // 이 기능 이전에 만든 캐릭터도 GM 접속 시 한 번 맞춘다
  if (game.user === game.users.activeGM) {
    (async () => {
      for (const a of game.actors.filter((x) => x.type === "character")) await syncUniqueSkill(a);
    })();
  }
  Hooks.on("updateActor", (actor, changes, _o, userId) => {
    if (!mine(userId)) return;
    const s = changes.system ?? {};
    if ("mainClass" in s || "subClass" in s) scheduleSync(actor);
  });
  for (const hook of ["createItem", "deleteItem"]) {
    Hooks.on(hook, (item, _o, userId) => {
      if (mine(userId) && item.type === "class" && item.parent?.type === "character") scheduleSync(item.parent);
    });
  }
}
