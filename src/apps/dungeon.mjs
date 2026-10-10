/**
 * 랜덤 던전 진행(단계 9-D, data/raw/rules/랜덤-던전.md)
 * - 시작: 던전 레벨·깊이·시작 시각 → 월드 설정 dungeon. 1시간 = 1턴, 6~17시 낮·18~5시 밤(설정 timeOfDay도 맞춘다)
 * - [다음 이벤트](GM): 1시간 경과(임페리얼 오버히트 −1) → 2D6 이벤트표 → 카드의 버튼(전투·채집·트랩·보물)
 * - 깊이만큼 이벤트를 지나면 클리어. 《아리아드네의 실》(효과 escapeDungeon)을 쓰면 긴급 탈출
 * 전투: 그 레벨의 에너미를 컴펜디움에서 무작위로 골라 임시 프리셋 씬(flags.nssq.randomPreset)을 만들고 개시 창을 연다. 전투가 끝나면 그 씬은 지운다
 */
import { isActiveGM } from "../combat/apply.mjs";
import { emit, onSocket } from "../socket.mjs";
import { LAYOUT, enemySlotX } from "../engine/formation.mjs";
import { rareTransform } from "../engine/rare.mjs";
import { DUNGEON_EVENTS, eventFor, timeOfDayAt } from "../engine/dungeon.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Dungeon.${k}`, d) : game.i18n.localize(`NSSQ.Dungeon.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const dungeonState = () => game.settings.get("nssq", "dungeon") ?? {};
const setState = async (s) => {
  // 던전에 들어가거나 나가면 누적 전투 턴을 비운다(07 #165)
  if (!!s.active !== !!dungeonState().active) await (await import("./time-pass.mjs")).resetBattleTurns();
  return game.settings.set("nssq", "dungeon", s);
};
const party = async () => (await import("./gm-screen.mjs")).partyActors();
const note = (html, flags = {}) => ChatMessage.create({ speaker: { alias: L("title") }, content: `<div class="nssq-dungeon">${html}</div>`, flags });

/* ---------------- 시작·진행 ---------------- */

export async function openDungeonDialog() {
  if (!game.user.isGM) return;
  const cur = dungeonState();
  // 진행 중이면: 다음 이벤트 / 던전 나가기 / 새로 시작
  if (cur.active) {
    const pick = await new Promise((resolve) => new Dialog({
      title: L("title"), content: `<p>${esc(L("activeAsk", { name: cur.name, done: cur.done ?? 0, depth: cur.depth ?? 0 }))}</p>`,
      buttons: {
        next: { icon: '<i class="fas fa-forward"></i>', label: L("next"), callback: () => resolve("next") },
        leave: { icon: '<i class="fas fa-door-open"></i>', label: (cur.done ?? 0) === 0 ? L("toTown") : L("leave"), callback: () => resolve("leave") },
        restart: { icon: '<i class="fas fa-redo"></i>', label: L("restart"), callback: () => resolve("restart") }
      },
      default: "next", close: () => resolve(null)
    }).render(true));
    if (pick === "next") return nextEvent();
    if (pick === "leave") return leaveDungeon();
    if (pick !== "restart") return;
  }
  const got = await Dialog.prompt({
    title: L("startTitle"),
    content: `<form>
      <div class="form-group"><label>${esc(L("name"))}</label><input type="text" name="name" value="${esc(L("defaultName"))}"/></div>
      <div class="form-group"><label>${esc(L("level"))}</label><input type="number" name="level" min="1" value="1"/></div>
      <div class="form-group"><label>${esc(L("depth"))}</label><input type="number" name="depth" min="1" value="5"/></div>
      <div class="form-group"><label>${esc(L("hour"))}</label><input type="number" name="hour" min="0" max="23" value="8"/></div>
      <p class="notes">${esc(L("startHint"))}</p></form>`,
    label: L("start"), rejectClose: false,
    callback: (html) => { const f = html[0].querySelector("form"); return { name: f.name.value.trim() || L("defaultName"), level: Math.max(1, Number(f.level.value) || 1), depth: Math.max(1, Number(f.depth.value) || 1), hour: Math.min(23, Math.max(0, Number(f.hour.value) || 0)) }; }
  });
  if (!got) return;
  return startDungeon(got);
}

export async function startDungeon({ name, level, depth, hour }) {
  if (!(await (await import("./party-board.mjs")).checkBeforeEntry())) return null;
  // 새 던전(진행 중인 것을 다시 시작해도): 누적 전투 턴을 비운다(07 #165)
  await (await import("./time-pass.mjs")).resetBattleTurns();
  await setState({ active: true, name, level, depth, done: 0, hour });
  await (await import("./town.mjs")).enteredDungeon();
  await game.settings.set("nssq", "timeOfDay", timeOfDayAt(hour));
  return note(`<h3><i class="fas fa-dungeon"></i> ${esc(L("started", { name, level, depth }))}</h3><p>${esc(L("clock", { h: hour, tod: L(`tod.${timeOfDayAt(hour)}`) }))}</p>${nextButton()}`);
}

const nextButton = () => `<button type="button" data-dungeon="next"><i class="fas fa-forward"></i> ${esc(L("next"))}</button>`;

/** 1턴 진행 → 이벤트 */
export async function nextEvent() {
  const st = dungeonState();
  if (!st.active) return ui.notifications.warn(L("noDungeon"));
  if (st.done >= st.depth) return clear();
  const hour = (st.hour + 1) % 24;
  const done = st.done + 1;
  await setState({ ...st, hour, done });
  const tod = timeOfDayAt(hour);
  if (tod !== game.settings.get("nssq", "timeOfDay")) await game.settings.set("nssq", "timeOfDay", tod);
  // 1턴 = 1시간: 독·자연 회복·심도·오버히트(07 #164)
  await (await import("./time-pass.mjs")).timePasses(1);
  const roll = await new Roll("2d6").evaluate();
  const ev = eventFor(roll.total);
  const members = await party();
  const ctx = { level: st.level, partySize: members.length };
  const rolls = [roll];
  const detail = { ...ev };
  // 보조 굴림
  const d = async (f) => { const r = await new Roll(f).evaluate(); rolls.push(r); return r.total; };
  if (ev.kind === "gather") detail.method = ["felling", "felling", "mining", "mining", "picking", "picking"][(await d("1d6")) - 1];
  if (ev.kind === "trap") detail.trapKind = (await d("1d6")) <= 3 ? "hp" : "tp";
  if (ev.kind === "gold") detail.gold = (await d("1d6")) * st.level * st.level * 100;
  if (ev.kind === "battle") detail.counts = ev.groups === 2 ? [await d("1d3"), await d("1d3")] : ev.groups === 1 && !ev.single ? [(await d("1d3")) + Math.floor(ctx.partySize / 2)] : [1];
  const rank = st.level + (ev.rankPlus ?? 0);
  const last = done >= st.depth;
  const body = `<h3>${esc(L("eventHead", { done, depth: st.depth, h: hour, tod: L(`tod.${tod}`) }))}</h3>
    <p>2D6 = <b>${roll.total}</b>: ${esc(L(`ev.${roll.total}`, { level: st.level, rank }))}</p>${eventBody(detail, st, rank)}
    ${last ? `<p class="notes">${esc(L("lastEvent"))}</p><button type="button" data-dungeon="clear"><i class="fas fa-flag-checkered"></i> ${esc(L("clearButton"))}</button>` : nextButton()}`;
  return ChatMessage.create({ speaker: { alias: L("title") }, content: `<div class="nssq-dungeon">${body}</div>`, rolls, sound: CONFIG.sounds.dice, flags: { nssq: { dungeonEvent: { ...detail, rank, level: st.level } } } });
}

function eventBody(e, st, rank) {
  const b = (action, icon, label) => `<button type="button" data-dungeon="${action}"><i class="fas ${icon}"></i> ${esc(label)}</button>`;
  switch (e.kind) {
    case "battle": return `<p>${esc(L("battleSpec", { level: st.level + (e.levelPlus ?? 0), counts: e.counts.join(" + ") }))}</p>${b("battle", "fa-skull-crossbones", L("battleButton"))}`;
    case "gather": return `<p>${esc(L("gatherSpec", { method: game.i18n.localize(`NSSQ.Loot.m.${e.method}`), rank }))}</p>${b("gather", "fa-leaf", L("gatherButton"))}`;
    case "trap": return `<p>${esc(L(e.trapKind === "hp" ? "trapHp" : "trapTp", { n: e.trapKind === "hp" ? st.level * 3 : st.level * 2 }))}</p>${b("trap", "fa-exclamation-triangle", L("trapButton"))}`;
    case "gold": return `<p>${esc(L("goldSpec", { g: e.gold }))}</p>${b("gold", "fa-coins", L("goldButton"))}`;
    case "item": return b("item", "fa-gem", L("itemButton"));
    case "squirrel": return b("squirrel", "fa-hand-paper", L("squirrelButton"));
    default: return "";
  }
}

async function clear() {
  const st = dungeonState();
  await setState({ ...st, active: false });
  await note(`<h3><i class="fas fa-flag-checkered"></i> ${esc(L("cleared", { name: st.name }))}</h3>`);
  // 클리어하면 마을로(07 #167)
  return (await import("./town.mjs")).returnToTown();
}

/** GM: 던전에서 나온다(클리어하지 않고 그만둠) */
export async function leaveDungeon() {
  if (!game.user.isGM) return;
  const st = dungeonState();
  if (!st.active) return;
  await note(`<h3><i class="fas fa-door-open"></i> ${esc(L("left", { name: st.name ?? "" }))}</h3>`);
  return (await import("./town.mjs")).returnToTown();
}

/** 《아리아드네의 실》: 긴급 탈출(전투 중이면 그 전투도 도주로 끝낸다) */
export async function escapeDungeon(by = "") {
  if (!isActiveGM()) return emit("dungeonEscape", { by });
  const battle = game.combats.find((c) => c.getFlag("nssq", "battle"));
  if (battle) await (await import("./battle.mjs")).endBattle(battle, "escape");
  const st = dungeonState();
  await note(`<h3><i class="fas fa-route"></i> ${esc(L("escaped", { name: st.name ?? "", by }))}</h3>`);
  // 《아리아드네의 실》의 도착지는 마을(07 #167). 필드 지도 진행 중이어도
  return (await import("./town.mjs")).returnToTown();
}

/* ---------------- 이벤트 버튼(GM) ---------------- */

async function act(message, action) {
  const e = message.getFlag("nssq", "dungeonEvent") ?? {};
  const members = await party();
  switch (action) {
    case "next": return nextEvent();
    case "clear": return clear();
    case "gather": return (await import("./loot.mjs")).openGatherDialog({ method: e.method, rank: e.rank, amount: "little" });
    case "trap": return (await import("./explore.mjs")).trap({ level: e.level, kind: e.trapKind, uuids: members.map((a) => a.uuid) });
    case "battle": return randomBattle(e);
    case "gold": {
      const each = Math.floor(e.gold / Math.max(1, members.length));
      const rest = e.gold - each * members.length;
      for (const [i, a] of members.entries()) await a.update({ "system.money": (a.system.money ?? 0) + each + (i === 0 ? rest : 0) });
      return note(esc(L("goldDone", { g: e.gold, names: members.map((a) => a.name).join(", ") })));
    }
    case "item": return treasureItem(e.rank, members);
    case "squirrel": {
      let n = 0;
      for (const a of members) {
        const ids = a.items.filter((i) => i.system.key === "アリアドネの糸" && !i.system.stored).map((i) => i.id);
        n += ids.length;
        if (ids.length) await a.deleteEmbeddedDocuments("Item", ids);
      }
      return note(esc(L("squirrelDone", { n })));
    }
  }
}

/** 보물: 던전 레벨 R의 장비 하나(무기·방어구 중 무작위) → 갈무리 카드 */
async function treasureItem(rank, members) {
  const docs = (await game.packs.get("nssq.equipment")?.getDocuments()) ?? [];
  const list = docs.filter((d) => ["weapon", "armor"].includes(d.type) && d.system.weaponType !== "주먹");
  const pick = list[Math.floor(CONFIG.Dice.randomUniform() * list.length)];
  if (!pick) return null;
  const data = pick.toObject();
  delete data._id;
  data.system.rank = rank;
  const { postLootPool } = await import("./loot.mjs");
  return postLootPool({ title: L("treasureTitle"), entries: [{ name: data.name, rank, qty: 1, data, from: L("treasureTitle") }], party: members });
}

/* ---------------- 무작위 전투 ---------------- */

/** 그 레벨(없으면 가장 가까운 아래, 그것도 없으면 위)의 에너미 문서 */
async function enemiesAt(level, { foe = false } = {}) {
  const docs = ((await game.packs.get("nssq.enemies")?.getDocuments()) ?? []).filter((d) => d.type === "enemy" && !!d.system.isFOE === foe);
  const levels = [...new Set(docs.map((d) => d.system.level))].sort((a, b) => a - b);
  const lv = [...levels].reverse().find((x) => x <= level) ?? levels[0];
  return { level: lv, docs: docs.filter((d) => d.system.level === lv) };
}

async function randomBattle(e) {
  const target = e.level + (e.levelPlus ?? 0);
  const { level, docs } = await enemiesAt(target, { foe: !!e.foe });
  if (!docs.length) return ui.notifications.warn(L("noEnemy"));
  const shuffled = [...docs].sort(() => CONFIG.Dice.randomUniform() - 0.5);
  const kinds = shuffled.slice(0, e.counts.length);
  const { enemyActorFor } = await import("./enemy-library.mjs");
  const actors = [];
  const all = kinds.flatMap((d, i) => Array(e.counts[i] ?? 1).fill(d));
  for (const d of all) {
    let actor = await enemyActorFor(d.uuid);
    // 강적: 희소종(HP ×2, 내성 0→1·1→2)
    if (e.rare) {
      const data = actor.toObject();
      delete data._id;
      const r = rareTransform(data.system, { multiplier: 2 });
      Object.assign(data.system, { isRare: true, hp: r.hp, stats: r.stats, resist: r.resist });
      data.flags = { ...(data.flags ?? {}), nssq: { ...(data.flags?.nssq ?? {}), randomRare: true } };
      actor = await Actor.create(data);
    }
    actors.push(actor);
  }
  if (level !== target) ui.notifications.info(L("levelFallback", { want: target, got: level }));
  return presetBattle(L("randomPresetName", { level, names: kinds.map((d) => d.name).join("·") }), actors);
}

/**
 * 액터들로 임시 프리셋 씬(전투가 끝나면 지운다)을 만들고 개시 창.
 * actors: Actor 또는 { actor, row: "front"|"back" }(열마다 가운데 정렬)
 * flags: 프리셋에 더할 nssq 플래그(필드 지도 F.O.E. 등), stage: { bg, bgm }(배경 그림·"재생목록id.곡id", 07 #166)
 */
export async function presetBattle(name, actors, flags = {}, stage = {}) {
  const list = actors.map((x) => (x?.actor ? { actor: x.actor, row: x.row === "back" ? "back" : "front" } : { actor: x, row: "front" }));
  const tokens = [];
  for (const row of ["front", "back"]) {
    const here = list.filter((x) => x.row === row);
    for (const [i, x] of here.entries()) {
      const y = (row === "back" ? LAYOUT.lanes.enemyBack : LAYOUT.lanes.enemyFront) - LAYOUT.grid / 2;
      const td = await x.actor.getTokenDocument({ x: enemySlotX(i, here.length) - LAYOUT.grid / 2, y, actorLink: false });
      tokens.push(td.toObject());
    }
  }
  const b = await import("./battle.mjs");
  const scene = await b.createPresetScene(name, { randomPreset: true, ...flags }, stage);
  await scene.createEmbeddedDocuments("Token", tokens);
  return b.openStartDialog(scene.id);
}

export function registerDungeon() {
  game.settings.register("nssq", "dungeon", { scope: "world", config: false, type: Object, default: {} });
  onSocket("dungeonEscape", ({ by }) => { if (isActiveGM()) escapeDungeon(by); });
  Hooks.on("renderChatMessage", (message, html) => {
    html[0].querySelectorAll(".nssq-dungeon [data-dungeon]").forEach((b) => {
      if (!game.user.isGM) return b.remove();
      b.addEventListener("click", () => { b.disabled = true; act(message, b.dataset.dungeon); });
    });
  });
}

export { DUNGEON_EVENTS };
