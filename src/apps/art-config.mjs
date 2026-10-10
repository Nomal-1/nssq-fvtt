/**
 * 캐릭터 일러스트 설정: 누끼 딴 기본 일러(전신·반신) 하나로 세 가지를 만든다.
 * - 전투 상반신: 메인 페이즈에 행동할 때 전투 화면 오른쪽(bustCrop)
 * - 필드 토큰: 원형으로 잘라 테두리 색으로 전열·후열을 표시(tokenCrop). Foundry 토큰은 그림 파일을 쓰므로
 *   저장할 때 전열용·후열용 그림을 월드 폴더(nssq-tokens)에 만들고, 열이 바뀌면 바꿔 끼운다
 * - 카드 얼굴: 전투 화면 아래 파티 카드(faceCrop). 따로 그림을 고를 수도 있다
 * 프레임 계산은 engine/art.mjs(미리보기를 끌면 위치, 휠이면 확대·축소).
 */
import { DEFAULT_CROP, cropCss, dragCrop, zoomCrop } from "../engine/art.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Art.${k}`, d) : game.i18n.localize(`NSSQ.Art.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** 전열·후열 토큰 테두리 색 */
export const ROW_COLOR = { front: "#e0b84a", back: "#6fd3e6" };
const TOKEN_PX = 400;

/** 실제로 쓸 그림·프레임 */
export function artOf(actor) {
  const a = actor?.system?.art ?? {};
  const full = a.full || actor?.img || "";
  const crop = (k) => ({ ...DEFAULT_CROP[k], ...Object.fromEntries(Object.entries(a[`${k}Crop`] ?? {}).filter(([, v]) => v !== null && v !== undefined)) });
  return {
    full,
    face: a.face || full,
    bustCrop: crop("bust"),
    tokenCrop: crop("token"),
    faceCrop: crop("face"),
    token: a.token ?? {}
  };
}

/** 카드 얼굴·상반신을 그리는 style 속성 값 */
export function faceStyle(actor) {
  const art = artOf(actor);
  return `background-image: url('${esc(art.face)}'); ${cropCss(art.faceCrop)}`;
}
export function bustStyle(actor) {
  const art = artOf(actor);
  return `background-image: url('${esc(art.full)}'); ${cropCss(art.bustCrop)}`;
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** 그림의 높이/너비 비율(끌기 계산용) */
async function imageRatio(src) {
  const img = await loadImage(src);
  return img?.naturalWidth ? img.naturalHeight / img.naturalWidth : 1;
}

/** 원형 토큰 그림(테두리 색 = 열)을 만든다 → Blob */
async function renderToken(src, crop, color) {
  const img = await loadImage(src);
  if (!img) return null;
  const W = TOKEN_PX;
  const cv = document.createElement("canvas");
  cv.width = cv.height = W;
  const ctx = cv.getContext("2d");
  const ring = Math.round(W * 0.05);
  const r = W / 2 - ring / 2;
  // 배경 원 + 그림(CSS background와 같은 계산)
  ctx.save();
  ctx.beginPath();
  ctx.arc(W / 2, W / 2, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = "#14243b";
  ctx.fillRect(0, 0, W, W);
  const iw = crop.s * W;
  const ih = iw * (img.naturalHeight / img.naturalWidth);
  ctx.drawImage(img, ((W - iw) * crop.x) / 100, ((W - ih) * crop.y) / 100, iw, ih);
  ctx.restore();
  // 테두리
  ctx.beginPath();
  ctx.arc(W / 2, W / 2, r, 0, Math.PI * 2);
  ctx.lineWidth = ring;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.beginPath();
  ctx.arc(W / 2, W / 2, r + ring / 2 - 1, 0, Math.PI * 2);
  ctx.stroke();
  return new Promise((resolve) => cv.toBlob(resolve, "image/webp", 0.92));
}

/** 전열·후열 토큰 그림을 월드 폴더에 올린다 → { front, back } 경로 */
async function uploadTokens(actor, src, crop) {
  const { uploadImage } = await import("./upload.mjs");
  const stamp = Date.now().toString(36);
  const out = {};
  for (const row of ["front", "back"]) {
    const blob = await renderToken(src, crop, ROW_COLOR[row]);
    if (!blob) return null;
    // 업로드 권한이 없는 플레이어는 GM이 대신 올린다(upload.mjs)
    const path = await uploadImage(blob, `${actor.id}-${stamp}-${row}.webp`);
    if (!path) return null;
    out[row] = path;
  }
  return out;
}

/** 이 캐릭터의 토큰 그림을 지금 열에 맞춘다(프로토타입 + 전투 사본이 아닌 씬의 토큰) */
export async function applyRowToken(actor) {
  const t = actor?.system?.art?.token;
  if (!t?.front || !t?.back) return;
  const src = actor.system.row === "back" ? t.back : t.front;
  if (actor.prototypeToken.texture.src !== src) await actor.update({ "prototypeToken.texture.src": src }, { nssqArt: true });
  for (const scene of game.scenes) {
    if (scene.getFlag("nssq", "battleCopy") || !scene.canUserModify?.(game.user, "update")) continue;
    const updates = scene.tokens.filter((tk) => tk.actorLink && tk.actorId === actor.id && tk.texture.src !== src).map((tk) => ({ _id: tk.id, "texture.src": src }));
    if (updates.length) await scene.updateEmbeddedDocuments("Token", updates);
  }
}

export async function openArtConfig(actor) {
  // 서버 파일 고르기는 둘러보기 권한이 있을 때만(없는 플레이어는 [올리기]만)
  const canBrowse = game.user.can("FILES_BROWSE");
  if (!actor?.isOwner) return;
  const start = artOf(actor);
  // 편집 중인 상태
  const st = {
    full: actor.system.art?.full ?? "",
    face: actor.system.art?.face ?? "",
    bustCrop: { ...start.bustCrop },
    tokenCrop: { ...start.tokenCrop },
    faceCrop: { ...start.faceCrop }
  };
  const fullSrc = () => st.full || actor.img;
  const faceSrc = () => st.face || fullSrc();
  const srcOf = (key) => (key === "face" ? faceSrc() : fullSrc());
  const row = actor.system.row === "back" ? "back" : "front";
  const content = `
    <form class="nssq-art-config">
      <div class="art-base">
        <div class="art-thumb" data-thumb></div>
        <div class="art-base-info">
          <b>${L("base")}</b><p class="notes">${L("baseHint")}</p>
          <div class="art-row"><button type="button" data-upload="full" class="go"><i class="fas fa-upload"></i> ${L("uploadFull")}</button>${canBrowse ? `<button type="button" data-pick="full"><i class="fas fa-image"></i> ${L("pickFull")}</button>` : ""}
            <button type="button" data-clear="full" title="${L("useActorImg")}"><i class="fas fa-undo"></i></button></div>
          <div class="art-path" data-path="full"></div>
        </div>
      </div>
      <p class="notes">${L("frameHint")}</p>
      <div class="art-cols">
        <div class="art-col">
          <h4>${L("bust")}</h4>
          <div class="art-frame bust" data-frame="bust"></div>
          <button type="button" data-reset="bust"><i class="fas fa-crop-alt"></i> ${L("resetFrame")}</button>
        </div>
        <div class="art-col">
          <h4>${L("token")}</h4>
          <div class="art-frame token ${row}" data-frame="token"></div>
          <p class="notes">${L("tokenHint")}</p>
          <button type="button" data-reset="token"><i class="fas fa-crop-alt"></i> ${L("resetFrame")}</button>
        </div>
        <div class="art-col">
          <h4>${L("face")}</h4>
          <div class="art-frame face" data-frame="face"></div>
          <div class="art-row"><button type="button" data-upload="face"><i class="fas fa-upload"></i> ${L("uploadFace")}</button>${canBrowse ? `<button type="button" data-pick="face"><i class="fas fa-user"></i> ${L("pickFace")}</button>` : ""}
            <button type="button" data-clear="face" title="${L("useFull")}"><i class="fas fa-undo"></i></button></div>
          <div class="art-path" data-path="face"></div>
          <button type="button" data-reset="face"><i class="fas fa-crop-alt"></i> ${L("resetFrame")}</button>
        </div>
      </div>
    </form>`;

  const refresh = (html) => {
    const root = html[0];
    const css = (key) => `background-image: url('${srcOf(key)}'); ${cropCss(st[`${key}Crop`])}`;
    for (const key of ["bust", "token", "face"]) root.querySelector(`[data-frame="${key}"]`).style.cssText = css(key);
    root.querySelector("[data-thumb]").style.backgroundImage = `url('${fullSrc()}')`;
    root.querySelector('[data-path="full"]').textContent = st.full || `(${L("useActorImg")})`;
    root.querySelector('[data-path="face"]').textContent = st.face || `(${L("useFull")})`;
  };

  const bindFrame = (html, el, key) => {
    let drag = null;
    el.addEventListener("pointerdown", async (ev) => {
      ev.preventDefault();
      el.setPointerCapture(ev.pointerId);
      drag = { x: ev.clientX, y: ev.clientY, ratio: await imageRatio(srcOf(key)) };
    });
    el.addEventListener("pointermove", (ev) => {
      if (!drag) return;
      const box = el.getBoundingClientRect();
      const k = `${key}Crop`;
      st[k] = dragCrop(st[k], { dx: ev.clientX - drag.x, dy: ev.clientY - drag.y, boxW: box.width, boxH: box.height, ratio: drag.ratio });
      drag.x = ev.clientX;
      drag.y = ev.clientY;
      refresh(html);
    });
    el.addEventListener("pointerup", () => { drag = null; });
    el.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      const k = `${key}Crop`;
      st[k] = zoomCrop(st[k], ev.deltaY < 0 ? 1.08 : 1 / 1.08);
      refresh(html);
    }, { passive: false });
  };

  const result = await Dialog.prompt({
    title: `${actor.name} — ${L("title")}`,
    content,
    label: L("save"),
    rejectClose: false,
    options: { classes: ["nssq", "dialog"], width: 640 },
    render: (html) => {
      const root = html[0];
      for (const key of ["bust", "token", "face"]) bindFrame(html, root.querySelector(`[data-frame="${key}"]`), key);
      root.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => {
        const key = b.dataset.pick;
        new FilePicker({
          type: "image",
          current: st[key] || actor.img,
          callback: (path) => {
            st[key] = path;
            // 얼굴을 따로 고르면 그 그림 전체가 보이도록
            if (key === "face") st.faceCrop = { x: 50, y: 50, s: 1 };
            refresh(html);
          }
        }).render(true);
      }));
      // 이 컴퓨터에서 올리기(업로드 권한이 없으면 GM이 대신 올림)
      root.querySelectorAll("[data-upload]").forEach((b) => b.addEventListener("click", async () => {
        const key = b.dataset.upload;
        const up = await import("./upload.mjs");
        const file = await up.pickLocalImage();
        if (!file) return;
        b.disabled = true;
        try {
          const blob = await up.shrinkImage(file);
          const path = blob ? await up.uploadImage(blob, `${actor.id}-${Date.now().toString(36)}-${key}.webp`) : null;
          if (path) {
            st[key] = path;
            if (key === "full") st.fullUploaded = true;
            if (key === "face") st.faceCrop = { x: 50, y: 50, s: 1 };
          }
        } finally { b.disabled = false; refresh(html); }
      }));
      root.querySelectorAll("[data-clear]").forEach((b) => b.addEventListener("click", () => {
        st[b.dataset.clear] = "";
        if (b.dataset.clear === "face") st.faceCrop = { ...DEFAULT_CROP.face };
        refresh(html);
      }));
      root.querySelectorAll("[data-reset]").forEach((b) => b.addEventListener("click", () => {
        const key = b.dataset.reset;
        st[`${key}Crop`] = key === "face" && st.face ? { x: 50, y: 50, s: 1 } : { ...DEFAULT_CROP[key] };
        refresh(html);
      }));
      refresh(html);
    },
    callback: () => true
  });
  if (!result) return;

  const update = { "system.art": { full: st.full, face: st.face, bustCrop: st.bustCrop, tokenCrop: st.tokenCrop, faceCrop: st.faceCrop } };
  // 필드 토큰 그림(전열·후열)
  let token = null;
  try {
    token = await uploadTokens(actor, fullSrc(), st.tokenCrop);
  } catch (e) {
    console.warn("NSSQ | token upload", e);
  }
  if (token) update["system.art"].token = token;
  // 새로 올린 전신 그림은 캐릭터 그림(액터 이미지)으로도 쓴다
  if (st.fullUploaded && st.full) update.img = st.full;
  else ui.notifications.warn(L("tokenUploadFailed"));
  await actor.update(update);
  if (token) await applyRowToken(actor);
}

export function registerArt() {
  // 열이 바뀌면(배치 변경·섞기·교대) 토큰 그림도 바꾼다. 바꾼 사람의 화면에서 한 번
  Hooks.on("updateActor", (actor, changes, options, userId) => {
    if (userId !== game.user.id || actor.type !== "character" || options.nssqArt) return;
    if (foundry.utils.hasProperty(changes, "system.row")) applyRowToken(actor);
  });
}
