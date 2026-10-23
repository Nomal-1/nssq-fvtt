/**
 * 전투 화면 카드의 지속 효과 표시(강화·방어 테두리, 봉인 덩굴, 상태 이상 아이콘·입자·오라, 특수 상태). combat/hud.mjs가 쓴다
 */
import { BUFFS } from "../engine/buffs.mjs";

/**
 * 지속 효과 표시(사용자 요청): 강화 중 → 카드 붉은 테두리, 방어 전념·대기 → 반투명 방패,
 * 봉인 → 덩굴, [혼란] → 소용돌이, 그 밖의 상태 이상 → 아이콘. 그림 위에 겹친다
 */
const AILMENT_ICON = { poison: "fa-skull-crossbones", paralyze: "fa-bolt", sleep: "fa-moon", fear: "fa-ghost", blind: "fa-eye-slash", curse: "fa-ankh", petrify: "fa-mountain", stun: "fa-star" };
export function persistClasses(c) {
  const a = c.actor;
  const buffs = a?.system.buffs ?? [];
  const isDebuff = (b) => BUFFS[b.id]?.kind === "debuff";
  return [buffs.some((b) => !isDebuff(b)) ? "fx-buffed" : "", buffs.some(isDebuff) ? "fx-debuffed" : ""].join(" ");
}
// 상태 이상별 지속 연출(CSS): 독=거품, 마비=전기, 수면=Z, 공포=푸른 떨림, 맹목=어둠, 저주=검붉은 연기, 스턴=도는 별
const AILMENT_FX = ["poison", "paralyze", "sleep", "fear", "blind", "curse", "stun"];
const AILMENT_FX_PARTS = { poison: 4, paralyze: 2, sleep: 3, fear: 2, blind: 0, curse: 3, stun: 3 };
/** 지속 효과 정보(그리기 공통) */
function persistState(c) {
  const a = c.actor;
  const conds = a?.system.conditions ?? [];
  const has = (id) => conds.some((x) => x.id === id);
  const buffs = a?.system.buffs ?? [];
  const nBuff = buffs.filter((b) => BUFFS[b.id]?.kind !== "debuff").length;
  return {
    conds, has,
    guard: !!c.getFlag("nssq", "guarding"),
    waiting: (c.getFlag("nssq", "stances") ?? []).length > 0 || !!c.getFlag("nssq", "late") || !!c.getFlag("nssq", "delayed"),
    binds: ["bindHead", "bindArm", "bindLeg"].filter((k) => has(k)),
    // 전투 고유 상태(무사의 자세 등, 플래그 states)·오버히트
    special: (a?.getFlag("nssq", "states") ?? []).length > 0,
    // 특수 상태별 모양(사용자 요청: 자세마다 다르게). 여럿이면 처음 것
    specialKey: STATE_THEME[(a?.getFlag("nssq", "states") ?? [])[0]?.id] ? (a.getFlag("nssq", "states")[0].id) : null,
    overheat: Number(a?.getFlag("nssq", "overheat") ?? 0) > 0,
    nBuff, nDebuff: buffs.length - nBuff
  };
}
const VINE_SVG = (cls) => `<svg class="${cls}" viewBox="0 0 100 40" preserveAspectRatio="none"><path d="M-5,28 C15,8 30,36 50,18 S80,4 105,22"/><path d="M-5,12 C20,32 40,6 60,26 S90,34 105,10"/><circle cx="22" cy="20" r="3.5"/><circle cx="50" cy="18" r="3.5"/><circle cx="78" cy="14" r="3.5"/></svg>`;
const SWIRL_SVG = `<svg class="nb-swirl" viewBox="0 0 40 40"><path d="M20 20 m0 -2 a2 2 0 1 1 -2 2 a4 4 0 1 1 4 4 a6 6 0 1 1 -6 -6 a8 8 0 1 1 8 8 a10 10 0 1 1 -10 -10 a12 12 0 1 1 12 12"/></svg>`;
const ailParticles = (st) => AILMENT_FX.filter((k) => st.has(k)).map((k) => `<span class="nb-ailfx fx-${k}" data-k="${k}">${"<i></i>".repeat(AILMENT_FX_PARTS[k] ?? 0)}</span>`).join("");
// 주위로 퍼지는 입자(독 거품처럼): 마비=튀는 불꽃, 공포=피어오르는 푸른 혼, 저주=검붉은 연기 덩어리. 카드·그림 밖으로 넘친다
const AURA = ["paralyze", "fear", "curse"];
const ailAura = (st) => [...AURA.filter((k) => st.has(k)), ...(st.special ? ["special"] : []), ...(st.overheat ? ["overheat"] : [])].map((k) => `<span class="nb-aura aura-${k}" data-k="${k}">${Array.from({ length: 7 }, (_, i) => `<i style="--x:${[-4, 12, 30, 50, 68, 86, 102][i]}%;--d:${(i * 0.37) % 1.6}s"></i>`).join("")}</span>`).join("");
const ailIcons = (st) => {
  const icons = st.conds.filter((x) => AILMENT_ICON[x.id]).map((x) => `<i class="fas ${AILMENT_ICON[x.id]} ail-${x.id}"></i>`).join("");
  return icons ? `<span class="nb-ail-icons">${icons}</span>` : "";
};
const bdBadges = (st) => (st.nBuff || st.nDebuff ? `<span class="nb-bd-badges">${st.nBuff ? `<b class="up"><i class="fas fa-caret-up"></i>${st.nBuff}</b>` : ""}${st.nDebuff ? `<b class="down"><i class="fas fa-caret-down"></i>${st.nDebuff}</b>` : ""}</span>` : "");

/** 특수 상태별 색·문양: 상단=불꽃(진홍), 청안=눈(청록), 발도=칼바람(은백), 나찰=해골(검붉음), 피에 물든 창=핏방울. 그 밖은 청록 태극 */
const STATE_THEME = {
  "bushido.jodan": { cls: "jodan", icon: "fa-fire-alt" },
  "bushido.seigan": { cls: "seigan", icon: "fa-eye" },
  "bushido.iai": { cls: "iai", icon: "fa-wind" },
  "mononofu.rakshasa": { cls: "rakshasa", icon: "fa-skull" },
  "shogun.bloodspear": { cls: "bloodspear", icon: "fa-tint" }
};
const themeOf = (st) => STATE_THEME[st.specialKey] ?? { cls: "generic", icon: "fa-yin-yang" };

/**
 * 카드(그림)에 거는 연출을 순서대로 하나씩 점멸(사용자 요청). 항목 = { key, cls }
 * 상태 이상 하나씩 → 방어 → 대기 → 특수 상태 → 오버히트. 봉인 덩굴(카드를 덮음, 사용자 결정)·석화·강화/약화 테두리·아이콘은 늘 보인다
 * 카드엔 늘 보이는 classes + data-cyc="key:cls|key:cls", 각 연출 요소엔 data-k. 바꾸는 것은 runCycle
 */
const CYCLE_AILMENTS = ["poison", "paralyze", "sleep", "fear", "blind", "curse", "stun", "confuse"];
function cycleEntries(st) {
  return [
    ...CYCLE_AILMENTS.filter((k) => st.has(k)).map((k) => ({ key: k, cls: `ail-${k}` })),
    ...(st.guard ? [{ key: "guard", cls: "st-guard" }] : []),
    ...(st.waiting ? [{ key: "wait", cls: "st-wait" }] : []),
    ...(st.special ? [{ key: "special", cls: `st-special sp-${themeOf(st).cls}` }] : []),
    ...(st.overheat ? [{ key: "overheat", cls: "st-overheat" }] : [])
  ];
}
/** 늘 보이는 classes(석화) + 점멸 목록 속성 */
export function cycleAttrs(c) {
  const st = persistState(c);
  const list = cycleEntries(st);
  return { cls: [st.has("petrify") ? "ail-petrify" : "", ...st.binds.map((k) => `ail-${k}`)].join(" "), attr: list.length ? `data-cyc="${list.map((e) => `${e.key}:${e.cls}`).join("|")}"` : "" };
}
/** 아군 카드 뒤 레이어(글자 뒤): 색·입자 / 앞 레이어: 덩굴·방패·모래시계 */
export function cardFx(c) {
  const st = persistState(c);
  const back = ailParticles(st) + (st.special ? `<span class="nb-specialfx" data-k="special"><i class="fas ${themeOf(st).icon}"></i></span>` : "") + (st.overheat ? `<span class="nb-heatfx" data-k="overheat"></span>` : "");
  // 봉인 덩굴: 머리=위 가장자리, 다리=아래 가장자리, 팔=양옆 세로(글자를 가리지 않게)
  // 봉인 덩굴: 카드를 셋으로 나눠 머리(왼쪽·얼굴)·팔(가운데)·다리(오른쪽)를 사선으로 감는다
  const vineD = (k) => `<svg class="nb-cardbind part-${k}" viewBox="0 0 100 100" preserveAspectRatio="none"><path class="v1" d="M-8,112 C20,80 30,70 50,50 S80,18 108,-12"/><path class="v2" d="M-8,82 C14,66 22,48 40,36 S62,6 80,-12"/><path class="v2" d="M20,112 C38,94 52,82 64,66 S90,40 108,18"/><circle cx="30" cy="68" r="4"/><circle cx="50" cy="50" r="4"/><circle cx="72" cy="30" r="4"/></svg>`;
  const front = st.binds.map(vineD).join("")
    + (st.guard ? `<i class="nb-card-shield fas fa-shield-alt" data-k="guard"></i>` : "")
    + (st.waiting ? `<i class="nb-card-wait fas fa-hourglass-half" data-k="wait"></i>` : "");
  const aura = ailAura(st);
  return `<div class="nb-cardfx">${back}</div>${aura ? `<div class="nb-cardaura">${aura}</div>` : ""}${front ? `<div class="nb-cardfx-front">${front}</div>` : ""}`;
}
/** 아군 얼굴 칸: 아이콘·혼란 소용돌이·석화·강화/약화 배지만 */
export function portraitOverlay(c) {
  const st = persistState(c);
  return (st.has("confuse") ? SWIRL_SVG.replace("<svg ", '<svg data-k="confuse" ') : "") + ailIcons(st) + bdBadges(st) + (st.has("petrify") ? `<span class="nb-stone"></span>` : "");
}

/** 에너미 그림 위(그림이 실제로 그려진 곳에 맞춘 상자 .nb-fxbox, fitFxBoxes) */
export function persistOverlay(c) {
  const a = c.actor;
  const conds = a?.system.conditions ?? [];
  const has = (id) => conds.some((x) => x.id === id);
  // 방어(guarding)=반투명 방패·푸른 막, 대기 상태(stances·후발·지연)=도는 금빛 점선 고리 + 모래시계
  const guard = !!c.getFlag("nssq", "guarding");
  const waiting = (c.getFlag("nssq", "stances") ?? []).length > 0 || !!c.getFlag("nssq", "late") || !!c.getFlag("nssq", "delayed");
  // 봉인: 머리=위, 팔=가운데, 다리=아래에 덩굴
  const binds = ["bindHead", "bindArm", "bindLeg"].filter((k) => has(k));
  const buffs = a?.system.buffs ?? [];
  const nBuff = buffs.filter((b) => BUFFS[b.id]?.kind !== "debuff").length;
  const nDebuff = buffs.length - nBuff;
  const icons = conds.filter((x) => AILMENT_ICON[x.id]).map((x) => `<i class="fas ${AILMENT_ICON[x.id]} ail-${x.id}"></i>`).join("");
  return `${guard ? `<span class="nb-guard-wall" data-k="guard"></span><i class="nb-guard-fx fas fa-shield-alt" data-k="guard"></i>` : ""}`
    + (waiting ? `<span class="nb-wait-fx" data-k="wait"><i class="fas fa-hourglass-half"></i></span>` : "")
    + binds.map((k) => VINE_SVG(`nb-vine part-${k}`)).join("")
    + (nBuff || nDebuff ? `<span class="nb-bd-badges">${nBuff ? `<b class="up"><i class="fas fa-caret-up"></i>${nBuff}</b>` : ""}${nDebuff ? `<b class="down"><i class="fas fa-caret-down"></i>${nDebuff}</b>` : ""}</span>` : "")
    + (has("confuse") ? `<svg class="nb-swirl" data-k="confuse" viewBox="0 0 40 40"><path d="M20 20 m0 -2 a2 2 0 1 1 -2 2 a4 4 0 1 1 4 4 a6 6 0 1 1 -6 -6 a8 8 0 1 1 8 8 a10 10 0 1 1 -10 -10 a12 12 0 1 1 12 12"/></svg>` : "")
    + ailParticles(persistState(c))
    + ailAura(persistState(c))
    + (persistState(c).special ? `<span class="nb-special-ring" data-k="special"></span>` : "")
    + (icons ? `<span class="nb-ail-icons">${icons}</span>` : "")
    + (has("petrify") ? `<span class="nb-stone"></span>` : "");
}
