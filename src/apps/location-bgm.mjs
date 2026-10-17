/**
 * 장소 BGM(사용자 요청): 마을·미궁(지도·에어리어)에 정한 곡을 그곳에 들어가면 튼다.
 * - 마을·미궁에 들어갈 때: 그 전에 나오던 곡(테마곡·지금 씬에 연결된 재생목록 제외)을 끄고 그곳의 곡. 곡이 없으면 끄기만
 * - 미궁 안에서 에어리어를 옮길 때: 에어리어 곡(없으면 지도 곡)이 지금 곡과 다를 때만 바꾼다. 둘 다 없으면 그대로
 * - 값은 전투 BGM과 같은 "재생목록id" 또는 "재생목록id.곡id". 마지막으로 튼 값은 설정 locationBgm에 둔다
 */
import { parseBgm } from "../engine/encounters.mjs";

async function soundSafe(fn) {
  try { await fn(); } catch (err) { console.warn("NSSQ | sound", err); }
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
  if (pl && !playingNow) await soundSafe(() => (so ? pl.playSound(so) : pl.playAll()));
  await game.settings.set("nssq", "locationBgm", pl ? ref : "");
}

export function registerLocationBgm() {
  game.settings.register("nssq", "locationBgm", { scope: "world", config: false, type: String, default: "" });
}
