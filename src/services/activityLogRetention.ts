import type { ActivityLog } from "@/domain/types";

export const ACTIVITY_LOG_RETENTION_DAYS = 90;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function normalizeRetentionDays(retentionDays: number) {
  return Math.max(1, Math.trunc(retentionDays));
}

export function getActivityLogRetentionCutoffIso(
  retentionDays = ACTIVITY_LOG_RETENTION_DAYS,
  referenceDate = new Date(),
) {
  return new Date(
    referenceDate.getTime() - normalizeRetentionDays(retentionDays) * MS_PER_DAY,
  ).toISOString();
}

function parseCreatedAt(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function filterActivityLogsByRetention<T extends Pick<ActivityLog, "created_at">>(
  logs: T[],
  retentionDays = ACTIVITY_LOG_RETENTION_DAYS,
  referenceDate = new Date(),
) {
  const cutoffTimestamp = Date.parse(
    getActivityLogRetentionCutoffIso(retentionDays, referenceDate),
  );

  return logs.filter((log) => {
    const createdAt = parseCreatedAt(log.created_at);
    return createdAt === null || createdAt >= cutoffTimestamp;
  });
}
