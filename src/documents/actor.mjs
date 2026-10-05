export class NssqActor extends Actor {
  /** 새 캐릭터: 토큰을 액터와 연결(전투 후에도 【HP】 등이 캐릭터에 남는다), 우호. 에너미: 연결하지 않음, 적대 */
  async _preCreate(data, options, user) {
    const allowed = await super._preCreate(data, options, user);
    if (allowed === false) return false;
    const token = data.prototypeToken ?? {};
    if (this.type === "character" && token.actorLink === undefined) {
      this.updateSource({ "prototypeToken.actorLink": true, "prototypeToken.disposition": CONST.TOKEN_DISPOSITIONS.FRIENDLY });
    }
    if (this.type === "enemy" && token.actorLink === undefined) {
      this.updateSource({ "prototypeToken.actorLink": false, "prototypeToken.disposition": CONST.TOKEN_DISPOSITIONS.HOSTILE });
    }
  }
}
