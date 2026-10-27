import {type Member, numericFields} from "./import.ts";
type NumericField = typeof numericFields[number];
export type SavedMember = Omit<Member, "group" | NumericField> & Record<NumericField, number | null> & { player_id: string; group_name: string | null };
export type Presence = "present" | "left" | "unconfirmed";
export type Day = { id: string; snapshot_date: string; is_complete_roster: boolean; revision: number; rows: SavedMember[] };
export const presenceLabels = { present: "在会", left: "暂时离会", unconfirmed: "本次未识别" };
export function absenceStatus(lastSeen: string, completeDate?: string): Presence { return completeDate && completeDate > lastSeen ? "left" : "unconfirmed"; }
export function change(now: number | null, previous: number | null) { return now === null || previous === null ? null : { amount: now - previous, percent: previous === 0 ? null : (now - previous) / previous * 100 }; }
export function playerTimeline(days: Day[]) {
  let status: Presence | null = null, previous: SavedMember | null = null;
  return days.flatMap(day => {
    const row = day.rows[0] ?? null;
    if (!row && status === null) return [];
    const event = row ? status === null ? "first_seen" : status === "left" ? "rejoined" : null : day.is_complete_roster && status !== "left" ? "left" : null;
    if (row) status = "present"; else if (day.is_complete_roster) status = "left";
    const changes = row && previous ? { score: change(row.extraordinary_score, previous.extraordinary_score), prosperity: change(row.prosperity, previous.prosperity), activity: change(row.weekly_activity, previous.weekly_activity), activity_reset: row.weekly_activity !== null && previous.weekly_activity !== null && row.weekly_activity < previous.weekly_activity } : null;
    if (row) previous = row;
    return [{ date: day.snapshot_date, revision: day.revision, complete: day.is_complete_roster, status: row ? "present" as const : status === "left" ? "left" as const : "unconfirmed" as const, event, member: row, changes }];
  });
}
