/**
 * effects 해석기 (03 §3·§6). Foundry 비의존 순수 함수(주사위는 주입).
 * 스킬·아이템 1회 사용의 effects를 대상별 결과로 바꾼다. 실제 적용(HP·상태·강화)은 호출자가 한다.
 *
 * 전투원 모양(profile): { id, name, side, row, hp, hpMax, tp, tpMax, physHit, elemHit, evasion, physAtk, elemAtk,
 *   defense, suppAtk, suppDef, resist, resistAwake?, elements, critUp, guarding, conditions, buffs, skills, weaponType, dualWield, acted }
 */
import { evaluate } from "../expr.mjs";
import { fpFromHitChecks, resolveAttack } from "../combat.mjs";
import { CONDITIONS, contestInflict, forcedInflict, resistCheck } from "../conditions.mjs";
import { BUFFS, canonicalBuff, paramElements } from "../buffs.mjs";
import { whenMatches } from "./when.mjs";
import { sumAttackBonuses } from "./passives.mjs";
import { activationRoll } from "./usage.mjs";

/** 단계 8(트리거계)에서 처리하는 타입: 지금은 기록만 하고 GM 판단 */
export const DEFERRED_TYPES = ["delayed", "counter", "chase", "trigger", "token", "guard", "aura", "provoke"];
/** 사용할 때 해석하지 않는 상시 타입(passives.mjs) */
export const PASSIVE_TYPES = ["modifier", "flag", "requireState", "requireSelf", "attackBonus", "useBonus", "target", "immune", "requireAllies", "multiUse", "redirectAlly", "anytime", "dualWield", "dualSkill", "wideEvade", "guardLateAttack", "timePenalty", "dropAdjust", "dropDoubleUp", "dropExtra", "gatherAdjust", "gatherDoubleUp", "gatherDoubleExtra", "gatherExtra", "preemptBlock", "escapeDungeon", "checkBonus", "checkAssist", "checkFlip", "checkExtraDie", "rerollBonus", "sessionFp"];

/** 대상 프로필에서 그 강화의 몫을 뺀 사본. list: "defenseUp"(수치 강화) / "resistUp:pierce"(그 속성 내성 +1) */
function ignoreBuffs(t, list) {
  if (!list?.length || !t?.buffs?.length) return t;
  const out = { ...t, resist: { ...(t.resist ?? {}) }, ...(t.resistAwake ? { resistAwake: { ...t.resistAwake } } : {}) };
  for (const b of t.buffs) {
    const id = canonicalBuff(b.id);
    for (const ig of list) {
      const [bid, el] = String(ig).split(":");
      if (bid !== id) continue;
      if (el) {
        if (!paramElements(b.param).includes(el)) continue;
        out.resist[el] = (out.resist[el] ?? 0) - 1;
        if (out.resistAwake) out.resistAwake[el] = (out.resistAwake[el] ?? 0) - 1;
      } else for (const k of BUFFS[id]?.stats ?? []) if (typeof out[k] === "number") out[k] -= Number(b.value) || 0;
    }
  }
  return out;
}

/** custom 핸들러 등록부: name → (ctx) => 결과 조각 */
const CUSTOM = new Map();
export const registerCustom = (name, fn) => CUSTOM.set(name, fn);

const blank = (t) => ({ id: t.id, name: t.name, hits: [], damage: 0, heal: { hp: 0, tp: 0 }, inflicts: [], buffs: [], cures: [], resource: [], states: [], sleepBroken: false, revive: false, actionTiming: null, stances: [] });

/** 선언 명칭(variants)을 고른 effects: variant가 없는 효과 + 고른 번호의 효과 */
export const variantEffects = (effects, variant = null) => (effects ?? []).filter((e) => e?.variant === undefined || e.variant === variant);
/** 이 effects에 선언 명칭별 효과가 있는가 */
export const hasVariants = (effects) => (effects ?? []).some((e) => e?.variant !== undefined);

/** 효과가 명중 판정을 하는가(하면 따로 발동 판정을 하지 않는다, 01 §3.4) */
export const hasHitCheck = (effects) => (effects ?? []).some((e) => e.type === "attack");

/**
 * @param {object} p
 * @param {object[]} p.effects
 * @param {number} [p.sl]
 * @param {object} p.user 사용자 프로필
 * @param {object[]} p.targets 대상 프로필(자신이면 [user])
 * @param {object[]} [p.pool] 무작위 대상 후보(사거리 안의 적)
 * @param {boolean} [p.mainAction] 「주행동」인가(발동 판정)
 * @param {(n: number) => number[]|Promise<number[]>} p.rollDice n개의 D6
 * @param {() => number} [p.rng] 0 이상 1 미만(무작위 대상)
 * @param {object} [p.ctx] when 조건용 { timeOfDay, allies }
 * @param {number|null} [p.variant] 선언 명칭 번호(《삼색 세이버》 등). variant가 붙은 효과는 이 번호만
 * @param {string} [p.category] 스킬 분류(『회복』이면 회복 롤에 사용자의 healDice를 더한다)
 * @param {"skill"|"item"} [p.source] 아이템이면 사용자의 itemHeal(《이피션트》)·itemRevive(《간이 소생》)
 */
export async function resolveEffects({ effects, sl = 1, user, targets = [], pool = [], mainAction = false, rollDice, rng = Math.random, ctx = {}, variant = null, category = "", source = "skill" }) {
  effects = variantEffects(effects, variant);
  const out = { activation: null, fpGain: 0, failed: false, results: new Map(), gm: [], deferred: [], overheat: 0, overheatReduce: 0 };
  const res = (t) => {
    if (!out.results.has(t.id)) out.results.set(t.id, blank(t));
    return out.results.get(t.id);
  };
  const vars = (target, extra = {}) => ({ SL: sl, self: user, target, ...extra });
  const d6 = async () => (await rollDice(1))[0];

  // 발동 판정: 명중 판정이 없는 「주행동」 스킬(회복 롤 포함, 01 §3.4·3.6)
  if (mainAction && !hasHitCheck(effects)) {
    const a = activationRoll(await rollDice(2));
    out.activation = { ok: a.ok, dice: a.check.used, fpGain: a.fpGain };
    out.fpGain = a.fpGain;
    if (!a.ok) { out.failed = true; return out; }
  }

  const hitChecks = [];
  let seq = 0;
  const run = async (list, tgt) => {
    for (const e of list ?? []) {
      if (!e?.type || PASSIVE_TYPES.includes(e.type)) continue;
      if (DEFERRED_TYPES.includes(e.type)) { out.deferred.push(e); out.gm.push(e.type); continue; }
      // toSelf: 대상과 관계없이 사용자 자신에게 한 번(《임팩트 애로》 사용 후 자신 [마비])
      for (const t of e.toSelf ? [user] : tgt) {
        if (!whenMatches(e.when, { ...ctx, self: user, target: t })) {
          // whenNote: 조건이 안 맞으면 카드에 「효과 없음」(《명하노니》 [공포] 행동 불능이 아닌 대상 등)
          if (e.whenNote) res(t).resource.push({ noEffect: true });
          continue;
        }
        // 확률 발동(「1D6 ≤ SL이면」 등)
        if (e.chance) {
          const sides = Number(String(e.chance.roll ?? "1d6").split("d")[1]) || 6;
          const die = sides === 6 ? await d6() : Math.floor(rng() * sides) + 1;
          if (die > evaluate(e.chance.lte ?? 0, vars(t))) { res(t).resource.push({ chanceFailed: true, die, label: e.label ?? e.type }); continue; }
        }
        await apply(e, t);
      }
    }
  };

  // 대기 상태는 사용자에게 한 번(대상이 여럿이어도). holder: "target"이면 대상마다(《노부시의 진형》)
  let stanceDone = false;
  // onHit 처리 중인 명중(흡수 drain이 대미지·주사위를 본다)
  let lastHit = null;
  const attackOnce = async (e, t) => {
    const kind = e.kind ?? "physical";
    // element: 그 속성으로 / addElement: 무기 속성에 더한다(「〈염〉 속성을 부가한」)
    let elements = e.element ? [].concat(e.element)
      : e.addElement ? [...new Set([...(user.elements ?? []).filter((x) => x !== "none"), ...[].concat(e.addElement)])] : user.elements;
    // 상시 스킬의 공격 보정(《선봉의 공명》 등)
    const pb = sumAttackBonuses(user.attackBonuses, { ...ctx, category, self: user, target: t, attack: { kind, elements } });
    // 「그 턴 이미 〈염〉〈빙〉〈뇌〉 공격이 있었으면 그 속성 부가」(《스피어 인볼브》, ctx.turnElements)
    const turnEls = (ctx.turnElements ?? []).filter((x) => [].concat(e.addTurnElements ?? []).includes(x));
    if (turnEls.length) elements = [...new Set([...(elements ?? []).filter((x) => x !== "none"), ...turnEls])];
    // 이번 턴 효과의 속성 부가(《링크 이펙트》)
    if (pb.addElement.length) elements = [...new Set([...(elements ?? []).filter((x) => x !== "none"), ...pb.addElement])];
    let hitMod = evaluate(e.hitMod ?? 0, vars(t)) + pb.hitMod;
    let diceMod = evaluate(e.diceMod ?? 0, vars(t)) + pb.diceMod;
    let atkPlus = 0;
    for (const b of e.bonuses ?? []) {
      if (!whenMatches(b.when, { ...ctx, self: user, target: t, attack: { kind, elements } })) continue;
      hitMod += evaluate(b.hitMod ?? 0, vars(t));
      diceMod += evaluate(b.diceMod ?? 0, vars(t));
      atkPlus += evaluate(b.atkMod ?? 0, vars(t));
      // 조건부 속성 변경(《음양검: 영공대참》 「상태 이상 중이면 무속성」)
      if (b.element) elements = [].concat(b.element);
    }
    const r = res(t);
    // 대상의 강화 무시(《실버 애로》 「『물리 방어 상승』·『내성 상승: 돌』 무시」): "defenseUp" / "resistUp:pierce"
    const tt = ignoreBuffs(t, e.ignoreBuffs);
    // [수면]은 명중한 공격의 처리 뒤 풀린다: 같은 행동의 다음 회차는 깬 상태의 내성(07 #37)
    const resist = r.sleepBroken && tt.resistAwake ? tt.resistAwake : tt.resist;
    const result = await resolveAttack({
      attacker: { hit: kind === "physical" ? user.physHit : user.elemHit, physAtk: user.physAtk, elemAtk: user.elemAtk, elements, critUp: user.critUp },
      target: { evasion: t.evasion, defense: tt.defense, resist, guarding: t.guarding, guardHalf: t.guardHalf },
      kind, hitMod, diceMod,
      atkMod: evaluate(e.atkMod ?? 0, vars(t)) + pb.atkMod + atkPlus, failAtOrBelow: Math.max(Number(e.failAtOrBelow ?? 0) || 0, pb.failAtOrBelow), resistMod: pb.resistMod, resistLow: pb.resistLow, critUp: pb.critUp, critDiceMod: pb.critDice, atkMultiplier: Number(e.atkMultiplier ?? 1) || 1, halfDamage: !!e.halfDamage,
      diceOverride: e.fixedDice !== undefined ? evaluate(e.fixedDice, vars(t)) : null,
      rollDice
    });
    hitChecks.push(result);
    // seq: 이 행동 안에서 몇 번째 공격인가(다회 공격을 카드에 순서대로 보인다)
    const hitRow = { ...result, elements, kind, seq: ++seq };
    r.hits.push(hitRow);
    if (result.hit) {
      r.damage += result.finalDamage ?? 0;
      if (!r.sleepBroken && (t.conditions ?? []).some((c) => c.id === "sleep")) { r.sleepBroken = true; hitRow.woke = true; }
      // 앞 회차에서 건 [수면]도 다음 명중으로 풀린다(07 #37)
      const slept = r.inflicts.find((x) => x.id === "sleep" && !x.resisted && !x.broken);
      if (slept) { slept.broken = hitRow.seq; hitRow.woke = true; }
      if (e.onHit?.length) {
        lastHit = result;
        // 이 명중으로 생긴 부여·강화에 회차를 붙인다
        const n0 = r.inflicts.length;
        const b0 = r.buffs.length;
        const c0 = r.resource.length;
        await run(e.onHit, [t]);
        for (const x of r.resource.slice(c0)) x.seq = hitRow.seq;
        for (const x of r.inflicts.slice(n0)) x.seq = hitRow.seq;
        for (const x of r.buffs.slice(b0)) x.seq = hitRow.seq;
      }
    }
  };

  const apply = async (e, t) => {
    const r = res(t);
    switch (e.type) {
      case "attack": {
        const times = Math.max(1, evaluate(e.times ?? 1, vars(t)));
        if (e.random) return; // 무작위 대상은 아래에서 한 번만 처리
        for (let i = 0; i < times; i++) await attackOnce(e, t);
        return;
      }
      case "heal": {
        const res0 = e.resource ?? "hp";
        // [전투 불능]인 대상은 revive 효과만 회복한다(《초의술》 「전투 불능에서도 부활」, 《리저렉션》)
        const revive = e.revive || (source === "item" && res0 === "hp" && !!user.itemRevive);
        if (t.ko && res0 === "hp" && !revive) return;
        if (t.ko && revive) r.revive = true;
        const max = res0 === "tp" ? t.tpMax ?? 0 : t.hpMax ?? 0;
        const cur = Math.max(0, res0 === "tp" ? t.tp ?? 0 : t.hp ?? 0);
        let amount = 0;
        let dice = [];
        if ((e.mode ?? "roll") === "roll") {
          // 『회복』 분류 스킬이면 회복 마스터리 등의 회복량 다이스 보정(healDice)
          const mastery = category === "회복" ? user.healDice ?? 0 : 0;
          const n = Math.max(0, (user.elemAtk ?? 0) + evaluate(e.bonus ?? 0, vars(t)) + mastery);
          dice = n ? await rollDice(n) : [];
          // 《집중 치료》: 그 턴 회복 롤은 3 이상을 센다(user.healThreshold)
          amount = dice.filter((v) => v >= (user.healThreshold ?? 4)).length;
        } else if (e.mode === "fixed") amount = evaluate(e.amount ?? 0, vars(t));
        else if (e.mode === "full") amount = max - cur;
        else if (e.mode === "percent") amount = Math.floor((max * evaluate(e.amount ?? 0, vars(t))) / 100);
        // 아이템의 회복 효과 +(《이피션트》)
        if (source === "item" && amount > 0) amount += user.itemHeal ?? 0;
        r.heal[res0] += Math.max(0, amount);
        r.resource.push({ heal: res0, amount: Math.max(0, amount), dice });
        return;
      }
      case "inflict": {
        const ck = e.check ?? null;
        // condition이 목록이면: choose(고른 부위 SL곳, 《스티그마》) 또는 randomPick(무작위 1개, 《신기한 씨앗》). 판정은 한 번
        let ids = [].concat(e.condition);
        if (ids.length > 1 && e.choose !== undefined) {
          const n = Math.max(1, evaluate(e.choose, vars(t)));
          ids = (ctx.choices?.length ? ids.filter((id) => ctx.choices.includes(id)) : ids).slice(0, n);
        } else if (ids.length > 1 && e.randomPick) ids = [ids[Math.min(ids.length - 1, Math.floor(rng() * ids.length))]];
        // 완전 내성(「완전 내성: 독」)은 판정 없이 막는다
        const immune = ids.filter((id) => (t.immune ?? []).includes(id) && ck?.type !== "forced");
        for (const id of immune) r.inflicts.push({ id, depth: null, resisted: true, immune: true });
        ids = ids.filter((id) => !immune.includes(id));
        if (!ids.length) return;
        // 상태 이상별 억제 방어 보정(「내성/약점: ○○」 ±n). 여러 개를 한 번에 판정하면 첫 번째 것
        const cr = t.condResist?.[ids[0]] ?? 0;
        if (!ck) { for (const id of ids) r.inflicts.push({ id, depth: evaluate(e.depth ?? 0, vars(t)), resisted: false }); return; }
        let row;
        if (ck.type === "forced") {
          const c = forcedInflict({ atkDice: await rollDice(2), suppAtk: user.suppAtk ?? 0 });
          row = { depth: c.depth, resisted: false, forced: { atk: c.atk } };
        } else if (ck.type === "contest") {
          // atkMod: 「대항 판정(자신 +(SL))」 공격 쪽 보정
          const c = contestInflict({ atkDice: await rollDice(2), suppAtk: (user.suppAtk ?? 0) + evaluate(ck.atkMod ?? 0, vars(t)), defDice: await rollDice(2), suppDef: (t.suppDef ?? 0) + cr });
          row = { depth: c.depth, resisted: c.resisted, contest: { atk: c.atk, def: c.def } };
        } else {
          const target = evaluate(ck.target, vars(t));
          const c = resistCheck({ dice: await rollDice(2), suppDef: (t.suppDef ?? 0) + cr + evaluate(ck.defMod ?? 0, vars(t)), target });
          row = { depth: c.depth, resisted: c.resisted, fixed: { target, check: c.check } };
        }
        // 판정 줄은 첫 번째에만
        ids.forEach((id, i) => r.inflicts.push(i === 0 ? { id, ...row } : { id, depth: row.depth, resisted: row.resisted }));
        // 《스티그마》: 성공하면 자신도 같은 부위를, 심도는 자신의 달성값(selfSame: "atk")
        if (e.selfSame === "atk" && !row.resisted && row.contest) {
          for (const id of ids) res(user).inflicts.push({ id, depth: row.contest.atk.total, resisted: false, self: true });
        }
        return;
      }
      case "forceRow": {
        // 강제 이동(산고래 《떠올리기》): 목표값 억제 방어 롤에 실패하면 그 열로. 적용할 때 옮긴다
        const target = evaluate(e.check?.target ?? 0, vars(t));
        const c = e.check ? resistCheck({ dice: await rollDice(2), suppDef: t.suppDef ?? 0, target }) : { resisted: false };
        r.resource.push({ forceRow: e.row ?? "back", resisted: c.resisted, ...(e.check ? { fixed: { target, check: c.check } } : {}) });
        return;
      }
      case "command": {
        // 《명하노니》: [공포]로 행동 불능인 대상에게(when targetDisabled). 적용할 때 실행(combat/skill-use.mjs)
        r.command = e.mode;
        return;
      }
      case "spreadAilment": {
        if (e.from === "self") {
          // 《전화위복》: 자신의 상태 이상을 최대 count개 대상에게(판정 없이 같은 심도)
          const mine = (user.conditions ?? []).filter((c) => CONDITIONS[c.id]?.kind === "ailment").slice(0, Math.max(1, evaluate(e.count ?? 1, vars(t))));
          for (const c of mine) r.inflicts.push({ id: c.id, depth: c.depth ?? null, resisted: false });
          return;
        }
        // 《인법: 수경》: 대결에서 이기면 대상의 상태 이상을 같은 열의 다른 적에게(같은 심도, 대상은 그대로, 07)
        const c = contestInflict({ atkDice: await rollDice(2), suppAtk: (user.suppAtk ?? 0) + evaluate(e.check?.atkMod ?? 0, vars(t)), defDice: await rollDice(2), suppDef: t.suppDef ?? 0 });
        const mine = (t.conditions ?? []).filter((x) => CONDITIONS[x.id]?.kind === "ailment");
        r.resource.push({ spread: { won: !c.resisted, atk: c.atk, def: c.def, ids: mine.map((x) => x.id) } });
        if (c.resisted) return;
        for (const p of pool.filter((x) => x.id !== t.id && !x.ko && (x.row ?? "front") === (t.row ?? "front"))) {
          for (const x of mine) res(p).inflicts.push({ id: x.id, depth: x.depth ?? null, resisted: false });
        }
        return;
      }
      case "emitImbue": {
        // 《이밋 웨펀》: 대상의 『속성 부여』를 해제하고 그 속성으로 적 전체 공격(호출자가 공격)
        const b = (t.buffs ?? []).find((x) => canonicalBuff(x.id) === "elemImbue");
        if (!b) { r.resource.push({ noEffect: true }); return; }
        r.cures.push({ conditions: "all", kind: "buff", buffs: ["elemImbue"] });
        out.emit = { element: b.param, kind: e.kind ?? "elemental" };
        return;
      }
      case "recoil": {
        // 반동: 이 행동에서 지금까지 굴린 대미지 다이스의 '1' 개수만큼 대미지(toSelf와 함께, 《싱글 스러스트》)
        let ones = 0;
        for (const x of out.results.values()) for (const h of x.hits) ones += [...(h.damage?.dice ?? []), ...(h.critExtra?.dice ?? [])].filter((d) => d === 1).length;
        // to: "allies": 자신 외의 아군 전원(《레기온 스러스트》·《게 볼그》), 호출자가 아군에게
        if (e.to === "allies") { if (ones) out.allyRecoil = (out.allyRecoil ?? 0) + ones; return; }
        if (ones) { r.damage += ones; r.resource.push({ recoil: ones }); }
        return;
      }
      case "healFromDamage": {
        // 《블랙 사바스》: 대미지를 준 다이스 수(대상 모두의 합, 가드 등 반감 후 — 07 #118 사용자 결정)만큼 아군 전체 【HP】 회복. 호출자가 아군에게
        let n = 0;
        for (const x of out.results.values()) for (const h of x.hits) if (h.hit) n += h.finalDamage ?? h.rawDamage ?? 0;
        if (n) out.allyHeal = (out.allyHeal ?? 0) + n;
        return;
      }
      case "nextTurn":
        // 「다음 턴에 ○○하면」(《차지 에지》): 다음 라운드에만 쓰는 「그 턴 동안」 효과. 호출자가 전투원 플래그 nextTurn으로
        res(user).nextTurn = { effects: e.effects ?? [], sl };
        return;
      case "stance": {
        // 대기 상태(단계 8): 저장해 두고 공격 이벤트 때 반격·추격·가드로 쓴다(combat/stance.mjs)
        const toTarget = e.holder === "target";
        if (!toTarget && stanceDone) return;
        if (!toTarget) stanceDone = true;
        // 《방패 마스터리》: 『방어』 스킬 대기 상태의 횟수 +
        const plus = category === "방어" ? user.guardCount ?? 0 : 0;
        const left = e.until === "count" ? Math.max(1, evaluate(e.count ?? 1, vars(t)) + plus) : null;
        // wait: false → 「그 턴 동안」 효과(《도발》·《캐슬링》): 저장만 하고 메인 행동은 그대로
        (toTarget ? r : res(user)).stances.push({ effects: e.effects ?? [], until: e.until ?? "endOfTurn", left, sl, waiting: !toTarget && e.wait !== false, guardTargets: targets.map((x) => x.id) });
        return;
      }
      case "drain": {
        // 흡수: 이 명중의 결과로 자신을 회복(《음양검: 영흡명참》 대미지 절반 → HP, 《영흡심참》 6의 개수 → TP)
        if (!lastHit) return;
        const resource = e.resource ?? "hp";
        const amount = e.mode === "sixes"
          ? [...(lastHit.damage?.dice ?? []), ...(lastHit.critExtra?.dice ?? [])].filter((d) => d === 6).length
          : Math.floor((lastHit.finalDamage ?? 0) / (e.mode === "quarter" ? 4 : 2));
        const me = res(user);
        me.heal[resource] += amount;
        me.resource.push({ heal: resource, amount, drain: true });
        return;
      }
      case "kill": {
        // 즉사: 고정 목표값 억제 방어 롤에 실패하면 【HP】 0(《일섬》 등). 카드에는 [즉사]로 표시
        if (e.check?.type === "contest") {
          // 대결 즉사(커스메이커 《죽음의 주언》)
          const c = contestInflict({ atkDice: await rollDice(2), suppAtk: (user.suppAtk ?? 0) + evaluate(e.check.atkMod ?? 0, vars(t)), defDice: await rollDice(2), suppDef: (t.suppDef ?? 0) + (t.condResist?.death ?? 0) });
          r.inflicts.push({ id: "death", depth: null, resisted: c.resisted, contest: { atk: c.atk, def: c.def } });
          return;
        }
        const target = evaluate(e.check?.target ?? 0, vars(t));
        // 「내성: 즉사」 condResist.death
        const c = resistCheck({ dice: await rollDice(2), suppDef: (t.suppDef ?? 0) + (t.condResist?.death ?? 0) + evaluate(e.check?.defMod ?? 0, vars(t)), target });
        r.inflicts.push({ id: "death", depth: null, resisted: c.resisted, fixed: { target, check: c.check } });
        return;
      }
      case "cure":
        r.cures.push({ conditions: e.conditions ?? "all", kind: e.kind ?? null, ...(e.count !== undefined ? { count: Math.max(0, evaluate(e.count, vars(t))) } : {}), ...(e.buffs ? { buffs: e.buffs.map(canonicalBuff) } : {}) });
        return;
      case "buff":
      case "debuff": {
        // 『추격: (자신)』·『추격: (스킬 사용자)』: 누구의 공격에 추격하는지 사용자 액터로 기록
        const param = e.id === "chase" && ["자신", "사용자", "self", "user"].includes(e.param) ? user.uuid ?? e.param : e.param;
        // 《무용 마스터리》 등: 이 스킬(분류)로 주는 강화의 지속 턴 +
        // 《주언 마스터리》: 약화 지속 턴 +(debuffTurns)
        const key = e.type === "buff" ? "buffTurns" : "debuffTurns";
        const plus = (user.useBonuses ?? []).filter((b) => whenMatches(b.when, { ...ctx, category, self: user, target: t })).reduce((n, b) => n + (b[key] ?? 0), 0);
        r.buffs.push({ id: canonicalBuff(e.id), value: evaluate(e.value ?? 0, vars(t)), turns: Math.max(1, evaluate(e.turns ?? 1, vars(t)) + plus), param: param ?? "" });
        return;
      }
      case "resource":
        r.resource.push({ resource: e.resource, delta: e.delta !== undefined ? evaluate(e.delta, vars(t)) : undefined, set: e.set !== undefined ? evaluate(e.set, vars(t)) : undefined });
        return;
      case "state": {
        // 전투 고유 상태(engine/states.mjs): 보정은 지금 SL로 계산해 둔다
        const mods = {};
        for (const m of e.mods ?? []) mods[m.path] = (mods[m.path] ?? 0) + evaluate(m.value ?? 0, vars(t));
        r.states.push({ id: e.id, name: e.label ?? "", group: e.group ?? "", mods, ...(e.max ? { max: evaluate(e.max, vars(t)) } : {}), note: e.note ?? "", ...(e.perAttack ? { perAttack: e.perAttack } : {}) });
        return;
      }
      case "lateRepeat":
        // 「명중했고 메인 페이즈 끝까지 대미지를 받지 않으면 후발로 한 번 더」(《딜레이 스탭》): onHit 안에서, 호출자가 예약
        res(user).lateRepeat = { target: t.id, diceMod: e.diceMod ?? 0 };
        return;
      case "focus":
        // 「그 턴, 대상 적 단일 스킬은 모두 이 대상」(에너미 워처 《타기팅》): 호출자가 전투 플래그로
        out.focus = t.id;
        return;
      case "rallyChase":
        // 「아군 최대 n명이 즉시 적 단일에게 추격」(《일제 사격》·《난룡의 진》): 호출자가 추격을 실행
        out.rally = { count: Math.max(1, evaluate(e.count ?? 1, vars(t))), weapons: e.weapons ?? null, target: t.id };
        return;
      case "tokenRemove":
        // 토큰 1개를 없앤다(《비스트 귀환》·《파진》): 사용자 결과에 기록, 호출자가 처리
        res(user).tokenRemove = e.category ?? "";
        return;
      case "extraAction":
        // 「그 턴, 주행동을 2회」(《인법: 분신》): 이번 턴 추가 주행동 수(전투원 플래그 extraAction, 호출자가 반영)
        r.extraAction = (r.extraAction ?? 0) + Math.max(1, evaluate(e.count ?? 1, vars(t)));
        return;
      case "grantLateAction":
        // 《끝없는 원무곡》: 대상이 후발 행동 취급으로 다시 행동(호출자가 전투 플래그로)
        r.bonusTurn = true;
        return;
      case "actionTiming":
        // 「최속/후발 행동」: 이번 턴 행동 순서(전투원 플래그 timing, 호출자가 반영)
        r.actionTiming = e.value === "last" ? "last" : "first";
        return;
      case "overheat":
        // 《제국 기사의 극의》 등 오버히트 턴 수 보정(상시 overheatTurns)
        out.overheat = Math.max(out.overheat, evaluate(e.turns ?? 0, vars(t)) + (user.overheatMod ?? 0), 0);
        return;
      case "overheatReduce":
        // 오버히트 단축(《샤프 에지》 등)
        out.overheatReduce += evaluate(e.turns ?? 0, vars(t));
        return;
      case "custom": {
        const fn = CUSTOM.get(e.handler);
        if (!fn) { out.gm.push(`custom:${e.handler}`); return; }
        await fn({ effect: e, user, target: t, result: r, sl, rollDice });
        return;
      }
      default:
        out.gm.push(e.type);
    }
  };

  // 무작위 다회 공격: 사거리 안의 적 중 같은 확률(01 §3.5), 「같은 에너미는 1번만」이면 중복은 없던 것으로
  for (const e of effects ?? []) {
    if (e?.type !== "attack" || !e.random) continue;
    const times = Math.max(1, evaluate(e.times ?? 1, vars(null)));
    const seen = new Set();
    for (let i = 0; i < times; i++) {
      // randomFrom: 그 열에서만 고른다(《밀리언 스러스트》 「적 전열 중 무작위」)
      const alive = pool.filter((p) => !p.ko && (!e.randomFrom || (p.row ?? "front") === e.randomFrom));
      if (!alive.length) break;
      const t = alive[Math.min(alive.length - 1, Math.floor(rng() * alive.length))];
      if (e.uniqueTarget && seen.has(t.id)) { res(t).hits.push({ skipped: true, seq: ++seq }); continue; }
      seen.add(t.id);
      await attackOnce(e, t);
    }
  }
  await run(effects, targets);
  // 《리인포스》 등: 이 분류의 스킬에 대상 HP 회복이 따라붙는다(useBonus healHp)
  const extraHeal = (user.useBonuses ?? []).filter((b) => b.healHp && whenMatches(b.when, { ...ctx, category, self: user })).reduce((n, b) => n + b.healHp, 0);
  if (extraHeal && !out.failed) {
    for (const t of targets) {
      if (t.ko) continue;
      const r = res(t);
      r.heal.hp += extraHeal;
      r.resource.push({ heal: "hp", amount: extraHeal });
    }
  }
  // 명중 판정의 1로 얻는 FP는 주행동 1회당 처음 판정 하나만(01 §3.5)
  if (hitChecks.length) out.fpGain = fpFromHitChecks(hitChecks);
  return out;
}

/**
 * 트리거 효과(on: crit / beforeKO / …) 중 이 사건에 해당하는 것을 해석한다. 연결은 단계 8
 * @returns {Promise<object[]>} 발동한 트리거의 결과 목록
 */
export async function resolveTriggers({ effects, on, sl = 1, user, rollDice, rng }) {
  const out = [];
  for (const e of effects ?? []) {
    if (e.type !== "trigger" || e.on !== on) continue;
    if (e.chance) {
      const die = (await rollDice(1))[0];
      if (die > evaluate(e.chance.lte ?? 0, { SL: sl, self: user })) { out.push({ trigger: e, ok: false, die }); continue; }
      const r = await resolveEffects({ effects: e.effects, sl, user, targets: [user], rollDice, rng });
      out.push({ trigger: e, ok: true, die, result: r });
    } else {
      out.push({ trigger: e, ok: true, result: await resolveEffects({ effects: e.effects, sl, user, targets: [user], rollDice, rng }) });
    }
  }
  return out;
}
