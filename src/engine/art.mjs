/**
 * 일러스트 자르기(프레임): 그림을 틀 안에서 얼마나 키우고(s), 어디를 보일지(x, y %)를 CSS 배경으로 나타낸다.
 * - s = 그림 너비 / 틀 너비 (1이면 틀 너비에 딱 맞음)
 * - x, y = CSS background-position 비율(0 = 왼쪽·위 끝, 100 = 오른쪽·아래 끝)
 * Foundry 비의존 순수 함수.
 */

export const MIN_SCALE = 0.3;
export const MAX_SCALE = 8;

/** 기본 프레임: 상반신 = 너비에 맞추고 위쪽, 토큰·얼굴 = 키워서 위쪽 가운데(머리) */
export const DEFAULT_CROP = {
  bust: { x: 50, y: 0, s: 1 },
  token: { x: 50, y: 4, s: 2 },
  face: { x: 50, y: 6, s: 2.4 }
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** CSS(background-size·position) */
export function cropCss({ x = 50, y = 50, s = 1 } = {}) {
  return `background-size: ${Math.round(s * 1000) / 10}% auto; background-position: ${Math.round(x * 10) / 10}% ${Math.round(y * 10) / 10}%;`;
}

/**
 * 틀 위에서 그림을 dx, dy(px) 끌었을 때의 새 프레임.
 * background-position p%는 「틀 − 그림」의 p%만큼 옮긴다 → Δp = Δpx × 100 / (틀 − 그림)
 * @param {{x, y, s}} crop
 * @param {{dx, dy, boxW, boxH, ratio}} m ratio = 그림 높이 / 너비
 */
export function dragCrop(crop, { dx = 0, dy = 0, boxW, boxH, ratio = 1 }) {
  const imgW = crop.s * boxW;
  const imgH = imgW * ratio;
  const step = (d, box, img, p) => (Math.abs(box - img) < 0.5 ? p : clamp(p + (d * 100) / (box - img), 0, 100));
  return { ...crop, x: step(dx, boxW, imgW, crop.x), y: step(dy, boxH, imgH, crop.y) };
}

/** 휠로 확대·축소(factor > 1이면 확대) */
export function zoomCrop(crop, factor) {
  return { ...crop, s: clamp(crop.s * factor, MIN_SCALE, MAX_SCALE) };
}
