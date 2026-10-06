/**
 * 몬스터 도감(월드 설정 nssq.bestiary): 한 번 식별하거나 처치한 종의 정보를 기억한다(07 #47, 사용자 결정).
 * - 정보 공개(자세히 보기·공격 카드)는 도감을 따른다. 내성 최소 3 처리는 매 전투의 식별 판정대로
 * - 사용한 스킬과 실제로 얻은 DROP도 기록(스킬은 사용하면 공개, DROP은 얻은 것만 공개)
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

/** 플레이어가 이 에너미의 능력을 아는가: 이번 전투에서 식별했거나, 도감에 식별·처치 기록이 있다 */
export function knowsEnemy(actor) {
  if (!actor || actor.type !== "enemy") return true;
  if (actor.system.identified) return true;
  const e = bestiaryEntry(actor);
  return !!e.identified || (e.defeated ?? 0) > 0;
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

/** 기록: { identified: true } / { defeated: 1 } / { skill: "이름" } / { drop: "R1 가죽" } */
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
  if (patch.identified) e.identified = true;
  if (patch.defeated) e.defeated = (e.defeated ?? 0) + patch.defeated;
  if (patch.skill && !(e.skills ?? []).includes(patch.skill)) e.skills = [...(e.skills ?? []), patch.skill];
  if (patch.drop && !(e.drops ?? []).includes(patch.drop)) e.drops = [...(e.drops ?? []), patch.drop];
  if (JSON.stringify(e) === before) return;
  all[key] = e;
  await game.settings.set("nssq", SETTING, all);
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
