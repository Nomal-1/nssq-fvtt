/**
 * 캐릭터 테마곡·컷인(사용자 요청 묶음F).
 * - 테마곡: 캐릭터 플래그 nssq.theme = { src, volume, seconds, on: { crit, absSuccess, ailment } }.
 *   그 순간이 오면 활성 GM이 지금 재생 중인 곡을 일시정지(pausedTime)하고 재생목록 「NSSQ 테마곡」으로 한 번 틀었다가
 *   seconds가 지나거나 곡이 끝나면 멈추고 원래 곡을 이어서 튼다(재생목록 상태라 모든 클라이언트가 같이 듣는다)
 * - 컷인: 추격·반격 카드, 능동 회피 성공 메시지(플래그 nssq.evaded)가 생기면 각 클라이언트가 페르소나식 띠를 잠깐 띄운다.
 *   클라이언트 설정 battleFx를 끄면 안 보인다
 */
import { evaluateCheck } from "../engine/check.mjs";
import { isActiveGM } from "./apply.mjs";
import { cutinStyle } from "../apps/art-config.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Spotlight.${k}`, d) : game.i18n.localize(`NSSQ.Spotlight.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const TRIGGERS = ["crit", "absSuccess", "ailment"];

/* ---------------- 컷인 ---------------- */

let cutQueue = Promise.resolve();

/** 컷인 하나(이 클라이언트에서만). kind: chase | counter | evade */
export function cutIn(actor, kind, { style = null } = {}) {
  if (!actor || game.settings.get("nssq", "battleFx") === false) return cutQueue;
  cutQueue = cutQueue.then(() => new Promise((resolve) => {
    const el = document.createElement("div");
    el.className = `nssq-cutin ci-${kind}`;
    // 그림 위치·크기는 그림 설정 창의 「컷인」 프레임(system.art.cutinCrop). 캐릭터 외에는 액터 그림
    const pic = style ?? (actor.type === "character" ? cutinStyle(actor) : `background-image: url('${esc(actor.img)}'); background-size: cover; background-position: 50% 15%;`);
    el.innerHTML = `<div class="ci-band"></div><div class="ci-art"><div class="ci-pic" style="${pic}"></div></div>
      <div class="ci-text"><b>${esc(L(`cut.${kind}`))}</b><span>${esc(actor.name)}</span></div>`;
    document.body.append(el);
    setTimeout(() => { el.remove(); resolve(); }, 1300);
  }));
  return cutQueue;
}

/* ---------------- 테마곡 ---------------- */

let busy = false;

async function themePlaylist() {
  let p = game.playlists.find((x) => x.getFlag("nssq", "theme"));
  if (!p) p = await CONFIG.Playlist.documentClass.create({ name: L("playlist"), mode: CONST.PLAYLIST_MODES.DISABLED, flags: { nssq: { theme: true } } });
  return p;
}

/** 활성 GM: 그 캐릭터의 테마곡을 한 번 튼다(이미 테마곡 중이면 무시) */
export async function playTheme(actor, kind) {
  const th = actor?.getFlag("nssq", "theme");
  if (!isActiveGM() || busy || !th?.src || !th.on?.[kind]) return;
  busy = true;
  try {
    const list = await themePlaylist();
    const paused = game.playlists.contents.filter((p) => p.id !== list.id).flatMap((p) => p.sounds.filter((s) => s.playing));
    for (const s of paused) await s.update({ playing: false, pausedTime: s.sound?.currentTime ?? s.pausedTime ?? 0 });
    let sound = list.sounds.find((s) => s.getFlag("nssq", "actor") === actor.id);
    const data = { name: actor.name, path: th.src, volume: Math.clamp(Number(th.volume) || 0.8, 0, 1), repeat: false };
    if (sound) await sound.update({ ...data, pausedTime: 0 });
    else [sound] = await list.createEmbeddedDocuments("PlaylistSound", [{ ...data, flags: { nssq: { actor: actor.id } } }]);
    await sound.update({ playing: true });
    const seconds = Math.max(3, Number(th.seconds) || 20);
    await new Promise((resolve) => {
      const stop = () => { clearTimeout(timer); Hooks.off("updatePlaylistSound", hook); resolve(); };
      const timer = setTimeout(stop, seconds * 1000);
      const hook = Hooks.on("updatePlaylistSound", (s, ch) => { if (s.id === sound.id && ch.playing === false) stop(); });
    });
    if (sound.playing) await sound.update({ playing: false, pausedTime: 0 });
    for (const s of paused) if (s.parent && !s.playing) await s.update({ playing: true });
  } finally {
    busy = false;
  }
}

/* ---------------- 감지 ---------------- */

function speakerActor(message, uuid) {
  const a = uuid ? fromUuidSync(uuid) : null;
  return a ?? ChatMessage.getSpeakerActor(message.speaker);
}

/** 메시지에서 컷인 종류·테마곡 순간을 읽는다 */
function readMoments(message) {
  const atk = message.getFlag("nssq", "attack");
  const card = message.getFlag("nssq", "skillCard");
  const check = message.getFlag("nssq", "check");
  const out = { actor: null, cut: null, theme: [] };
  if (atk) {
    out.actor = speakerActor(message, atk.attackerUuid);
    if (["chase", "counter"].includes(atk.followup?.type)) out.cut = atk.followup.type;
    if ((atk.targets ?? []).some((t) => t.crit)) out.theme.push("crit");
  } else if (card) {
    out.actor = speakerActor(message, card.userUuid);
    if (["chase", "counter"].includes(card.followup?.type)) out.cut = card.followup.type;
    if ((card.entries ?? []).some((e) => (e.hits ?? []).some((h) => h.crit) || e.extra?.crit)) out.theme.push("crit");
    if ((card.entries ?? []).some((e) => (e.inflicts ?? []).some((i) => !i.resisted))) out.theme.push("ailment");
  } else if (check && !check.forcedFail) {
    out.actor = speakerActor(message, check.actorUuid);
    if (evaluateCheck({ ...check, modifier: (check.bonus ?? 0) + (check.modifier ?? 0) }).absSuccess) out.theme.push("absSuccess");
  } else if (message.getFlag("nssq", "evaded")) {
    out.actor = ChatMessage.getSpeakerActor(message.speaker);
    out.cut = "evade";
  }
  return out;
}

/* ---------------- 설정 창 ---------------- */

export async function openThemeConfig(actor) {
  if (!actor?.isOwner || actor.type !== "character") return null;
  const th = actor.getFlag("nssq", "theme") ?? {};
  const browse = game.user.can("FILES_BROWSE");
  const content = `<form class="nssq-theme-config">
    <p class="notes">${esc(L("hint"))}</p>
    <div class="form-group"><label>${esc(L("src"))}</label><input type="text" name="src" value="${esc(th.src ?? "")}" placeholder="${esc(L("srcPlaceholder"))}"/>${browse ? `<button type="button" data-pick style="flex:0 0 32px"><i class="fas fa-file-audio"></i></button>` : ""}</div>
    <div class="form-group"><label>${esc(L("seconds"))}</label><input type="number" name="seconds" min="3" max="300" value="${esc(th.seconds ?? 20)}"/></div>
    <div class="form-group"><label>${esc(L("volume"))}</label><input type="range" name="volume" min="0" max="1" step="0.05" value="${esc(th.volume ?? 0.8)}"/></div>
    <fieldset><legend>${esc(L("when"))}</legend>${TRIGGERS.map((k) => `<label class="checkbox"><input type="checkbox" name="on.${k}" ${th.on?.[k] ?? k !== "ailment" ? "checked" : ""}/> ${esc(L(`on.${k}`))}</label>`).join("")}</fieldset>
    ${browse ? "" : `<p class="notes">${esc(L("noBrowse"))}</p>`}
  </form>`;
  const got = await Dialog.prompt({
    title: L("title", { name: actor.name }), content, label: L("save"), rejectClose: false,
    options: { classes: ["nssq", "dialog"], width: 440 },
    render: (html) => (html[0] ?? html).querySelector("[data-pick]")?.addEventListener("click", () => {
      const input = (html[0] ?? html).querySelector("[name=src]");
      new FilePicker({ type: "audio", current: input.value, callback: (src) => { input.value = src; } }).render(true);
    }),
    callback: (html) => {
      const f = html[0].querySelector("form");
      return {
        src: f.src.value.trim(), seconds: Math.clamp(Number(f.seconds.value) || 20, 3, 300), volume: Number(f.volume.value) || 0.8,
        on: Object.fromEntries(TRIGGERS.map((k) => [k, f.querySelector(`[name="on.${k}"]`).checked]))
      };
    }
  });
  if (!got) return null;
  return actor.setFlag("nssq", "theme", got);
}

export function registerSpotlight() {
  Hooks.on("createChatMessage", (message) => {
    const m = readMoments(message);
    if (!m.actor) return;
    if (m.cut && m.actor.type === "character") cutIn(m.actor, m.cut);
    const k = m.actor.type === "character" ? m.theme.find((x) => m.actor.getFlag("nssq", "theme")?.on?.[x]) : null;
    if (k) playTheme(m.actor, k);
  });
}
