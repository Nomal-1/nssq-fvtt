/**
 * 필드 지도 창의 [편집] 부분(에어리어·통로·F.O.E.·트리거·조우표 편집, 저장). apps/fieldmap.mjs의 FieldMapApp에 메서드로 붙인다
 */
import * as FM from "../engine/fieldmap.mjs";
import { GATHER_AMOUNT } from "../engine/loot.mjs";
import { ABILITIES } from "../engine/derive.mjs";
import { CHECK_KINDS } from "../chat/check-mods.mjs";
import { esc } from "../util.mjs";
import { L, opt, rid, allMaps, areaName, areaOf, areaImg, sceneImage, encBgmOptions, passageLabel, saveMap } from "./fieldmap-common.mjs";

const ACTIONS = {
  message: [["text", "textarea"]],
  battle: [["enemies", "enemies"]],
  gather: [["method", "select", ["felling", "mining", "picking"]], ["amount", "select", Object.keys(GATHER_AMOUNT)], ["rank", "num"]],
  trap: [["kind", "select", ["hp", "tp"]], ["level", "num"]],
  camp: [],
  check: [["ability", "ability"], ["checkKind", "checkKind"], ["target", "num"], ["note", "text"]],
  reveal: [["area", "area"], ["passage", "passage"]],
  passage: [["passage", "passage"], ["state", "select", FM.PASSAGE_STATES]],
  foeRemove: [["foe", "foe"]],
  move: [["area", "area"]],
  mapGo: [["map", "map"], ["toArea", "mapArea"]],
  choice: [["text", "textarea"], ["options", "options"]]
};

/** FieldMapApp.prototype에 붙일 편집 메서드 */
export const editorMethods = {
  editPanel(map) {
    const issues = this.issues ? [...this.issues.errors.map((e) => `<li class="err">${esc(L(`v.${e.code}`, { name: e.name ?? "" }))}</li>`), ...this.issues.warnings.map((e) => `<li>${esc(L(`v.${e.code}`, { name: e.name ?? "" }))}</li>`)].join("") || `<li>${esc(L("v.ok"))}</li>` : "";
    const check = `<button type="button" data-fm-act="validate"><i class="fas fa-check-double"></i> ${esc(L("validate"))}</button>${issues ? `<ul class="fm-issues">${issues}</ul>` : ""}`;
    if (this.sel?.kind === "area") {
      const i = map.areas.findIndex((a) => a.id === this.sel.id);
      const a = map.areas[i];
      if (a) {
        const p = `areas.${i}`;
        return `<h3>${esc(L("areaHead"))} <a data-fm-act="deselect" title="${esc(L("close"))}"><i class="fas fa-times"></i></a></h3>
          ${this.field(`${p}.name`, a.name, L("f.name"))}
          <div class="form-group"><label>${esc(L("f.scene"))}</label><select data-path="${p}.sceneId" data-struct>${opt("", a.sceneId, L("noScene"))}${game.scenes.contents.filter((x) => !x.getFlag("nssq", "randomPreset")).map((x) => opt(x.id, a.sceneId, x.name)).join("")}</select><button type="button" data-fm-act="makeScene" class="fm-icon" title="${esc(L("makeSceneHint"))}"><i class="fas fa-plus"></i></button></div>
          <div class="form-group"><label>${esc(L("f.img"))}</label><input type="text" data-path="${p}.img" data-struct value="${esc(a.img ?? "")}" placeholder="${esc(L("f.imgHint"))}"/><button type="button" data-fm-act="pickImg" class="fm-icon"><i class="fas fa-file-import"></i></button></div>
          ${areaImg(a) ? `<div class="fm-edit-img" style="background-image:url('${esc(areaImg(a))}')"></div>` : ""}
          ${this.field(`${p}.terrain`, a.terrain, L("f.terrain"), "text", L("f.terrainHint"))}
          ${this.field(`${p}.gmNote`, a.gmNote, L("f.gmNote"), "textarea")}
          ${this.field(`${p}.narration`, a.narration, L("f.narration"), "textarea", L("f.narrationHint"))}
          ${this.field(`${p}.narrationAgain`, a.narrationAgain, L("f.narrationAgain"), "textarea", L("f.narrationAgainHint"))}
          ${this.field(`${p}.gather`, a.gather, L("f.gather"), "text", game.i18n.localize("NSSQ.Loot.tablePlaceholder"))}
          <div class="form-group"><label>${esc(L("f.exitMap"))}</label><select data-path="${p}.exits.0.map" data-struct>${opt("", a.exits?.[0]?.map ?? "", L("none"))}${Object.values(allMaps()).filter((x) => x.id !== map.id).map((x) => opt(x.id, a.exits?.[0]?.map ?? "", x.name)).join("")}</select></div>
          ${a.exits?.[0]?.map ? `<div class="form-group"><label>${esc(L("f.exitArea"))}</label><select data-path="${p}.exits.0.area">${opt("", a.exits[0].area ?? "", L("af.mapStart"))}${(allMaps()[a.exits[0].map]?.areas ?? []).map((x) => opt(x.id, a.exits[0].area ?? "", x.name)).join("")}</select></div>` : ""}
          <p class="notes">${esc(L("f.exitHint"))}</p>
          <div class="form-group fm-acts"><label>${esc(L("f.acts"))}</label><span>${Object.entries(FM.areaActs(a)).map(([k, on]) => `<label class="fm-act"><input type="checkbox" data-path="${p}.acts.${k}" data-type="bool" ${on ? "checked" : ""}/> ${esc(game.i18n.localize(`NSSQ.FieldScene.act.${k}`))}</label>`).join("")}</span></div>
          <p class="notes">${esc(L("f.actsHint"))}</p>
          ${this.field(`${p}.tags`, a.tags, L("f.tags"), "text", L("f.tagsHint"))}
          <div class="form-group"><label>${esc(L("f.areaBattleBg"))}</label><input type="text" data-path="${p}.battleBg" value="${esc(a.battleBg ?? "")}" placeholder="${esc(L("f.mapDefault"))}"/></div>
          ${this.encounterTableEdit(a, p)}
          <div class="form-group"><label>${esc(L("f.light"))}</label><select data-path="${p}.light">${["", "dark", "bright"].map((v) => opt(v, a.light ?? "", L(`f.light_${v || "auto"}`))).join("")}</select></div>
          <p class="notes">${esc(L("f.lightHint"))}</p>
          ${this.field(`${p}.secret`, a.secret, L("f.secret"), "bool")}
          <p>${map.start === a.id ? `<b><i class="fas fa-flag"></i> ${esc(L("isStart"))}</b>` : `<button type="button" data-fm-act="setStart">${esc(L("setStart"))}</button>`}</p>
          ${this.triggersHtml(`${p}.triggers`, a.triggers ?? [], FM.AREA_TRIGGERS, map)}
          <p><button type="button" data-fm-act="delArea" class="fm-danger"><i class="fas fa-trash"></i> ${esc(L("delArea"))}</button></p>`;
      }
    }
    if (this.sel?.kind === "passage") {
      const i = map.passages.findIndex((x) => x.id === this.sel.id);
      const pa = map.passages[i];
      if (pa) {
        const p = `passages.${i}`;
        return `<h3>${esc(L("passageHead"))} <a data-fm-act="deselect"><i class="fas fa-times"></i></a></h3><p>${esc(passageLabel(map, pa))}</p>
          <div class="form-group"><label>${esc(L("f.state"))}</label><select data-path="${p}.state">${FM.PASSAGE_STATES.map((x) => opt(x, pa.state, L(`ps.${x}`))).join("")}</select></div>
          <div class="form-group"><label>${esc(L("f.direction"))}</label><select data-fm-dir>
            ${opt("both", pa.oneWay ? "" : "both", `${areaName(map, pa.a)} ↔ ${areaName(map, pa.b)}`)}
            ${opt("ab", pa.oneWay ? "ab" : "", `${areaName(map, pa.a)} → ${areaName(map, pa.b)}`)}
            ${opt("ba", "", `${areaName(map, pa.b)} → ${areaName(map, pa.a)}`)}</select></div>
          ${this.field(`${p}.hideBlocked`, pa.hideBlocked, L("f.hideBlocked"), "bool")}
          <p class="notes">${esc(L("f.hideBlockedHint"))}</p>
          ${this.field(`${p}.label`, pa.label, L("f.label"))}
          <p class="notes">${esc(L("passageHint"))}</p>
          <p><button type="button" data-fm-act="delPassage" class="fm-danger"><i class="fas fa-trash"></i> ${esc(L("delPassage"))}</button></p>`;
      }
    }
    const foes = map.foes.map((f, i) => `<fieldset class="fm-foe-edit"><legend>${esc(f.name || "F.O.E.")} <a data-fm-del="foes.${i}"><i class="fas fa-trash"></i></a></legend>
      ${this.field(`foes.${i}.actorLabel`, f.actorLabel, L("f.actor"), "enemy")}
      ${this.field(`foes.${i}.name`, f.name, L("f.name"))}
      <div class="form-group"><label>${esc(L("f.mode"))}</label><select data-path="foes.${i}.mode" data-struct>${FM.FOE_MODES.map((m) => opt(m, f.mode, L(`mode.${m}`))).join("")}</select></div>
      ${f.mode === "chase" ? this.field(`foes.${i}.range`, f.range ?? 1, L("f.range"), "num") : ""}
      ${this.field(`foes.${i}.every`, f.every ?? 1, L("f.every"), "num")}
      ${this.field(`foes.${i}.nightOnly`, f.nightOnly, L("f.nightOnly"), "bool")}
      <div class="form-group"><label>${esc(L("f.foeBg"))}</label><input type="text" data-path="foes.${i}.bg" value="${esc(f.bg ?? "")}" placeholder="${esc(L("f.mapDefault"))}"/><button type="button" data-fm-act="pickFoeBg" data-id="${i}" class="fm-icon"><i class="fas fa-file-import"></i></button></div>
      <div class="form-group"><label>${esc(L("f.foeBgm"))}</label><select data-path="foes.${i}.bgm">${encBgmOptions(f.bgm ?? "", L("f.mapDefault"))}</select></div>
      <p class="notes">${esc(L("f.route"))}: ${esc((f.route ?? []).map((id) => areaName(map, id)).join(" → ") || L("none"))}</p>
      <p><button type="button" data-fm-act="route" data-id="${f.id}">${esc(L(this.routeFoe === f.id ? "routeStop" : "routeSet"))}</button><button type="button" data-fm-act="routeClear" data-id="${f.id}">${esc(L("routeClear"))}</button></p></fieldset>`).join("");
    return `<h3>${esc(L("mapHead"))}</h3>
      ${this.field("name", map.name, L("f.mapName"), "textarea")}
      ${this.field("startHour", map.startHour ?? 8, L("startHour"), "num")}
      ${this.field("activateScene", map.activateScene, L("f.activateScene"), "bool")}
      ${this.field("hidden", map.hidden, L("f.hidden"), "bool")}
      <div class="form-group"><label>${esc(L("f.bg"))}</label><select data-path="bg.style">${opt("parchment", map.bg?.style, L("bg.parchment"))}${opt("image", map.bg?.style, L("bg.image"))}</select></div>
      ${map.bg?.style === "image" ? `<div class="form-group"><input type="text" data-path="bg.src" value="${esc(map.bg.src)}"/><button type="button" data-fm-act="pickBg"><i class="fas fa-file-import"></i></button></div>` : ""}
      <h3>${esc(L("battleStage"))}</h3>
      <div class="form-group"><label>${esc(L("f.battleBg"))}</label><input type="text" data-path="battleBg" value="${esc(map.battleBg ?? "")}"/><button type="button" data-fm-act="pickBattleBg" class="fm-icon"><i class="fas fa-file-import"></i></button></div>
      <div class="form-group"><label>${esc(L("f.battleBgm"))}</label><select data-path="battleBgm">${encBgmOptions(map.battleBgm ?? "", L("f.noBgm"))}</select></div>
      <p class="notes">${esc(L("battleStageHint"))}</p>
      <div class="form-group"><label>${esc(L("f.fieldBgm"))}</label><select data-path="fieldBgm">${encBgmOptions(map.fieldBgm ?? "", L("f.noBgm"))}</select></div>
      <p class="notes">${esc(L("f.fieldBgmHint"))}</p>
      <p class="notes">${esc(L("editHint"))}</p>${check}
      <h3>F.O.E. <a data-fm-add="foes" data-kind="foe"><i class="fas fa-plus"></i></a></h3>${foes}
      <datalist id="fm-enemies">${this.enemyChoices().map((x) => `<option value="${esc(x.label)}"></option>`).join("")}</datalist>
      ${this.triggersHtml("triggers", map.triggers ?? [], FM.MAP_TRIGGERS, map)}
      <p><button type="button" data-fm-act="dupMap"><i class="fas fa-copy"></i> ${esc(L("dupMap"))}</button><button type="button" data-fm-act="delMap" class="fm-danger"><i class="fas fa-trash"></i> ${esc(L("delMap"))}</button></p>`;
  },

  /** 편집: 에어리어 조우표(전투 구성 + 가중치) */
  encounterTableEdit(a, p) {
    const encs = Object.values(game.settings.get("nssq", "encounters") ?? {}).sort((x, y) => x.name.localeCompare(y.name, "ko"));
    // 확률(가중치 비율)을 옆에 보인다. 구성 편집·새로 만들기는 전투 구성 창을 그 구성으로 바로 연다(사용자 요청 묶음E)
    const total = (a.encounters ?? []).reduce((n, r) => n + (r.id ? Number(r.weight) || 0 : 0), 0);
    const rows = (a.encounters ?? []).map((r, j) => `<div class="fm-enc-row"><select data-path="${p}.encounters.${j}.id">${opt("", r.id, L("encPick"))}${encs.map((e) => opt(e.id, r.id, e.name)).join("")}</select>
      <input type="number" min="0" data-path="${p}.encounters.${j}.weight" data-type="num" value="${esc(r.weight ?? 1)}" title="${esc(L("encWeight"))}"/>
      <span class="fm-enc-pct">${r.id && total ? Math.round(((Number(r.weight) || 0) / total) * 100) : 0}%</span>
      ${r.id ? `<a data-fm-act="encEdit" data-id="${r.id}" title="${esc(L("encEdit"))}"><i class="fas fa-pen"></i></a>` : ""}
      <a data-fm-del="${p}.encounters.${j}"><i class="fas fa-times"></i></a></div>`).join("");
    return `<h3>${esc(L("encTable"))} <a data-fm-act="addEnc" title="${esc(L("encAdd"))}"><i class="fas fa-plus"></i></a> <a data-fm-act="encNew" title="${esc(L("encNew"))}"><i class="fas fa-file-medical"></i></a> <a data-fm-act="openEncounters" title="${esc(L("encOpen"))}"><i class="fas fa-dragon"></i></a></h3>
      ${rows || `<p class="notes">${esc(L("encNone"))}</p>`}<p class="notes">${esc(L("encHint"))}</p>`;
  },

  /** 진행: 지금 에어리어의 조우표(먼저 보인다) */
  encounterSection(map, st) {
    const here = areaOf(map, st.current);
    const all = game.settings.get("nssq", "encounters") ?? {};
    const rows = (here?.encounters ?? []).filter((r) => all[r.id]);
    if (!rows.length) return "";
    const total = rows.reduce((n, r) => n + (Number(r.weight) || 0), 0);
    return `<section class="fm-encounters"><h4><i class="fas fa-dragon"></i> ${esc(L("encHere", { name: here.name }))}</h4>
      <div class="fm-actions"><button type="button" data-fm-act="encRandom"><i class="fas fa-dice"></i> ${esc(L("encRandom"))}</button></div>
      <ul>${rows.map((r) => `<li><a data-fm-act="encStart" data-id="${r.id}"><i class="fas fa-skull-crossbones"></i> ${esc(all[r.id].name)}</a> <span class="notes">${total ? Math.round(((Number(r.weight) || 0) / total) * 100) : 0}%</span></li>`).join("")}</ul></section>`;
  },

  enemyChoices() {
    this._enemies ??= [
      ...game.actors.filter((a) => a.type === "enemy").map((a) => ({ uuid: a.uuid, label: `${a.system.isFOE ? "★" : ""}${a.name}` })),
      ...(game.packs.get("nssq.enemies")?.index ?? []).map((e) => ({ uuid: e.uuid, label: e.name }))
    ];
    return this._enemies;
  },

  field(path, value, label, kind = "text", hint = "") {
    const v = value ?? "";
    let input;
    if (kind === "bool") input = `<input type="checkbox" data-path="${path}" data-type="bool" ${v ? "checked" : ""}/>`;
    else if (kind === "textarea") input = `<textarea data-path="${path}" rows="${hint ? 4 : 2}" placeholder="${esc(hint)}">${esc(v)}</textarea>`;
    else if (kind === "num") input = `<input type="number" data-path="${path}" data-type="num" value="${esc(v)}"/>`;
    else if (kind === "enemy") input = `<input type="text" data-path="${path}" data-type="enemy" list="fm-enemies" value="${esc(v)}" placeholder="${esc(L("f.actorHint"))}"/>`;
    else input = `<input type="text" data-path="${path}" value="${esc(v)}" placeholder="${esc(hint)}"/>`;
    return `<div class="form-group ${kind === "textarea" ? "stacked" : ""}"><label>${esc(label)}</label>${input}</div>`;
  },

  triggersHtml(path, list, ons, map) {
    const rows = list.map((t, i) => {
      const p = `${path}.${i}`;
      return `<fieldset class="fm-trigger"><legend><select data-path="${p}.on" data-struct>${ons.map((o) => opt(o, t.on, L(`on.${o}`, { n: "n" }))).join("")}</select>
        <a data-fm-up="${p}" title="${esc(L("up"))}"><i class="fas fa-arrow-up"></i></a> <a data-fm-del="${p}" title="${esc(L("remove"))}"><i class="fas fa-trash"></i></a></legend>
        ${t.on === "visit" || t.on === "segment" ? this.field(`${p}.n`, t.n ?? 1, L("f.n"), "num") : ""}
        ${this.field(`${p}.once`, t.once, L("f.once"), "bool")}${this.field(`${p}.auto`, t.auto, L("f.auto"), "bool")}
        ${this.field(`${p}.text`, t.text, L("f.gmText"), "textarea")}${this.field(`${p}.playerText`, t.playerText, L("f.playerText"), "textarea")}
        ${this.actionsHtml(`${p}.actions`, t.actions ?? [], map, true)}</fieldset>`;
    }).join("");
    return `<h3>${esc(L(path === "triggers" ? "mapTriggers" : "triggers"))} <a data-fm-add="${path}" data-kind="trigger" data-on="${ons[0]}"><i class="fas fa-plus"></i></a></h3>${rows}`;
  },

  actionsHtml(path, list, map, allowChoice) {
    const types = Object.keys(ACTIONS).filter((t) => allowChoice || t !== "choice");
    const rows = list.map((a, i) => {
      const p = `${path}.${i}`;
      const fields = (ACTIONS[a.type] ?? []).map(([k, kind, choices]) => {
        const fp = `${p}.${k}`;
        const lab = L(`af.${k}`);
        switch (kind) {
          case "select": return `<div class="form-group"><label>${esc(lab)}</label><select data-path="${fp}">${choices.map((c) => opt(c, a[k], L(`av.${c}`))).join("")}</select></div>`;
          case "area": return `<div class="form-group"><label>${esc(lab)}</label><select data-path="${fp}">${opt("", a[k], L("none"))}${map.areas.map((x) => opt(x.id, a[k], x.name)).join("")}</select></div>`;
          case "passage": return `<div class="form-group"><label>${esc(lab)}</label><select data-path="${fp}">${opt("", a[k], L("none"))}${map.passages.map((x) => opt(x.id, a[k], passageLabel(map, x))).join("")}</select></div>`;
          case "foe": return `<div class="form-group"><label>${esc(lab)}</label><select data-path="${fp}">${opt("", a[k], L("none"))}${map.foes.map((x) => opt(x.id, a[k], x.name)).join("")}</select></div>`;
          case "num": return this.field(fp, a[k], lab, "num");
          case "map": return `<div class="form-group"><label>${esc(lab)}</label><select data-path="${fp}" data-struct>${opt("", a[k], L("none"))}${Object.values(allMaps()).filter((x) => x.id !== map.id).map((x) => opt(x.id, a[k], x.name)).join("")}</select></div>`;
          case "mapArea": { const m2 = allMaps()[a.map]; return `<div class="form-group"><label>${esc(lab)}</label><select data-path="${fp}">${opt("", a[k], L("af.mapStart"))}${(m2?.areas ?? []).map((x) => opt(x.id, a[k], x.name)).join("")}</select></div>`; }
          case "ability": return `<div class="form-group"><label>${esc(lab)}</label><select data-path="${fp}">${ABILITIES.map((c) => opt(c, a[k] ?? "tec", game.i18n.localize(`NSSQ.Ability.${c}`))).join("")}</select></div>`;
          case "checkKind": return `<div class="form-group"><label>${esc(lab)}</label><select data-path="${fp}">${opt("", a[k], L("none"))}${CHECK_KINDS.map((c) => opt(c, a[k], game.i18n.localize(`NSSQ.Check.kind.${c}`))).join("")}</select></div>`;
          case "textarea": return this.field(fp, a[k], lab, "textarea");
          case "enemies": return this.field(fp, a[k], lab, "text", L("af.enemiesHint"));
          case "options": return `<div class="fm-options">${(a.options ?? []).map((o, j) => `<fieldset><legend>${esc(L("option", { n: j + 1 }))} <a data-fm-del="${fp}.${j}"><i class="fas fa-trash"></i></a></legend>
            ${this.field(`${fp}.${j}.label`, o.label, L("af.label"))}${this.actionsHtml(`${fp}.${j}.actions`, o.actions ?? [], map, false)}</fieldset>`).join("")}
            <a data-fm-add="${fp}" data-kind="option"><i class="fas fa-plus"></i> ${esc(L("addOption"))}</a></div>`;
          default: return this.field(fp, a[k], lab);
        }
      }).join("");
      return `<div class="fm-action"><div class="fm-action-head"><select data-path="${p}.type" data-struct>${types.map((t) => opt(t, a.type, L(`act.${t}`))).join("")}</select>
        <a data-fm-up="${p}"><i class="fas fa-arrow-up"></i></a> <a data-fm-del="${p}"><i class="fas fa-times"></i></a></div>${fields}</div>`;
    }).join("");
    return `<div class="fm-actions-edit"><p class="fm-sub">${esc(L("actions"))} <a data-fm-add="${path}" data-kind="action"><i class="fas fa-plus"></i></a></p>${rows}</div>`;
  }

  /* ---------- 입력 ---------- */,

  /** 편집 칸 → 초안. 구조가 바뀌는 칸(data-struct)이면 다시 그린다 */
  /** 에어리어 이름으로 씬을 만들어 연결한다(그림이 있으면 배경으로, 폴더 「필드 지도: 지도 이름」) */
  async makeScene(area) {
    if (!area || !game.user.isGM) return;
    const map = this.currentMap();
    const folderName = `${L("sceneFolder")}: ${map.name}`;
    const folder = game.folders.find((f) => f.type === "Scene" && f.name === folderName) ?? await Folder.create({ name: folderName, type: "Scene" });
    // 모두에게 시야 허용: 토큰 시야·안개 끄기, 플레이어 기본 권한 「관찰자」(전투 프리셋 씬과 같은 설정)
    const data = { name: area.name, folder: folder.id, navigation: false, tokenVision: false, fog: { exploration: false }, ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER } };
    if (area.img) {
      data.background = { src: area.img };
      // 씬 크기 = 그림 크기(못 읽으면 Foundry 기본값)
      const size = await new Promise((resolve) => { const img = new Image(); img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight }); img.onerror = () => resolve(null); img.src = area.img; });
      if (size?.width && size?.height) Object.assign(data, size);
    }
    const scene = await Scene.create(data);
    if (!scene) return;
    area.sceneId = scene.id;
    area.sceneImg = sceneImage(scene.id) || area.img || "";
    this.dirty = true;
    ui.notifications.info(L("sceneMade", { name: scene.name }));
    return this.render();
  },

  onField(el) {
    if (this.mode !== "edit" || !this.draft) return;
    let v = el.type === "checkbox" ? el.checked : el.value;
    if (el.dataset.type === "num") v = el.value === "" ? null : Number(el.value);
    const path = el.dataset.path;
    if (el.dataset.type === "enemy") {
      const hit = this.enemyChoices().find((x) => x.label === v);
      const base = path.replace(/\.actorLabel$/, "");
      foundry.utils.setProperty(this.draft, `${base}.actorUuid`, hit?.uuid ?? "");
      const f = foundry.utils.getProperty(this.draft, base);
      if (hit && !f.name) f.name = hit.label.replace(/^★/, "");
    }
    if (path.endsWith(".type") && el.dataset.struct !== undefined) {
      // 동작 종류가 바뀌면 그 동작의 칸을 비운다
      foundry.utils.setProperty(this.draft, path.replace(/\.type$/, ""), { type: v, ...(v === "choice" ? { options: [] } : {}) });
    } else foundry.utils.setProperty(this.draft, path, v);
    if (path.endsWith(".sceneId")) foundry.utils.setProperty(this.draft, path.replace(/sceneId$/, "sceneImg"), sceneImage(v));
    this.dirty = true;
    const structural = el.dataset.struct !== undefined || el.dataset.type === "enemy" || path === "bg.style" || path.endsWith(".oneWay") || path.endsWith(".state") || path.endsWith(".name") || path.endsWith(".secret");
    if (structural) this.render();
    else this.element.find("[data-fm-act=save]").addClass("fm-dirty");
  },

  addItem({ fmAdd: path, kind, on }) {
    const list = foundry.utils.getProperty(this.draft, path) ?? [];
    const item = {
      trigger: () => ({ id: rid(), on: on || "enter", n: 1, once: false, auto: false, text: "", playerText: "", actions: [] }),
      action: () => ({ type: "message", text: "" }),
      option: () => ({ label: "", actions: [] }),
      foe: () => ({ id: rid(), name: "", actorUuid: "", actorLabel: "", route: [], mode: "loop", every: 1, nightOnly: false, active: true })
    }[kind]();
    list.push(item);
    foundry.utils.setProperty(this.draft, path, list);
    this.dirty = true;
    this.render();
  },

  delItem(path) {
    const parts = path.split(".");
    const i = Number(parts.pop());
    const list = foundry.utils.getProperty(this.draft, parts.join("."));
    if (Array.isArray(list)) list.splice(i, 1);
    this.dirty = true;
    this.render();
  },

  upItem(path) {
    const parts = path.split(".");
    const i = Number(parts.pop());
    const list = foundry.utils.getProperty(this.draft, parts.join("."));
    if (Array.isArray(list) && i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
    this.dirty = true;
    this.render();
  },

  async save() {
    if (!this.draft) return;
    for (const a of this.draft.areas) if (a.sceneId) a.sceneImg = sceneImage(a.sceneId) || a.sceneImg || "";
    await saveMap(this.draft);
    this.dirty = false;
    ui.notifications.info(L("saved", { name: this.draft.name }));
  },

  addArea({ x, y }) {
    const map = this.draft;
    const a = { id: rid(), name: L("newArea", { n: map.areas.length + 1 }), x, y, terrain: "", gmNote: "", secret: false, gather: "", tags: "", triggers: [] };
    map.areas.push(a);
    map.start ??= a.id;
    this.sel = { kind: "area", id: a.id };
    this.dirty = true;
    this.render();
  },

  clickPassage(id) {
    if (!game.user.isGM) return;
    this.sel = { kind: "passage", id };
    this.render();
  }
};
