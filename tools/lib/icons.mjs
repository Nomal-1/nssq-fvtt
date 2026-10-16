// 컴펜디움 아이콘(묶음G): 기본 svg 아이콘을 Foundry v12 코어 아이콘(icons/…, 서버에 실제로 있는 경로)으로 바꾼다.
// 후보 목록은 tools/lib/icon-sets.json(tools/dev/icon-sets.py가 서버 아이콘 목록에서 만든다). 같은 이름은 늘 같은 아이콘(이름 해시).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SETS = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "icon-sets.json"), "utf8"));
const DEFAULT = /^icons\/svg\//;

function pick(set, key) {
  const list = SETS[set];
  if (!list?.length) return null;
  let h = 0;
  for (const ch of String(key)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return list[h % list.length];
}
const byName = (name, rules) => rules.find(([re]) => re.test(name))?.[1] ?? null;

const ACCESSORY = [[/장갑/, "x.장갑"], [/머리|모자|관/, "x.머리"], [/벨트/, "x.벨트"], [/슈즈|부츠|신발/, "x.신발"], [/부적/, "x.부적"], [/서$|책/, "x.책"],
  [/고글/, "x.고글"], [/오브/, "x.오브"], [/반지|링/, "x.반지"], [/피어스|귀걸이/, "x.귀걸이"], [/팔찌|브레이슬릿/, "x.팔찌"], [/네클리스|목걸이/, "x.목걸이"]];
const ITEM = [[/메디카|테리아카γ/, "i.빨간약"], [/암리타/, "i.파란약"], [/넥타르/, "i.금약"], [/테리아카/, "i.초록약"], [/파이어 오일/, "i.주황약"], [/프리즈 오일/, "i.파란약"],
  [/쇼크 오일/, "i.금약"], [/미스트/, "i.보라약"], [/아리아드네|실$|로프/, "i.로프"], [/고기/, "i.고기"], [/생선/, "i.생선"], [/^알$/, "i.알"], [/곡류/, "i.곡류"], [/채소/, "i.채소"],
  [/과일/, "i.과일"], [/백팩/, "i.가방"], [/텐트/, "i.텐트"], [/조리/, "i.냄비"], [/물통/, "i.물통"], [/자루/, "i.자루"], [/^천$/, "i.천"], [/나이프/, "i.칼"],
  [/망치/, "i.공구망치"], [/못|쐐기/, "i.못"], [/거울/, "i.거울"], [/횃불/, "i.횃불"], [/부싯/, "i.부싯돌"], [/랜턴/, "i.랜턴"], [/기름|병/, "i.병"]];
// 클래스: 그 클래스다운 분류
const CLASS = { "프린스/프린세스": "x.머리", 소드맨: "w.검", 레인저: "w.활", 팔라딘: "a.방패", "다크 헌터": "w.채찍", 메딕: "s.heal", 알케미스트: "s.fire", 바드: "s.song",
  무사: "w.도", "커스 메이커": "s.curse", 거너: "w.총", "닥터 마구스": "w.지팡이", 워리어: "w.도끼", 팔랑크스: "a.방패", 파이리츠: "w.세검", 시노비: "s.ninja", 몽크: "w.주먹",
  조디악: "s.rune", "비스트 킹": "s.summon", 발리스타: "w.쇠뇌", 농부: "w.농기구", 장군: "s.command", "나이트 시커": "w.단검", 포트리스: "a.중갑", 스나이퍼: "w.활",
  "룬 마스터": "s.rune", 댄서: "s.dance", 미스틱: "x.오브", 모노노후: "w.도끼", 임페리얼: "w.포검", 하이랜더: "w.창" };
const WEAPON_WORDS = ["주먹", "단검", "세검", "검", "창", "도끼", "지팡이", "망치", "채찍", "포검", "도", "농기구", "활", "쇠뇌", "총"];
const CATEGORY = { 백병: "s.melee", 투인: "s.melee", 사격: "s.ranged", 회복: "s.heal", 주언: "s.curse", 주가: "s.song", 무용: "s.dance", 호령: "s.command",
  방진: "s.formation", 방어: "s.defense", 인법: "s.ninja", 소환수: "s.summon" };

function skillSet(e) {
  const s = e.system ?? {};
  const fx = JSON.stringify(s.effects ?? []);
  const el = /"fire"/.test(fx) ? "s.fire" : /"ice"/.test(fx) ? "s.ice" : /"volt"/.test(fx) ? "s.volt" : null;
  if (s.category === "술식") return el ?? "s.rune";
  if (CATEGORY[s.category]) return CATEGORY[s.category];
  // 분류 없는 스킬(패시브 등)
  if (/마스터리/.test(e.name)) {
    const w = WEAPON_WORDS.find((x) => e.name.startsWith(x));
    if (w) return `w.${w}`;
  }
  if (/벌채|채굴|채취|채집|요리|지도/.test(e.name)) return "s.gather";
  if (/독/.test(e.name)) return "s.toxin";
  if (el) return el;
  if (/"heal"/.test(fx) || /(hp|tp)(Max|max)/.test(fx)) return "s.heal";
  if (/resist/.test(fx) || /"defense"/.test(fx)) return "s.defense";
  if (/evasion|speed/.test(fx)) return "s.dance";
  if (/physAtk|elemAtk|physHit|elemHit/.test(fx)) return "s.buff";
  if (/"buff"/.test(fx)) return "s.buff";
  if (/"attack"/.test(fx)) return s.weaponReq?.length ? "s.melee" : "s.melee";
  return "s.passive";
}

/** 그 항목의 아이콘(기본 svg가 아닌 그림이면 그대로) */
export function iconFor(e) {
  if (e.img && !DEFAULT.test(e.img)) return e.img;
  const s = e.system ?? {};
  let set = null;
  switch (e.type) {
    case "weapon": set = `w.${s.weaponType}`; break;
    case "armor": set = `a.${s.armorType}`; break;
    case "accessory": set = byName(e.name, ACCESSORY); break;
    case "consumable": case "tool": set = byName(e.name, ITEM); break;
    case "material": set = `m.${String(s.materialType ?? e.name).replace("날개·깃털", "깃털")}`; break;
    case "class": set = CLASS[e.name] ?? null; break;
    case "skill": set = skillSet(e); break;
  }
  return (set && pick(set, e.name)) ?? e.img;
}
