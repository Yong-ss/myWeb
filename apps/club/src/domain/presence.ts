import {type Member, numericFields} from "./member.ts";
type NumericField = typeof numericFields[number];
export type SavedMember = Omit<Member, "group" | NumericField> & Record<NumericField, number | null> & { player_id: string; group_name: string | null };
export type Presence = "present" | "left" | "unconfirmed";
export type AbsenceDetails={absence_decision?:string|null;absence_reason?:string|null};
export function presenceText(presence:Presence,decision?:string|null){return presence==="left"?(decision==="temporary"?"暂离":decision==="left"?"已确认退会":"不在会"):presenceLabels[presence];}
export type Day = { id: string; snapshot_date: string; is_complete_roster: boolean; confirmed_left?: boolean; revision: number; rows: SavedMember[] } & AbsenceDetails;
export const presenceLabels = { present: "在会", left: "不在会", unconfirmed: "待确认" };
export function absenceStatus(lastSeen: string, completeDate?: string): Presence { return completeDate && completeDate > lastSeen ? "left" : "unconfirmed"; }
export function change(now: number | null, previous: number | null) { return now === null || previous === null ? null : { amount: now - previous, percent: previous === 0 ? null : (now - previous) / previous * 100 }; }
export function playerTimeline(days: Day[], seed?: {status:Presence|null;previous:SavedMember|null}&AbsenceDetails) {
  let status: Presence | null = seed?.status??null, previous: SavedMember | null = seed?.previous??null;
  let absence:AbsenceDetails={absence_decision:seed?.absence_decision,absence_reason:seed?.absence_reason};
  return days.flatMap(day => {
    const row = day.rows[0] ?? null;
    if (!row && status === null) return [];
    const choice=day.absence_decision;
    if(row)absence={};else if(choice)absence={absence_decision:choice,absence_reason:day.absence_reason};
    const departure = choice?choice==="left"||choice==="temporary":day.is_complete_roster || day.confirmed_left;
    const event = row ? status === null ? "first_seen" : status === "left" ? "rejoined" : null : departure && status !== "left" ? "left" : null;
    if (row) status = "present"; else if (departure) status = "left"; else if(choice)status="unconfirmed";
    const changes = row && previous ? { score: change(row.extraordinary_score, previous.extraordinary_score), prosperity: change(row.prosperity, previous.prosperity), activity: change(row.weekly_activity, previous.weekly_activity), activity_reset: row.weekly_activity !== null && previous.weekly_activity !== null && row.weekly_activity < previous.weekly_activity } : null;
    if (row) previous = row;
    return [{ ...absence, date: day.snapshot_date, revision: day.revision, complete: day.is_complete_roster, status: row ? "present" as const : status === "left" ? "left" as const : "unconfirmed" as const, event, member: row, changes }];
  });
}
