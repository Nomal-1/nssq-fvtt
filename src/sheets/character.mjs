/**
 * 캐릭터 시트 「능력치」 탭: 능력치 카드(내역·편집), 부능력치, 내성, 장비 요약, 작성 기록(GM).
 * - 「굴림」: 작성 잠금 전에는 소유자, 잠근 뒤에는 GM만
 * - 「성장」「일시」: 소유자
 * - 「GM 보너스」: GM만(플레이어에게는 값이 보인다)
 */
import { ABILITIES, RESISTS, SUB_STATS } from "../engine/derive.mjs";
import { initialMoney } from "../engine/chargen.mjs";
import { refinementBadges } from "./badges.mjs";
import { slotOccupant } from "../engine/equipment.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.Sheet.${k}`, d) : game.i18n.localize(`NSSQ.Sheet.${k}`));
const SHORT = { str: "STR", tec: "TEC", vit: "VIT", agi: "AGI", luc: "LUC" };
const SOURCE_KEYS = ["base", "class", "growth", "bonus", "equip", "temp"];
const sign = (n) => (n > 0 ? `+${n}` : `${n}`);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** 기록 한 줄 추가(최근 30개 유지) */
export async function logCreation(actor, entry) {
  const log = [...(actor.system.creation?.log ?? []), { ...entry, at: Date.now(), user: game.user.name }].slice(-30);
  await actor.update({ "system.creation.log": log });
}

export function canEditBase(actor) {
  return game.user.isGM || (actor.isOwner && !actor.system.creation?.locked);
}

export function characterContext(actor) {
  const s = actor.system;
  const label = (k) => game.i18n.localize(`NSSQ.Ability.source.${k}`);
  const abilityCards = ABILITIES.map((k) => {
    const p = s.abilityParts[k];
    const lines = SOURCE_KEYS.filter((src) => src === "base" || p[src]).map((src) => `${label(src)} ${src === "base" ? p[src] : sign(p[src])}`);
    return {
      key: k, short: SHORT[k], total: p.total, b: s.bonus[k],
      boosted: p.equip + p.temp + p.bonus !== 0,
      tooltip: `${lines.join(" · ")}\n${L("abilityClickHint")}`
    };
  });
  const subStats = SUB_STATS.map((k) => ({ key: k, label: game.i18n.localize(`NSSQ.Inventory.${k}`), value: s.sub[k], full: game.i18n.localize(`NSSQ.Sub.${k}`) }));
  const resist = RESISTS.map((k) => ({ key: k, label: game.i18n.localize(`NSSQ.Resist.${k}`), base: s.resist[k], total: s.resistTotal[k], changed: s.resistTotal[k] !== s.resist[k] }));
  const items = actor.items.contents;
  const equip = ["weapon", "armor", "other"].map((slot) => {
    const it = slotOccupant(items, slot);
    return {
      slot, label: game.i18n.localize(`NSSQ.Slot.${slot}`), icon: { weapon: "fa-khanda", armor: "fa-tshirt", other: "fa-gem" }[slot],
      item: it ? { id: it.id, name: it.name, rank: ["weapon", "armor"].includes(it.type) && it.system.rank ? `R${it.system.rank}` : "", refine: refinementBadges(it) } : null
    };
  });
  const w = s.equipment?.weapon;
  const weaponLine = w?.unarmed ? game.i18n.format("NSSQ.Inventory.unarmed", { type: w.weaponType, atk: w.physAtk }) : "";

  // 작성 기록(GM)
  const log = [...(s.creation?.log ?? [])].reverse();
  const rolls = log.filter((e) => e.type === "roll");
  const lastAssign = log.find((e) => e.type === "assign");
  const creation = {
    locked: !!s.creation?.locked,
    rollCount: rolls.length,
    totals: s.abilityRolls?.length ? s.abilityRolls : null,
    sum: s.abilityRolls?.reduce((a, b) => a + b, 0) ?? 0,
    money: s.abilityRolls?.length ? initialMoney(s.abilityRolls) : null,
    assign: lastAssign ? ABILITIES.map((k) => `${SHORT[k]} ${lastAssign.abilities?.[k] ?? "-"}`).join(" · ") : "",
    entries: log.slice(0, 12).map((e) => ({
      when: new Date(e.at).toLocaleString(),
      user: e.user,
      text: e.type === "roll" ? L("logRoll", { totals: (e.totals ?? []).join(", ") })
        : e.type === "assign" ? L("logAssign", { values: ABILITIES.map((k) => `${SHORT[k]} ${e.abilities?.[k]}`).join(" ") })
          : e.type === "edit" ? L("logEdit", { ability: SHORT[e.ability] ?? e.ability, field: label(e.field), from: e.from, to: e.to })
            : e.type === "lock" ? L(e.locked ? "logLocked" : "logUnlocked") : esc(e.text ?? "")
    }))
  };
  return { abilityCards, subStats, resist, equip, weaponLine, creation, canRollAbilities: game.user.isGM || !s.creation?.locked };
}

/** 능력치 내역 편집 창 */
export async function editAbility(actor, key) {
  const s = actor.system;
  const p = s.abilityParts[key];
  const label = (k) => game.i18n.localize(`NSSQ.Ability.source.${k}`);
  const baseOk = canEditBase(actor);
  const gm = game.user.isGM;
  const row = (src, editable, hint = "") => `
    <div class="form-group">
      <label>${label(src)}${hint ? ` <span class="notes">${hint}</span>` : ""}</label>
      ${editable ? `<input type="number" name="${src}" value="${s.abilities[key][src] ?? 0}"/>` : `<span class="nq-ro">${src === "base" ? p[src] : sign(p[src])}</span>`}
    </div>`;
  const content = `
    <form class="nssq-ability-edit">
      <p class="nq-big">${game.i18n.localize(`NSSQ.Ability.${key}`)} <b>${p.total}</b> <span class="notes">B ${s.bonus[key]}</span></p>
      ${row("base", baseOk, baseOk ? "" : L("lockedHint"))}
      ${row("class", false, L("classHint"))}
      ${row("growth", actor.isOwner)}
      ${row("bonus", gm, gm ? L("bonusHintGM") : L("bonusHint"))}
      ${row("equip", false, L("equipHint"))}
      ${row("temp", actor.isOwner)}
    </form>`;
  const values = await Dialog.prompt({
    title: `${actor.name} — ${game.i18n.localize(`NSSQ.Ability.${key}`)}`,
    content,
    label: L("save"),
    rejectClose: false,
    options: { classes: ["nssq", "dialog"], width: 340 },
    callback: (html) => Object.fromEntries([...html[0].querySelectorAll("input[name]")].map((i) => [i.name, Number(i.value) || 0]))
  });
  if (!values) return;
  const update = {};
  const changes = [];
  for (const [field, v] of Object.entries(values)) {
    const from = s.abilities[key][field] ?? 0;
    if (from === v) continue;
    update[`system.abilities.${key}.${field}`] = v;
    changes.push({ type: "edit", ability: key, field, from, to: v });
  }
  if (!changes.length) return;
  await actor.update(update);
  // 굴림·보너스 변경은 작성 기록에 남긴다
  for (const c of changes.filter((c) => c.field === "base" || c.field === "bonus")) await logCreation(actor, c);
}

/** GM: 작성 잠금·해제 */
export async function toggleCreationLock(actor) {
  if (!game.user.isGM) return;
  const locked = !actor.system.creation?.locked;
  await actor.update({ "system.creation.locked": locked });
  await logCreation(actor, { type: "lock", locked });
}
