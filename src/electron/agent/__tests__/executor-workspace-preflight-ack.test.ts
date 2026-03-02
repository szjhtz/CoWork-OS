import { describe, it, expect, vi } from "vitest";
import { TaskExecutor } from "../executor";
import { TEMP_WORKSPACE_ID } from "../../../shared/types";

describe("TaskExecutor workspace preflight acknowledgement", () => {
  const buildBase = () => ({
    shouldPauseForQuestions: true,
    workspacePreflightAcknowledged: false,
    capabilityUpgradeRequested: false,
    requiresExecutionToolRun: false,
    allowExecutionWithoutShell: false,
    isInternalAppOrToolChangeIntent: vi.fn(() => false),
    preflightShellExecutionCheck: vi.fn(() => false),
    tryAutoSwitchToPreferredWorkspaceForAmbiguousTask: vi.fn(() => false),
    task: { prompt: "Fix a bug in src/app.ts", id: "t1" },
    classifyWorkspaceNeed: vi.fn(() => "needs_existing"),
    getWorkspaceSignals: vi.fn(() => ({
      hasProjectMarkers: false,
      hasCodeFiles: false,
      hasAppDirs: false,
    })),
  });

  it("pauses on workspace mismatch when acknowledgement is not set", () => {
    const pauseForUserInput = vi.fn();
    const fakeThis: Any = {
      ...buildBase(),
      workspace: { isTemp: false, id: "ws1" },
      pauseForUserInput,
    };

    const shouldPause = (TaskExecutor as Any).prototype.preflightWorkspaceCheck.call(fakeThis);
    expect(shouldPause).toBe(true);
    expect(pauseForUserInput).toHaveBeenCalledTimes(1);
    expect(pauseForUserInput.mock.calls[0][1]).toBe("workspace_mismatch");
  });

  it("does not re-pause once the user acknowledged the preflight warning", () => {
    const pauseForUserInput = vi.fn();
    const fakeThis: Any = {
      ...buildBase(),
      workspacePreflightAcknowledged: true,
      workspace: { isTemp: false, id: "ws1" },
      pauseForUserInput,
    };

    const shouldPause = (TaskExecutor as Any).prototype.preflightWorkspaceCheck.call(fakeThis);
    expect(shouldPause).toBe(false);
    expect(pauseForUserInput).not.toHaveBeenCalled();
  });

  it("applies to temp workspace gates as well", () => {
    const pauseForUserInput = vi.fn();
    const fakeThis: Any = {
      ...buildBase(),
      workspace: { isTemp: true, id: TEMP_WORKSPACE_ID },
      pauseForUserInput,
    };

    const shouldPause = (TaskExecutor as Any).prototype.preflightWorkspaceCheck.call(fakeThis);
    expect(shouldPause).toBe(true);
    expect(pauseForUserInput).toHaveBeenCalledTimes(1);
    expect(pauseForUserInput.mock.calls[0][1]).toBe("workspace_required");
  });

  it("does not pause for ambiguous coding requests in temporary workspace", () => {
    const pauseForUserInput = vi.fn();
    const tryAutoSwitch = vi.fn(() => false);
    const fakeThis: Any = {
      ...buildBase(),
      workspace: { isTemp: true, id: TEMP_WORKSPACE_ID },
      classifyWorkspaceNeed: vi.fn(() => "ambiguous"),
      tryAutoSwitchToPreferredWorkspaceForAmbiguousTask: tryAutoSwitch,
      pauseForUserInput,
    };

    const shouldPause = (TaskExecutor as Any).prototype.preflightWorkspaceCheck.call(fakeThis);
    expect(shouldPause).toBe(false);
    expect(pauseForUserInput).not.toHaveBeenCalled();
    expect(tryAutoSwitch).toHaveBeenCalledTimes(1);
  });

  it("does not pause when capability upgrade intent is active", () => {
    const pauseForUserInput = vi.fn();
    const fakeThis: Any = {
      ...buildBase(),
      capabilityUpgradeRequested: true,
      workspace: { isTemp: true, id: TEMP_WORKSPACE_ID },
      pauseForUserInput,
    };

    const shouldPause = (TaskExecutor as Any).prototype.preflightWorkspaceCheck.call(fakeThis);
    expect(shouldPause).toBe(false);
    expect(pauseForUserInput).not.toHaveBeenCalled();
  });

  it("pauses for shell enablement when task requires command execution and shell is disabled", () => {
    const pauseForUserInput = vi.fn();
    const fakeThis: Any = {
      ...buildBase(),
      workspace: { isTemp: false, id: "ws1", permissions: { shell: false } },
      requiresExecutionToolRun: true,
      allowExecutionWithoutShell: false,
      lastPauseReason: null,
      pauseForUserInput,
    };

    const shouldPause = (TaskExecutor as Any).prototype.preflightShellExecutionCheck.call(fakeThis);
    expect(shouldPause).toBe(true);
    expect(pauseForUserInput).toHaveBeenCalledTimes(1);
    expect(pauseForUserInput.mock.calls[0][1]).toBe("shell_permission_required");
  });

  it("does not pause for shell when user explicitly chose to continue without shell", () => {
    const pauseForUserInput = vi.fn();
    const fakeThis: Any = {
      ...buildBase(),
      workspace: { isTemp: false, id: "ws1", permissions: { shell: false } },
      requiresExecutionToolRun: true,
      allowExecutionWithoutShell: true,
      lastPauseReason: null,
      pauseForUserInput,
    };

    const shouldPause = (TaskExecutor as Any).prototype.preflightShellExecutionCheck.call(fakeThis);
    expect(shouldPause).toBe(false);
    expect(pauseForUserInput).not.toHaveBeenCalled();
  });

  it("does not pause for internal app/tool change intent in temporary workspace", () => {
    const pauseForUserInput = vi.fn();
    const fakeThis: Any = {
      ...buildBase(),
      workspace: { isTemp: true, id: TEMP_WORKSPACE_ID },
      isInternalAppOrToolChangeIntent: vi.fn(() => true),
      pauseForUserInput,
    };

    const shouldPause = (TaskExecutor as Any).prototype.preflightWorkspaceCheck.call(fakeThis);
    expect(shouldPause).toBe(false);
    expect(pauseForUserInput).not.toHaveBeenCalled();
  });

  it("auto-switches to the preferred non-temp workspace for ambiguous temp tasks", () => {
    const preferredWorkspace = {
      id: "ws-preferred",
      name: "Preferred",
      path: process.cwd(),
      permissions: { read: true, write: true, delete: false, network: true, shell: false },
    };
    const fakeThis: Any = {
      workspace: { isTemp: true, id: TEMP_WORKSPACE_ID, path: process.cwd() },
      task: { id: "t1", workspaceId: TEMP_WORKSPACE_ID },
      sandboxRunner: null,
      toolRegistry: { setWorkspace: vi.fn() },
      daemon: {
        getMostRecentNonTempWorkspace: vi.fn(() => preferredWorkspace),
        updateTaskWorkspace: vi.fn(),
        logEvent: vi.fn(),
      },
      getWorkspaceSignalsForPath: vi.fn(() => ({
        hasProjectMarkers: true,
        hasCodeFiles: false,
        hasAppDirs: false,
      })),
    };

    const switched = (
      TaskExecutor as Any
    ).prototype.tryAutoSwitchToPreferredWorkspaceForAmbiguousTask.call(
      fakeThis,
      "ambiguous_temp_workspace",
    );

    expect(switched).toBe(true);
    expect(fakeThis.workspace.id).toBe("ws-preferred");
    expect(fakeThis.task.workspaceId).toBe("ws-preferred");
    expect(fakeThis.toolRegistry.setWorkspace).toHaveBeenCalledWith(preferredWorkspace);
    expect(fakeThis.daemon.updateTaskWorkspace).toHaveBeenCalledWith("t1", "ws-preferred");
  });

  it("does not preflight-fail create/build steps that mention artifacts to be created", () => {
    const fakeThis: Any = Object.create((TaskExecutor as Any).prototype);
    fakeThis.workspace = { path: process.cwd() };
    const step = {
      id: "s1",
      description:
        "Add a simple host entry in SystemMetricsWidgetApp.swift, run a build cycle, and create canvas/system-metrics-widget-preview.html.",
      kind: "primary",
      status: "pending",
    };

    const reason = (TaskExecutor as Any).prototype.getMissingWorkspaceArtifactPreflightReason.call(
      fakeThis,
      step,
    );
    expect(reason).toBeNull();
  });

  it("still preflight-fails verification-only missing artifacts", () => {
    const fakeThis: Any = Object.create((TaskExecutor as Any).prototype);
    fakeThis.workspace = { path: process.cwd() };
    const step = {
      id: "s2",
      description:
        "Verify and inspect SystemMetricsWidgetApp.swift and canvas/system-metrics-widget-preview.html.",
      kind: "verification",
      status: "pending",
    };

    const reason = (TaskExecutor as Any).prototype.getMissingWorkspaceArtifactPreflightReason.call(
      fakeThis,
      step,
    );
    expect(String(reason || "")).toContain("missing_required_workspace_artifact");
  });

  it("does not preflight-fail mixed verification plus write-note steps", () => {
    const fakeThis: Any = Object.create((TaskExecutor as Any).prototype);
    fakeThis.workspace = { path: process.cwd() };
    const step = {
      id: "s3",
      description:
        "Verify: run a full functional pass by opening `index.html` and checking interactions; then provide a short usage note in `README.md`.",
      kind: "primary",
      status: "pending",
    };

    const reason = (TaskExecutor as Any).prototype.getMissingWorkspaceArtifactPreflightReason.call(
      fakeThis,
      step,
    );
    expect(reason).toBeNull();
  });

  it("ignores command snippets when checking verification artifact preflight", () => {
    const fakeThis: Any = Object.create((TaskExecutor as Any).prototype);
    fakeThis.workspace = { path: process.cwd() };
    const step = {
      id: "s4",
      description:
        "Verification: run the local server (`python3 -m http.server`) and manually validate key flows.",
      kind: "verification",
      status: "pending",
    };

    const reason = (TaskExecutor as Any).prototype.getMissingWorkspaceArtifactPreflightReason.call(
      fakeThis,
      step,
    );
    expect(reason).toBeNull();
  });

  it("requires write_file for write-intent steps that target source/project artifact files", () => {
    const fakeThis: Any = Object.create((TaskExecutor as Any).prototype);
    const requiredTools = (TaskExecutor as Any).prototype.extractRequiredToolsFromStepDescription.call(
      fakeThis,
      "Build widget UI in SystemMetricsWidgetExtension/SystemMetricsWidget.swift and wire the provider.",
    ) as Set<string>;

    expect(requiredTools.has("write_file")).toBe(true);
  });

  it("ignores non-tool via phrases such as localStorage when inferring required tools", () => {
    const fakeThis: Any = Object.create((TaskExecutor as Any).prototype);
    const requiredTools = (TaskExecutor as Any).prototype.extractRequiredToolsFromStepDescription.call(
      fakeThis,
      "Implement Notepad save/load via localStorage and keyboard shortcuts.",
    ) as Set<string>;

    expect(requiredTools.has("localstorage")).toBe(false);
  });

  it("still infers real tools from via phrases when the tool exists", () => {
    const fakeThis: Any = Object.create((TaskExecutor as Any).prototype);
    const requiredTools = (TaskExecutor as Any).prototype.extractRequiredToolsFromStepDescription.call(
      fakeThis,
      "Research the error via web_search and summarize likely root causes.",
    ) as Set<string>;

    expect(requiredTools.has("web_search")).toBe(true);
  });
});
