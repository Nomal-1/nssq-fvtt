// data/raw → data/*.json 변환 + build/report.md (02 §5)
// 사용: node tools/convert.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Report } from "./lib/report.mjs";
import { formula, makeId, normalizeKey, parseTables, toHTML, unescape } from "./lib/util.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW = path.join(ROOT, "data", "raw");
const OUT = path.join(ROOT, "data");
const report = new Report();

const read = (rel) => fs.readFileSync(path.join(RAW, rel), "utf8");
const written = new Set();

/**
 * 손으로 작성한 효과 데이터(effects·review, 단계 7)를 재변환 때 잃지 않도록
 * 기존 파일에서 같은 id(또는 key)의 값을 옮겨 온다.
 */
function eachAuthored(node, fn) {
  if (Array.isArray(node)) return node.forEach((n) => eachAuthored(n, fn));
  if (!node || typeof node !== "object") return;
  const holder = node.system && Array.isArray(node.system.effects) ? node.system : Array.isArray(node.effects) ? node : null;
  const id = node._id ?? node.id ?? node.key;
  if (holder && id) fn(id, holder);
  for (const v of Object.values(node)) if (v && typeof v === "object") eachAuthored(v, fn);
}

const write = (rel, data) => {
  const file = path.join(OUT, rel);
  written.add(path.resolve(file));
  if (fs.existsSync(file)) {
    const old = new Map();
    eachAuthored(JSON.parse(fs.readFileSync(file, "utf8")), (id, h) => {
      // 변환기가 자동 작성한 효과(effectsSource: "convert")는 매번 새로 만든다
      if (h.effectsSource === "convert") return;
      if (h.effects.length || (h.review && h.review !== "todo")) old.set(id, h);
    });
    eachAuthored(data, (id, h) => {
      const o = old.get(id);
      if (!o) return;
      h.effects = o.effects;
      if (o.review !== undefined) h.review = o.review;
      if (o.effectsNote !== undefined) h.effectsNote = o.effectsNote;
      delete h.effectsSource;
    });
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 1) + "\n");
};

/* ---------------- 열거형 (02 §2.4) ---------------- */
const ENUM = {
  weapon: ["단검", "검", "세검", "창", "도끼", "지팡이", "망치", "채찍", "도", "포검", "농기구", "활", "쇠뇌", "총", "주먹", "방패"],
  part: ["-", "머리", "팔", "다리"],
  category: ["-", "백병", "사격", "술식", "회복", "주언", "주가", "소환수", "무용", "호령", "방어", "인법", "방진", "투인"],
  timing: ["상시", "주행동", "개막", "수동", "특수"],
  range: ["-", "근", "원"],
  target: ["자신", "적 단일", "적 열", "적 전체", "적 관통", "아군 단일", "아군 열", "아군 전체", "임의 단일", "특수", "-"],
  maxSL: ["3/2", "5/3", "4/2", "2/1", "1/1", "3/-", "2/-", "1/-", "1/0", "★"],
  armor: ["중갑", "경갑", "옷", "방패"],
  material: ["이빨", "가죽", "모피", "뿔", "발톱", "뼈", "날개·깃털", "껍질", "가시", "칼날", "실", "비늘", "등딱지", "결정", "목재", "덩굴", "가지", "석재", "금속", "보석", "풀", "꽃", "열매"],
  element: { 참: "slash", 괴: "strike", 돌: "pierce", 염: "fire", 빙: "ice", 뇌: "volt", 무: "none" }
};
const MATERIAL_ALIAS = { 날개: "날개·깃털", 깃털: "날개·깃털" };
const FOODSTUFF = ["고기", "생선", "알", "곡류", "채소", "과일"];

function checkEnum(kind, value, where) {
  if (!ENUM[kind].includes(value)) report.add("열거형 위반", `${where}: ${kind} = \`${value}\``);
}

/* ---------------- glossary ---------------- */
const glossary = JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "glossary.json"), "utf8"));
const forbiddenMap = new Map();
for (const g of glossary) for (const f of g.forbidden) forbiddenMap.set(unescape(f), g.ko);

/** 카테고리 안에서 ko로 찾기. 실패·금지 표기는 리포트 */
function lookup(categories, ko, where) {
  const cats = [].concat(categories);
  const hit = glossary.find((g) => cats.includes(g.category) && unescape(g.ko) === ko);
  if (forbiddenMap.has(ko)) report.add("glossary 금지 표기", `${where}: \`${ko}\` → \`${forbiddenMap.get(ko)}\``);
  if (!hit) report.add("glossary 불일치(용어 추가 필요)", `${where}: \`${ko}\` (${cats.join("/")})`);
  return hit;
}

/** glossary jp → 키. 없으면 한국어명으로 만들고 리포트 */
function keyOf(categories, ko, where) {
  const hit = lookup(categories, ko, where);
  if (hit) return normalizeKey(hit.jp);
  report.add("키를 한국어명으로 생성", `${where}: \`${ko}\``);
  return normalizeKey(ko);
}

/** 해설 안의 금지 표기(3자 이상)만 참고로 남긴다 */
function scanForbidden(text, where) {
  for (const [bad, good] of forbiddenMap) {
    if (bad.length >= 3 && text.includes(bad)) report.add("참고: 해설 안 금지 표기 후보", `${where}: \`${bad}\` → \`${good}\``);
  }
}

/* ---------------- 스킬 공통 ---------------- */
const SKILL_CATEGORIES = ["클래스 스킬", "커먼 스킬"];

/** 전제 문자열 → { all: [ {skill, sl} | { any: [...] } ] } */
function parsePrereqs(src, where) {
  let s = src.replace(/\((?![^)]*《)[^)]*\)/g, "").trim(); // 《 없는 괄호 주석 제거
  const tokens = [];
  const re = /\s*(\(|\)|\+|or\b|또는|《([^》]+)》\s*SL\s*(\d+))\s*/gy;
  let m;
  while (re.lastIndex < s.length && (m = re.exec(s))) {
    if (m[2]) tokens.push({ skill: m[2], sl: Number(m[3]) });
    else tokens.push(m[1] === "또는" ? "or" : m[1]);
  }
  if (re.lastIndex < s.length) {
    report.add("파싱 실패", `${where}: 전제 \`${src}\``);
    return { all: [], raw: src };
  }
  let i = 0;
  // OR가 AND보다 약하다고 본다(혼용은 괄호로만 나타남)
  const parseOr = () => {
    const terms = [parseAnd()];
    while (tokens[i] === "or") { i++; terms.push(parseAnd()); }
    return terms.length === 1 ? terms[0] : { any: terms };
  };
  const parseAnd = () => {
    const terms = [parseAtom()];
    while (tokens[i] === "+") { i++; terms.push(parseAtom()); }
    return terms.length === 1 ? terms[0] : { all: terms };
  };
  const parseAtom = () => {
    const t = tokens[i++];
    if (t === "(") { const e = parseOr(); i++; return e; }
    return t;
  };
  const tree = parseOr();
  return tree.all ? tree : { all: [tree] };
}

function parseCost(s, where) {
  const t = s.trim();
  if (t === "-" || t === "") return { tp: 0, fp: 0 };
  let m = t.match(/^(TP|FP):\s*(\d+)$/);
  if (m) return { tp: m[1] === "TP" ? Number(m[2]) : 0, fp: m[1] === "FP" ? Number(m[2]) : 0 };
  if (/^\d+$/.test(t)) return { tp: Number(t), fp: 0 }; // 커먼 스킬 TP 열
  report.add("열거형 위반", `${where}: 코스트 = \`${t}\``);
  return { tp: 0, fp: 0, raw: t };
}

function parseMaxSL(s, where) {
  checkEnum("maxSL", s, where);
  if (s === "★") return { maxSL: { main: 1, sub: null }, unique: true };
  const [main, sub] = s.split("/");
  // 07 #10: 1/0과 1/- 모두 "서브로는 습득 불가"
  return { maxSL: { main: Number(main) || 1, sub: sub === "-" || sub === "0" ? null : Number(sub) }, unique: false };
}

const variantSources = new Map(); // 선언 명칭 → glossary 비고로 확인
for (const g of glossary) if (g.note.includes("선언 명칭")) variantSources.set(unescape(g.ko), g.note);

/** 스킬 표 한 행 → skill 아이템 데이터 */
function skillFromRow(cells, { classKey, className, where }) {
  const [nameCell, descCell, weaponCell, part, category, timing, range, target, costCell, maxSLCell] = cells;
  const nm = nameCell.match(/^《(★?)(.+)》$/);
  if (!nm) {
    report.add("파싱 실패", `${where}: 스킬 이름 \`${nameCell}\``);
    return null;
  }
  const name = nm[2].trim();
  const w = `${where} 《${name}》`;
  let desc = descCell;
  let prereqs = { all: [] };
  const pm = desc.match(/\s*전제:\s*(.+)$/);
  if (pm) {
    prereqs = parsePrereqs(pm[1], w);
    desc = desc.slice(0, pm.index).trim();
  }
  const weaponReq = weaponCell ? weaponCell.split("/").map((x) => x.trim()).filter(Boolean) : [];
  weaponReq.forEach((x) => checkEnum("weapon", x, w));
  checkEnum("part", part, w);
  checkEnum("category", category, w);
  checkEnum("timing", timing, w);
  checkEnum("range", range, w);
  checkEnum("target", target, w);
  const { maxSL, unique } = parseMaxSL(maxSLCell, w);
  if (nm[1] === "★" && !unique) report.add("열거형 위반", `${w}: ★ 이름인데 MaxSL이 \`${maxSLCell}\``);

  // 선언 명칭: "아래 중 하나의 명칭으로 선언한다. 《A》《B》《C》" 또는 "《A》《B》《C》 중 하나로 선언"
  const variants = [];
  const vm = desc.match(/명칭으로 선언한다\.?\s*((?:《[^》]+》\s*)+)/) ?? desc.match(/((?:《[^》]+》\s*){2,})중 하나(?:의 명칭)?로 선언/);
  if (vm) for (const v of vm[1].matchAll(/《([^》]+)》/g)) variants.push(v[1]);
  for (const v of variants) if (!variantSources.has(v)) report.add("glossary 불일치(용어 추가 필요)", `${w}: 선언 명칭 \`${v}\``);

  const skillKey = keyOf(SKILL_CATEGORIES, name, w);
  scanForbidden(desc, w);
  return {
    id: makeId("Item", `skill:${classKey}`, skillKey),
    name,
    type: "skill",
    img: "icons/svg/book.svg",
    system: {
      key: `${classKey}.${skillKey}`,
      skillKey,
      classKey,
      weaponReq,
      part,
      category,
      timing,
      range,
      target,
      cost: parseCost(costCell, w),
      maxSL,
      unique,
      prereqs,
      variants,
      sl: 1,
      description: toHTML(desc),
      effects: [],
      review: "todo"
    },
    _meta: { className }
  };
}

/* ---------------- 클래스·스킬 ---------------- */
function convertClasses() {
  const classes = [];
  let skillTotal = 0;
  const files = fs.readdirSync(path.join(RAW, "classes")).filter((f) => f.endsWith(".md")).sort();
  for (const file of files) {
    const md = read(`classes/${file}`);
    const where = `classes/${file}`;
    const jm = md.match(/```json\s*([\s\S]*?)```/);
    if (!jm) {
      report.add("파싱 실패", `${where}: 클래스 JSON 블록 없음`);
      continue;
    }
    const meta = JSON.parse(jm[1]);
    const name = meta["클래스"];
    const gl = lookup("클래스", name, where);
    if (gl && normalizeKey(gl.jp) !== normalizeKey(meta["원문"])) {
      report.add("glossary 불일치(용어 추가 필요)", `${where}: 원문 \`${meta["원문"]}\` ≠ glossary \`${gl.jp}\``);
    }
    const classKey = normalizeKey(meta["원문"]);

    const weapons = [];
    for (const w of meta["무기"].split("/")) {
      const m = w.trim().match(/^([^()]+)(?:\(([^)]+)\))?$/);
      weapons.push(m[1].trim());
      if (m[2]) {
        weapons.push(m[2].trim());
        report.add("참고: 클래스 무기 괄호 주석(07 #15, 둘 다 허용)", `${where}: \`${w.trim()}\` → ${m[1].trim()}, ${m[2].trim()}`);
      }
    }
    weapons.forEach((w) => checkEnum("weapon", w, where));
    const armors = meta["방어구"].split("/").map((x) => x.trim());
    armors.forEach((a) => checkEnum("armor", a, where));

    const body = md.slice(jm.index + jm[0].length);
    const descText = unescape(body.split(/^###\s/m)[0]);

    classes.push({
      id: makeId("Item", "class", classKey),
      name,
      type: "class",
      img: "icons/svg/mystery-man.svg",
      system: {
        key: classKey,
        abilityBonus: { str: meta.STR, tec: meta.TEC, vit: meta.VIT, agi: meta.AGI, luc: meta.LUC },
        weapons,
        armors,
        role: meta["역할"] ?? [],
        position: meta["위치"] ?? "",
        description: toHTML(descText)
      },
      _meta: { number: meta["번호"], source: meta["원문 링크"] }
    });

    const table = parseTables(md).find((t) => t.header[0] === "스킬");
    if (!table) {
      report.add("파싱 실패", `${where}: 스킬 표 없음`);
      continue;
    }
    if (table.header.length !== 10) report.add("파싱 실패", `${where}: 스킬 표 열 수 ${table.header.length}`);
    const skills = table.rows.map((r, i) => skillFromRow(r, { classKey, className: name, where: `${name} ${i + 1}행` })).filter(Boolean);
    const dup = skills.map((s) => s.system.skillKey).filter((k, i, a) => a.indexOf(k) !== i);
    if (dup.length) report.add("파싱 실패", `${where}: 같은 클래스 안 중복 스킬 ${dup.join(", ")}`);
    skillTotal += skills.length;
    report.add("참고: effects 미작성(todo)", `${name}: ${skills.length}`);
    write(`skills/${classKey}.json`, skills);
  }
  classes.sort((a, b) => a._meta.number - b._meta.number);
  write("classes.json", classes);
  report.count("클래스", classes.length);
  return skillTotal;
}

function convertCommonSkills() {
  const md = read("data/커먼-스킬.md");
  const table = parseTables(md)[0];
  const skills = table.rows.map((r, i) => skillFromRow(r, { classKey: "common", className: "커먼", where: `커먼 스킬 ${i + 1}행` })).filter(Boolean);
  write("skills/common.json", skills);
  report.add("참고: effects 미작성(todo)", `커먼: ${skills.length}`);
  report.count("커먼 스킬", skills.length);
  return skills.length;
}

/* ---------------- 단순 효과 문장 → effects (장식·제련·기타 아이템) ---------------- */
const ABILITY_KEY = { STR: "str", TEC: "tec", VIT: "vit", AGI: "agi", LUC: "luc" };
const SUB_KEY = {
  "물리 명중": "physHit", "속성 명중": "elemHit", 회피: "evasion", "물리 공격": "physAtk", "속성 공격": "elemAtk",
  방어: "defense", "억제 공격": "suppAtk", "억제 방어": "suppDef", 속도: "speed", HP: "hpMax", TP: "tpMax"
};
const ELEM_KEY = { 염: "fire", 빙: "ice", 뇌: "volt" };
const EFFECT_PATTERNS = [
  [/^【(STR|TEC|VIT|AGI|LUC)】\s*\+(\d+)$/, (m) => [{ type: "modifier", path: `abilities.${ABILITY_KEY[m[1]]}`, value: Number(m[2]) }]],
  [/^【([^】]+)】\s*\+(\d+)$/, (m) => SUB_KEY[m[1]] && [{ type: "modifier", path: SUB_KEY[m[1]], value: Number(m[2]) }]],
  [/^에너미 식별 판정에 \+(\d+)$/, (m) => [{ type: "modifier", path: "checks.identify", value: Number(m[1]) }]],
  [/^도주 판정에 \+(\d+)$/, (m) => [{ type: "modifier", path: "checks.escape", value: Number(m[1]) }]],
  [/^〈(염|빙|뇌)〉 속성 부여$/, (m) => [{ type: "flag", flag: "weaponElement", value: ELEM_KEY[m[1]] }]],
  [/^〈(염|빙|뇌)〉 내성\s*\+(\d+)$/, (m) => [{ type: "modifier", path: `resist.${ELEM_KEY[m[1]]}`, value: Number(m[2]) }]]
];
// 기타 아이템 해설의 문장 단위 패턴(문장 일부만 맞으면 partial)
const SENTENCE_PATTERNS = [
  [/^아이템 소지 수 \+(\d+)를 얻는다$/, (m) => [{ type: "modifier", path: "carry", value: Number(m[1]) }]],
  [/소지 수를 계산할 때 아이템 1개분으로 계산하지 않는다$/, () => [{ type: "flag", flag: "noCarryCount", value: true }]],
  [/이 아이템을 2개 이상 소지할 수는 없다$/, () => [{ type: "flag", flag: "ownLimit", value: 1 }]],
  [/^캠프 시의 『주변 위험도』를 -(\d+)로 취급한다$/, (m) => [{ type: "modifier", path: "checks.campDanger", value: -Number(m[1]) }]]
];

/** 한 줄짜리 효과 문장 → { effects, review } (못 읽으면 todo) */
function effectsFromPhrase(text, where) {
  for (const [re, fn] of EFFECT_PATTERNS) {
    const m = text.trim().match(re);
    const effects = m && fn(m);
    if (effects) return { effects, review: "auto", effectsSource: "convert" };
  }
  report.add("참고: 효과 자동 작성 실패(단계 7에서 작성)", `${where}: \`${text}\``);
  return { effects: [], review: "todo" };
}

/** 해설 문장들 → 맞는 문장만 effects로. 일부만 맞으면 partial, 하나도 없으면 todo */
function effectsFromSentences(text) {
  const sentences = text.split(/[.。]\s*/).map((s) => s.trim().replace(/^(또한|그리고)\s*/, "")).filter(Boolean);
  const effects = [];
  let matched = 0;
  for (const s of sentences) {
    for (const [re, fn] of SENTENCE_PATTERNS) {
      const m = s.match(re);
      if (m) { effects.push(...fn(m)); matched++; break; }
    }
  }
  if (!matched) return { effects: [], review: "todo" };
  return { effects, review: matched === sentences.length ? "auto" : "partial", effectsSource: "convert" };
}

/* ---------------- 장비 ---------------- */
function convertEquipment() {
  const md = read("data/무기·방어구.md");
  const tables = parseTables(md);
  const byHead = (h) => tables.find((t) => t.header[0] === h);

  // 무기 종류 표
  const weapons = [];
  for (const r of byHead("무기 종류").rows) {
    const [type, cat, range, elem, physHit, elemHit, physAtk, elemAtk, speed, price, mats] = r;
    const where = `무기 표 ${type}`;
    const alt = type.match(/^(.+)\((.+)\)$/);
    if (alt) {
      // 주먹(주먹 마스터리): 같은 종류의 대체 식
      const base = weapons.find((w) => w.name === alt[1]);
      if (base) {
        base.system.table.physAtkAlt = { formula: formula(physAtk), requires: alt[2] };
        report.add("참고: 무기 대체 식", `${where} → 「${alt[1]}」의 physAtkAlt (조건 《${alt[2]}》)`);
      } else report.add("파싱 실패", `${where}: 기준 무기 없음`);
      continue;
    }
    checkEnum("weapon", type, where);
    const em = elem.match(/〈(.)〉/);
    const element = em ? ENUM.element[em[1]] : elem === "(※)" ? "choice" : null;
    if (!element) report.add("열거형 위반", `${where}: 기본 속성 \`${elem}\``);
    const materials = mats === "-" ? [] : mats.split("/").map((x) => x.trim());
    materials.forEach((x) => checkEnum("material", x, where));
    const key = keyOf("무기·방어구 종별", type, where);
    weapons.push({
      id: makeId("Item", "weapon", key),
      name: type,
      type: "weapon",
      img: "icons/svg/sword.svg",
      system: {
        key,
        weaponType: type,
        rank: 1,
        element: element === "choice" ? "" : element,
        refinements: [],
        slot: "weapon",
        description: "",
        // 아래는 종류 표 값(R식). 런타임 계산은 단계 3
        table: {
          category: cat, range, elementChoice: element === "choice",
          physHit: formula(physHit), elemHit: formula(elemHit),
          physAtk: formula(physAtk), elemAtk: formula(elemAtk),
          speed: formula(speed), price: formula(price), materials
        }
      }
    });
  }
  if (weapons.some((w) => w.system.table.elementChoice)) {
    report.add("참고: 농기구 기본 속성", "입수할 때 〈참〉〈괴〉〈돌〉 중 선택 → element 빈 값, table.elementChoice=true");
  }
  write("weapons.json", weapons);
  report.count("무기 종류", weapons.length);

  const armors = byHead("방어구 종류").rows.map(([type, defense, evasion, speed, price, mats]) => {
    const where = `방어구 표 ${type}`;
    checkEnum("armor", type, where);
    const materials = mats.split("/").map((x) => x.trim());
    materials.forEach((x) => checkEnum("material", x, where));
    const key = keyOf("무기·방어구 종별", type, where);
    return {
      id: makeId("Item", "armor", key),
      name: type,
      type: "armor",
      img: "icons/svg/shield.svg",
      system: {
        key, armorType: type, rank: 1, refinements: [], description: "",
        table: { defense: formula(defense), evasion: formula(evasion), speed: formula(speed), price: formula(price), materials }
      }
    };
  });
  write("armors.json", armors);
  report.count("방어구 종류", armors.length);

  const accessories = byHead("장식 명칭").rows.map(([name, effect, price]) => {
    const where = `장식 ${name}`;
    const key = keyOf("장식", name, where);
    return {
      id: makeId("Item", "accessory", key),
      name,
      type: "accessory",
      img: "icons/svg/item-bag.svg",
      system: { key, price: Number(price), description: toHTML(effect), effectText: effect, ...effectsFromPhrase(effect, where) }
    };
  });
  write("accessories.json", accessories);
  report.count("장식", accessories.length);
  report.add("참고: effects 미작성(todo)", `장식: ${accessories.length}`);

  const KIND = { 무기: "weapon", 방어구: "armor" };
  const refinements = byHead("효과").rows.map(([effect, kinds, price]) => {
    const where = `제련 ${effect}`;
    const k = kinds.split("/").map((x) => KIND[x.trim()]);
    if (k.includes(undefined)) report.add("열거형 위반", `${where}: 종류 \`${kinds}\``);
    const key = normalizeKey(effect);
    return { key, name: effect, kinds: k, price: formula(price), ...effectsFromPhrase(effect, where) };
  });
  write("refinements.json", refinements);
  report.count("제련", refinements.length);
  report.add("참고: effects 미작성(todo)", `제련: ${refinements.length}`);
}

/* ---------------- 아이템·소재 ---------------- */
function parseMaterials(s, where) {
  if (s === "-" || !s) return [];
  return s.split(/[,/]/).map((x) => {
    const m = x.trim().match(/^(.+?)\s*R(\d+)$/);
    if (!m) {
      report.add("파싱 실패", `${where}: 필요 소재 \`${x}\``);
      return { type: x.trim(), rank: 1 };
    }
    checkEnum("material", m[1], where);
    return { type: m[1], rank: Number(m[2]) };
  });
}

function convertItems() {
  const md = read("data/아이템.md");
  const tables = parseTables(md);
  const items = [];
  for (const t of tables) {
    const consumable = t.heading.includes("소모품");
    for (const [name, desc, price, mats] of t.rows) {
      const where = `${t.heading} ${name}`;
      const key = keyOf(consumable ? "소모품 아이템" : "기타 아이템", name, where);
      const type = consumable ? "consumable" : "tool";
      const system = { key, price: Number(price), effects: [], quantity: 1, description: toHTML(desc) };
      if (!consumable) {
        Object.assign(system, effectsFromSentences(desc));
        // 「소모품.」으로 시작하는 기타 아이템(못·쐐기, 횃불, 기름)은 쓰면 줄어든다
        system.consumable = /^소모품\./.test(desc);
      }
      // 「5개 세트」: 아이템 1개(소지 수 1)에 사용 횟수 n
      const setMatch = desc.match(/(\d+)개 세트/);
      system.uses = setMatch ? { value: Number(setMatch[1]), max: Number(setMatch[1]) } : { value: 0, max: 0 };
      if (setMatch) report.add("참고: 사용 횟수(n회분) 아이템", `${where}: ${setMatch[1]}회`);
      if (consumable) Object.assign(system, { materials: parseMaterials(mats, where), foodstuff: FOODSTUFF.includes(name) });
      else if (mats !== "-") report.add("파싱 실패", `${where}: 기타 아이템에 필요 소재 \`${mats}\``);
      if (Number.isNaN(system.price)) report.add("파싱 실패", `${where}: 가격 \`${price}\``);
      items.push({ id: makeId("Item", type, key), name, type, img: consumable ? "icons/svg/pill.svg" : "icons/svg/chest.svg", system });
    }
  }
  write("items.json", items);
  report.count("소모품", items.filter((i) => i.type === "consumable").length);
  report.count("기타 아이템", items.filter((i) => i.type === "tool").length);
  report.add("참고: effects 미작성(todo)", `아이템: ${items.length}`);

  const mat = parseTables(read("data/소재.md"))[0];
  const materials = mat.rows.map(([name]) => {
    checkEnum("material", name, `소재 ${name}`);
    const key = keyOf("소재", name, `소재 ${name}`);
    return {
      id: makeId("Item", "material", key),
      name,
      type: "material",
      img: "icons/svg/item-bag.svg",
      system: { key, materialType: name, rank: 1, quantity: 1, description: "" }
    };
  });
  write("materials.json", materials);
  report.count("소재 종류", materials.length);
}

/* ---------------- 에너미 ---------------- */
const STAT_LABEL = {
  HP: "hp", 물명: "physHit", 속명: "elemHit", 회피: "evasion", 물공: "physAtk", 속공: "elemAtk",
  방어: "defense", 억공: "suppAtk", 억방: "suppDef", 속도: "speed", 희소도: "rarity"
};
const RESIST_LABEL = { 참: "slash", 괴: "strike", 돌: "pierce", 염: "fire", 빙: "ice", 뇌: "volt" };
/** 《약점: ○》《내성: ○》 등의 인자 → 상태 ID(04 §5.2)·속성 ID */
const SKILL_PARAM = {
  머리: "bindHead", 팔: "bindArm", 다리: "bindLeg",
  석화: "petrify", 저주: "curse", 독: "poison", 수면: "sleep", 혼란: "confuse", 마비: "paralyze",
  공포: "fear", 맹목: "blind", 스턴: "stun", 즉사: "instantDeath",
  ...RESIST_LABEL
};

function convertEnemyBlock(block, file) {
  const lines = block.split("\n");
  const hm = lines[0].match(/^###\s+(★?)(.+?)\s*\(([^)]+)\)\s*$/);
  if (!hm) {
    report.add("파싱 실패", `${file}: 에너미 제목 \`${lines[0]}\``);
    return null;
  }
  const [, star, name, jp] = hm;
  const where = `${file} ${name}`;
  const gl = lookup("에너미", name, where);
  if (gl && normalizeKey(gl.jp) !== normalizeKey(jp)) report.add("glossary 불일치(용어 추가 필요)", `${where}: 원문 \`${jp}\` ≠ glossary \`${gl.jp}\``);
  const key = normalizeKey(jp);
  const id = makeId("Actor", "enemy", key);

  const system = {
    key, level: 1, rarity: 0, attackElements: [], isFOE: !!star, isRare: false, identified: false,
    hp: { value: 1, max: 1 },
    stats: { physHit: 0, elemHit: 0, evasion: 0, physAtk: 0, elemAtk: 0, defense: 0, suppAtk: 0, suppDef: 0, speed: 0 },
    resist: { slash: 3, strike: 3, pierce: 3, fire: 3, ice: 3, volt: 3 },
    drops: [], row: "front", order: 0, description: ""
  };
  const skills = [];
  const notes = [];
  let source = null;
  let gotStats = false;
  let gotResist = false;

  for (const raw of lines.slice(1)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^Lv\s*\d/.test(line)) {
      gotStats = true;
      for (const part of line.split("·").map((x) => x.trim())) {
        let m;
        if ((m = part.match(/^Lv\s*(\d+)$/))) system.level = Number(m[1]);
        else if ((m = part.match(/^공격 속성\s+(.+)$/))) {
          for (const e of m[1].split(/[/,·]/).map((x) => x.trim())) {
            if (!ENUM.element[e]) report.add("열거형 위반", `${where}: 공격 속성 \`${e}\``);
            else system.attackElements.push(ENUM.element[e]);
          }
        } else if ((m = part.match(/^(\S+)\s+(-?\d+)$/)) && STAT_LABEL[m[1]]) {
          const k = STAT_LABEL[m[1]];
          const v = Number(m[2]);
          if (k === "hp") system.hp = { value: v, max: v };
          else if (k === "rarity") system.rarity = v;
          else system.stats[k] = v;
        } else report.add("파싱 실패", `${where}: 스탯 \`${part}\``);
      }
    } else if (line.startsWith("내성:")) {
      gotResist = true;
      for (const m of line.slice(3).matchAll(/([참괴돌염빙뇌])\s*(-?\d+)/g)) system.resist[RESIST_LABEL[m[1]]] = Number(m[2]);
      if ([...line.matchAll(/[참괴돌염빙뇌]/g)].length !== 6) report.add("파싱 실패", `${where}: 내성 \`${line}\``);
    } else if (line.startsWith("- 《")) {
      const sm = unescape(line).match(/^- 《([^》]+)》\s*\(([^)]*)\)\s*:\s*([\s\S]*)$/);
      if (!sm) {
        report.add("파싱 실패", `${where}: 스킬 \`${line.slice(0, 60)}…\``);
        continue;
      }
      const [, sname, head, desc] = sm;
      const parts = head.split("/").map((x) => x.trim());
      const w = `${where} 《${sname}》`;
      if (parts.length !== 5) {
        report.add("파싱 실패", `${w}: 스킬 머리 \`${head}\``);
        continue;
      }
      const [part, category, timing, range, target] = parts;
      checkEnum("part", part, w);
      checkEnum("category", category, w);
      checkEnum("timing", timing, w);
      checkEnum("range", range, w);
      checkEnum("target", target, w);
      // 에너미 상시 스킬(약점·내성 등)은 glossary 강화·약화 효과 행으로 등록된 것도 있다
      // 《약점: 머리》처럼 ○ 자리표시가 있는 이름은 "약점: ○" 행 + 인자 ID로 키를 만든다
      const param = sname.includes(": ") ? sname.split(": ")[1].trim() : null;
      let sKey = keyOf(["에너미 스킬", "강화·약화 효과", "클래스 스킬"], param ? sname.replace(/: .+$/, ": ○") : sname, w);
      if (param) {
        const pid = SKILL_PARAM[param];
        if (!pid) report.add("열거형 위반", `${w}: 스킬 인자 \`${param}\``);
        sKey += `.${pid ?? normalizeKey(param)}`;
      }
      skills.push({
        _id: makeId("Item", `enemyskill:${key}`, sKey),
        name: sname,
        type: "skill",
        img: "icons/svg/pawprint.svg",
        system: {
          key: `enemy.${key}.${sKey}`, skillKey: sKey, classKey: "enemy", weaponReq: [],
          part, category, timing, range, target, cost: { tp: 0, fp: 0 }, maxSL: { main: 1, sub: null },
          unique: false, prereqs: { all: [] }, variants: [], sl: 1,
          description: toHTML(desc.trim()), effects: [], review: "todo"
        }
      });
    } else if (line.startsWith("DROP:")) {
      for (const d of unescape(line.slice(5)).split("/").map((x) => x.trim())) {
        const m = d.match(/^(\d+)(?:~(\d+)?)?\s+(?:R(\d+)\s+)?(.+)$/);
        if (!m) {
          report.add("파싱 실패", `${where}: DROP \`${d}\``);
          continue;
        }
        const [, min, max, rank, item] = m;
        const isRange = d.includes("~");
        const material = MATERIAL_ALIAS[item] ?? item;
        if (rank && !ENUM.material.includes(material)) report.add("열거형 위반", `${where}: DROP 소재 \`${item}\``);
        system.drops.push({
          min: Number(min), max: isRange ? (max ? Number(max) : null) : Number(min),
          item: rank ? material : item, rank: rank ? Number(rank) : null
        });
      }
    } else if (line.startsWith(">")) notes.push(unescape(line.replace(/^>\s?/, "")));
    else if ((source = line.match(/^\[원문\]\((.+)\)$/)?.[1] ?? source)) continue;
    else report.add("참고: 에너미 블록의 기타 줄", `${where}: \`${line.slice(0, 80)}\``);
  }
  if (!gotStats) report.add("파싱 실패", `${where}: 스탯 줄 없음`);
  if (!gotResist) report.add("파싱 실패", `${where}: 내성 줄 없음`);
  system.description = toHTML(notes.join("\n"));
  for (const s of skills) s._key = `!actors.items!${id}.${s._id}`;
  return {
    id, name, type: "enemy", img: "icons/svg/mystery-man-black.svg",
    system, items: skills, _meta: { source, jp }
  };
}

function convertEnemies() {
  const FILES = { "Lv1-에너미.md": "lv1", "Lv2-에너미.md": "lv2", "Lv3-4-에너미.md": "lv3-4", "F-O-E.md": "foe" };
  let total = 0;
  let skillTotal = 0;
  for (const [file, out] of Object.entries(FILES)) {
    const md = read(`enemies/${file}`);
    const blocks = md.split(/^(?=### )/m).slice(1);
    const enemies = blocks.map((b) => convertEnemyBlock(b, file)).filter(Boolean);
    total += enemies.length;
    skillTotal += enemies.reduce((n, e) => n + e.items.length, 0);
    write(`enemies/${out}.json`, enemies);
  }
  report.count("에너미", total);
  report.count("에너미 스킬", skillTotal);
  if (total !== 66) report.add("참고: 로드맵과 다른 수", `에너미 블록 ${total}개 (05 단계 1은 66블록, 원문 65종으로 기재)`);
  report.add("참고: effects 미작성(todo)", `에너미 스킬: ${skillTotal}`);
}

/* ---------------- 표 ---------------- */
function rangeOf(s) {
  const t = unescape(s);
  let m;
  if ((m = t.match(/^~(\d+)$/))) return { min: null, max: Number(m[1]) };
  if ((m = t.match(/^(\d+)~(\d+)$/))) return { min: Number(m[1]), max: Number(m[2]) };
  if ((m = t.match(/^(\d+)~$/))) return { min: Number(m[1]), max: null };
  if ((m = t.match(/^(\d+)$/))) return { min: Number(m[1]), max: Number(m[1]) };
  return null;
}

function convertTables() {
  // 랜덤 던전 이벤트 + 채집표
  const rd = parseTables(read("rules/랜덤-던전.md"));
  const events = rd.find((t) => t.header[0] === "2D6").rows.map(([n, text]) => ({ roll: Number(n), text }));
  const gatherTable = rd.find((t) => t.header[0] === "눈");
  const results = gatherTable.rows.map(([r, logging, mining, harvest]) => ({ ...rangeOf(r), logging, mining, harvest }));
  write("tables/random-dungeon.json", { formula: "2d6", events });

  const dt = parseTables(read("rules/던전-탐색-룰.md"));
  const methods = dt.find((t) => t.header[0] === "채집 방법").rows.map(([name, count, ahh]) => ({ name, count: Number(count), ahh: Number(ahh) }));
  write("tables/gathering.json", {
    methods,
    // 랜덤 던전 공통 채집표. 베이직 던전은 던전마다 표를 정한다
    results,
    columns: { logging: "벌채", mining: "채굴", harvest: "채취" }
  });

  const ch = parseTables(read("character/캐릭터-작성-(Character-Generation).md"));
  const history = ch.find((t) => t.header[0] === "D666").rows.map(([n, text]) => ({ roll: n, text }));
  write("tables/history-d666.json", { formula: "d666", entries: history });

  const gr = parseTables(read("rules/세션-결과와-성장.md"));
  const levels = gr.find((t) => t.header[0] === "LV").rows.map(([lv, need, total, note]) => ({
    level: Number(lv), need: Number(need), total: Number(total), note: note ?? ""
  }));
  for (let i = 1; i < levels.length; i++) {
    if (levels[i].total !== levels[i - 1].total + levels[i].need) report.add("파싱 실패", `레벨표 Lv${levels[i].level}: 누계 불일치`);
  }
  const exp = gr.find((t) => t.header[0] === "항목").rows.map(([item, value]) => ({ item, value }));
  write("tables/level-exp.json", { levels, sessionExp: exp });

  const ck = parseTables(read("rules/일반-행위-판정.md"));
  const targets = ck.find((t) => t.header[0] === "목표값").rows.map(([value, text]) => ({ value: Number(value), text }));
  const abilityUses = ck.find((t) => t.header[0] === "능력치").rows.map(([ability, text]) => ({ ability, text }));
  write("tables/check.json", { targets, abilityUses });
  report.count("목표값 기준", targets.length);

  report.count("랜덤 던전 이벤트", events.length);
  report.count("경력표(D666)", history.length);
  report.count("레벨표", levels.length);
}

/* ---------------- 실행 ---------------- */
const classSkills = convertClasses();
const common = convertCommonSkills();
report.count("클래스 스킬", classSkills);
report.count("스킬 합계(클래스+커먼)", classSkills + common);
convertEquipment();
convertItems();
convertEnemies();
convertTables();

// 이번 변환에서 만들지 않은 산출물(이름이 바뀐 클래스 등)은 지운다
for (const d of ["skills", "enemies", "tables"]) {
  const dir = path.join(OUT, d);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    const full = path.resolve(dir, f);
    if (f.endsWith(".json") && !written.has(full)) {
      fs.rmSync(full);
      report.add("참고: 삭제한 이전 산출물", `${d}/${f}`);
    }
  }
}

// 런타임·테스트가 동기로 쓰는 장비 표 모듈
{
  const load = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), "utf8"));
  const tables = {
    weapons: Object.fromEntries(load("weapons.json").map((w) => [w.system.weaponType, { key: w.system.key, element: w.system.element, ...w.system.table }])),
    armors: Object.fromEntries(load("armors.json").map((a) => [a.system.armorType, { key: a.system.key, ...a.system.table }])),
    refinements: load("refinements.json").map(({ key, name, kinds, price, effects }) => ({ key, name, kinds, price, effects })),
    materials: load("materials.json").map((m) => m.name),
    // 가격 식이 없는 무기 종류(주먹) = 무기 슬롯이 비었을 때의 맨손(07 #20)
    unarmed: load("weapons.json").find((w) => !w.system.table.price)?.system.weaponType ?? null,
    // GM 스크린 참고표
    check: load("tables/check.json"),
    levelExp: load("tables/level-exp.json")
  };
  const file = path.join(ROOT, "src", "generated", "tables.mjs");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `// 자동 생성: tools/convert.mjs (data/*.json). 직접 고치지 않는다.
export default ${JSON.stringify(tables, null, 1)};
`);
}

fs.mkdirSync(path.join(ROOT, "build"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "build", "report.md"), report.toMarkdown());
console.log(`변환 완료. 확인 필요 항목 ${report.issueCount}개 → build/report.md`);
