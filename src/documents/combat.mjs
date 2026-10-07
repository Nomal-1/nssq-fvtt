/**
 * NSSQ 전투(04 §5.3): 개막 → 메인 → 종료 페이즈.
 * - 이니셔티브는 굴리지 않는다: 【속도】(최속 +1000, 후발 −1000, 동률 PC → 아군 NPC → 에너미)
 * - 메인 페이즈만 Foundry의 턴을 쓰고, 전투 불능·대기 상태는 건너뛴다
 * - 개막·종료 페이즈에서 [다음]을 누르면 페이즈가 넘어간다
 * - 개막 페이즈 시작: [혼란]·[마비]·[공포] 1D6, 종료 페이즈 시작: 독·리젠·자연 회복·턴 감소(combat/turn-status.mjs)
 */
import { initiativeValue } from "../engine/combat.mjs";
import { combatProfile } from "../combat/profile.mjs";
import { openEndDialog } from "../apps/battle.mjs";
import { actionState, confirmEndPhaseApplied, openingRolls, runEndPhase } from "../combat/turn-status.mjs";
import { confirmOpeningDone, snapshotOpening } from "../combat/opening.mjs";

export class NssqCombat extends Combat {
  get phase() {
    return this.getFlag("nssq", "phase") ?? "opening";
  }

  /** 【속도】로 이니셔티브를 정한다(굴리지 않음) */
  async rollInitiative(ids) {
    ids = typeof ids === "string" ? [ids] : ids;
    const updates = ids.map((id) => this.combatants.get(id)).filter(Boolean).map((c) => ({
      _id: c.id,
      initiative: c.actor ? initiativeValue({
        speed: combatProfile(c.actor, c).speed,
        side: combatProfile(c.actor, c).side,
        timing: c.getFlag("nssq", "timing") ?? "normal"
      }) : 0
    }));
    if (updates.length) await this.updateEmbeddedDocuments("Combatant", updates);
    return this;
  }

  async refreshInitiative() {
    return this.rollInitiative(this.combatants.map((c) => c.id));
  }

  async startCombat() {
    await this.refreshInitiative();
    await this.clearRoundFlags();
    await super.startCombat();
    // 1턴은 개막 페이즈부터(메인 페이즈 전에는 차례 표시 없음)
    await this.setPhase("opening", { turn: null });
    return this;
  }

  /** 메인 페이즈에서 행동할 수 있는가: 전투 불능·대기 상태·행동 불가 상태 이상([석화]·[수면]·[스턴]·판정 실패)은 건너뜀 */
  canAct(combatant) {
    if (!combatant || combatant.defeated || combatant.isDefeated) return false;
    if (combatant.getFlag("nssq", "waiting")) return false;
    if (actionState(combatant).noAction) return false;
    return true;
  }

  firstActingTurn(from = 0) {
    for (let i = from; i < this.turns.length; i++) if (this.canAct(this.turns[i])) return i;
    return null;
  }

  /** 라운드마다 지워지는 전투원 표시(방어 전념·대기·개막 행동) */
  async clearRoundFlags() {
    const updates = this.combatants.map((c) => ({
      _id: c.id,
      "flags.nssq.-=guarding": null,
      "flags.nssq.-=waiting": null,
      "flags.nssq.-=opening": null,
      "flags.nssq.-=disabled": null,
      "flags.nssq.-=confused": null
    }));
    if (updates.length) await this.updateEmbeddedDocuments("Combatant", updates);
  }

  async setPhase(phase, extra = {}) {
    await this.update({ "flags.nssq.phase": phase, ...extra });
    await ChatMessage.create({
      speaker: { alias: game.i18n.localize("NSSQ.Combat.tracker") },
      content: `<div class="nssq-phase phase-${phase}"><i class="fas fa-hourglass-half"></i> ${game.i18n.format("NSSQ.Combat.phaseStart", { round: this.round, phase: game.i18n.localize(`NSSQ.Combat.phase.${phase}`) })}</div>`
    });
    // 상태 이상의 턴 처리(단계 5)
    if (phase === "opening") {
      await openingRolls(this);
      // 개막 행동 되돌리기용 기록(combat/opening.mjs)
      await snapshotOpening(this);
    }
    if (phase === "end") await runEndPhase(this);
  }

  async nextTurn() {
    if (!game.user.isGM) return this;
    // 한 진영이 전멸했으면 턴을 넘기지 않고 종료 창(결과 미리 선택)
    const over = this.getFlag("nssq", "over");
    if (over) {
      if (this.getFlag("nssq", "battle")) openEndDialog(over);
      else ui.notifications.info(game.i18n.localize(over === "victory" ? "NSSQ.Combat.enemyDefeated" : "NSSQ.Combat.partyDefeated"));
      return this;
    }
    switch (this.phase) {
      case "opening": {
        // 모두 개막 행동을 정했는가(남은 GM 전투원은 확인 뒤 「행동 안 함」)
        if (!(await confirmOpeningDone(this))) return this;
        // 개막 → 메인: 【속도】를 다시 계산하고 첫 행동자부터
        await this.refreshInitiative();
        const first = this.firstActingTurn(0);
        if (first === null) return this.setPhase("end", { turn: null });
        return this.setPhase("main", { turn: first });
      }
      case "main": {
        const next = this.firstActingTurn((this.turn ?? -1) + 1);
        if (next === null) return this.setPhase("end", { turn: null });
        return this.update({ turn: next });
      }
      default:
        return this.nextRound();
    }
  }

  async nextRound() {
    if (!game.user.isGM) return this;
    // 종료 페이즈 결과를 적용하지 않았으면 묻는다(적용하고 넘어가기 / 그냥 넘어가기 / 취소)
    if (!(await confirmEndPhaseApplied(this))) return this;
    // 오버히트(《○○ 드라이브》): 턴마다 1 줄어든다
    for (const c of this.combatants) {
      const n = Number(c.actor?.getFlag("nssq", "overheat") ?? 0);
      if (n > 0) await c.actor.setFlag("nssq", "overheat", n - 1);
    }
    await this.clearRoundFlags();
    await this.refreshInitiative();
    await super.nextRound();
    await this.setPhase("opening", { turn: null });
    return this;
  }

  /** 다음 페이즈 버튼(컴뱃 트래커) */
  async nextPhase() {
    return this.nextTurn();
  }
}
