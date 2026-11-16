/**
 * 마을·미궁 화면(사용자 결정 2026-11-16: 씬을 쓰지 않는다).
 * 예전에는 마을·미궁마다 씬을 만들어 활성화하고 그 위에 메뉴를 덮었다. 지금은 씬 없이,
 * 씬 컨트롤·내비게이션·핫바·사이드바 사이(apps/mobile.mjs viewArea, 모바일이면 화면 전체)를 덮는 창 하나(ApplicationV2, 틀 없음)로 그린다.
 *
 * 무엇을 보여 줄지는 월드 상태로 정한다(모두 같은 화면):
 * - NSSQ 전투 중이면 아무것도 안 보인다(전투 화면 combat/hud.mjs가 덮는다)
 * - 필드 지도 진행 중(fieldMapState.active)이면 미궁 화면(apps/field-scene.mjs FieldStage)
 * - 파티가 마을에 있으면(location.kind = town) 마을 화면(apps/town.mjs TownStage)
 * - GM은 파티가 없는 마을도 미리 볼 수 있다(그 GM 화면에서만, previewTown)
 * 씬을 보여 줄 때(시설에 연결한 씬 등): GM이 화면을 걷으면(월드 설정 stageHidden) 모두 씬을 보고,
 * 플레이어가 혼자 걷으면 자기 화면만. 걷힌 동안 위쪽 가운데 [화면으로 돌아가기] 버튼.
 */
import { viewArea } from "./mobile.mjs";

export const STAGE_DESIGN = { w: 1280, h: 720 };
const L = (k) => game.i18n.localize(`NSSQ.Stage.${k}`);

let previewTown = null;
let localHidden = false;
const apps = {};

const worldHidden = () => !!game.settings.get("nssq", "stageHidden");
const nssqBattle = () => game.combats?.some((c) => c.started && c.getFlag("nssq", "battle"));

/** 지금 보여 줄 화면: "field" | "town" | null */
export function stageMode() {
  if (!game.ready || nssqBattle()) return null;
  const fm = game.settings.get("nssq", "fieldMapState") ?? {};
  if (fm.active && (game.settings.get("nssq", "fieldMaps") ?? {})[fm.mapId]) return "field";
  const loc = game.settings.get("nssq", "location") ?? {};
  const towns = game.settings.get("nssq", "towns") ?? {};
  if (loc.kind === "town" && towns[loc.townId]) return "town";
  if (game.user.isGM && previewTown && towns[previewTown]) return "town";
  return null;
}

/** GM 미리보기 중인 마을(파티가 있는 마을이면 미리보기가 아니다) */
export const previewTownId = () => previewTown;

/** 마을·미궁 화면 창의 공통 옵션(틀 없음, 위치는 placeStage가 정한다) */
export const STAGE_OPTIONS = { window: { frame: false, positioned: false } };

/** 화면 상자를 보이는 영역에 맞추고, 1280×720 설계를 가운데에 확대 */
export function placeStage(el) {
  if (!el) return;
  const a = viewArea();
  const w = Math.max(320, a.r - a.l);
  const h = Math.max(200, a.b - a.t);
  Object.assign(el.style, { left: `${a.l}px`, top: `${a.t}px`, width: `${w}px`, height: `${h}px` });
  const frame = el.querySelector(".town-frame");
  if (!frame) return;
  const s = Math.min(w / STAGE_DESIGN.w, h / STAGE_DESIGN.h);
  frame.style.transform = `translate(${(w - STAGE_DESIGN.w * s) / 2}px, ${(h - STAGE_DESIGN.h * s) / 2}px) scale(${s})`;
}

async function stageApp(mode) {
  if (apps[mode]) return apps[mode];
  const cls = mode === "field" ? (await import("./field-scene.mjs")).FieldStage : (await import("./town.mjs")).TownStage;
  apps[mode] ??= new cls();
  return apps[mode];
}

let syncing = Promise.resolve();
/** 상태에 맞게 화면을 열고 닫는다(차례로, 겹쳐 부르면 마지막 상태로) */
export function syncStage() {
  syncing = syncing.then(doSync).catch((err) => console.error("nssq | stage sync failed", err));
  return syncing;
}

async function doSync() {
  const mode = stageMode();
  const hidden = localHidden || worldHidden();
  for (const [m, app] of Object.entries(apps)) if ((m !== mode || hidden) && app.rendered) await app.close({ animate: false });
  if (mode && !hidden) {
    const app = await stageApp(mode);
    await app.render({ force: true });
  }
  syncReturnButton(mode, hidden);
}

/** 내용만 다시 그리기(열려 있을 때) */
export function refreshStage() {
  for (const app of Object.values(apps)) if (app.rendered) app.render();
}

/** 창 크기·사이드바가 바뀌면 자리만 다시 */
export function relayoutStage() {
  for (const app of Object.values(apps)) if (app.rendered) placeStage(app.element);
  const btn = document.getElementById("nssq-stage-return");
  if (btn) { const a = viewArea(); btn.style.left = `${(a.l + a.r) / 2}px`; btn.style.top = `${a.t + 4}px`; }
}

function syncReturnButton(mode, hidden) {
  let btn = document.getElementById("nssq-stage-return");
  // 플레이어는 GM이 걷은 화면을 되돌릴 수 없다
  const show = mode && hidden && (game.user.isGM || !worldHidden());
  if (!show) { btn?.remove(); return; }
  if (!btn) {
    btn = document.createElement("button");
    btn.type = "button";
    btn.id = "nssq-stage-return";
    btn.className = "nssq";
    btn.addEventListener("click", () => showStage());
    document.body.append(btn);
  }
  btn.innerHTML = `<i class="fas ${mode === "field" ? "fa-map" : "fa-home"}"></i> ${L(mode === "field" ? "backField" : "backTown")}`;
  relayoutStage();
}

/** 화면을 걷는다(씬을 보여 줄 때). GM이면 모두, 플레이어면 자기만 */
export async function hideStage() {
  localHidden = true;
  if (game.user.isGM && !worldHidden()) await game.settings.set("nssq", "stageHidden", true);
  return syncStage();
}

/** 화면을 다시 덮는다 */
export async function showStage() {
  localHidden = false;
  if (game.user.isGM && worldHidden()) await game.settings.set("nssq", "stageHidden", false);
  return syncStage();
}

/** 장소가 바뀌면(귀환·미궁 진입) 걷어 둔 화면을 되돌린다(활성 GM이 부른다) */
export async function resetStageHidden() {
  localHidden = false;
  previewTown = null;
  if (game.user.isGM && worldHidden()) await game.settings.set("nssq", "stageHidden", false);
}

/** GM: 마을 화면 보기. 파티가 있는 마을이면 걷은 화면을 되돌리고, 아니면 그 마을을 미리 본다(GM 화면만) */
export async function showTown(townId) {
  const loc = game.settings.get("nssq", "location") ?? {};
  previewTown = game.user.isGM && townId && !(loc.kind === "town" && loc.townId === townId) ? townId : null;
  if (apps.town) apps.town.facId = null;
  return showStage();
}

/** GM: 미리보기 닫기 */
export function closePreview() {
  previewTown = null;
  return syncStage();
}

const WATCH = ["nssq.location", "nssq.towns", "nssq.fieldMapState", "nssq.fieldMaps", "nssq.fieldEvents", "nssq.fieldNarration", "nssq.stageHidden"];

export function registerStage() {
  game.settings.register("nssq", "stageHidden", { scope: "world", config: false, type: Boolean, default: false });
  Hooks.once("ready", () => syncStage());
  for (const h of ["createSetting", "updateSetting"]) Hooks.on(h, (s) => {
    // 화면 종류가 바뀌면 열고 닫고, 같으면 다시 그린다(syncStage가 둘 다 한다)
    if (WATCH.includes(s.key)) syncStage();
  });
  for (const h of ["createCombat", "updateCombat", "deleteCombat"]) Hooks.on(h, () => syncStage());
  Hooks.on("nssqRoster", () => refreshStage());
  Hooks.on("updateActor", (a) => {
    if (a.type !== "character" || !Object.values(apps).some((x) => x.rendered)) return;
    clearTimeout(registerStage.u);
    registerStage.u = setTimeout(refreshStage, 200);
  });
  Hooks.on("collapseSidebar", () => setTimeout(relayoutStage, 300));
  window.addEventListener("resize", () => { clearTimeout(registerStage.r); registerStage.r = setTimeout(relayoutStage, 100); });
}
