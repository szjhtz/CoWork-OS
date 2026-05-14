import { describe, expect, it } from "vitest";
import { GOOGLE_SCOPE_DRIVE, GOOGLE_SCOPE_TASKS } from "../../../shared/google-workspace";
import { testGoogleWorkspaceConnection } from "../google-workspace-api";

describe("testGoogleWorkspaceConnection", () => {
  it("fails fast when saved Google Workspace scopes are missing required services", async () => {
    const result = await testGoogleWorkspaceConnection({
      enabled: true,
      accessToken: "token",
      scopes: [GOOGLE_SCOPE_DRIVE],
    });

    expect(result.success).toBe(false);
    expect(result.missingScopes).toContain(GOOGLE_SCOPE_TASKS);
    expect(result.error).toContain("Reconnect Google Workspace");
  });
});
