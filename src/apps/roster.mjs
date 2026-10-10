/**
 * 파티 명단(사용자 요청): 플레이어가 가진 캐릭터 + GM 스크린에서 동료 NPC로 체크한 캐릭터.
 * 플레이어는 권한이 없는 액터를 못 보므로, 활성 GM이 명단을 월드 설정(partyRoster)에 계속 갱신하고
 * 편성판·마을/미궁 하단 명단은 이것을 읽는다(GM은 액터에서 바로 계산).
 */
import { isActiveGM } from "../combat/apply.mjs";

const playerOwned = (a) => game.users.some((u) => !u.isGM && a.testUserPermission(u, "OWNER"));

/** 명단 항목 하나 */
async function entryOf(a) {
  const { skillBudget } = await import("../engine/skills.mjs");
  const skills = a.items.filter((i) => i.type === "skill").map((i) => ({ sl: i.system.sl ?? 0, unique: !!i.system.unique, common: i.system.classKey === "common" }));
  const s = a.system;
  return {
    id: a.id, name: a.name, img: a.img, npc: !!s.npc, benched: !!a.getFlag("nssq", "benched"),
    row: s.row ?? "front", order: s.order ?? null, level: s.level ?? 1,
    cls: s.classItems?.main?.name ?? "", hp: { value: s.hp?.value ?? 0, max: s.hp?.max ?? 0 }, tp: { value: s.tp?.value ?? 0, max: s.tp?.max ?? 0 },
    money: s.money ?? 0, sp: skillBudget({ level: s.level, skills, bonus: s.skillBonus ?? 0 }).left, bad: (s.conditions ?? []).length,
    owners: game.users.filter((u) => !u.isGM && a.testUserPermission(u, "OWNER")).map((u) => u.id),
    // 조종하는 플레이어가 접속 중인가(동료 NPC는 늘 true)
    online: !!s.npc || game.users.some((u) => u.active && !u.isGM && a.testUserPermission(u, "OWNER"))
  };
}

/** GM: 액터에서 명단 계산 */
export async function computeRoster() {
  const list = game.actors.filter((a) => a.type === "character" && (playerOwned(a) || a.system.npc));
  return Promise.all(list.map(entryOf));
}

/** 명단(편성 후보 전원). GM은 바로 계산, 플레이어는 설정 */
export async function roster() {
  if (game.user.isGM) return computeRoster();
  return game.settings.get("nssq", "partyRoster") ?? [];
}

/** 참가 중인 명단(대기 제외) */
export async function rosterMembers() {
  return (await roster()).filter((e) => !e.benched);
}

let timer = null;
async function sync() {
  if (!isActiveGM()) return;
  const next = await computeRoster();
  if (JSON.stringify(next) === JSON.stringify(game.settings.get("nssq", "partyRoster") ?? [])) return;
  await game.settings.set("nssq", "partyRoster", next);
}
export function scheduleRosterSync() { clearTimeout(timer); timer = setTimeout(sync, 400); }

export function registerRoster() {
  game.settings.register("nssq", "partyRoster", {
    scope: "world", config: false, type: Array, default: [],
    onChange: () => Hooks.callAll("nssqRoster")
  });
  Hooks.once("ready", () => scheduleRosterSync());
  Hooks.on("userConnected", () => scheduleRosterSync());
  for (const h of ["updateActor", "createActor", "deleteActor"]) Hooks.on(h, (a) => { if (a.type === "character") scheduleRosterSync(); });
  for (const h of ["createItem", "updateItem", "deleteItem"]) Hooks.on(h, (i) => { if (i.parent?.type === "character") scheduleRosterSync(); });
}
