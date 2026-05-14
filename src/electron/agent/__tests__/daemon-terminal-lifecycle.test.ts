import { describe, expect, it, vi } from "vitest";

import { AgentDaemon } from "../daemon";

describe("AgentDaemon terminal lifecycle helpers", () => {
  it("wraps up a paused task as completed when the user accepts current progress", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const daemonLike = Object.assign(Object.create(AgentDaemon.prototype), {
      taskRepo: {
        findById: vi.fn().mockReturnValue({
          id: "task-paused",
          status: "paused",
          terminalStatus: "needs_user_action",
          resultSummary: "Draft and analysis are already usable.",
          bestKnownOutcome: {
            capturedAt: Date.now(),
            resultSummary: "Draft and analysis are already usable.",
            confidence: "medium",
          },
        }),
        update: vi.fn(),
      },
      inputRequestRepo: {
        findPendingByTaskId: vi.fn().mockReturnValue([]),
      },
      pendingInputRequests: new Map(),
      pendingContinuationTaskIds: new Set(["task-paused"]),
      activeTasks: new Map([
        [
          "task-paused",
          {
            status: "active",
            lastAccessed: 0,
            executor: { cancel },
          },
        ],
      ]),
      cleanupPendingApprovalsForTask: vi.fn(),
      clearRetryState: vi.fn(),
      clearTimelineTaskState: vi.fn(),
      finishQueueSlot: vi.fn(),
      logEvent: vi.fn(),
      teamOrchestrator: null,
    }) as Any;

    await AgentDaemon.prototype.wrapUpTask.call(daemonLike, "task-paused");

    expect(cancel).toHaveBeenCalledWith("user");
    expect(daemonLike.pendingContinuationTaskIds.has("task-paused")).toBe(false);
    expect(daemonLike.taskRepo.update).toHaveBeenCalledWith(
      "task-paused",
      expect.objectContaining({
        status: "completed",
        error: null,
        terminalStatus: "ok",
        failureClass: undefined,
        resultSummary: "Draft and analysis are already usable.",
      }),
    );
    expect(daemonLike.logEvent).toHaveBeenCalledWith(
      "task-paused",
      "task_completed",
      expect.objectContaining({
        message: "Task stopped by user; current progress accepted.",
        terminalStatus: "ok",
        terminalStatusReason: "user_accepted_current_progress",
      }),
    );
    expect(daemonLike.clearRetryState).toHaveBeenCalledWith("task-paused");
    expect(daemonLike.finishQueueSlot).toHaveBeenCalledWith("task-paused");
  });

  it("cancelTaskRecord persists cancelled status and emits canonical terminal events", () => {
    const daemonLike = Object.assign(Object.create(AgentDaemon.prototype), {
      taskRepo: {
        findById: vi.fn().mockReturnValue({
          id: "task-cancelled",
          status: "executing",
        }),
        update: vi.fn(),
      },
      approvalRepo: {
        update: vi.fn(),
      },
      clearRetryState: vi.fn(),
      clearTimelineTaskState: vi.fn(),
      activeTasks: new Map([
        [
          "task-cancelled",
          {
            status: "active",
            lastAccessed: 0,
          },
        ],
      ]),
      pendingApprovals: new Map(),
      logEvent: vi.fn(),
      teamOrchestrator: null,
    }) as Any;

    AgentDaemon.prototype.cancelTaskRecord.call(
      daemonLike,
      "task-cancelled",
      "Task was stopped by user",
    );

    expect(daemonLike.taskRepo.update).toHaveBeenCalledWith(
      "task-cancelled",
      expect.objectContaining({
        status: "cancelled",
        completedAt: expect.any(Number),
        error: null,
        terminalStatus: undefined,
        failureClass: undefined,
      }),
    );
    expect(daemonLike.clearRetryState).toHaveBeenCalledWith("task-cancelled");
    expect(daemonLike.clearTimelineTaskState).toHaveBeenCalledWith("task-cancelled");
    expect(daemonLike.activeTasks.get("task-cancelled")).toEqual(
      expect.objectContaining({
        status: "completed",
        lastAccessed: expect.any(Number),
      }),
    );
    expect(daemonLike.logEvent).toHaveBeenNthCalledWith(
      1,
      "task-cancelled",
      "task_status",
      expect.objectContaining({
        status: "cancelled",
        message: "Task was stopped by user",
      }),
    );
    expect(daemonLike.logEvent).toHaveBeenNthCalledWith(
      2,
      "task-cancelled",
      "task_cancelled",
      expect.objectContaining({
        message: "Task was stopped by user",
      }),
    );
  });
});
