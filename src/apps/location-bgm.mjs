/**
 * 장소 BGM(사용자 요청): 마을·미궁(지도·에어리어)에 정한 곡을 그곳에 들어가면 튼다.
 * - 마을·미궁에 들어갈 때: 그 전에 나오던 곡(테마곡·지금 씬에 연결된 재생목록 제외)을 끄고 그곳의 곡. 곡이 없으면 끄기만
 * - 미궁 안에서 에어리어를 옮길 때: 에어리어 곡(없으면 지도 곡)이 지금 곡과 다를 때만 바꾼다. 둘 다 없으면 그대로
 * - 반복(사용자 요청): 시스템이 트는 BGM(마을·미궁·전투·랜덤 던전 필드)은 Foundry 설정과 관계없이 반복한다(ensureLoop)
 * - 값은 전투 BGM과 같은 "재생목록id" 또는 "재생목록id.곡id". 마지막으로 튼 값은 설정 locationBgm에 둔다
 */
import { parseBgm } from "../engine/encounters.mjs";

async function soundSafe(fn) {
  try { await fn(); } catch (err) { console.warn("NSSQ | sound", err); }
}

/**
 * 반복 재생이 되게 문서를 맞춘다. 곡 하나: 그 곡의 「반복」을 켠다(Foundry는 곡이 끝나면 같은 목록의 다음 곡으로 넘어가거나 멈춘다).
 * 재생목록 전체: 「순차」·「셔플」이 아니면 「순차」로(끝까지 가면 처음으로 돌아간다). 곡이 하나뿐이면 그 곡을 반복
 */
export async function ensureLoop(pl, so = null) {
  if (!pl || !game.user.isGM) return;
  const M = CONST.PLAYLIST_MODES;
  if (so) { if (!so.repeat) await soundSafe(() => so.update({ repeat: true })); return; }
  if (![M.SEQUENTIAL, M.SHUFFLE].includes(pl.mode)) await soundSafe(() => pl.update({ mode: M.SEQUENTIAL }));
  if (pl.sounds.size === 1) { const only = pl.sounds.contents[0]; if (!only.repeat) await soundSafe(() => only.update({ repeat: true })); }
}

/** 반복으로 튼다(곡 하나 또는 재생목록 전체) */
export async function playLooped(pl, so = null) {
  if (!pl) return;
  await ensureLoop(pl, so);
  await soundSafe(() => (so ? pl.playSound(so) : pl.playAll()));
}

/** @param {string} ref @param {{ enter?: boolean }} opts enter: 장소에 새로 들어감(이전 곡을 끈다) */
export async function playLocationBgm(ref, { enter = false } = {}) {
  if (!game.user.isGM) return;
  ref = ref || "";
  const { playlist, sound } = parseBgm(ref);
  const pl = playlist ? game.playlists.get(playlist) ?? null : null;
  const so = pl && sound ? pl.sounds.get(sound) ?? null : null;
  if (!pl && !enter) return;
  const playingNow = so ? so.playing : !!pl?.playing;
  if (pl && playingNow && ref === game.settings.get("nssq", "locationBgm")) return;
  const keep = (p, s) => p.getFlag("nssq", "theme") || p.id === game.scenes.active?.playlist?.id || (p.id === pl?.id && (!so || s.id === so.id));
  for (const p of game.playlists.contents) {
    for (const s of p.sounds.contents) if (s.playing && !keep(p, s)) await soundSafe(() => s.update({ playing: false }));
  }
  if (pl && !playingNow) await playLooped(pl, so);
  else if (pl) await ensureLoop(pl, so);
  await game.settings.set("nssq", "locationBgm", pl ? ref : "");
}

export function registerLocationBgm() {
  game.settings.register("nssq", "locationBgm", { scope: "world", config: false, type: String, default: "" });
}
