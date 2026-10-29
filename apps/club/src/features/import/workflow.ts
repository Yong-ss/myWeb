// Pure import-workflow rules used by the page. No React, no network.
import { fields, numericFields, type Member } from "../../domain/member.ts";
import { validateRows, type ConfirmedMember, type ImportContext } from "./contract.ts";

export const labels: Record<typeof fields[number], string> = { name: "昵称", position: "职位", level: "等级", pathway: "途径", extraordinary_score: "非凡评分", prosperity: "风尚度", weekly_activity: "周活跃", group: "分组", join_days: "入会天数" };
export type Row = { member: Member; identity: string; manual: boolean; sourceName: string | null; remember: boolean; needsReview: boolean; search?: string; correction?: { name: string; expected: string } };
export type AbsenceChoice = "left" | "missed" | "uncertain";

export function beijingToday() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** Empty means unrecognized (null), never 0; only plain digits in numeric fields become numbers, so validation can reject the rest. */
export function fieldValue(field: typeof fields[number], text: string): string | number | null {
  return text === "" ? null : (numericFields as readonly string[]).includes(field) && /^\d+$/.test(text) ? Number(text) : text;
}

/** Same rule the server enforces for a nickname correction. */
export function invalidCorrection(name: string | null) {
  return name !== null && (!name.trim() || name.length > 200 || /[\u0000-\u001f\u007f]/.test(name));
}

/** Rows as the server contract expects them: "new" means no existing player id. */
export function confirmedMembers(rows: Row[]): ConfirmedMember[] {
  return validateRows(rows.map(r => ({ ...r.member, player_id: r.identity === "new" ? null : r.identity, source_name: r.sourceName, remember_alias: r.remember, identity_confirmed: r.manual, ...(r.correction ? { correct_name: r.correction.name, expected_name: r.correction.expected } : {}) })));
}

/** Players from the previous roster that this import would drop, and whether every one has an explicit decision. */
export function absenceReview(context: ImportContext | null, rows: Row[], mode: "merge" | "replace" | "", choices: Record<string, AbsenceChoice>) {
  // In merge mode the day's existing players stay, so they are not missing.
  const retained = new Set([...rows.filter(r => r.identity && r.identity !== "new").map(r => r.identity), ...(mode === "merge" ? (context?.members ?? []).flatMap(r => r.player_id ? [r.player_id] : []) : [])]);
  const missing = (context?.absence_context?.members ?? []).filter(p => !retained.has(p.player_id));
  return {
    missing,
    pending: missing.filter(p => !choices[p.player_id]).length,
    // A roster can only be "complete" when every missing player is a confirmed departure.
    completeAllowed: missing.every(p => choices[p.player_id] === "left"),
    decisions: missing.map(p => ({ player_id: p.player_id, decision: choices[p.player_id] })),
  };
}

const errorLabels: Record<string, string> = { extraordinary_score: "非凡评分", weekly_activity: "周活跃", join_days: "入会天数", prosperity: "风尚度", pathway: "途径", player_id: "玩家身份" };
/** Validation messages name JSON keys; show the Chinese field names instead. */
export function readableError(message: string) {
  return message.replace(/extraordinary_score|weekly_activity|join_days|prosperity|pathway|player_id/g, key => errorLabels[key] ?? key);
}
