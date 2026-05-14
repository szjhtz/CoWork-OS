import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function jsonResponse(data: Any, status = 200): Any {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? "OK" : "Error",
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(JSON.stringify(data)),
  };
}

async function loadConnector(scopeText?: string) {
  vi.resetModules();
  process.env.GOOGLE_ACCESS_TOKEN = "test-token";
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_REFRESH_TOKEN;
  if (scopeText === undefined) {
    delete process.env.GOOGLE_SCOPES;
  } else {
    process.env.GOOGLE_SCOPES = scopeText;
  }
  return import("../../../../connectors/google-workspace-mcp/src/index");
}

describe("google-workspace MCP Tasks and Slides tools", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GOOGLE_ACCESS_TOKEN;
    delete process.env.GOOGLE_SCOPES;
  });

  it("sends a Tasks PATCH with null due when clearDue is requested", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(jsonResponse({ id: "task-1", due: null }) as Response);
    const { executeGoogleWorkspaceToolForTest } = await loadConnector();

    await executeGoogleWorkspaceToolForTest("google-workspace.tasks_update", {
      tasklistId: "list-1",
      taskId: "task-1",
      clearDue: true,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://tasks.googleapis.com/tasks/v1/lists/list-1/tasks/task-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ due: null }),
      }),
    );
  });

  it("exposes confirmation schema on delete without adding it to task completion", async () => {
    const { listGoogleWorkspaceToolsForTest } = await loadConnector();
    const tools = listGoogleWorkspaceToolsForTest();
    const completeSchema = tools.find((tool: Any) => tool.name === "google-workspace.tasks_complete")
      ?.inputSchema;
    const deleteSchema = tools.find((tool: Any) => tool.name === "google-workspace.tasks_delete")
      ?.inputSchema;

    expect(completeSchema?.required).toEqual(["tasklistId", "taskId"]);
    expect(deleteSchema?.required).toContain("confirm");
    expect(deleteSchema?.properties?.confirm).toBeTruthy();
    expect(deleteSchema?.properties?.deleteAssignedTaskEverywhere).toBeTruthy();
  });

  it("blocks assigned task deletion unless cross-surface deletion is explicitly acknowledged", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: "task-1", assignmentInfo: { surfaceType: "DOCUMENT" } }) as Response,
    );
    const { executeGoogleWorkspaceToolForTest } = await loadConnector();

    await expect(
      executeGoogleWorkspaceToolForTest("google-workspace.tasks_delete", {
        tasklistId: "list-1",
        taskId: "task-1",
        confirm: true,
      }),
    ).rejects.toThrow(/assigned task/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("requires explicit confirmation for raw Slides batch updates", async () => {
    const fetchMock = vi.mocked(fetch);
    const { executeGoogleWorkspaceToolForTest } = await loadConnector();

    await expect(
      executeGoogleWorkspaceToolForTest("google-workspace.slides_batch_update", {
        presentationId: "deck-1",
        requests: [{ deleteObject: { objectId: "slide-1" } }],
      }),
    ).rejects.toThrow(/Confirmation required/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports missing scopes from connector health when GOOGLE_SCOPES is incomplete", async () => {
    const fetchMock = vi.mocked(fetch);
    const { executeGoogleWorkspaceToolForTest } = await loadConnector(
      "https://www.googleapis.com/auth/drive",
    );

    const result = await executeGoogleWorkspaceToolForTest("google-workspace.health", {});

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.data.status).toBe("missing_scopes");
    expect(result.data.missingScopes).toContain("https://www.googleapis.com/auth/tasks");
    expect(result.data.missingScopes).toContain("https://www.googleapis.com/auth/presentations");
  });
});
