/**
 * 스킬 표시용 [의존 부위][의존 무기] 아이콘 쌍(사용자 요청). 스킬 트리 노드·캐릭터 시트 스킬 목록·전투 스킬 메뉴에서 스킬 그림 대신 쓴다.
 * - 부위: 스킬 system.part(머리·팔·다리, 「-」는 빈 칸). 그 부위가 봉인(bindHead·bindArm·bindLeg) 중이면 빨갛게 사선
 * - 무기: system.weaponReq(여럿이면 둘까지 겹쳐, 없으면 빈 칸)
 * - 그림: 아래 기본(Foundry 내장 아이콘). [에셋 폴더 연결]의 「스킬아이콘/」에 「머리.png」「도.png」처럼 넣으면 그 그림(설정 assetLinks.icons)
 */
import { nameKey } from "./asset-link.mjs";
import { esc } from "../util.mjs";

const L = (k, d) => (d ? game.i18n.format(`NSSQ.SkillBadge.${k}`, d) : game.i18n.localize(`NSSQ.SkillBadge.${k}`));

export const PART_ICONS = {
  머리: "icons/equipment/head/helm-barbute-engraved-steel.webp",
  팔: "icons/equipment/hand/gauntlet-armored-steel-grey.webp",
  다리: "icons/equipment/feet/boots-armored-steel.webp"
};
export const WEAPON_ICONS = {
  주먹: "icons/equipment/hand/gauntlet-armored-black.webp",
  단검: "icons/weapons/daggers/dagger-black.webp",
  검: "icons/weapons/swords/shortsword-broad.webp",
  세검: "icons/weapons/swords/scimitar-broad.webp",
  창: "icons/weapons/polearms/spear-flared-blue.webp",
  도끼: "icons/weapons/axes/axe-battle-black.webp",
  지팡이: "icons/weapons/staves/staff-animal-bird.webp",
  망치: "icons/weapons/hammers/hammer-double-bronze.webp",
  채찍: "icons/weapons/misc/whip-red-yellow.webp",
  도: "icons/weapons/swords/sword-katana.webp",
  포검: "icons/weapons/swords/greatsword-crossguard-blue.webp",
  농기구: "icons/magic/death/weapon-scythe-rune-green.webp",
  활: "icons/weapons/bows/bow-ornamental-carved-brown.webp",
  쇠뇌: "icons/weapons/crossbows/crossbow-blue.webp",
  총: "icons/weapons/guns/gun-blunderbuss-steel.webp",
  방패: "icons/equipment/shield/buckler-iron-cross-gray.webp"
};
/** 에셋 폴더 연결의 「스킬아이콘/」 대상 이름 */
export const BADGE_NAMES = [...Object.keys(PART_ICONS), ...Object.keys(WEAPON_ICONS)];
const BIND = { 머리: "bindHead", 팔: "bindArm", 다리: "bindLeg" };

function iconOf(name, defaults) {
  const custom = game.settings.get("nssq", "assetLinks")?.icons?.[nameKey(name)];
  return custom || defaults[name] || null;
}

/**
 * @param {object} sys 스킬 system(part, weaponReq)
 * @param {Actor} [actor] 주면 그 부위 봉인을 표시
 */
export function skillBadgeHtml(sys, actor = null) {
  const part = PART_ICONS[sys?.part] ? sys.part : null;
  const weapons = [].concat(sys?.weaponReq ?? []).filter(Boolean);
  const bound = part && actor && (actor.system.conditions ?? []).some((c) => c.id === BIND[part]);
  const tip = [part ? L("part", { part }) : L("noPart"), weapons.length ? L("weapon", { list: weapons.join("·") }) : L("noWeapon")].join(" · ") + (bound ? ` · ${L("bound")}` : "");
  const img = (src, cls = "") => `<img class="${cls}" src="${esc(src)}" alt=""/>`;
  const partSlot = part ? img(iconOf(part, PART_ICONS)) : "";
  const shown = weapons.slice(0, 2).map((w) => iconOf(w, WEAPON_ICONS)).filter(Boolean);
  const weaponSlot = shown.map((src, i) => img(src, i ? "second" : "")).join("") + (weapons.length > 2 ? `<b>+${weapons.length - 2}</b>` : "");
  return `<span class="nq-skb${bound ? " bound" : ""}" title="${esc(tip)}"><span class="p${part ? "" : " none"}">${partSlot}</span><span class="w${shown.length ? "" : " none"}${shown.length > 1 ? " two" : ""}">${weaponSlot}</span></span>`;
}
