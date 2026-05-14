import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isLikelyIntegrationAuthError,
  notifyIntegrationAuthIssue,
  resetIntegrationAuthNotificationDedupe,
  setIntegrationAuthNotificationServiceProvider,
} from "../integration-auth";

describe("integration auth notifications", () => {
  afterEach(() => {
    setIntegrationAuthNotificationServiceProvider(null);
    resetIntegrationAuthNotificationDedupe();
    vi.useRealTimers();
  });

  it("recognizes token and authorization failures", () => {
    expect(isLikelyIntegrationAuthError(Object.assign(new Error("Unauthorized"), { status: 401 })))
      .toBe(true);
    expect(isLikelyIntegrationAuthError(new Error("Google Workspace token refresh failed")))
      .toBe(true);
    expect(isLikelyIntegrationAuthError(new Error("request timed out"))).toBe(false);
  });

  it("adds one deduped warning notification per integration auth issue", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-11T12:00:00Z"));
    const add = vi.fn().mockResolvedValue({ id: "notification-1" });
    setIntegrationAuthNotificationServiceProvider(() => ({ add }) as Any);

    const first = await notifyIntegrationAuthIssue({
      integrationId: "google-workspace",
      integrationName: "Google Workspace",
      settingsPath: "Settings > Integrations > Google Workspace",
      reason: "Token has been expired or revoked.",
      dedupeKey: "auth",
    });
    const second = await notifyIntegrationAuthIssue({
      integrationId: "google-workspace",
      integrationName: "Google Workspace",
      settingsPath: "Settings > Integrations > Google Workspace",
      reason: "Token has been expired or revoked.",
      dedupeKey: "auth",
    });

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "warning",
        title: "Reconnect Google Workspace",
        message: expect.stringContaining("Settings > Integrations > Google Workspace"),
      }),
    );
  });
});
