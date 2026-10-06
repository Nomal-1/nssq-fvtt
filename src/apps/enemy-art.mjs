/**
 * 에너미 일러스트 적용.
 * - 컴펜디움은 tools/pack.mjs가 그림을 넣어 만든다
 * - 이미 월드에 만들어진 에너미 액터·배치된 토큰은 그림이 기본 아이콘일 때만 바꾼다(GM이 직접 고른 그림은 그대로).
 *   새 버전에서 그림 표가 바뀌면 GM이 접속할 때 한 번 돈다
 */
import ART from "../generated/enemy-art.mjs";

const DEFAULT_IMGS = new Set(["icons/svg/mystery-man-black.svg", "icons/svg/mystery-man.svg", ""]);
const isDefault = (src) => DEFAULT_IMGS.has(src ?? "");

/** 이 에너미의 일러스트(없으면 null) */
export function enemyArt(name) {
  return ART[name] ?? null;
}

/** 액터·그 액터의 토큰 중 기본 아이콘인 것에 일러스트를 넣는다 */
export async function applyEnemyArt() {
  if (!game.user.isGM) return 0;
  let n = 0;
  for (const a of game.actors.filter((a) => a.type === "enemy")) {
    const art = enemyArt(a.name);
    if (!art) continue;
    const u = {};
    if (isDefault(a.img)) u.img = art;
    if (isDefault(a.prototypeToken.texture.src)) u["prototypeToken.texture.src"] = art;
    if (Object.keys(u).length) {
      await a.update(u);
      n++;
    }
  }
  for (const scene of game.scenes) {
    const updates = scene.tokens
      .filter((t) => t.actor?.type === "enemy" && isDefault(t.texture.src) && enemyArt(t.actor.name))
      .map((t) => ({ _id: t.id, "texture.src": enemyArt(t.actor.name) }));
    if (updates.length) {
      await scene.updateEmbeddedDocuments("Token", updates);
      n += updates.length;
    }
  }
  return n;
}

/** GM 접속 시: 그림 표가 바뀌었으면 한 번 적용 */
export async function migrateEnemyArt() {
  if (game.user !== game.users.activeGM) return;
  const stamp = String(Object.keys(ART).length) + ":" + game.system.version;
  if (game.settings.get("nssq", "enemyArtApplied") === stamp) return;
  const n = await applyEnemyArt();
  await game.settings.set("nssq", "enemyArtApplied", stamp);
  if (n) ui.notifications.info(game.i18n.format("NSSQ.Battle.artApplied", { n }));
}
