/**
 * 전투 프리셋·전투 개시·전투 종료.
 * - 프리셋 = 「전투 프리셋」 폴더의 씬(flags.nssq.battlePreset). 배경·BGM(씬의 재생목록)·에너미 토큰을 GM이 넣어 둔다
 * - 개시: 프리셋 사본 씬 생성(전투원 데이터용, 화면에는 띄우지 않음) → 파티 토큰 배치 → 이전 음악 정지 → 프리셋 BGM
 *   → 전투 시작. 모두 지금 보던 씬(필드)에 머물고, 원작풍 전투 화면(combat/hud.mjs)이 그 위를 덮는다
 * - 종료: 결과 기록 → 전투 BGM 정지 → 이전 음악 → 전투·사본 삭제
 */
import { partyActors } from "./gm-screen.mjs";
import { LAYOUT } from "../engine/formation.mjs";
import { relayout } from "../combat/formation.mjs";
import { enemyActorFor } from "./enemy-library.mjs";
import { applyIdentify, identifyEnemy } from "../combat/identify.mjs";
import { applyAutoIdentify, recordBestiary, recordSeen } from "../combat/bestiary.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Battle.${k}`, d) : game.i18n.localize(`NSSQ.Battle.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/* ---------------- 배치(격자 100px, 3000×2000) ---------------- */

const GRID = LAYOUT.grid;
const SCENE_W = LAYOUT.width;
const SCENE_H = 2000;
const CENTER_X = SCENE_W / 2;
export const LANES = LAYOUT.lanes;
const ENEMY_MID = (LANES.enemyBack + LANES.enemyFront) / 2;

/* ---------------- 프리셋 ---------------- */

async function presetFolder() {
  let folder = game.folders.find((f) => f.type === "Scene" && f.getFlag("nssq", "battlePresets"));
  folder ??= await Folder.create({ name: L("presetFolder"), type: "Scene", flags: { nssq: { battlePresets: true } } });
  return folder;
}

async function copyFolder() {
  let folder = game.folders.find((f) => f.type === "Scene" && f.getFlag("nssq", "battleCopies"));
  folder ??= await Folder.create({ name: L("copyFolder"), type: "Scene", flags: { nssq: { battleCopies: true } } });
  return folder;
}

export function battlePresets() {
  return game.scenes.filter((s) => s.getFlag("nssq", "battlePreset"));
}

/** 줄 이름 표시(GM에게만 보이는 글) */
function laneDrawings() {
  const label = (text, y) => ({
    shape: { type: "r", width: 2400, height: 260 },
    x: CENTER_X - 1200, y: y - 130,
    strokeWidth: 2, strokeColor: "#ffffff", strokeAlpha: 0.25, fillType: 0,
    text, fontSize: 36, textColor: "#ffffff", textAlpha: 0.6,
    hidden: true, locked: true
  });
  return [
    label(L("laneEnemyBack"), LANES.enemyBack),
    label(L("laneEnemyFront"), LANES.enemyFront),
    label(L("lanePartyFront"), LANES.partyFront),
    label(L("lanePartyBack"), LANES.partyBack)
  ];
}

/** GM: 새 프리셋 씬 */
export async function createPreset() {
  if (!game.user.isGM) return;
  const name = await Dialog.prompt({
    title: L("newPreset"),
    content: `<form><div class="form-group"><label>${L("presetName")}</label><input type="text" name="name" value="${L("presetDefaultName")}"/></div>
      <p class="notes">${L("newPresetHint")}</p></form>`,
    rejectClose: false,
    callback: (html) => html[0].querySelector("[name=name]").value.trim() || L("presetDefaultName")
  });
  if (!name) return;
  const scene = await createPresetScene(name);
  ui.notifications.info(L("presetCreated", { name }));
  await scene.view();
  scene.sheet.render(true);
  return scene;
}

/** 프리셋 씬 만들기(빈 씬 + 열 표시). flags: 더할 nssq 플래그(랜덤 던전의 임시 프리셋 randomPreset 등) */
export async function createPresetScene(name, flags = {}) {
  const folder = await presetFolder();
  const scene = await Scene.create({
    name, folder: folder.id, navigation: false,
    width: SCENE_W, height: SCENE_H, padding: 0, backgroundColor: "#1a1a22",
    // 토큰과 관계없이 모두가 전체를 본다
    tokenVision: false, fog: { exploration: false },
    grid: { size: GRID, type: 1 },
    initial: { x: CENTER_X, y: SCENE_H / 2, scale: 0.5 },
    flags: { nssq: { battlePreset: true, ...flags } }
  });
  await scene.createEmbeddedDocuments("Drawing", laneDrawings());
  return scene;
}

/* ---------------- 상태 ---------------- */

/** 진행 중인 NSSQ 전투(전투 개시로 만든 것) */
export function currentBattle() {
  return game.combats.find((c) => c.getFlag("nssq", "battle")) ?? null;
}

/* ---------------- 개시 ---------------- */

/** 개시 창: 프리셋·참가자·기습 */
export async function openStartDialog(presetId = null) {
  if (!game.user.isGM) return;
  if (currentBattle() || game.combat?.started) return ui.notifications.warn(L("alreadyInBattle"));
  const presets = battlePresets();
  if (!presets.length) return ui.notifications.warn(L("noPresets"));
  const party = partyActors();
  const content = `
    <form class="nssq-battle-start">
      <div class="form-group"><label>${L("preset")}</label>
        <select name="preset">${presets.map((s) => `<option value="${s.id}" ${s.id === presetId ? "selected" : ""}>${esc(s.name)} (${L("enemyCount", { n: s.tokens.size })})</option>`).join("")}</select></div>
      <fieldset><legend>${L("members")}</legend>
        ${party.map((a) => `<label class="member"><input type="checkbox" name="member" value="${a.id}" ${(a.system.hp?.value ?? 1) > 0 ? "checked" : ""}/>
          <img src="${a.img}" width="24" height="24"/> ${esc(a.name)}${a.system.npc ? ` <span class="npc-tag">NPC</span>` : ""}
          <span class="notes">${game.i18n.localize(`NSSQ.Row.${a.system.row ?? "front"}`)} · 【HP】 ${a.system.hp?.value ?? 0}/${a.system.hp?.max ?? 0}</span></label>`).join("")}
      </fieldset>
      <div class="form-group"><label>${L("identify")}</label>
        <input type="number" name="identify" value="" placeholder="${L("identifyLater")}"/></div>
      <p class="notes">${L("identifyHint")}</p>
      <div class="form-group"><label>${L("surprise")}</label>
        <select name="surprise">
          <option value="none">${L("surpriseNone")}</option>
          <option value="party">${L("surpriseParty")}</option>
          <option value="enemy">${L("surpriseEnemy")}</option>
        </select></div>
      <p class="notes">${L("startHint")}</p>
    </form>`;
  const choice = await Dialog.prompt({
    title: L("start"),
    content,
    label: L("startButton"),
    rejectClose: false,
    options: { width: 440 },
    callback: (html) => {
      const f = html[0].querySelector("form");
      return {
        presetId: f.preset.value,
        members: [...f.querySelectorAll("[name=member]:checked")].map((i) => i.value),
        surprise: f.surprise.value,
        identifyValue: f.identify.value === "" ? null : Number(f.identify.value)
      };
    }
  });
  if (!choice) return;
  if (!choice.members.length) return ui.notifications.warn(L("noMembers"));
  return startBattle(choice);
}

/** 지금 재생 중인 소리(나중에 되돌리기 위해) */
function playingSounds() {
  return game.playlists.contents.flatMap((p) => p.sounds.filter((s) => s.playing).map((s) => ({ playlist: p.id, sound: s.id })));
}

async function stopSounds(list) {
  for (const { playlist, sound } of list) await game.playlists.get(playlist)?.sounds.get(sound)?.update({ playing: false });
}

async function resumeSounds(list) {
  for (const { playlist, sound } of list) await game.playlists.get(playlist)?.sounds.get(sound)?.update({ playing: true });
}

export async function startBattle({ presetId, members, surprise = "none", identifyValue = null }) {
  if (!game.user.isGM) return;
  const preset = game.scenes.get(presetId);
  if (!preset) return;
  const origin = game.scenes.active?.id ?? canvas.scene?.id ?? null;
  const previousSounds = playingSounds();

  // 1) 사본 씬
  const folder = await copyFolder();
  const copy = await preset.clone({
    name: L("copyName", { name: preset.name }),
    folder: folder.id, navigation: false, active: false,
    flags: { nssq: { battlePreset: false, battleCopy: { presetId, origin } } },
    tokenVision: false, fog: { exploration: false },
    // 화면에 띄우지 않지만 플레이어도 전투원(토큰) 데이터를 읽는다
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED }
  }, { save: true });

  // 2) 에너미 토큰: 액터 연결을 풀고(원본 액터 보호), 놓인 위치로 전위·후위
  const tokenUpdates = [];
  let relinked = 0;
  for (const t of copy.tokens) {
    if (t.actor?.type !== "enemy") continue;
    const u = { _id: t.id };
    if (t.actorLink) { u.actorLink = false; relinked++; }
    tokenUpdates.push(u);
  }
  if (tokenUpdates.length) await copy.updateEmbeddedDocuments("Token", tokenUpdates);
  // 열은 놓인 높이로, 순서는 왼쪽부터
  const enemyTokens = copy.tokens.filter((t) => t.actor?.type === "enemy").sort((a, b) => a.x - b.x);
  for (const [i, t] of enemyTokens.entries()) {
    const cy = t.y + (t.height * GRID) / 2;
    // 식별(단계 5에서 판정 연결): 식별 전에는 에너미 【HP】 변화를 플레이어에게 숨긴다
    // 식별은 전투가 만들어진 뒤 달성값으로 판정(아래). 처음엔 식별 전
    await t.actor.update({ "system.row": cy < ENEMY_MID ? "back" : "front", "system.order": i, "system.identified": false, "system.rareKnown": false });
  }
  // 도감: 만난 종
  await recordSeen(enemyTokens.map((t) => t.actor));
  if (relinked) ui.notifications.warn(L("relinked", { n: relinked }));

  // 3) 파티 토큰: 액터와 연결(【HP】가 캐릭터에 남도록). 자리는 칸 배치(전위·후위 각 3칸)가 정한다
  const actors = members.map((id) => game.actors.get(id)).filter(Boolean);
  const tokenData = [];
  for (const actor of actors) {
    const doc = await actor.getTokenDocument({ x: 0, y: SCENE_H - GRID, actorLink: true, disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY });
    tokenData.push(doc.toObject());
  }
  await copy.createEmbeddedDocuments("Token", tokenData);
  await relayout(copy);

  // 4) 음악 전환: 씬은 바꾸지 않으므로 프리셋 씬에 연결된 BGM을 직접 튼다
  await stopSounds(previousSounds);
  if (copy.playlist) {
    if (copy.playlistSound) await copy.playlist.playSound(copy.playlistSound);
    else await copy.playlist.playAll();
  }

  // 5) 전투: 어느 씬을 보든 보이도록 씬에 묶지 않는다(전투원은 사본 씬의 토큰)
  const combat = await Combat.create({
    scene: null, active: true,
    flags: { nssq: { battle: { presetId, presetName: preset.name, origin, copy: copy.id, previousSounds, surprise, identifyValue } } }
  });
  const combatants = copy.tokens.filter((t) => t.actor && ["character", "enemy", "token"].includes(t.actor.type))
    .map((t) => ({ tokenId: t.id, sceneId: copy.id, actorId: t.actorId, hidden: t.hidden }));
  await combat.createEmbeddedDocuments("Combatant", combatants);
  await combat.startCombat();
  if (identifyValue !== null && identifyValue !== undefined) await applyIdentify(combat, identifyValue);
  // 도감 처치 수가 기준 이상인 종은 판정 전에도 식별 상태
  await applyAutoIdentify(combat);
  // 대미지 적용 등은 채팅 카드에서 하므로 전투 중에도 채팅을 연다(인카운터 기능은 전투 화면에 있다)
  ui.sidebar.activateTab("chat");

  const surpriseText = surprise === "party" ? L("surprisedEnemy") : surprise === "enemy" ? L("surprisedParty") : "";
  await ChatMessage.create({
    speaker: { alias: game.i18n.localize("NSSQ.Combat.tracker") },
    content: `<div class="nssq-battle-start-card"><h3><i class="fas fa-skull-crossbones"></i> ${L("started", { name: esc(preset.name) })}</h3>
      <p>${actors.map((a) => esc(a.name)).join(", ")} vs ${copy.tokens.filter((t) => t.actor?.type === "enemy").map((t) => esc(t.name)).join(", ")}</p>
      ${surpriseText ? `<p class="warn">${surpriseText}</p>` : ""}</div>`
  });
  if (surprise === "enemy") await (await import("../combat/turn-status.mjs")).preemptBlocks(combat);
  return combat;
}

/* ---------------- 난입 ---------------- */

/**
 * GM: 진행 중인 전투에 액터 하나를 끼워 넣는다(프리셋은 바뀌지 않는다, 이 전투의 사본 씬에만).
 * - 에너미: 컴펜디움 것은 「프리셋 에너미」 폴더의 액터를 재사용, 비연결 토큰으로. row = 놓은 위치(위쪽 절반이면 후열)
 * - 캐릭터: 연결 토큰, 아군으로(자기 열·칸)
 * 이니셔티브는 전투원 추가 때 자동으로 굴린다(tracker)
 */
export async function joinBattle(combat, uuid, { row = "front" } = {}) {
  if (!game.user.isGM || !combat) return;
  const info = combat.getFlag("nssq", "battle") ?? {};
  const copy = game.scenes.get(info.copy);
  if (!copy) return;
  const doc = await fromUuid(uuid);
  if (!doc || doc.documentName !== "Actor") return ui.notifications.warn(L("joinActorOnly"));
  if (!["enemy", "character"].includes(doc.type)) return ui.notifications.warn(L("joinActorOnly"));
  const enemy = doc.type === "enemy";
  const actor = enemy && doc.pack ? await enemyActorFor(uuid) : doc;
  if (!actor) return;
  if (!enemy && copy.tokens.some((t) => t.actorLink && t.actorId === actor.id)) return ui.notifications.warn(L("joinAlready", { name: actor.name }));
  const td = await actor.getTokenDocument({
    x: 0, y: 0, actorLink: !enemy,
    disposition: enemy ? CONST.TOKEN_DISPOSITIONS.HOSTILE : CONST.TOKEN_DISPOSITIONS.FRIENDLY
  });
  const [token] = await copy.createEmbeddedDocuments("Token", [td.toObject()]);
  if (enemy) {
    const order = Math.max(-1, ...copy.tokens.filter((t) => t.actor?.type === "enemy" && t.id !== token.id).map((t) => t.actor.system.order ?? 0)) + 1;
    await token.actor.update({ "system.row": row, "system.order": order, "system.identified": false, "system.rareKnown": false });
    // 이 전투에서 이미 식별 판정을 했다면 그 달성값으로
    if (info.identifyValue !== null && info.identifyValue !== undefined) await identifyEnemy(token.actor, info.identifyValue);
    else await applyAutoIdentify(combat);
    await recordBestiary(token.actor, { seen: true });
  }
  await relayout(copy);
  await combat.createEmbeddedDocuments("Combatant", [{ tokenId: token.id, sceneId: copy.id, actorId: token.actorId, hidden: token.hidden }]);
  await ChatMessage.create({
    speaker: { alias: game.i18n.localize("NSSQ.Combat.tracker") },
    content: `<div class="nssq-combat-note"><i class="fas fa-bolt"></i> ${L(enemy ? "joinedEnemy" : "joinedAlly", { name: esc(token.name) })}</div>`
  });
}

/* ---------------- 종료 ---------------- */

let ending = false;

/** GM: 결과를 고르고 정리한다. preset: 미리 고를 결과(전멸 판정) */
export async function openEndDialog(preset = null) {
  if (!game.user.isGM) return;
  const combat = currentBattle();
  if (!combat) return ui.notifications.warn(L("noBattle"));
  const pick = preset ?? combat.getFlag("nssq", "over") ?? "victory";
  const opt = (v) => `<option value="${v}" ${v === pick ? "selected" : ""}>${L(`result${v[0].toUpperCase()}${v.slice(1)}`)}</option>`;
  const result = await Dialog.prompt({
    title: L("end"),
    content: `<form><div class="form-group"><label>${L("result")}</label><select name="r">
      ${["victory", "escape", "defeat", "abort"].map(opt).join("")}
    </select></div><p class="notes">${L("endHint")}</p></form>`,
    label: L("endButton"),
    rejectClose: false,
    callback: (html) => html[0].querySelector("[name=r]").value
  });
  if (!result) return;
  return endBattle(combat, result);
}

export async function endBattle(combat, result = "abort") {
  if (!game.user.isGM || ending) return;
  ending = true;
  try {
    const info = combat.getFlag("nssq", "battle") ?? {};
    const copy = game.scenes.get(info.copy);
    await ChatMessage.create({
      speaker: { alias: game.i18n.localize("NSSQ.Combat.tracker") },
      content: `<div class="nssq-battle-end-card"><h3><i class="fas fa-flag-checkered"></i> ${L("ended", { name: esc(info.presetName ?? "") })}: ${L(`result${result[0].toUpperCase()}${result.slice(1)}`)}</h3>
</div>`
    });
    // 승리: 드롭 판정·갈무리 카드(단계 9-A). 전투를 지우기 전에(쓰러진 에너미·참가 캐릭터를 본다)
    if (result === "victory") await (await import("./loot.mjs")).startLoot(combat);
    // 전투가 끝나면 아군(연결된 캐릭터)의 상태 이상·봉인·강화·약화를 푼다. [석화]만 남긴다(07 #46)
    for (const c of combat.combatants) {
      const a = c.actor;
      if (!a || !c.token?.actorLink) continue;
      const conds = (a.system.conditions ?? []).filter((x) => x.id === "petrify");
      if (conds.length !== (a.system.conditions ?? []).length || (a.system.buffs ?? []).length) {
        await a.update({ "system.conditions": conds, "system.buffs": [] });
      }
      // 오버히트·전투 고유 상태(무사의 자세 등)도 그 전투까지(07 #57)
      if (a.getFlag("nssq", "overheat")) await a.unsetFlag("nssq", "overheat");
      if ((a.getFlag("nssq", "states") ?? []).length) await a.unsetFlag("nssq", "states");
    }
    // 전투 BGM 정지 → 원래 씬·음악
    if (copy?.playlist) await copy.playlist.stopAll();
    if (game.combats.has(combat.id)) await combat.delete();
    // 예전 방식(사본 씬으로 이동한 전투)이면 원래 씬으로 되돌린다
    const origin = game.scenes.get(info.origin);
    if (origin && game.scenes.active?.id === copy?.id) await origin.activate();
    await resumeSounds(info.previousSounds ?? []);
    if (copy) await copy.delete();
    // 랜덤 던전의 임시 프리셋·희소종 액터는 전투가 끝나면 지운다
    const preset = game.scenes.get(info.presetId);
    if (preset?.getFlag("nssq", "randomPreset")) {
      const rares = preset.tokens.map((t) => game.actors.get(t.actorId)).filter((a) => a?.getFlag("nssq", "randomRare"));
      await preset.delete();
      for (const a of rares) await a.delete();
    }
  } finally {
    ending = false;
  }
}

export function registerBattle() {
  // 트래커의 기본 [전투 종료]로 끝내도 정리한다(결과는 「중단」).
  // 훅은 모든 클라이언트에서 돌므로 접속 중인 GM 한 명만(보조 GM 등 GM이 여럿이면 사본 씬을 두 번 지우려다 오류)
  Hooks.on("deleteCombat", (combat) => {
    if (game.users.activeGM?.id !== game.user.id || ending || !combat.getFlag("nssq", "battle")) return;
    const info = combat.getFlag("nssq", "battle");
    if (!game.scenes.get(info.copy)) return;
    // 전멸로 끝난 전투를 기본 [전투 종료]로 닫으면 그 결과로 기록
    endBattle(combat, combat.getFlag("nssq", "over") ?? "abort");
  });
}
