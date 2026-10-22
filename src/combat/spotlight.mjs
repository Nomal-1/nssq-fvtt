/**
 * 캐릭터 테마곡·컷인(사용자 요청 묶음F).
 * - 테마곡: 캐릭터 플래그 nssq.theme = { src, volume, on: { crit, absSuccess, ailment } }(재생 길이 제한 없음, 사용자 요청. 예전 seconds는 무시).
 *   그 순간이 오면 활성 GM이 지금 재생 중인 곡을 일시정지(pausedTime)하고 재생목록 「NSSQ 테마곡」으로 한 번 틀었다가
 *   곡이 끝나면 원래 곡을 이어서 튼다(재생목록 상태라 모든 클라이언트가 같이 듣는다)
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

const volumeOf = (v, d = 0.8) => (Number.isFinite(Number(v)) && v !== "" && v !== null && v !== undefined ? Math.clamp(Number(v), 0, 1) : d);

/**
 * 테마곡 때 멈춘 원래 곡을 다시 튼다. 그사이 다른 곡이 틀어졌거나(씬 전환·GM 조작) 그 곡이 바뀌었으면 건드리지 않는다.
 * paused: [{ playlist, sound, time }] (테마 재생목록 플래그 nssq.paused에도 남겨 GM 새로고침 뒤에도 되살린다)
 */
async function resumePaused(list, paused) {
  const othersPlaying = game.playlists.contents.some((p) => p.id !== list?.id && p.sounds.some((x) => x.playing));
  if (!othersPlaying) {
    for (const r of paused ?? []) {
      const s = game.playlists.get(r.playlist)?.sounds.get(r.sound);
      if (s && !s.playing && (s.pausedTime ?? null) === r.time) await s.update({ playing: true });
    }
  }
  if (list?.getFlag("nssq", "paused")) await list.unsetFlag("nssq", "paused");
}

/** 활성 GM: 그 캐릭터의 테마곡을 한 번 튼다(이미 테마곡 중이면 무시) */
/** 지금 흐르는 테마곡(전투가 끝나면 멈추고, 멈춰 둔 전투 곡은 되돌리지 않는다) */
let current = null;

export async function playTheme(actor, kind) {
  const th = actor?.getFlag("nssq", "theme");
  if (!isActiveGM() || busy || !th?.src || !th.on?.[kind]) return;
  busy = true;
  let list = null;
  let paused = [];
  try {
    list = await themePlaylist();
    // 테마곡 소리를 먼저 준비한다(경로가 잘못되면 여기서 실패하고 원래 곡은 건드리지 않는다)
    let sound = list.sounds.find((s) => s.getFlag("nssq", "actor") === actor.id);
    const data = { name: actor.name, path: th.src, volume: volumeOf(th.volume), repeat: false };
    if (sound) await sound.update({ ...data, pausedTime: 0 });
    else [sound] = await list.createEmbeddedDocuments("PlaylistSound", [{ ...data, flags: { nssq: { actor: actor.id } } }]);
    const playing = game.playlists.contents.filter((p) => p.id !== list.id).flatMap((p) => p.sounds.filter((s) => s.playing));
    for (const s of playing) {
      const time = s.sound?.currentTime ?? s.pausedTime ?? 0;
      await s.update({ playing: false, pausedTime: time });
      paused.push({ playlist: s.parent.id, sound: s.id, time });
    }
    if (paused.length) await list.setFlag("nssq", "paused", paused);
    await sound.update({ playing: true });
    current = { list, sound, cancelResume: false };
    await new Promise((resolve) => {
      // 곡이 끝나면 v12는 재생목록(부모)을 갱신한다(updatePlaylist). 소리 문서를 직접 멈춰도(updatePlaylistSound) 끝
      const check = () => { if (!list.sounds.get(sound.id)?.playing) stop(); };
      const stop = () => { Hooks.off("updatePlaylistSound", h1); Hooks.off("updatePlaylist", h2); resolve(); };
      const h1 = Hooks.on("updatePlaylistSound", (s) => { if (s.id === sound.id) check(); });
      const h2 = Hooks.on("updatePlaylist", (p) => { if (p.id === list.id) check(); });
    });
    const now = list.sounds.get(sound.id);
    if (now?.playing) await now.update({ playing: false, pausedTime: 0 });
  } catch (err) {
    console.warn("NSSQ | theme", err);
  } finally {
    const skip = current?.cancelResume;
    current = null;
    if (!skip) try { await resumePaused(list, paused); } catch (err) { console.warn("NSSQ | theme resume", err); }
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
        src: f.src.value.trim(), volume: volumeOf(f.volume.value),
        on: Object.fromEntries(TRIGGERS.map((k) => [k, f.querySelector(`[name="on.${k}"]`).checked]))
      };
    }
  });
  if (!got) return null;
  return actor.setFlag("nssq", "theme", got);
}

export function registerSpotlight() {
  // 테마곡은 길이 제한이 없어 전투가 끝난 뒤에도 흐를 수 있다: 전투가 끝나면 멈추고 전투 곡은 되돌리지 않는다(전투 종료가 원래 곡을 튼다)
  Hooks.on("deleteCombat", async () => {
    if (!current || !isActiveGM()) return;
    current.cancelResume = true;
    const s = current.list.sounds.get(current.sound.id);
    if (s?.playing) await s.update({ playing: false, pausedTime: 0 });
  });
  // GM이 테마곡 중에 새로고침했으면: 멈춰 둔 원래 곡을 되살린다
  Hooks.once("ready", () => {
    if (!isActiveGM()) return;
    const list = game.playlists.find((x) => x.getFlag("nssq", "theme"));
    const paused = list?.getFlag("nssq", "paused");
    if (paused?.length) setTimeout(() => resumePaused(list, paused).catch((e) => console.warn("NSSQ | theme resume", e)), 3000);
  });
  Hooks.on("createChatMessage", (message) => {
    const m = readMoments(message);
    if (!m.actor) return;
    if (m.cut && m.actor.type === "character") cutIn(m.actor, m.cut);
    const k = m.actor.type === "character" ? m.theme.find((x) => m.actor.getFlag("nssq", "theme")?.on?.[x]) : null;
    if (k) playTheme(m.actor, k);
  });
}
