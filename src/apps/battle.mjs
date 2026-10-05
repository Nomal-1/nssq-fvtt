/**
 * 전투 프리셋·전투 개시·전투 종료.
 * - 프리셋 = 「전투 프리셋」 폴더의 씬(flags.nssq.battlePreset). 배경·BGM(씬의 재생목록)·에너미 토큰을 GM이 넣어 둔다
 * - 개시: 프리셋 사본 씬 생성 → 파티 토큰 배치 → 이전 음악 정지 → 사본 활성화(모두의 화면 전환, BGM) → 전투 시작
 * - 종료: 결과 기록 → 사본의 음악 정지 → 원래 씬·음악으로 → 전투·사본 삭제
 */
import { partyActors } from "./gm-screen.mjs";
import { LAYOUT } from "../engine/formation.mjs";
import { relayout } from "../combat/formation.mjs";

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
  const folder = await presetFolder();
  const scene = await Scene.create({
    name, folder: folder.id, navigation: false,
    width: SCENE_W, height: SCENE_H, padding: 0, backgroundColor: "#1a1a22",
    // 토큰과 관계없이 모두가 전체를 본다
    tokenVision: false, fog: { exploration: false },
    grid: { size: GRID, type: 1 },
    initial: { x: CENTER_X, y: SCENE_H / 2, scale: 0.5 },
    flags: { nssq: { battlePreset: true } }
  });
  await scene.createEmbeddedDocuments("Drawing", laneDrawings());
  ui.notifications.info(L("presetCreated", { name }));
  await scene.view();
  scene.sheet.render(true);
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
        <select name="identify">
          <option value="unknown">${L("identifyUnknown")}</option>
          <option value="success">${L("identifySuccess")}</option>
        </select></div>
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
        identified: f.identify.value === "success"
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

export async function startBattle({ presetId, members, surprise = "none", identified = false }) {
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
    tokenVision: false, fog: { exploration: false }
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
    await t.actor.update({ "system.row": cy < ENEMY_MID ? "back" : "front", "system.order": i, "system.identified": identified });
  }
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

  // 4) 음악 전환·화면 전환(씬에 연결된 BGM은 활성화 때 재생된다)
  await stopSounds(previousSounds);
  await copy.activate();

  // 5) 전투
  const combat = await Combat.create({
    scene: copy.id, active: true,
    flags: { nssq: { battle: { presetId, presetName: preset.name, origin, copy: copy.id, previousSounds, surprise } } }
  });
  const combatants = copy.tokens.filter((t) => t.actor && ["character", "enemy", "token"].includes(t.actor.type))
    .map((t) => ({ tokenId: t.id, sceneId: copy.id, actorId: t.actorId, hidden: t.hidden }));
  await combat.createEmbeddedDocuments("Combatant", combatants);
  await combat.startCombat();
  ui.sidebar.activateTab("combat");

  const surpriseText = surprise === "party" ? L("surprisedEnemy") : surprise === "enemy" ? L("surprisedParty") : "";
  await ChatMessage.create({
    speaker: { alias: game.i18n.localize("NSSQ.Combat.tracker") },
    content: `<div class="nssq-battle-start-card"><h3><i class="fas fa-skull-crossbones"></i> ${L("started", { name: esc(preset.name) })}</h3>
      <p>${actors.map((a) => esc(a.name)).join(", ")} vs ${copy.tokens.filter((t) => t.actor?.type === "enemy").map((t) => esc(t.name)).join(", ")}</p>
      ${surpriseText ? `<p class="warn">${surpriseText}</p>` : ""}</div>`
  });
  return combat;
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
        ${result === "victory" ? `<p class="notes">${L("dropLater")}</p>` : ""}</div>`
    });
    // 전투 BGM 정지 → 원래 씬·음악
    if (copy?.playlist) await copy.playlist.stopAll();
    if (game.combats.has(combat.id)) await combat.delete();
    const origin = game.scenes.get(info.origin);
    if (origin) await origin.activate();
    await resumeSounds(info.previousSounds ?? []);
    if (copy) await copy.delete();
  } finally {
    ending = false;
  }
}

export function registerBattle() {
  // 트래커의 기본 [전투 종료]로 끝내도 정리한다(결과는 「중단」)
  Hooks.on("deleteCombat", (combat) => {
    if (!game.user.isGM || ending || !combat.getFlag("nssq", "battle")) return;
    const info = combat.getFlag("nssq", "battle");
    if (!game.scenes.get(info.copy)) return;
    // 전멸로 끝난 전투를 기본 [전투 종료]로 닫으면 그 결과로 기록
    endBattle(combat, combat.getFlag("nssq", "over") ?? "abort");
  });
}
