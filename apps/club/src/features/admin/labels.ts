// Pure display helpers for the platform panel; no access decisions here (the Worker and database make them).
export const scopeNames: Record<string, string> = { platform: "平台", alliance: "联盟", club: "俱乐部" };

type Row = Record<string, unknown> | undefined;
export type PlatformEvent = { id: string; created_at: string; action: string; via: string; details: { old?: Row; new?: Row }; actor: string | null; subject: string | null; club: string | null };

const tables: Record<string, string> = {
  club_memberships: "俱乐部角色", auth_roles: "角色", auth_role_permissions: "角色权限", auth_permissions: "权限登记",
  platform_super_admins: "超级管理员名单", platform_super_admin_factors: "超级管理员验证器",
};
const verbs: Record<string, string> = { insert: "新增", update: "修改", delete: "删除" };

/** "修改 · 俱乐部角色" for any audited table; unknown actions fall back to the raw key, never to a guess. */
export function actionLabel(action: string) {
  const [table, verb] = action.split(".");
  return tables[table] && verbs[verb] ? `${verbs[verb]} · ${tables[table]}` : action;
}

/** The fields that changed, as "field: old → new"; inserts and deletes list the identifying fields only. */
export function changeSummary(event: PlatformEvent) {
  const { old, new: next } = event.details;
  const pick = (row: Row) => ["role", "role_key", "permission_key", "key", "status", "name", "factor_name"].filter(k => row?.[k] != null).map(k => `${k}: ${String(row![k])}`);
  if (old && next) return Object.keys(next).filter(k => JSON.stringify(old[k]) !== JSON.stringify(next[k])).map(k => `${k}: ${String(old[k] ?? "—")} → ${String(next[k] ?? "—")}`);
  return pick(next ?? old);
}

/** Who made the change: the signed-in user, or the database login for SQL Editor / migrations. */
export function actorLabel(event: PlatformEvent) {
  return event.actor ?? (event.via === "postgres" ? "Supabase SQL Editor／迁移" : `数据库（${event.via}）`);
}
