import { description, int, resource, row, str } from "../fields.mjs";

const { ArrayField, ObjectField } = foundry.data.fields;

/** 토큰 스킬로 배치되는 유사 NPC (02 §4.1) */
export class TokenData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ownerUuid: str(""),
      hp: resource(1),
      action: new ArrayField(new ObjectField()),
      speedFrom: str("owner", { choices: ["owner"] }),
      row: row(),
      order: int(0),
      description: description()
    };
  }
}
