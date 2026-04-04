import { describe, expect, it, vi } from "vitest";

import { AgentDaemon } from "../daemon";

describe("AgentDaemon terminal lifecycle helpers", () => {
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
