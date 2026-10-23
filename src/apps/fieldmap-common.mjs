/**
 * 필드 지도 공용(진행·편집 창이 같이 쓰는 상태 읽기·문구·양피지 그림). apps/fieldmap.mjs가 다시 내보낸다
 */
import { timeOfDayAt } from "../engine/dungeon.mjs";
import { esc } from "../util.mjs";

export const L = (k, d) => (d ? game.i18n.format(`NSSQ.FieldMap.${k}`, d) : game.i18n.localize(`NSSQ.FieldMap.${k}`));
export const opt = (v, cur, label) => `<option value="${esc(v)}" ${String(v) === String(cur ?? "") ? "selected" : ""}>${esc(label)}</option>`;
export const rid = () => foundry.utils.randomID(8);
export const W = 1000;
export const H = 700;
export const R = 34;
// Font Awesome 글리프(SVG 텍스트)
export const G = { lock: "", flag: "", eye: "" };

export const allMaps = () => game.settings.get("nssq", "fieldMaps") ?? {};
export const mapState = () => game.settings.get("nssq", "fieldMapState") ?? {};
export const activeMap = () => { const s = mapState(); return s.active ? allMaps()[s.mapId] ?? null : null; };
export const areaName = (map, id) => map?.areas?.find((a) => a.id === id)?.name ?? "?";
export const areaOf = (map, id) => map?.areas?.find((a) => a.id === id) ?? null;
/** 에어리어 그림: 직접 고른 그림 → 연결한 씬의 배경(저장할 때 sceneImg로 복사해 두어 플레이어도 본다) */
export const areaImg = (a) => a?.img || a?.sceneImg || "";
export const sceneImage = (id) => { const sc = game.scenes.get(id); return sc?.background?.src || sc?.thumb || ""; };
/** 재생목록·곡 선택지(apps/encounters.mjs와 같은 값) */
export function encBgmOptions(cur, emptyLabel) {
  const out = [opt("", cur, emptyLabel)];
  for (const p of game.playlists.contents) {
    out.push(opt(p.id, cur, `♫ ${p.name}`));
    for (const so of p.sounds.contents) out.push(opt(`${p.id}.${so.id}`, cur, `  └ ${so.name}`));
  }
  return out.join("");
}

/** 나침반(장식): 오른쪽 위, 지도 전체로 뻗는 방위선 */
const CX = W - 150;
const CY = 135;
const compass = () => {
  const rays = Array.from({ length: 32 }, (_, i) => {
    const t = (i / 32) * Math.PI * 2;
    return `<line x1="${CX + Math.cos(t) * 62}" y1="${CY + Math.sin(t) * 62}" x2="${CX + Math.cos(t) * 1300}" y2="${CY + Math.sin(t) * 1300}"/>`;
  }).join("");
  const star = (r, w, rot) => `<path transform="rotate(${rot})" d="M0,${-r} L${w},${-w} L${r},0 L${w},${w} L0,${r} L${-w},${w} L${-r},0 L${-w},${-w} Z"/>`;
  return `<g class="fm-rays">${rays}</g><g class="fm-compass" transform="translate(${CX},${CY})"><circle r="58"/><circle r="52"/><circle r="40"/>
    ${star(48, 7, 45)}${star(58, 9, 0)}<path class="n" d="M0,-58 L9,-9 L-9,-9 Z"/><circle class="hub" r="4"/><text y="-66">N</text></g>`;
};

/** 시드 고정 난수(지도마다 같은 찢긴 가장자리) */
function rng(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** 찢긴 양피지 윤곽(시계 방향) */
function tornPath(seed) {
  const r = rng(seed);
  const I = 24;
  const pts = [];
  const edge = (x0, y0, x1, y1, nx, ny) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.round(len / 13);
    for (let k = 0; k < n; k++) {
      const t = k / n;
      // 대부분 잔 톱니, 가끔 깊게 찢긴 홈
      const d = r() < 0.06 ? 10 + r() * 16 : r() * 9;
      pts.push([x0 + (x1 - x0) * t + nx * d, y0 + (y1 - y0) * t + ny * d]);
    }
  };
  edge(I, I, W - I, I, 0, 1);
  edge(W - I, I, W - I, H - I, -1, 0);
  edge(W - I, H - I, I, H - I, 0, -1);
  edge(I, H - I, I, I, 1, 0);
  return `M${pts.map((p) => p.map((v) => v.toFixed(1)).join(",")).join(" L")} Z`;
}

/** 얼룩(시드 고정) */
function stains(seed) {
  const r = rng(`${seed}:stain`);
  return Array.from({ length: 7 }, () => `<ellipse cx="${(80 + r() * (W - 160)).toFixed(0)}" cy="${(70 + r() * (H - 140)).toFixed(0)}" rx="${(40 + r() * 110).toFixed(0)}" ry="${(30 + r() * 80).toFixed(0)}" opacity="${(0.06 + r() * 0.1).toFixed(2)}"/>`).join("");
}

/** 양피지 배경: 그림자 → 종이(그라데이션·결·얼룩·격자·방위선·나침반) → 그을린 가장자리 */
export function parchment(seed) {
  const d = tornPath(seed);
  const grid = [...Array.from({ length: 9 }, (_, i) => `<line x1="${(i + 1) * 100}" y1="0" x2="${(i + 1) * 100}" y2="${H}"/>`), ...Array.from({ length: 6 }, (_, i) => `<line x1="0" y1="${(i + 1) * 100}" x2="${W}" y2="${(i + 1) * 100}"/>`)].join("");
  return `<defs><clipPath id="fm-paper"><path d="${d}"/></clipPath></defs>
    <path d="${d}" class="fm-paper-shadow" transform="translate(5,8)" filter="url(#fm-blur)"/>
    <g clip-path="url(#fm-paper)">
      <rect width="${W}" height="${H}" fill="url(#fm-grad)"/>
      <rect width="${W}" height="${H}" filter="url(#fm-noise)" opacity="0.45"/>
      <g class="fm-stains">${stains(seed)}</g>
      <g class="fm-grid">${grid}</g>
      ${compass()}
      <path d="${d}" class="fm-burn" filter="url(#fm-blur)"/>
      <path d="${d}" class="fm-burn-edge" filter="url(#fm-blur2)"/>
    </g>`;
}
export const passageLabel = (map, p) => `${areaName(map, p.a)} ${p.oneWay ? "→" : "↔"} ${areaName(map, p.b)}${p.label ? ` (${p.label})` : ""}`;
export const clock = (s) => L("clock", { seg: s.segment ?? 0, h: s.hour ?? 0, tod: game.i18n.localize(`NSSQ.Dungeon.tod.${timeOfDayAt(s.hour ?? 0)}`) });

export async function saveMap(map) {
  if (!game.user.isGM) return;
  await game.settings.set("nssq", "fieldMaps", { ...allMaps(), [map.id]: foundry.utils.deepClone(map) });
}
