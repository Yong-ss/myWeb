// Pure explanation helpers for permission layers (stage B), shared by the platform and team features. Display only:
// the Worker and database decide every access.
/** One permission of one user in one club, as returned by club_private.permission_explain (platform and owner readers). */
export type Explained = { key: string; description: string; sensitive: boolean; non_delegable: boolean; layer: string; allowed: boolean;
  platform_default: boolean; cap_blocked: boolean; club_default: boolean | null; forced: boolean | null; owner_set: boolean | null;
  /** Stage G: the alliance this account leads grants this read here (before a Super Admin forced deny). */
  alliance?: boolean;
  /** Event permissions (Four-Way League, Highland Race): the platform admin's personal and club-role settings. */
  platform_set?: boolean | null; platform_role?: boolean | null };

const layerReasons: Record<string, string> = {
  no_role: "此账户在该俱乐部没有职位", unregistered: "未登记的权限", non_delegable: "系统安全规则：只有公会长可以拥有",
  forced_allow: "超级管理员单独允许", forced_deny: "超级管理员单独禁止", owner_allow: "公会长单独允许", owner_deny: "公会长单独禁止",
  platform_allow: "平台管理员单独允许", platform_deny: "平台管理员单独禁止", platform_role_allow: "平台管理员按职位允许", platform_role_deny: "平台管理员按职位禁止",
  club_allow: "本俱乐部默认允许", club_deny: "本俱乐部默认不允许", default_allow: "全平台默认允许", default_deny: "全平台默认不允许",
};

type Change = Partial<Pick<Explained, "forced" | "owner_set" | "club_default" | "platform_set" | "platform_role">>;
/** The final result if one setting changed (null = follow), from the same inputs the database uses
 * (club_private.permission_layer): safety and cap first, then forced, owner (admins only), club, platform.
 * Used to decide whether a change widens access, so a confirmation compares final results, not menu choices. */
export function allowedWith(p: Explained, role: string | null, confirmed: boolean, change: Change) {
  if (!confirmed) return false;
  const q = { ...p, ...change };
  // The alliance read (stage F) applies unless the Super Admin forces a deny, whatever the direct layers say.
  if (p.alliance && q.forced !== false) return true;
  if (!role || ["unregistered", "non_delegable", "cap", "no_role", "needs_read"].includes(p.layer)) return false;
  if (q.forced !== null) return q.forced;
  if (q.platform_set != null) return q.platform_set;
  if (q.platform_role != null) return q.platform_role;
  if (role === "admin" && q.owner_set !== null) return q.owner_set;
  return q.club_default ?? q.platform_default;
}
/** Every layer as [label, value], in the order the database applies them: defaults, personal settings, limits, result. */
export function layerBreakdown(p: Explained, role: string | null): [string, string][] {
  const yes = (v: boolean | null, follow: string) => v === null ? follow : v ? "允许" : "不允许";
  const personal = p.forced !== null ? `超级管理员单独${p.forced ? "允许" : "禁止"}` : role === "admin" && p.owner_set !== null ? `公会长单独${p.owner_set ? "允许" : "禁止"}` : "无";
  const limit = p.layer === "non_delegable" ? "只有公会长可以拥有" : p.cap_blocked ? "超出职位上限" : p.layer === "needs_read" ? "缺少查看权限" : "无";
  const platform = p.platform_set != null ? `单独${p.platform_set ? "允许" : "禁止"}` : p.platform_role != null ? `按职位${p.platform_role ? "允许" : "禁止"}` : null;
  return [
    ["全平台默认", role ? (p.platform_default ? "允许" : "不允许") : "无职位"],
    ["俱乐部默认", role ? yes(p.club_default, "跟随全平台") : "无职位"],
    ...(p.alliance ? [["联盟会长只读", "允许"] as [string, string]] : []),
    ...(platform ? [["平台管理员设置", platform] as [string, string]] : []),
    ["个人设置", personal],
    ["上级限制", limit],
    ["最终生效", p.allowed ? "允许" : "不允许"],
  ];
}
/** The Super Admin's personal setting becoming `forced`. */
export const allowedWithForced = (p: Explained, role: string | null, confirmed: boolean, forced: boolean | null) => allowedWith(p, role, confirmed, { forced });

/** Why the final result is what it is, in plain words. A personal allow stopped by a cap says so explicitly. */
export function layerReason(p: Explained) {
  if (p.alliance && p.forced === false) return "超级管理员单独禁止（联盟会长只读也不生效）";
  if (p.alliance && p.allowed && !["forced_allow", "owner_allow", "club_allow", "default_allow"].includes(p.layer)) return "联盟会长只读";
  if (p.layer === "cap") return p.forced === true || p.owner_set === true ? "已单独允许，但超出该职位的权限上限，未生效" : "超出该职位的权限上限";
  if (p.layer === "needs_read") return `已设置允许，但缺少「${p.key.startsWith("highland.") ? "查看高原竞逐战绩" : p.key.startsWith("dragon.") ? "查看猎龙出勤" : "查看四方联赛战绩"}」权限，暂不生效`;
  return layerReasons[p.layer] ?? "未知原因（请查看高级详情）";
}
