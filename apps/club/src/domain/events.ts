// Four-Way League metrics (docs/CLUB_EVENTS_DISCUSSION.md §6.2), shared by the events feature and the player profile.
export const outputFields = ["kills", "assists", "dispersals", "awakens"] as const;
export const strategyFields = ["player_damage", "damage_taken", "healing", "guardian_damage", "purification"] as const;
export const metricFields = [...outputFields, ...strategyFields] as const;
export type Metric = typeof metricFields[number];
export type Metrics = Record<Metric, number>;
export const metricLabels: Record<Metric, string> = { kills: "击败", assists: "助攻", dispersals: "消散", awakens: "唤醒", player_damage: "对玩家伤害", damage_taken: "承受伤害", healing: "治疗", guardian_damage: "对守卫伤害", purification: "净化" };
