// Mirrors public.auth_permissions. permissions.test.mjs fails if the database registry and this list drift apart.
export const permissions = ["absences.resolve", "aliases.manage", "alliance.joins.decide", "audit.actor_email.read", "audit.read", "club.admins.manage", "club.admins.permissions", "club.alliance.request", "club.rename", "events.edit", "events.import", "events.read", "highland.edit", "highland.import", "highland.read", "imports.create", "imports.delete", "members.read", "platform.alliance_leaders.assign", "platform.alliances.manage", "platform.clubs.admin_limit", "platform.events.permissions", "platform.highland.permissions", "platform.permissions.manage", "platform.platform_admins.assign", "platform.read", "platform.roles.assign", "platform.users.remove_all_clubs"] as const;
export type Permission = typeof permissions[number];
/** Plain Chinese names, identical to the registry descriptions (permissions.test.mjs checks they match). */
export const permissionNames: Record<Permission, string> = {
  "absences.resolve": "处理待确认的缺席成员", "aliases.manage": "记住或解除 AI 错名关联", "alliance.joins.decide": "批准或拒绝俱乐部加入本联盟",
  "audit.actor_email.read": "在操作日志中查看操作者邮箱（超级管理员永远不显示）", "audit.read": "查看操作日志",
  "club.admins.manage": "任命、撤销和移出本俱乐部的管理员", "club.admins.permissions": "修改本俱乐部管理员的默认权限和个人权限",
  "club.alliance.request": "申请加入联盟或撤回申请", "club.rename": "修改俱乐部名称",
  "events.edit": "修改、补录、移除、作废或恢复四方联赛战绩", "events.import": "导入四方联赛比赛", "events.read": "查看四方联赛战绩",
  "highland.edit": "修改、补录、移除、作废或恢复高原竞逐战绩", "highland.import": "导入高原竞逐比赛", "highland.read": "查看高原竞逐战绩", "imports.create": "导入每日数据并更正昵称",
  "imports.delete": "删除某日全部数据", "members.read": "查看成员名单、个人档案、评分与分析",
  "platform.alliance_leaders.assign": "任命或撤销联盟会长", "platform.alliances.manage": "新建、改名、停用联盟，并安排俱乐部所属联盟",
  "platform.clubs.admin_limit": "修改俱乐部管理员人数上限", "platform.events.permissions": "按俱乐部设置公会长和管理员的四方联赛权限", "platform.highland.permissions": "按俱乐部设置公会长和管理员的高原竞逐权限", "platform.permissions.manage": "修改默认权限、职位权限上限和个人权限",
  "platform.platform_admins.assign": "任命或撤销平台管理员", "platform.read": "查看平台总览、全部用户、角色与平台日志",
  "platform.roles.assign": "任命、撤销及转让俱乐部角色", "platform.users.remove_all_clubs": "把一个账户移出全部俱乐部",
};
export const permissionName = (key: string) => isPermission(key) ? permissionNames[key] : key;
export const isPermission = (value: unknown): value is Permission => (permissions as readonly unknown[]).includes(value);
