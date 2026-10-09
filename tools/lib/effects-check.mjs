// 효과 데이터(effects) 검사 (03, 단계 7). data/*.json 의 effects가 스키마·엔진과 맞는지 확인하고 review 상태를 센다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

import { NESTED, checkEffects } from "../../src/engine/effects/schema.mjs";
export { TYPES, MOD_PATHS, FLAGS, TRIGGER_ON, checkEffects } from "../../src/engine/effects/schema.mjs";

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));

/** 검사 대상: { group, name, holder(system 또는 노드) } */
export function collectHolders() {
  const out = [];
  for (const f of fs.readdirSync(path.join(ROOT, "data/skills")).filter((x) => x.endsWith(".json")).sort()) {
    for (const s of readJson(`data/skills/${f}`)) out.push({ group: s._meta?.className ?? f.replace(".json", ""), name: s.name, holder: s.system });
  }
  for (const f of fs.readdirSync(path.join(ROOT, "data/enemies")).filter((x) => x.endsWith(".json")).sort()) {
    for (const a of readJson(`data/enemies/${f}`)) for (const it of a.items ?? []) out.push({ group: `에너미 ${f.replace(".json", "")}`, name: `${a.name}/${it.name}`, holder: it.system });
  }
  for (const [f, label] of [["items.json", "아이템"], ["accessories.json", "장식"]]) {
    for (const it of readJson(`data/${f}`)) out.push({ group: label, name: it.name, holder: it.system });
  }
  for (const r of readJson("data/refinements.json")) out.push({ group: "제련", name: r.name, holder: r });
  return out;
}

/** 단계 8에 연결할 type */
/** flag 이름(03 §3) */
/** trigger.on 값(03 §3) */

export const STAGE8 = new Set(["stance", "trigger", "counter", "chase", "delayed", "token", "guard", "aura", "provoke"]);
const usesStage8 = (list) => (list ?? []).some((e) => STAGE8.has(e.type) || NESTED.some((k) => usesStage8(e[k])));

export function checkAll() {
  const errors = [];
  const counts = new Map();
  const partial = [];
  const gm = [];
  const stage8 = [];
  // 같은 이름의 스킬(여러 클래스의 《HP 부스트》 등)은 해설이 같으면 effects도 같아야 한다
  const byName = new Map();
  for (const { group, name, holder } of collectHolders()) {
    if (holder.review && holder.review !== "todo" && holder.description) {
      const k = `${name}\u0000${holder.description}`;
      const v = JSON.stringify(holder.effects ?? []);
      const prev = byName.get(k);
      if (prev && prev.v !== v) errors.push(`${group} 《${name}》: 해설이 같은 ${prev.group}의 것과 effects가 다르다`);
      else if (!prev) byName.set(k, { v, group });
    }
    const where = `${group} 《${name}》`;
    const review = holder.review ?? (holder.effects?.length ? "auto" : "todo");
    const c = counts.get(group) ?? { todo: 0, auto: 0, partial: 0, ok: 0, none: 0, gm: 0 };
    c[review] = (c[review] ?? 0) + 1;
    counts.set(group, c);
    checkEffects(holder.effects ?? [], where, errors);
    for (const e of holder.effects ?? []) if (e.variant !== undefined && !(Number.isInteger(e.variant) && e.variant >= 0 && e.variant < (holder.variants ?? []).length)) errors.push(`${where}: variant ${e.variant}가 선언 명칭 범위 밖`);
    if (review === "partial") {
      if (!holder.effectsNote) errors.push(`${where}: partial인데 effectsNote가 없다`);
      partial.push(`${where}: ${holder.effectsNote ?? ""}`);
    }
    // gm: 자동화할 수 없어 GM 개입이 반드시 필요한 것(전투 밖 연출·지형 등). effectsNote가 GM이 할 일
    if (review === "gm") {
      if (!holder.effectsNote) errors.push(`${where}: gm인데 effectsNote가 없다`);
      gm.push(`${where}: ${holder.effectsNote ?? ""}`);
    }
    if (review === "none" && (holder.effects ?? []).length) errors.push(`${where}: none인데 effects가 있다`);
    if (["ok", "auto"].includes(review) && !(holder.effects ?? []).length) errors.push(`${where}: ${review}인데 effects가 비었다`);
    if (usesStage8(holder.effects)) stage8.push(where);
  }
  return { errors, counts, partial, gm, stage8 };
}

export function reportMarkdown({ errors, counts, partial, gm = [], stage8 }) {
  const total = { todo: 0, auto: 0, partial: 0, ok: 0, none: 0, gm: 0 };
  const rows = [...counts].map(([g, c]) => {
    for (const k of Object.keys(total)) total[k] += c[k] ?? 0;
    return `| ${g} | ${c.todo ?? 0} | ${c.auto ?? 0} | ${c.partial ?? 0} | ${c.ok ?? 0} | ${c.none ?? 0} | ${c.gm ?? 0} |`;
  });
  return [
    "# 효과 데이터 리포트 (tools/effects-check.mjs)", "",
    `오류 ${errors.length}건 · todo ${total.todo} · auto ${total.auto} · partial ${total.partial} · ok ${total.ok} · none(규칙상 효과 없음) ${total.none} · gm(GM 개입 필수) ${total.gm}`, "",
    "| 묶음 | todo | auto | partial | ok | none | gm |", "|---|---|---|---|---|---|---|", ...rows, "",
    "## 오류", ...(errors.length ? errors.map((e) => `- ${e}`) : ["없음"]), "",
    "## partial (남은 처리)", ...(partial.length ? partial.map((e) => `- ${e}`) : ["없음"]), "",
    "## gm (자동화 불가, GM 개입 필수)", ...(gm.length ? gm.map((e) => `- ${e}`) : ["없음"]), "",
    "## 단계 8 대기(트리거·대기 상태·지연·추격·반격·토큰)", ...(stage8.length ? stage8.map((e) => `- ${e}`) : ["없음"]), ""
  ].join("\n");
}
