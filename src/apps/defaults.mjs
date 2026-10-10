/**
 * 기본 제공 마을·던전(data/defaults/world.json). 처음 켠 월드에 한 번 넣고, GM 스크린 「준비」에서 다시 넣을 수 있다.
 * - 마을 1(시설 7: 길드·상점·여관·시약원·주점·관청·미궁 입구), 필드 지도 2, 전투 구성 10
 * - 그림 경로는 테스트 서버의 파일이다. 이 서버에 없는 그림은 비워 넣는다(그라데이션으로 보인다)
 * - id가 고정이라 다시 넣으면 기본 것만 원래대로 돌아가고, GM이 만든 마을·지도는 그대로다
 */
const L = (k, d) => (d ? game.i18n.format(`NSSQ.Defaults.${k}`, d) : game.i18n.localize(`NSSQ.Defaults.${k}`));

async function exists(path, cache) {
  if (!path) return false;
  if (!cache.has(path)) cache.set(path, fetch(encodeURI(path), { method: "HEAD" }).then((r) => r.ok).catch(() => false));
  return cache.get(path);
}

/** 그림 경로 중 이 서버에 없는 것을 비운다 */
async function dropMissing(obj, keys, cache) {
  for (const k of keys) if (obj[k] && !(await exists(obj[k], cache))) obj[k] = "";
}

/**
 * @param {{force?: boolean}} opts force면 기본 마을·지도·구성을 원래대로 덮어쓴다
 * @returns {Promise<{towns:number, maps:number, encounters:number}>}
 */
export async function seedDefaults({ force = false } = {}) {
  if (!game.user.isGM) return null;
  const data = await (await fetch(`systems/${game.system.id}/data/defaults/world.json`)).json();
  const cache = new Map();
  const index = (await game.packs.get("nssq.enemies")?.getIndex({ fields: ["img"] })) ?? [];
  const n = { towns: 0, maps: 0, encounters: 0 };

  const towns = { ...(game.settings.get("nssq", "towns") ?? {}) };
  for (const t of data.towns ?? []) {
    if (towns[t.id] && !force) continue;
    await dropMissing(t, ["img"], cache);
    for (const f of t.facilities ?? []) await dropMissing(f, ["img", "npc"], cache);
    towns[t.id] = t; n.towns++;
  }
  const maps = { ...(game.settings.get("nssq", "fieldMaps") ?? {}) };
  for (const m of data.maps ?? []) {
    if (maps[m.id] && !force) continue;
    await dropMissing(m, ["battleBg"], cache);
    for (const a of m.areas ?? []) await dropMissing(a, ["img"], cache);
    maps[m.id] = m; n.maps++;
  }
  const encs = { ...(game.settings.get("nssq", "encounters") ?? {}) };
  for (const e of data.encounters ?? []) {
    if (encs[e.id] && !force) continue;
    for (const x of e.enemies ?? []) {
      const hit = index.find((i) => i.uuid === x.uuid || `Compendium.nssq.enemies.Actor.${i._id}` === x.uuid);
      if (hit) { x.name = hit.name; x.img = hit.img ?? ""; }
    }
    encs[e.id] = e; n.encounters++;
  }
  if (n.towns) await game.settings.set("nssq", "towns", towns);
  if (n.maps) await game.settings.set("nssq", "fieldMaps", maps);
  if (n.encounters) await game.settings.set("nssq", "encounters", encs);
  return n;
}

/** GM 스크린 버튼: 확인 후 기본 마을·던전을 원래대로 */
export async function reseedDefaults() {
  const ok = await Dialog.confirm({ title: L("title"), content: `<p>${L("ask")}</p>`, rejectClose: false });
  if (!ok) return null;
  const n = await seedDefaults({ force: true });
  if (n) ui.notifications.info(L("done", n));
  return n;
}

export function registerDefaults() {
  game.settings.register("nssq", "defaultsSeeded", { scope: "world", config: false, type: Number, default: 0 });
  // 처음 켠 월드(활성 GM 한 명)에 한 번
  Hooks.once("ready", async () => {
    if (game.users.activeGM?.id !== game.user.id) return;
    if (game.settings.get("nssq", "defaultsSeeded") >= 1) return;
    try {
      const n = await seedDefaults();
      await game.settings.set("nssq", "defaultsSeeded", 1);
      if (n && (n.towns || n.maps)) ui.notifications.info(L("seeded", n));
    } catch (err) { console.error("NSSQ | defaults", err); }
  });
}
