/**
 * 그림 올리기(캐릭터 일러스트 등)
 * - 업로드 권한(FILES_UPLOAD)이 있으면 바로 올린다
 * - 없으면 브라우저에서 줄여(긴 변 1600px, webp) 조각으로 나눠 활성 GM에게 보내고, GM이 대신 올려 경로를 돌려준다
 * - 저장 위치: worlds/<월드>/nssq-art/<캐릭터 id>-<시각>.webp (GM 대리 업로드는 이 폴더 밖으로 쓰지 않는다)
 */
import { emit, onSocket } from "../socket.mjs";
import { isActiveGM } from "../combat/apply.mjs";

const L = (k) => game.i18n.localize(`NSSQ.Upload.${k}`);
export const artDir = () => `worlds/${game.world.id}/nssq-art`;
const CHUNK = 256 * 1024;
const MAX_TOTAL = 12 * 1024 * 1024;

/** 파일 고르기 창(이 컴퓨터) → File | null */
export function pickLocalImage() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp,image/gif";
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
}

/** 긴 변 max px로 줄여 webp Blob */
export async function shrinkImage(file, max = 1600, quality = 0.88) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const cv = document.createElement("canvas");
    cv.width = Math.round(img.naturalWidth * k);
    cv.height = Math.round(img.naturalHeight * k);
    cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
    return await new Promise((res) => cv.toBlob(res, "image/webp", quality));
  } finally { URL.revokeObjectURL(url); }
}

const safeName = (n) => String(n ?? "img").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);

async function directUpload(blob, dir, name) {
  try { await FilePicker.createDirectory("data", dir); } catch { /* 이미 있음 */ }
  const res = await FilePicker.upload("data", dir, new File([blob], name, { type: blob.type || "image/webp" }), {}, { notify: false });
  return res?.path ?? null;
}

const pending = new Map();

/**
 * 그림을 올리고 경로를 돌려준다. dir은 artDir() 아래만(GM 대리 업로드 검사)
 * @returns {Promise<string|null>}
 */
export async function uploadImage(blob, name, dir = artDir()) {
  name = safeName(name);
  if (game.user.can("FILES_UPLOAD")) return directUpload(blob, dir, name);
  if (!game.users.activeGM) { ui.notifications.warn(L("noGM")); return null; }
  const data = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
  if (data.length > MAX_TOTAL) { ui.notifications.warn(L("tooBig")); return null; }
  const reqId = foundry.utils.randomID();
  const parts = Math.ceil(data.length / CHUNK);
  const done = new Promise((resolve) => {
    pending.set(reqId, resolve);
    setTimeout(() => { if (pending.delete(reqId)) resolve(null); }, 60000);
  });
  for (let i = 0; i < parts; i++) emit("uploadPart", { reqId, userId: game.user.id, dir, name, i, parts, data: data.slice(i * CHUNK, (i + 1) * CHUNK) });
  const path = await done;
  if (!path) ui.notifications.warn(L("failed"));
  return path;
}

/* GM 쪽: 조각을 모아 올린다 */
const inbox = new Map();
async function onPart({ reqId, userId, dir, name, i, parts, data }) {
  if (!isActiveGM()) return;
  const box = inbox.get(reqId) ?? { parts: new Array(parts), n: 0, size: 0 };
  if (box.parts[i] === undefined) { box.parts[i] = data; box.n++; box.size += data.length; }
  inbox.set(reqId, box);
  if (box.size > MAX_TOTAL) { inbox.delete(reqId); return emit("uploadDone", { reqId, userId, path: null }); }
  if (box.n < parts) return;
  inbox.delete(reqId);
  let path = null;
  try {
    // 정해진 폴더 밖·이상한 이름·그림이 아닌 것은 받지 않는다
    if (dir !== artDir()) throw new Error("dir");
    const url = box.parts.join("");
    if (!/^data:image\/(webp|png|jpeg|gif);base64,/.test(url)) throw new Error("type");
    const blob = await (await fetch(url)).blob();
    path = await directUpload(blob, dir, safeName(name));
  } catch (err) { console.warn("NSSQ | upload", err); }
  emit("uploadDone", { reqId, userId, path });
}

export function registerUpload() {
  onSocket("uploadPart", onPart);
  onSocket("uploadDone", ({ reqId, userId, path }) => {
    if (userId !== game.user.id) return;
    const resolve = pending.get(reqId);
    if (resolve) { pending.delete(reqId); resolve(path); }
  });
}
