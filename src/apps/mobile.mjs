/**
 * 모바일 모드(사용자 요청, 1차)와 플레이어 담당 캐릭터 자동 지정.
 * - 판단: 클라이언트 설정 mobileMode(자동/켬/끔, 기기마다 따로). 자동 = 주 입력이 손가락(pointer: coarse)이고 화면 짧은 변 < 700px
 * - 켜지면 body.nssq-mobile: Foundry 기본 UI(씬 컨트롤·내비게이션·핫바·플레이어 목록·사이드바)를 숨기고,
 *   오른쪽 아래 떠 있는 버튼으로 채팅 서랍·전체 화면을 연다. 창(시트·대화창)은 화면에 꽉 차게(CSS)
 * - 마을·미궁 화면 맞춤(viewArea)과 전투 화면 오른쪽 여백은 모바일이면 화면 전체를 쓴다
 * - 담당 캐릭터: Foundry v12는 담당 캐릭터가 없는 플레이어에게 접속마다 「플레이어 설정」 창을 띄운다(Game#setupGame).
 *   없으면 그 플레이어의 캐릭터(대기 제외) 중 처음 것으로 정하고 창을 닫는다(다음부터는 뜨지 않는다)
 */
const L = (k) => game.i18n.localize(`NSSQ.Mobile.${k}`);

let active = false;
export const isMobile = () => active;

function detect() {
  const mode = game.settings.get("nssq", "mobileMode");
  if (mode === "on") return true;
  if (mode === "off") return false;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches;
  return !!coarse && Math.min(window.screen?.width ?? 9999, window.screen?.height ?? 9999) < 700;
}

/** 마을·미궁 씬 UI를 맞출 화면 영역(씬 컨트롤·내비게이션·핫바·사이드바에 가리지 않게). 모바일이면 화면 전체 */
export function viewArea() {
  if (active) return { l: 2, t: 2, r: window.innerWidth - 2, b: window.innerHeight - 2 };
  const side = ui.sidebar?._collapsed ? 40 : (ui.sidebar?.element?.[0]?.offsetWidth ?? 300) + 16;
  const box = (id) => document.getElementById(id)?.getBoundingClientRect();
  return {
    l: Math.max(70, (box("controls")?.right ?? 60) + 8), t: Math.max(46, (box("navigation")?.bottom ?? 40) + 6),
    r: window.innerWidth - side, b: Math.min(window.innerHeight - 66, (box("hotbar")?.top ?? window.innerHeight - 66) - 6)
  };
}

/** 떠 있는 버튼(채팅·전체 화면) */
function ensureDock() {
  let dock = document.getElementById("nssq-mobile-dock");
  if (!active) { dock?.remove(); return; }
  if (dock) return;
  dock = document.createElement("div");
  dock.id = "nssq-mobile-dock";
  dock.innerHTML = `<button type="button" data-m="chat" title="${L("chat")}"><i class="fas fa-comments"></i></button>
    ${game.user.isGM ? `<button type="button" data-m="gm" title="${L("gm")}"><i class="fas fa-book-open"></i></button>` : `<button type="button" data-m="sheet" title="${L("sheet")}"><i class="fas fa-id-card"></i></button>`}
    <button type="button" data-m="full" title="${L("fullscreen")}"><i class="fas fa-expand"></i></button>`;
  dock.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-m]");
    if (!b) return;
    if (b.dataset.m === "chat") toggleChat();
    else if (b.dataset.m === "sheet") game.user.character?.sheet.render(true);
    // GM은 휴대폰으로 진행 상황을 확인하는 정도(사용자 결정): GM 스크린을 연다. 액터·씬 등은 채팅 서랍의 사이드바 탭으로
    else if (b.dataset.m === "gm") import("./gm-screen.mjs").then((m) => m.GMScreen.open());
    else if (b.dataset.m === "full") {
      if (document.fullscreenElement) document.exitFullscreen?.();
      else document.documentElement.requestFullscreen?.().catch(() => ui.notifications.warn(L("noFullscreen")));
    }
  });
  document.body.append(dock);
}

function toggleChat(force) {
  const open = force ?? !document.body.classList.contains("nssq-chat-open");
  document.body.classList.toggle("nssq-chat-open", open);
  if (open) {
    ui.sidebar?.expand?.();
    ui.sidebar?.activateTab?.("chat");
  }
}

function apply() {
  active = detect();
  document.body.classList.toggle("nssq-mobile", active);
  if (!active) document.body.classList.remove("nssq-chat-open");
  ensureDock();
  // 화면 맞춤을 다시
  Hooks.callAll("nssqViewArea");
  window.dispatchEvent(new Event("resize"));
}

/** 담당 캐릭터가 없으면 자기 캐릭터(대기 제외) 중 처음 것으로 정하고 플레이어 설정 창을 닫는다 */
async function autoAssignCharacter() {
  if (game.user.isGM || game.user.character) return;
  const mine = game.actors.filter((a) => a.type === "character" && a.testUserPermission(game.user, "OWNER"));
  const pick = mine.find((a) => !a.getFlag("nssq", "benched")) ?? mine[0];
  // 자기 캐릭터가 아직 없으면: 모바일에서는 창만 닫는다(고를 것이 없고 화면을 가린다)
  if (!pick) { if (active) await game.user.sheet?.close?.(); return; }
  await game.user.update({ character: pick.id });
  await game.user.sheet?.close?.();
}

export function registerMobile() {
  game.settings.register("nssq", "mobileMode", {
    name: "NSSQ.Mobile.setting", hint: "NSSQ.Mobile.settingHint",
    // 기본 끔(사용자 결정: 옛 휴대폰 과열로 모바일 지원은 보류). 필요하면 기기마다 켬·자동으로
    scope: "client", config: true, type: String, default: "off",
    choices: { auto: "NSSQ.Mobile.auto", on: "NSSQ.Mobile.on", off: "NSSQ.Mobile.off" },
    onChange: () => apply()
  });
  Hooks.once("ready", () => {
    apply();
    autoAssignCharacter().catch((e) => console.warn("NSSQ | auto character", e));
    // 모바일에서는 해상도 경고 알림을 지운다(이미 알고 쓰는 것)
    if (active) setTimeout(() => ui.notifications?.clear?.(), 500);
  });
  // 채팅 서랍이 열린 채 창을 열면 닫는다(창이 가리지 않게)
  Hooks.on("renderApplication", () => { if (active && document.body.classList.contains("nssq-chat-open")) toggleChat(false); });
  // 담당 캐릭터가 정해지지 않은 채 새 캐릭터가 생기면(작성 마법사) 그것으로
  Hooks.on("createActor", (a) => { if (a.type === "character" && a.testUserPermission(game.user, "OWNER")) autoAssignCharacter(); });
}
