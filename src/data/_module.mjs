import { CharacterData } from "./actor/character.mjs";
import { EnemyData } from "./actor/enemy.mjs";
import { TokenData } from "./actor/token.mjs";
import * as item from "./item/index.mjs";

export const actorModels = { character: CharacterData, enemy: EnemyData, token: TokenData };

export const itemModels = {
  class: item.ClassData,
  skill: item.SkillData,
  weapon: item.WeaponData,
  armor: item.ArmorData,
  accessory: item.AccessoryData,
  consumable: item.ConsumableData,
  tool: item.ToolData,
  material: item.MaterialData
};
