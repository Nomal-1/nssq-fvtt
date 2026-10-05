/**
 * 프리셋용 에너미 액터 관리.
 * - 프리셋 씬에 컴펜디움 에너미를 끌어 놓으면, 같은 에너미 액터를 「프리셋 에너미」 폴더에서 재사용한다(중복 생성 방지)
 * - [에너미 정리]: 이름·이미지·능력치까지 완전히 같은 중복만 하나로 합치고(토큰은 그 하나를 가리키게, 토큰별 수정은 유지),
 *   GM이 복제해 만든 변형(이름·값이 다른 것)은 건드리지 않는다.
 *   어느 씬에서도 쓰지 않는 시스템 에너미 액터는 확인 후 지운다
 */
import { sameEnemyData } from "../engine/rare.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Battle.${k}`, d) : game.i18n.localize(`NSSQ.Battle.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** 컴펜디움 원본 uuid(v12 _stats.compendiumSource, 예전 flags.core.sourceId) */
export const sourceOf = (doc) => doc?._stats?.compendiumSource ?? doc?.flags?.core?.sourceId ?? null;

async function enemyFolder() {
  let folder = game.folders.find((f) => f.type === "Actor" && f.getFlag("nssq", "presetEnemies"));
  folder ??= await Folder.create({ name: L("enemyFolder"), type: "Actor", flags: { nssq: { presetEnemies: true } } });
  return folder;
}

/**
 * 이 원본의 기본 액터(없으면 「프리셋 에너미」 폴더에 하나 만든다).
 * 기본 액터 = 이 기능으로 만든 것(flags.nssq.library)이고 이름이 원본 그대로, 희소종이 아닌 것.
 * GM이 복제·수정한 변형은 재사용 대상이 아니다.
 */
export async function enemyActorFor(uuid) {
  const doc = await fromUuid(uuid);
  if (!doc) return null;
  const existing = game.actors.find((a) => a.type === "enemy" && a.getFlag("nssq", "library") === uuid && a.name === doc.name && !a.system.isRare);
  if (existing) return existing;
  const folder = await enemyFolder();
  const data = game.actors.fromCompendium(doc);
  data.folder = folder.id;
  foundry.utils.setProperty(data, "_stats.compendiumSource", uuid);
  foundry.utils.setProperty(data, "flags.nssq.library", uuid);
  return Actor.implementation.create(data);
}

/** 떨어뜨린 위치(중심)에 토큰을 놓는다 */
async function placeEnemy(scene, data) {
  const actor = await enemyActorFor(data.uuid);
  if (!actor) return;
  const g = scene.grid.size;
  const td = await actor.getTokenDocument({
    x: Math.round((data.x - g / 2) / g) * g,
    y: Math.round((data.y - g / 2) / g) * g,
    actorLink: false
  });
  await scene.createEmbeddedDocuments("Token", [td.toObject()]);
}

/** 정리: 중복 합치기 + 안 쓰는 것 지우기 */
export async function cleanupEnemies() {
  if (!game.user.isGM) return;
  const enemies = game.actors.filter((a) => a.type === "enemy");
  const groups = new Map();
  for (const a of enemies) {
    const src = sourceOf(a);
    if (!src) continue;
    if (!groups.has(src)) groups.set(src, []);
    groups.get(src).push(a);
  }
  const folder = await enemyFolder();
  // 1) 완전히 같은 중복만 합친다(변형은 그대로). 기본 액터(library)를 대표로
  let merged = 0;
  for (const list of groups.values()) {
    const clusters = [];
    for (const actor of list) {
      const data = actor.toObject();
      const c = clusters.find((cl) => sameEnemyData(cl.data, data));
      if (c) c.actors.push(actor);
      else clusters.push({ data, actors: [actor] });
    }
    for (const { actors } of clusters) {
      const keep = actors.find((x) => x.getFlag("nssq", "library")) ?? actors.find((x) => x.folder?.id === folder.id) ?? actors[0];
      const drop = actors.filter((x) => x !== keep);
      if (drop.length) {
        const dropIds = new Set(drop.map((x) => x.id));
        for (const scene of game.scenes) {
          const updates = scene.tokens.filter((t) => dropIds.has(t.actorId)).map((t) => ({ _id: t.id, actorId: keep.id, actorLink: false }));
          if (updates.length) await scene.updateEmbeddedDocuments("Token", updates);
        }
        for (const x of drop) await x.delete();
        merged += drop.length;
      }
      const upd = {};
      if (keep.folder?.id !== folder.id) upd.folder = folder.id;
      // 원본 그대로인 것만 재사용 대상(기본 액터)으로 표시
      const src = await fromUuid(sourceOf(keep));
      if (src && keep.name === src.name && !keep.getFlag("nssq", "library") && !keep.system.isRare) upd["flags.nssq.library"] = sourceOf(keep);
      if (Object.keys(upd).length) await keep.update(upd);
    }
  }
  // 2) 어느 씬의 토큰도 쓰지 않는 시스템 에너미(컴펜디움에서 온 것)
  const used = new Set(game.scenes.flatMap((s) => s.tokens.map((t) => t.actorId)));
  const unused = game.actors.filter((a) => a.type === "enemy" && sourceOf(a)?.startsWith("Compendium.nssq.") && !used.has(a.id));
  let removed = 0;
  if (unused.length) {
    const ok = await Dialog.confirm({
      title: L("cleanupTitle"),
      content: `<p>${L("cleanupUnused", { n: unused.length })}</p><ul>${unused.map((a) => `<li>${esc(a.name)}</li>`).join("")}</ul><p class="notes">${L("cleanupUnusedNote")}</p>`,
      rejectClose: false
    });
    if (ok) {
      await Actor.deleteDocuments(unused.map((a) => a.id));
      removed = unused.length;
    }
  }
  ui.notifications.info(L("cleanupDone", { merged, removed }));
}

const isPreset = (scene) => !!scene?.getFlag("nssq", "battlePreset");

export function registerEnemyLibrary() {
  // 프리셋 씬의 에너미 토큰은 항상 액터와 연결하지 않는다(프리셋에서 고친 값이 액터 원본에 들어가지 않도록)
  Hooks.on("preCreateToken", (token) => {
    if (!isPreset(token.parent) || token.actor?.type !== "enemy" || !token.actorLink) return;
    token.updateSource({ actorLink: false });
  });
  Hooks.on("preUpdateToken", (token, changes) => {
    if (!isPreset(token.parent) || token.actor?.type !== "enemy" || changes.actorLink !== true) return;
    changes.actorLink = false;
    ui.notifications.warn(L("presetNoLink"));
  });
  // 프리셋 씬에 컴펜디움 에너미를 끌어 놓을 때: 기본 동작(매번 새 액터 가져오기) 대신 재사용
  Hooks.on("dropCanvasData", (cnv, data) => {
    if (!game.user.isGM || data?.type !== "Actor" || !data.uuid?.startsWith("Compendium.")) return;
    const scene = cnv.scene;
    if (!scene?.getFlag("nssq", "battlePreset")) return;
    const entry = fromUuidSync(data.uuid);
    if (entry?.type !== "enemy") return;
    placeEnemy(scene, data);
    return false;
  });
}
