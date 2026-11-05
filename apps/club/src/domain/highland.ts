// Highland Race metrics and factions (docs/CLUB_HIGHLAND_RACE_DISCUSSION.md), shared by the events feature, the player
// profile and the Worker. No guardian damage; merit (战功) is a personal output metric, not the club's score.
export const highlandOutputFields = ["kills", "assists", "dispersals", "awakens", "merit"] as const;
export const highlandStrategyFields = ["player_damage", "damage_taken", "healing", "purification"] as const;
export const highlandFields = [...highlandOutputFields, ...highlandStrategyFields] as const;
export type HighlandMetric = typeof highlandFields[number];
export type HighlandMetrics = Record<HighlandMetric, number>;
export const highlandLabels: Record<HighlandMetric, string> = { kills: "击败", assists: "助攻", dispersals: "消散", awakens: "唤醒", merit: "战功", player_damage: "对玩家伤害", damage_taken: "承受伤害", healing: "治疗", purification: "净化" };
/** The fixed in-game factions confirmed so far, exactly as the game writes them. Mirrors club_private.highland_factions()
 * (highland.test.mjs checks both lists match); the other names are added there and here once confirmed, never guessed. */
export const highlandFactions: readonly string[] = ["血皇帝势力"];
export const isFactionRank = (value: unknown) => value === null || (Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 4);
export const isFaction = (value: unknown) => value === null || (typeof value === "string" && highlandFactions.includes(value));
