/**
 * 전투 프리셋·전투 개시·전투 종료.
 * - 프리셋 = 「전투 프리셋」 폴더의 씬(flags.nssq.battlePreset). 배경·BGM(씬의 재생목록)·에너미 토큰을 GM이 넣어 둔다
 * - 개시: 프리셋 사본 씬 생성 → 파티 토큰 배치 → 이전 음악 정지 → 사본 활성화(모두의 화면 전환, BGM) → 전투 시작
 * - 종료: 결과 기록 → 사본의 음악 정지 → 원래 씬·음악으로 → 전투·사본 삭제
 */
import { partyActors } from "./gm-screen.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Battle.${k}`, d) : game.i18n.localize(`NSSQ.Battle.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/* ---------------- 배치(격자 100px, 3000×2000) ---------------- */

const GRID = 100;
const SCENE_W = 3000;
const SCENE_H = 2000;
const CENTER_X = SCENE_W / 2;
const SPACING = 250;
/** 각 줄의 토큰 중심 y */
export const LANES = { enemyBack: 400, enemyFront: 750, partyFront: 1250, partyBack: 1600 };
const ENEMY_MID = (LANES.enemyBack + LANES.enemyFront) / 2;

/** n개를 가운데 정렬로 늘어놓을 때 i번째의 중심 x */
const laneX = (i, n) => CENTER_X - ((n - 1) * SPACING) / 2 + i * SPACING;

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
        surprise: f.surprise.value
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

export async function startBattle({ presetId, members, surprise = "none" }) {
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
    flags: { nssq: { battlePreset: false, battleCopy: { presetId, origin } } }
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
  for (const t of copy.tokens) {
    if (t.actor?.type !== "enemy") continue;
    const cy = t.y + (t.height * GRID) / 2;
    await t.actor.update({ "system.row": cy < ENEMY_MID ? "back" : "front" });
  }
  if (relinked) ui.notifications.warn(L("relinked", { n: relinked }));

  // 3) 파티 토큰: 열에 따라 줄에 늘어놓는다. PC는 액터와 연결(【HP】가 캐릭터에 남도록)
  const actors = members.map((id) => game.actors.get(id)).filter(Boolean);
  const lanes = { front: actors.filter((a) => a.system.row !== "back"), back: actors.filter((a) => a.system.row === "back") };
  const tokenData = [];
  for (const [row, list] of Object.entries(lanes)) {
    for (const [i, actor] of list.entries()) {
      const cx = laneX(i, list.length);
      const cy = row === "front" ? LANES.partyFront : LANES.partyBack;
      const doc = await actor.getTokenDocument({ x: cx - GRID / 2, y: cy - GRID / 2, actorLink: true, disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY });
      tokenData.push(doc.toObject());
    }
  }
  await copy.createEmbeddedDocuments("Token", tokenData);

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

/** GM: 결과를 고르고 정리한다 */
export async function openEndDialog() {
  if (!game.user.isGM) return;
  const combat = currentBattle();
  if (!combat) return ui.notifications.warn(L("noBattle"));
  const result = await Dialog.prompt({
    title: L("end"),
    content: `<form><div class="form-group"><label>${L("result")}</label><select name="r">
      <option value="victory">${L("resultVictory")}</option>
      <option value="escape">${L("resultEscape")}</option>
      <option value="defeat">${L("resultDefeat")}</option>
      <option value="abort">${L("resultAbort")}</option>
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
    endBattle(combat, "abort");
  });
}
