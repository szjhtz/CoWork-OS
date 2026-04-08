import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { TranscriptStore } from "../TranscriptStore";

const createdDirs: string[] = [];

async function createWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-transcript-store-"));
  createdDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(createdDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("TranscriptStore", () => {
  it("writes checkpoints and restores them synchronously", async () => {
    const workspacePath = await createWorkspace();

    await TranscriptStore.writeCheckpoint(workspacePath, "task-1", {
      checkpointKind: "completion",
      conversationHistory: [{ role: "user", content: "hello" }],
      trackerState: { filesRead: ["src/app.ts"] },
      structuredSummary: {
        source: "completion",
        decisions: ["Ship the migration fix"],
        openLoops: [],
        nextActions: ["Run the release checklist"],
        keyFindings: ["The installer was missing built artifacts"],
      },
      evidencePacket: {
        generatedAt: Date.now(),
        spanHash: "abc123",
        spanCount: 1,
        spans: [
          {
            sourceType: "task_message",
            objectId: "event-1",
            taskId: "task-1",
            timestamp: Date.now(),
            type: "assistant_message",
            excerpt: "Ship the migration fix.",
          },
        ],
      },
    });

    const restored = TranscriptStore.loadCheckpointSync(workspacePath, "task-1");
    expect(restored?.conversationHistory).toEqual([{ role: "user", content: "hello" }]);
    expect(restored?.checkpointKind).toBe("completion");
    expect(restored?.structuredSummary?.decisions).toContain("Ship the migration fix");
  });

  it("appends searchable transcript spans", async () => {
    const workspacePath = await createWorkspace();

    await TranscriptStore.appendEvent(workspacePath, {
      id: "event-1",
      taskId: "task-1",
      timestamp: Date.now(),
      type: "assistant_message",
      payload: { message: "Layered memory is ready" },
      schemaVersion: 2,
    });

    const results = await TranscriptStore.searchSpans({
      workspacePath,
      taskId: "task-1",
      query: "layered memory",
      limit: 5,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.type).toBe("assistant_message");
  });

  it("persists user messages so verbatim recall can capture both sides of the exchange", async () => {
    const workspacePath = await createWorkspace();

    await TranscriptStore.appendEvent(workspacePath, {
      id: "event-user-1",
      taskId: "task-1",
      timestamp: Date.now(),
      type: "user_message",
      payload: { message: "Never mutate the production DB directly." },
      schemaVersion: 2,
    });

    const results = await TranscriptStore.searchSpans({
      workspacePath,
      taskId: "task-1",
      query: "production db directly",
      limit: 5,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.type).toBe("user_message");
  });

  it("caps task-scoped search results without scanning every older matching line", async () => {
    const workspacePath = await createWorkspace();

    for (let index = 0; index < 6; index += 1) {
      await TranscriptStore.appendEvent(workspacePath, {
        id: `event-${index}`,
        taskId: "task-limit",
        timestamp: Date.now() + index,
        type: "assistant_message",
        payload: { message: `Layered memory result ${index}` },
        schemaVersion: 2,
      });
    }

    const results = await TranscriptStore.searchSpans({
      workspacePath,
      taskId: "task-limit",
      query: "layered memory",
      limit: 3,
    });

    expect(results).toHaveLength(3);
    expect(results[0]?.timestamp).toBeGreaterThan(results[2]?.timestamp || 0);
  });
});
