/**
 * 캐릭터 주인에게 묻는 창(고르기·예/아니요). 플레이어 화면이면 그 화면에서, 활성 GM 화면(후발 행동·에너미 공격 중 등)이면
 * 그 캐릭터를 가진 접속한 플레이어에게 소켓으로 보내 답을 받는다(askOwner·askOwnerAnswer). 접속한 주인이 없거나
 * 2분 동안 답이 없으면 지금 화면에서 묻는다(에너미·GM의 NPC는 언제나 지금 화면)
 */
import { emit, onSocket } from "../socket.mjs";

/** 그 캐릭터를 가진 접속 중인 플레이어(담당 캐릭터인 사람 먼저) */
export function ownerUser(actor) {
  if (!actor?.hasPlayerOwner) return null;
  const list = game.users.filter((u) => !u.isGM && u.active && actor.testUserPermission?.(u, "OWNER"));
  return list.find((u) => u.character?.id === actor.id) ?? list[0] ?? null;
}

/** 폼 값: 체크 상자는 같은 이름끼리 체크한 값 목록, 나머지는 값 */
function readForm(root) {
  const out = {};
  for (const el of root?.querySelectorAll?.("input[name], select[name], textarea[name]") ?? []) {
    if (el.type === "checkbox") { out[el.name] ??= []; if (el.checked) out[el.name].push(el.value); } else if (el.type === "radio") { if (el.checked) out[el.name] = el.value; } else out[el.name] = el.value;
  }
  return out;
}

/**
 * @param {{ title: string, content: string, buttons: Object<string, string>, default?: string, close?: string|null, limit?: { name: string, max: number } }} spec
 *   buttons: { 버튼 id: 글 }. close: 창을 닫으면 고른 것으로 볼 버튼 id(없으면 null). limit: 체크 상자 수 제한
 * @returns {Promise<{ button: string|null, values: object }>}
 */
function askHere(spec) {
  return new Promise((resolve) => {
    let root = null;
    let done = false;
    const finish = (button) => { if (done) return; done = true; resolve({ button, values: readForm(root) }); };
    new Dialog({
      title: spec.title, content: spec.content,
      buttons: Object.fromEntries(Object.entries(spec.buttons).map(([id, label]) => [id, { label, callback: () => finish(id) }])),
      default: spec.default ?? Object.keys(spec.buttons)[0],
      render: (html) => {
        root = html[0] ?? html;
        if (spec.limit) {
          // 정한 수까지만 고를 수 있게
          const list = [...root.querySelectorAll(`[name="${spec.limit.name}"]`)];
          const sync = () => { const n = list.filter((x) => x.checked).length; list.forEach((x) => { x.disabled = !x.checked && n >= spec.limit.max; }); };
          list.forEach((x) => x.addEventListener("change", sync));
          sync();
        }
      },
      close: () => finish(spec.close ?? null)
    }, { classes: ["nssq", "dialog"] }).render(true);
  });
}

const waiting = new Map();

/** @param {Actor} actor 답할 캐릭터 @returns {Promise<{ button: string|null, values: object }>} */
export async function askOwner(actor, spec) {
  const u = game.user.isGM ? ownerUser(actor) : null;
  if (!u) return askHere(spec);
  const reqId = foundry.utils.randomID();
  const got = await new Promise((resolve) => {
    const timer = setTimeout(() => { waiting.delete(reqId); resolve(null); }, 120000);
    waiting.set(reqId, (a) => { clearTimeout(timer); waiting.delete(reqId); resolve(a); });
    emit("askOwner", { reqId, userId: u.id, spec });
  });
  return got ?? askHere(spec);
}

export function registerAskOwner() {
  onSocket("askOwner", async ({ reqId, userId, spec }) => {
    if (userId !== game.user.id) return;
    emit("askOwnerAnswer", { reqId, ...(await askHere(spec)) });
  });
  onSocket("askOwnerAnswer", ({ reqId, ...a }) => waiting.get(reqId)?.(a));
}
