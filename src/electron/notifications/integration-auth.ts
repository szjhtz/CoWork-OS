import type { NotificationService } from "./service";

const DEFAULT_DEDUPE_WINDOW_MS = 60 * 60 * 1000;
const MAX_REASON_LENGTH = 180;

let notificationServiceProvider: (() => NotificationService | null) | null = null;
const lastNotificationAtByKey = new Map<string, number>();

export interface IntegrationAuthNotificationInput {
  integrationId: string;
  integrationName: string;
  settingsPath?: string;
  reason?: string;
  taskId?: string;
  workspaceId?: string;
  dedupeKey?: string;
}

export function setIntegrationAuthNotificationServiceProvider(
  provider: (() => NotificationService | null) | null,
): void {
  notificationServiceProvider = provider;
}

export function resetIntegrationAuthNotificationDedupe(): void {
  lastNotificationAtByKey.clear();
}

export function isLikelyIntegrationAuthError(error: unknown): boolean {
  const status = Number((error as Any)?.status ?? (error as Any)?.statusCode ?? NaN);
  const message = String((error as Any)?.message ?? error ?? "");

  if (status === 401) return true;
  if (
    status === 403 &&
    /(insufficient authentication scopes|forbidden|unauthori[sz]ed|invalid token|token|scope|permission)/i.test(
      message,
    )
  ) {
    return true;
  }

  return (
    /token refresh failed|refresh token not configured|access token not configured|access token expired/i.test(
      message,
    ) ||
    /expired or revoked|invalid_grant|invalid_client|unauthorized_client/i.test(message) ||
    /authentication required|authentication failed|not authenticated|login required/i.test(
      message,
    ) ||
    /sign in to continue|invalid token|unauthori[sz]ed|oauth|credential/i.test(message)
  );
}

function sanitizeReason(reason?: string): string | undefined {
  const normalized = reason
    ?.trim()
    .replace(/\s+/g, " ")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]")
    .replace(/\b(access|refresh|id)[_-]?token=([^&\s]+)/gi, "$1_token=[redacted]")
    .replace(/\b(sk-[A-Za-z0-9]{12,})\b/g, "[redacted-token]");
  if (!normalized) return undefined;
  return normalized.length > MAX_REASON_LENGTH
    ? `${normalized.slice(0, MAX_REASON_LENGTH - 3)}...`
    : normalized;
}

export async function notifyIntegrationAuthIssue(
  input: IntegrationAuthNotificationInput,
): Promise<boolean> {
  const notificationService = notificationServiceProvider?.() ?? null;
  if (!notificationService) {
    return false;
  }

  const dedupeKey = `${input.integrationId}:${input.dedupeKey || "auth"}`;
  const now = Date.now();
  const lastNotificationAt = lastNotificationAtByKey.get(dedupeKey) ?? 0;
  if (now - lastNotificationAt < DEFAULT_DEDUPE_WINDOW_MS) {
    return false;
  }

  const settingsPath = input.settingsPath || `Settings > Integrations > ${input.integrationName}`;
  const reason = sanitizeReason(input.reason);
  const message = reason
    ? `${input.integrationName} needs attention in ${settingsPath} before automated work can continue. ${reason}`
    : `${input.integrationName} needs attention in ${settingsPath} before automated work can continue.`;

  try {
    await notificationService.add({
      type: "warning",
      title: `Reconnect ${input.integrationName}`,
      message,
      taskId: input.taskId,
      workspaceId: input.workspaceId,
    });
    lastNotificationAtByKey.set(dedupeKey, now);
    return true;
  } catch (error) {
    console.warn("[Notifications] Failed to add integration auth notification:", error);
    return false;
  }
}
