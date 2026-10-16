/**
 * 추가 컨텐츠 「○○의 책」(01 #168, 사용자 결정): 퀘스트·탐색 보상용 유니크 도구. 상점에서 팔지 않는다
 * - 소지품에서 [활성화](동시에 하나만, 전투 중에는 바꿀 수 없다). 액터 플래그 nssq.activeBook = 아이템 id
 * - 활성화 중에는 [통상 공격]이 책 공격으로 바뀐다: 대미지 없이, 거리와 관계없이 적 1체에게
 *   목표값 【억제 공격】 + 4 + R의 억제 방어 롤, 실패하면 그 상태 이상·봉인(심도 = 목표값). [독] 대미지는 원문대로 사용자의 【억제 공격】
 * - 추격·반격(통상 공격 취급)은 그대로 무기 공격
 */
const L = (k, d) => (d ? game.i18n.format(`NSSQ.Book.${k}`, d) : game.i18n.localize(`NSSQ.Book.${k}`));

/** 책 효과(effects type "book") */
export const bookOf = (item) => (item?.type === "tool" ? (item.system.effects ?? []).find((e) => e?.type === "book") ?? null : null);

/** 활성화한 책(창고에 넣었거나 지웠으면 없음) */
export function activeBook(actor) {
  const id = actor?.getFlag?.("nssq", "activeBook");
  const item = id ? actor.items.get(id) : null;
  return item && bookOf(item) && !item.system.stored ? item : null;
}

const inCombat = (actor) => !!game.combat?.started && game.combat.combatants.some((c) => c.actor?.uuid === actor.uuid);

/** [활성화]·[끄기]. 다른 책이 켜져 있으면 그것은 꺼진다 */
export async function toggleBook(actor, item) {
  if (!bookOf(item)) return null;
  if (inCombat(actor)) return ui.notifications.warn(L("noCombat"));
  if (actor.getFlag("nssq", "activeBook") === item.id) return actor.unsetFlag("nssq", "activeBook");
  return actor.setFlag("nssq", "activeBook", item.id);
}

/** 책 공격의 효과(목표값 식은 03 inflict check fixed) */
export const bookEffects = (book) => [
  { type: "target", side: "enemy", scope: "single" },
  { type: "inflict", condition: bookOf(book).condition, check: { type: "fixed", target: "@self.suppAtk + 4 + R" } }
];

/**
 * 통상 공격 대신 책 공격(attack.mjs normalAttack). 메인 페이즈 자기 차례만(GM은 확인 후 강행)
 * @param {Actor} attacker
 * @param {Item} book
 * @param {TokenDocument} targetToken
 */
export async function bookAttack(attacker, book, targetToken) {
  const combat = game.combat;
  const me = combat?.combatants.find((c) => c.actor === attacker) ?? null;
  const tc = combat?.combatants.find((c) => c.token?.id === targetToken.id || c.actor === targetToken.actor) ?? null;
  if (combat?.started && me) {
    const myTurn = combat.getFlag("nssq", "phase") === "main" && combat.combatant?.id === me.id;
    if (!myTurn) {
      if (!game.user.isGM) return ui.notifications.warn(L("notTurn"));
      if (!(await Dialog.confirm({ title: book.name, content: `<p>${L("notTurn")}</p>`, rejectClose: false }))) return null;
    }
  }
  const { resolveAndPost } = await import("./skill-use.mjs");
  const { conditionName } = await import("./status.mjs");
  // 카드 해설은 책 해설 전체 대신 한 줄
  const desc = L("cardDesc", { condition: conditionName(bookOf(book).condition), rank: book.system.rank ?? 0 });
  return resolveAndPost({
    actor: attacker, combatant: me, kind: "item", mainAction: false,
    item: { name: book.name, img: book.img, system: { effects: bookEffects(book), sl: 1, rank: book.system.rank ?? 0, category: "", target: "적 단일", description: `<p>${desc}</p>` } },
    units: [{ actor: targetToken.actor, combatant: tc }]
  });
}
