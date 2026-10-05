/**
 * 전투 씬 메인 페이즈의 「클릭 = 타겟」 모드.
 * - 현재 차례인 토큰과, 플레이어 자신의 토큰은 평소처럼 선택
 * - 그 밖의 토큰을 클릭하면 그 토큰 하나만 타겟(다시 클릭하면 해제)
 */
function autoTargetMode(token) {
  const combat = game.combat;
  if (!combat?.started || combat.getFlag("nssq", "phase") !== "main") return false;
  if (!token.scene?.getFlag("nssq", "battleCopy")) return false;
  if (combat.combatant?.tokenId === token.id) return false;
  if (token.isOwner && !game.user.isGM) return false;
  return true;
}

export class NssqToken extends Token {
  /** 자기 것이 아닌 토큰도 클릭은 받는다(이동·조종 권한은 생기지 않는다) */
  _canControl(user, event) {
    if (event && autoTargetMode(this)) return true;
    return super._canControl(user, event);
  }

  _onClickLeft(event) {
    if (autoTargetMode(this)) {
      this.setTarget(!this.isTargeted, { releaseOthers: true });
      return;
    }
    return super._onClickLeft(event);
  }
}
