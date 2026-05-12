/**
 * Re-export of domain types so existing imports `@/lib/types` keep working.
 * New code should import directly from `@/domain/types`.
 */
export * from "@/domain/types";

// Backwards-compat alias used by NotificationsDrawer.
export type { NotificationItem as Notification } from "@/domain/types";
