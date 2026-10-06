/**
 * 몬스터 도감(월드 설정 nssq.bestiary): 종마다 만남·식별·처치 수·본 스킬·얻은 DROP을 기억한다(07 #47·#48, 사용자 결정).
 * - 전투 중 정보 공개(자세히 보기·공격 카드)는 이번 전투의 식별 결과대로. 도감은 쓴 스킬·얻은 DROP과 자동 식별(처치 수)에만 쓴다
 * - 희소종도 원종과 같은 키(희소종을 따로 기억하지 않고 처치 수도 원종에 더한다)
 * 키는 에너미 데이터 key(없으면 이름). 기록은 GM만 쓸 수 있으므로 플레이어 쪽은 소켓으로 맡긴다.
 * GM은 도감 창(apps/bestiary.mjs)에서 언제든 고친다.
 * 설정 「자동 식별 처치 수」: 그 수 이상 처치한 종은 식별 판정과 관계없이 식별 상태(내성·약점 모두, 07 #48)
 */
import { emit, onSocket } from "../socket.mjs";

const SETTING = "bestiary";

export const bestiaryKey = (actor) => actor?.system?.key || actor?.name || "";

/** @returns {{identified?: boolean, defeated?: number, skills?: string[], drops?: string[]}} */
export function bestiaryEntry(actor) {
  const all = game.settings.get("nssq", SETTING) ?? {};
  return all[bestiaryKey(actor)] ?? {};
}

/** 플레이어가 이 에너미의 수치를 아는가: 이번 전투에서 식별했다(자동 식별 포함, 07 #48). 도감 기록만으로는 모른다 */
export function knowsEnemy(actor) {
  if (!actor || actor.type !== "enemy") return true;
  return !!actor.system.identified;
}

/** 도감 단계(플레이어 도감 창): 0 만난 적 없음 / 1 만남(모습·이름) / 2 식별한 적 있음 / 3 처치 수 기준 이상(전부) */
export function bestiaryTier(entry) {
  const n = autoIdentifyKills();
  if (n > 0 && (entry.defeated ?? 0) >= n) return 3;
  if (entry.identified) return 2;
  if (entry.seen || (entry.defeated ?? 0) > 0) return 1;
  return 0;
}

/** 자동 식별 처치 수(0이면 끔) */
export const autoIdentifyKills = () => Number(game.settings.get("nssq", "bestiaryAutoKills")) || 0;

/** 이 에너미의 종이 자동 식별 기준을 채웠는가 */
export function meetsAutoIdentify(actor) {
  const n = autoIdentifyKills();
  return n > 0 && (bestiaryEntry(actor).defeated ?? 0) >= n;
}

/** 진행 중인 전투에서 기준을 채운 에너미를 식별 상태로(GM) */
export async function applyAutoIdentify(combat) {
  if (!game.user.isGM || !combat) return;
  for (const c of combat.combatants) {
    const a = c.actor;
    if (a?.type === "enemy" && !a.system.identified && meetsAutoIdentify(a)) await a.update({ "system.identified": true });
  }
}

/** GM: 한 종의 기록을 통째로 바꾼다 */
export async function setBestiaryEntry(key, entry) {
  if (!game.user.isGM || !key) return;
  const all = foundry.utils.deepClone(game.settings.get("nssq", SETTING) ?? {});
  all[key] = entry;
  await game.settings.set("nssq", SETTING, all);
}

/** 기록: { seen: true } / { identified: true } / { defeated: 1 } / { skill: "이름" } / { drop: "R1 가죽" } */
export async function recordBestiary(actor, patch) {
  const key = bestiaryKey(actor);
  if (!key) return;
  if (!game.user.isGM) return emit("bestiary", { key, patch });
  return writeEntry(key, patch);
}

async function writeEntry(key, patch) {
  const all = foundry.utils.deepClone(game.settings.get("nssq", SETTING) ?? {});
  const e = all[key] ?? {};
  const before = JSON.stringify(e);
  if (patch.seen) e.seen = true;
  if (patch.identified) e.identified = true;
  if (patch.defeated) e.defeated = (e.defeated ?? 0) + patch.defeated;
  if (patch.skill && !(e.skills ?? []).includes(patch.skill)) e.skills = [...(e.skills ?? []), patch.skill];
  if (patch.drop && !(e.drops ?? []).includes(patch.drop)) e.drops = [...(e.drops ?? []), patch.drop];
  if (JSON.stringify(e) === before) return;
  all[key] = e;
  await game.settings.set("nssq", SETTING, all);
}

/** 전투에 나온 에너미들: 도감에 「만남」(GM, 한 번에 저장) */
export async function recordSeen(actors) {
  if (!game.user.isGM) return;
  const all = foundry.utils.deepClone(game.settings.get("nssq", SETTING) ?? {});
  let changed = false;
  for (const a of actors) {
    const key = bestiaryKey(a);
    if (!key || all[key]?.seen) continue;
    all[key] = { ...(all[key] ?? {}), seen: true };
    changed = true;
  }
  if (changed) await game.settings.set("nssq", SETTING, all);
}

/** GM: 한 종의 기록 지우기(액터 또는 키) */
export async function forgetBestiary(actorOrKey) {
  if (!game.user.isGM) return;
  const key = typeof actorOrKey === "string" ? actorOrKey : bestiaryKey(actorOrKey);
  const all = foundry.utils.deepClone(game.settings.get("nssq", SETTING) ?? {});
  delete all[key];
  await game.settings.set("nssq", SETTING, all);
}

export function registerBestiary() {
  game.settings.register("nssq", SETTING, {
    scope: "world", config: false, type: Object, default: {},
    onChange: () => Hooks.callAll("nssqBestiary")
  });
  game.settings.register("nssq", "bestiaryAutoKills", {
    name: "NSSQ.Bestiary.autoKills.name", hint: "NSSQ.Bestiary.autoKills.hint",
    scope: "world", config: true, type: Number, default: 0,
    onChange: () => Hooks.callAll("nssqBestiary")
  });
  game.settings.register("nssq", "bestiaryPlayers", {
    name: "NSSQ.Bestiary.players.name", hint: "NSSQ.Bestiary.players.hint",
    scope: "world", config: true, type: Boolean, default: true,
    onChange: () => ui.actors?.render()
  });
  // 처치 수가 바뀌어 기준을 채우면 진행 중인 전투의 같은 종도 식별 상태로
  Hooks.on("nssqBestiary", () => {
    const gm = game.users.activeGM;
    if (gm && gm.id === game.user.id) applyAutoIdentify(game.combat);
  });
  onSocket("bestiary", ({ key, patch }) => {
    const gm = game.users.activeGM;
    if (gm && gm.id === game.user.id) writeEntry(key, patch);
  });
}
