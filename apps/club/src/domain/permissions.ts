// Mirrors public.auth_permissions. permissions.test.mjs fails if the database registry and this list drift apart.
export const permissions = ["absences.resolve", "aliases.manage", "audit.actor_email.read", "audit.read", "club.rename", "imports.create", "imports.delete", "members.read", "platform.read", "platform.roles.assign"] as const;
export type Permission = typeof permissions[number];
export const isPermission = (value: unknown): value is Permission => (permissions as readonly unknown[]).includes(value);
