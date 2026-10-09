import { ABILITIES, RESISTS, SUB_STATS } from "../engine/derive.mjs";
import { unidentifiedResist } from "../engine/combat.mjs";
import { statusListOf } from "../combat/status.mjs";
import { bestiaryEntry, forgetBestiary } from "../combat/bestiary.mjs";
import { promptCheck, rollCheck } from "../chat/check.mjs";
import { rollAbilities } from "../apps/ability-roll.mjs";
import { activateInventoryListeners, inventoryContext } from "./inventory.mjs";
import { acquireItems } from "../apps/acquire.mjs";
import { normalAttack } from "../combat/attack.mjs";
import { makeRare, removeRare } from "../apps/rare.mjs";
import { isPhysical } from "../engine/equipment.mjs";
import { characterContext, editAbilities, showCreationLog, toggleCreationLock } from "./character.mjs";
import { rollGrowth } from "../apps/growth.mjs";
import { openArtConfig } from "../apps/art-config.mjs";
import { SkillTree } from "../apps/skill-tree.mjs";
import tables from "../generated/tables.mjs";

/** GM 편의: 「Lv n으로」 → 경험점을 그 레벨이 되는 값으로 맞춘다(레벨은 경험점으로 정해짐) */
async function setLevelDialog(actor) {
  if (!game.user.isGM) return;
  const levels = tables.levelExp?.levels ?? [];
  const options = levels.map((r) => `<option value="${r.level}" ${r.level === actor.system.level ? "selected" : ""}>Lv ${r.level} (${game.i18n.localize("NSSQ.Exp")} ${r.total})</option>`).join("");
  const level = await Dialog.prompt({
    title: game.i18n.format("NSSQ.Level.setTitle", { name: actor.name }),
    content: `<form><div class="form-group"><label>${game.i18n.localize("NSSQ.Level.label")}</label><select name="level">${options}</select></div><p class="notes">${game.i18n.localize("NSSQ.Level.setNote")}</p></form>`,
    label: game.i18n.localize("NSSQ.Level.apply"),
    callback: (html) => Number(html[0].querySelector("[name=level]").value),
    rejectClose: false
  });
  if (!level) return;
  const total = levels.find((r) => r.level === level)?.total ?? 0;
  await actor.update({ "system.exp": total, "system.level": level });
}

export class NssqActorSheet extends ActorSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["nssq", "nq-window", "sheet", "actor"],
      width: 780,
      height: 780,
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "main" }]
    });
  }

  get template() {
    return `systems/nssq/templates/actor/${this.actor.type}-sheet.hbs`;
  }

  async getData(options) {
    const context = await super.getData(options);
    const system = this.actor.system;
    context.system = system;
    context.abilityKeys = ABILITIES;
    context.subKeys = SUB_STATS;
    context.resistKeys = RESISTS;
    context.rowChoices = { front: "NSSQ.Row.front", back: "NSSQ.Row.back" };
    context.canAttack = this.isEditable && (this.actor.type === "character" || this.actor.type === "enemy");
    context.showNpcToggle = game.user.isGM && this.actor.type === "character";
    context.isGM = game.user.isGM;
    if (this.actor.type === "character") {
      // 레벨은 경험점으로 정해진다: 다음 레벨까지 남은 경험점
      const levels = tables.levelExp?.levels ?? [];
      const next = levels.find((r) => r.level === system.level + 1);
      context.expHint = next
        ? game.i18n.format("NSSQ.Level.toNext", { level: next.level, total: next.total, left: Math.max(0, next.total - (system.exp ?? 0)) })
        : game.i18n.localize("NSSQ.Level.max");
    }
    const pct = (r) => (r?.max > 0 ? Math.clamp(Math.round((r.value / r.max) * 100), 0, 100) : 0);
    context.hpPct = pct(system.hp);
    if (this.actor.type === "enemy") {
      // 상태 이상·강화·약화로 바뀐 값(파란 숫자, 단계 5). 미식별 내성 최소 3은 바뀐 것으로 치지 않는다
      const base = system.identified ? system.resist : unidentifiedResist(system.resist);
      context.effStats = Object.fromEntries(SUB_STATS.map((k) => [k, { value: system.combatStats?.[k], changed: system.combatStats?.[k] !== system.stats[k] }]));
      context.effResist = Object.fromEntries(RESISTS.map((k) => [k, { value: system.resistTotal?.[k], changed: system.resistTotal?.[k] !== base[k] }]));
      context.effHpMax = system.hp.max !== system.hpMaxBase ? system.hp.max : null;
      context.statusList = statusListOf(this.actor);
      // 도감 기록 요약(GM)
      const book = bestiaryEntry(this.actor);
      context.bestiary = Object.keys(book).length ? game.i18n.format("NSSQ.Analysis.bookLine", {
        identified: book.identified ? "O" : "X", defeated: book.defeated ?? 0,
        skills: (book.skills ?? []).join(", ") || "-", drops: (book.drops ?? []).join(", ") || "-"
      }) : "";
    }
    if (this.actor.type === "enemy") {
      const el = (e) => (e === "none" ? game.i18n.localize("NSSQ.Combat.noElement") : game.i18n.localize(`NSSQ.Resist.${e}`));
      context.attackElementText = (system.attackElements ?? []).map(el).join("·") || "-";
      context.drops = (system.drops ?? []).map((d) => ({
        range: d.max === null ? `${d.min}~` : d.min === d.max ? `${d.min}` : `${d.min}~${d.max}`,
        item: `${d.rank ? `R${d.rank} ` : ""}${d.item}`
      }));
    }
    if (this.actor.type === "character") {
      context.abilityRows = ABILITIES.map((k) => ({
        key: k, ...system.abilityParts[k], bonus: system.bonus[k]
      }));
      const { main, sub, all } = system.classItems;
      context.classes = { main, sub };
      context.mainClassChoices = Object.fromEntries(all.map((c) => [c.system.key, c.name]));
      context.subClassChoices = { "": game.i18n.localize("NSSQ.Class.none"), ...Object.fromEntries(all.filter((c) => c !== main).map((c) => [c.system.key, c.name])) };
      context.mainClassKey = main?.system.key ?? "";
      context.subClassKey = sub?.system.key ?? "";
      // 선택 상자가 이름을 자르지 않도록 이름 길이에 맞춘 너비(em)
      const emWidth = (name) => Math.max(5, [...(name ?? "")].reduce((w, ch) => w + (/[ㄱ-힝]/.test(ch) ? 1.05 : 0.6), 0) + 3).toFixed(1);
      context.mainClassWidth = emWidth(main?.name);
      context.subClassWidth = emWidth(sub?.name ?? game.i18n.localize("NSSQ.Class.none"));
      context.inventory = inventoryContext(this.actor, { skillFilter: this._skillFilter ?? "all" });
      context.isGM = game.user.isGM;
    if (this.actor.type === "character") {
      // 레벨은 경험점으로 정해진다: 다음 레벨까지 남은 경험점
      const levels = tables.levelExp?.levels ?? [];
      const next = levels.find((r) => r.level === system.level + 1);
      context.expHint = next
        ? game.i18n.format("NSSQ.Level.toNext", { level: next.level, total: next.total, left: Math.max(0, next.total - (system.exp ?? 0)) })
        : game.i18n.localize("NSSQ.Level.max");
    }
      context.sheet = characterContext(this.actor);
      context.tpPct = pct(system.tp);
      context.resistRows = RESISTS.map((k) => ({ key: k, base: system.resist[k], total: system.resistTotal[k], changed: system.resistTotal[k] !== system.resist[k] }));
    }
    context.items = this.actor.items.contents.sort((a, b) => (a.sort || 0) - (b.sort || 0));
    context.enrichedDescription = await TextEditor.enrichHTML(system.description ?? "", {
      async: true,
      secrets: this.actor.isOwner,
      relativeTo: this.actor
    });
    return context;
  }

  /** 클래스 아이템: 캐릭터당 2개(메인·서브)까지, 같은 클래스 중복 불가. 처음 놓은 것이 메인 */
  async _onDropItemCreate(itemData, event) {
    const list = Array.isArray(itemData) ? itemData : [itemData];
    if (this.actor.type !== "character") return super._onDropItemCreate(list, event);
    const classes = this.actor.items.filter((i) => i.type === "class");
    const keys = new Set(classes.map((c) => c.system.key));
    const accepted = [];
    let classCount = classes.length;
    for (const d of list) {
      if (d.type === "class") {
        if (keys.has(d.system?.key)) { ui.notifications.warn(game.i18n.format("NSSQ.Class.duplicate", { name: d.name })); continue; }
        if (classCount >= 2) { ui.notifications.warn(game.i18n.localize("NSSQ.Class.tooMany")); continue; }
        keys.add(d.system?.key);
        classCount++;
      }
      accepted.push(d);
    }
    // 물건은 소지 수를 확인하며 받는다(넘치면 두고 갈 것·버릴 것 고르기, 창고로는 보낼 수 없음)
    const goods = accepted.filter(isPhysical);
    const others = accepted.filter((d) => !isPhysical(d));
    const created = others.length ? await super._onDropItemCreate(others, event) : [];
    if (goods.length) created.push(...(await acquireItems(this.actor, goods, { source: "gift" })).taken);
    const update = {};
    for (const c of created.filter((i) => i.type === "class")) {
      if (!this.actor.system.mainClass && !update["system.mainClass"]) update["system.mainClass"] = c.system.key;
      else if (!this.actor.system.subClass && !update["system.subClass"]) update["system.subClass"] = c.system.key;
    }
    if (Object.keys(update).length) await this.actor.update(update);
    return created;
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.on("click", "[data-action=set-level]", (ev) => {
      ev.preventDefault();
      setLevelDialog(this.actor);
    });
    html.on("click", "[data-action=item-edit]", (ev) => {
      const id = ev.currentTarget.closest("[data-item-id]")?.dataset.itemId;
      this.actor.items.get(id)?.sheet.render(true);
    });
    // 스킬 탭: 전체/전투/비전투 분류(보는 사람마다), 스킬 트리(보기는 누구나, 습득은 소유자)
    html.on("click", "[data-action=skill-filter]", (ev) => {
      ev.preventDefault();
      this._skillFilter = ev.currentTarget.dataset.filter;
      this.render(false);
    });
    html.on("click", "[data-action=skill-tree]", (ev) => {
      ev.preventDefault();
      SkillTree.open(this.actor);
    });
    if (!this.isEditable) return;
    // 선택형 스킬·『추격』 강화: 조건이 맞으면 자동 사용(단계 8)
    html.on("click", "[data-action=auto-trigger]", async (ev) => {
      ev.preventDefault();
      const key = ev.currentTarget.dataset.key;
      const cur = this.actor.getFlag("nssq", "autoTrigger") ?? {};
      await this.actor.update({ [`flags.nssq.autoTrigger.${key}`]: !cur[key] });
    });
    if (this.actor.type === "character") activateInventoryListeners(this, html);
    // 통상 공격: 지정(타깃)한 토큰 1개. GM은 Shift로 사거리·아군 확인 무시
    html.on("click", "[data-action=rare-on]", () => makeRare(this.actor));
    html.on("click", "[data-action=enemy-maker]", async () => (await import("../apps/custom-maker.mjs")).openEnemyMaker({ actor: this.actor }));
    // 에너미 스킬: 식별 시 공개 켜고 끄기(GM)
    html.on("click", "[data-action=skill-reveal]", (ev) => {
      const item = this.actor.items.get(ev.currentTarget.closest("[data-item-id]")?.dataset.itemId);
      if (item && game.user.isGM) item.update({ "system.reveal": !item.system.reveal });
    });
    html.on("click", "[data-action=bestiary-forget]", async () => {
      const ok = await Dialog.confirm({ title: game.i18n.localize("NSSQ.Analysis.forget"), content: `<p>${game.i18n.format("NSSQ.Analysis.forgetConfirm", { name: this.actor.name })}</p>`, rejectClose: false });
      if (ok) await forgetBestiary(this.actor);
      this.render();
    });
    html.on("click", "[data-action=rare-off]", () => removeRare(this.actor));
    html.on("click", "[data-action=normal-attack]", (ev) => {
      ev.preventDefault();
      normalAttack(this.actor, { ignoreRange: ev.shiftKey && game.user.isGM });
    });
    html.on("click", "[data-action=edit-abilities]", (ev) => {
      ev.preventDefault();
      editAbilities(this.actor);
    });
    html.on("click", "[data-action=edit-art]", (ev) => {
      ev.preventDefault();
      openArtConfig(this.actor);
    });
    html.on("click", "[data-action=roll-growth]", (ev) => {
      ev.preventDefault();
      rollGrowth(this.actor);
    });
    html.on("click", "[data-action=show-log]", (ev) => {
      ev.preventDefault();
      showCreationLog(this.actor);
    });
    html.on("click", "[data-action=toggle-lock]", (ev) => {
      ev.preventDefault();
      toggleCreationLock(this.actor);
    });
    html.on("click", "[data-action=roll-abilities]", (ev) => {
      ev.preventDefault();
      rollAbilities(this.actor);
    });
    // 능력치 판정: 클릭하면 대화창, Shift+클릭하면 바로 굴린다
    html.on("click", "[data-action=roll-ability]", async (ev) => {
      ev.preventDefault();
      const ability = ev.currentTarget.dataset.ability;
      const opts = ev.shiftKey ? { ability } : await promptCheck(this.actor, { ability });
      if (opts) await rollCheck(this.actor, opts);
    });
    html.on("click", "[data-action=item-delete]", (ev) => {
      const id = ev.currentTarget.closest("[data-item-id]")?.dataset.itemId;
      this.actor.items.get(id)?.deleteDialog();
    });
  }
}
