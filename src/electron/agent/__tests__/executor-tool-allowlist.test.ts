import { describe, expect, it, vi } from "vitest";
import { TaskExecutor } from "../executor";

describe("TaskExecutor tool allow-list semantics", () => {
  function createExecutor(allowedTools?: string[]) {
    const executor = Object.create(TaskExecutor.prototype) as Any;
    executor.task = { agentConfig: { allowedTools } };
    executor.toolRegistry = {
      getTools: vi
        .fn()
        .mockReturnValue([
          { name: "read_file" },
          { name: "write_file" },
          { name: "canvas_push" },
          { name: "create_diagram" },
        ]),
    };
    executor.toolFailureTracker = {
      getDisabledTools: vi.fn().mockReturnValue([]),
    };
    executor.isVisualCanvasTask = vi.fn().mockReturnValue(false);
    executor.isCanvasTool = vi.fn((toolName: string) => toolName.startsWith('canvas_'));
    executor.workspace = { permissions: { shell: true } };
    executor.logTag = "[Executor:test]";
    return executor;
  }

  it("treats an explicitly configured empty allow-list as deny-all", () => {
    const executor = createExecutor([]);
    const availableTools = (executor as Any).getAvailableTools();

    expect(availableTools).toEqual([]);
    expect((executor as Any).isToolRestrictedByPolicy("read_file")).toBe(true);
  });

  it("does not enforce allow-list when it is not configured", () => {
    const executor = createExecutor(undefined);
    const availableTools = (executor as Any).getAvailableTools();

    expect(availableTools).toEqual([
      { name: "read_file" },
      { name: "write_file" },
      { name: "create_diagram" },
    ]);
    expect((executor as Any).isToolRestrictedByPolicy("read_file")).toBe(false);
  });

  it("does not recurse through getAvailableTools when resolving via tool hints", () => {
    const executor = Object.create(TaskExecutor.prototype) as Any;
    executor.getEffectiveExecutionMode = vi.fn().mockReturnValue("plan");
    executor.normalizeToolName = vi.fn((name: string) => ({ name }));
    executor.toolRegistry = {
      getTools: vi.fn().mockReturnValue([{ name: "custom_picker" }]),
    };
    executor.getAvailableTools = vi.fn(() => {
      throw new Error("getAvailableTools should not be called");
    });

    const requiredTools = (executor as Any).extractRequiredToolsFromStepDescription(
      "Ask clarifying questions via custom_picker before drafting.",
    ) as Set<string>;

    expect(requiredTools.has("custom_picker")).toBe(true);
    expect(executor.getAvailableTools).not.toHaveBeenCalled();
  });

  it("keeps execute-mode chat intent on a minimal step allowlist", () => {
    const executor = Object.create(TaskExecutor.prototype) as Any;
    executor.task = {
      agentConfig: {
        taskIntent: "chat",
      },
    };
    executor.getEffectiveExecutionMode = vi.fn().mockReturnValue("execute");

    const allowlist = (TaskExecutor as Any).prototype.buildStepToolAllowlist.call(
      executor,
      { requiredTools: new Set<string>() },
      "analysis",
      "general",
    );

    expect(allowlist.has("scratchpad_write")).toBe(false);
    expect(allowlist.has("count_text")).toBe(false);
    expect(allowlist.has("text_metrics")).toBe(false);
    expect(allowlist.size).toBe(0);
  });

  it("infers create_diagram for inline diagram steps", () => {
    const executor = Object.create(TaskExecutor.prototype) as Any;
    executor.getEffectiveExecutionMode = vi.fn().mockReturnValue("execute");
    executor.normalizeToolName = vi.fn((name: string) => ({ name }));
    executor.toolRegistry = {
      getTools: vi.fn().mockReturnValue([{ name: "create_diagram" }]),
    };

    const requiredTools = (executor as Any).extractRequiredToolsFromStepDescription(
      "Create a Mermaid flowchart showing the CI/CD pipeline stages.",
    ) as Set<string>;

    expect(requiredTools.has("create_diagram")).toBe(true);
  });
});
