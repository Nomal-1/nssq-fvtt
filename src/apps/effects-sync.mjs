/**
 * 효과 데이터 갱신(GM): 시스템 컴펜디움(스킬·아이템·에너미)의 effects를 월드의 액터·아이템에 복사한다.
 * 스킬·아이템을 끌어다 놓을 때 effects가 비어 있던 것(단계 6~7에서 데이터가 채워짐)을 맞추기 위함.
 * 같은 key(system.key)끼리만 바꾸고, GM이 시트에서 손으로 effects를 쓴 것(review가 "manual")은 건드리지 않는다.
 * 시스템 버전이 바뀐 뒤 처음 접속하면 자동으로 한 번 실행한다.
 */
import tables from "../generated/tables.mjs";
import { expForLevel, levelFromExp } from "../engine/derive.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.EffectsSync.${k}`, d) : game.i18n.localize(`NSSQ.EffectsSync.${k}`));

/** key → { effects, review } */
async function packEffects() {
  const map = new Map();
  const put = (it) => {
    const key = it.system?.key;
    if (key && Array.isArray(it.system.effects) && it.system.effects.length) map.set(key, { effects: it.system.effects, review: it.system.review ?? "", note: it.system.effectsNote ?? "" });
  };
  for (const name of ["nssq.skills", "nssq.items"]) {
    const pack = game.packs.get(name);
    if (!pack) continue;
    for (const doc of await pack.getDocuments()) put(doc);
  }
  const enemies = game.packs.get("nssq.enemies");
  if (enemies) for (const a of await enemies.getDocuments()) for (const it of a.items) put(it);
  return map;
}

const same = (a, b) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

export async function syncEffects({ quiet = false } = {}) {
  if (!game.user.isGM) return 0;
  const map = await packEffects();
  let n = 0;
  const fix = (it) => {
    const src = map.get(it.system?.key);
    if (!src || it.system.review === "manual" || (same(it.system.effects, src.effects) && (it.system.effectsNote ?? "") === src.note)) return null;
    n++;
    return {
      _id: it.id, "system.effects": src.effects,
      ...(it.system.review !== undefined ? { "system.review": src.review } : {}),
      ...(it.system.effectsNote !== undefined ? { "system.effectsNote": src.note } : {})
    };
  };
  for (const a of game.actors) {
    const updates = a.items.map(fix).filter(Boolean);
    if (updates.length) await a.updateEmbeddedDocuments("Item", updates);
  }
  const worldItems = game.items.map(fix).filter(Boolean);
  if (worldItems.length) await Item.updateDocuments(worldItems);
  await game.settings.set("nssq", "effectsSyncedVersion", game.system.version);
  if (!quiet || n) ui.notifications.info(L("done", { n }));
  return n;
}

/**
 * v0.10.8: 레벨을 경험점으로 정하게 바뀌었다. 저장된 레벨보다 경험점이 적은 캐릭터는
 * 경험점을 그 레벨의 누적 값으로 올려 레벨이 내려가지 않게 한다(한 번만)
 */
async function migrateLevelExp() {
  if (game.settings.get("nssq", "levelExpMigrated")) return;
  const levels = tables.levelExp?.levels ?? [];
  const updates = [];
  for (const a of game.actors.filter((x) => x.type === "character")) {
    const stored = Number(a._source.system?.level) || 1;
    if (levelFromExp(a.system.exp, levels) < stored) updates.push({ _id: a.id, "system.exp": expForLevel(stored, levels) });
  }
  if (updates.length) await Actor.updateDocuments(updates);
  await game.settings.set("nssq", "levelExpMigrated", true);
  if (updates.length) ui.notifications.info(game.i18n.format("NSSQ.Level.migrated", { n: updates.length }), { permanent: true });
}

export function registerEffectsSync() {
  game.settings.register("nssq", "effectsSyncedVersion", { scope: "world", config: false, type: String, default: "" });
  game.settings.register("nssq", "levelExpMigrated", { scope: "world", config: false, type: Boolean, default: false });
  Hooks.once("ready", async () => {
    const gm = game.users.activeGM;
    if (!gm || gm.id !== game.user.id) return;
    await migrateLevelExp();
    if (game.settings.get("nssq", "effectsSyncedVersion") !== game.system.version) syncEffects({ quiet: true });
  });
}
