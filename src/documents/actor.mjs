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

  /** 캐릭터 이름을 바꾸면 프로토타입 토큰 이름도(예전 이름 그대로였을 때) */
  async _preUpdate(changed, options, user) {
    const allowed = await super._preUpdate(changed, options, user);
    if (allowed === false) return false;
    if (this.type === "character" && typeof changed.name === "string" && changed.name !== this.name) {
      options.nssqOldName = this.name;
      if (this.prototypeToken.name === this.name && changed.prototypeToken?.name === undefined) {
        foundry.utils.setProperty(changed, "prototypeToken.name", changed.name);
      }
    }
  }

  /**
   * …그리고 씬에 놓인 연결 토큰·전투원 이름도. 플레이어는 전투원 이름을 고칠 권한이 없으므로
   * 접속 중인 GM의 클라이언트에서 한 번(GM이 없으면 바꾼 사람이 할 수 있는 만큼)
   */
  _onUpdate(changed, options, userId) {
    super._onUpdate(changed, options, userId);
    const old = options.nssqOldName;
    if (!old) return;
    const runner = game.users.activeGM?.id ?? userId;
    if (runner !== game.user.id) return;
    const name = this.name;
    (async () => {
      try {
        for (const scene of game.scenes) {
          const updates = scene.tokens.filter((t) => t.actorLink && t.actorId === this.id && t.name === old).map((t) => ({ _id: t.id, name }));
          if (updates.length) await scene.updateEmbeddedDocuments("Token", updates);
        }
        for (const combat of game.combats) {
          const updates = combat.combatants.filter((c) => c.actorId === this.id && c.name === old).map((c) => ({ _id: c.id, name }));
          if (updates.length) await combat.updateEmbeddedDocuments("Combatant", updates);
        }
      } catch (err) {
        console.warn("NSSQ | rename: could not update tokens/combatants", err);
      }
    })();
  }
}
