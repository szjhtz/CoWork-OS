import { beforeEach, describe, expect, it, vi } from "vitest";

const rankModelInvocableSkillsForQuery = vi.fn();

vi.mock("../custom-skill-loader", () => ({
  getCustomSkillLoader: () => ({
    rankModelInvocableSkillsForQuery,
  }),
}));

import { TaskExecutor } from "../executor";

describe("TaskExecutor high-confidence natural-language skill routing", () => {
  function createExecutor(prompt: string) {
    const executor = Object.create(TaskExecutor.prototype) as Any;

    executor.task = {
      id: "task-skill-route-1",
      title: "Routing test",
      prompt,
      createdAt: Date.now() - 1000,
    };

    executor.getAvailableTools = vi.fn(() => [{ name: "use_skill" }]);
    executor.emitEvent = vi.fn();
    executor.toolRegistry = {
      executeTool: vi.fn(async (_name: string, _input: Any) => ({
        success: true,
        expanded_prompt: "Expanded dual-agent review workflow",
      })),
    };

    return executor as TaskExecutor & {
      toolRegistry: { executeTool: ReturnType<typeof vi.fn> };
      emitEvent: ReturnType<typeof vi.fn>;
      getAvailableTools: ReturnType<typeof vi.fn>;
    };
  }

  beforeEach(() => {
    rankModelInvocableSkillsForQuery.mockReset();
  });

  it("deterministically expands the strongest matching skill for the PR review prompt", async () => {
    rankModelInvocableSkillsForQuery.mockReturnValue([
      {
        skill: {
          id: "codex-cli",
          name: "Codex CLI Agent",
          description: "Review a PR with Codex CLI.",
          parameters: [],
        },
        score: 0.93,
      },
      {
        skill: {
          id: "coding-agent",
          name: "Coding-agent",
          description: "Run coding agents via background process.",
          parameters: [],
        },
        score: 0.58,
      },
    ]);

    const prompt =
      "We need to review PR #55 on cowork os repo. Spin up Codex to review it.";
    const executor = createExecutor(prompt);

    const handled = await (TaskExecutor as Any).prototype.maybeHandleHighConfidenceSkillRouting.call(
      executor,
    );

    expect(handled).toBe(true);
    expect(executor.toolRegistry.executeTool).toHaveBeenCalledWith("use_skill", {
      skill_id: "codex-cli",
      parameters: {},
    });
    expect(executor.task.prompt).toBe("Expanded dual-agent review workflow");
  });

  it("does not auto-route when the top skill still needs required parameters", async () => {
    rankModelInvocableSkillsForQuery.mockReturnValue([
      {
        skill: {
          id: "repo-review",
          name: "Repo Review",
          description: "Review a repository with custom inputs.",
          parameters: [
            {
              name: "repoPath",
              type: "string",
              description: "Repository path",
              required: true,
            },
          ],
        },
        score: 0.96,
      },
    ]);

    const executor = createExecutor("Review this repo with the specialized reviewer.");
    const originalPrompt = executor.task.prompt;

    const handled = await (TaskExecutor as Any).prototype.maybeHandleHighConfidenceSkillRouting.call(
      executor,
    );

    expect(handled).toBe(false);
    expect(executor.toolRegistry.executeTool).not.toHaveBeenCalled();
    expect(executor.task.prompt).toBe(originalPrompt);
  });

  it("does not auto-route when the top two skills are too close to call safely", async () => {
    rankModelInvocableSkillsForQuery.mockReturnValue([
      {
        skill: {
          id: "codex-cli",
          name: "Codex CLI Agent",
          description: "Review with Codex.",
          parameters: [],
        },
        score: 0.82,
      },
      {
        skill: {
          id: "coding-agent",
          name: "Coding-agent",
          description: "Run coding agents.",
          parameters: [],
        },
        score: 0.75,
      },
    ]);

    const executor = createExecutor("Use codex and figure out the best next step.");
    const handled = await (TaskExecutor as Any).prototype.maybeHandleHighConfidenceSkillRouting.call(
      executor,
    );

    expect(handled).toBe(false);
    expect(executor.toolRegistry.executeTool).not.toHaveBeenCalled();
  });
});