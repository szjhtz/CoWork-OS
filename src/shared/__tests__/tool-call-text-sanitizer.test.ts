import { describe, expect, it } from "vitest";
import { sanitizeToolCallTextFromAssistant } from "../tool-call-text-sanitizer";

describe("sanitizeToolCallTextFromAssistant", () => {
  it("removes xml-style tool call markup", () => {
    const result = sanitizeToolCallTextFromAssistant(
      'Before<tool_call><tool_name>run_command</tool_name><parameters>{"command":"pwd"}</parameters></tool_call>After',
    );

    expect(result.text).toBe("BeforeAfter");
    expect(result.hadToolCallText).toBe(true);
  });

  it("suppresses plain-text run_command transcripts", () => {
    const result = sanitizeToolCallTextFromAssistant(
      'to=run_command џьjson\n{"command":"git status --short","cwd":"/tmp/repo"}\nassistant to=run_command մեկնաբանություն\n{"command":"git diff --stat","cwd":"/tmp/repo","timeout_ms":1000}',
    );

    expect(result.text).toBe("");
    expect(result.hadToolCallText).toBe(true);
    expect(result.removedSegments).toBeGreaterThan(0);
  });

  it("keeps normal prose that merely mentions commands", () => {
    const result = sanitizeToolCallTextFromAssistant(
      "I ran git status locally and the working tree is clean.",
    );

    expect(result.text).toBe("I ran git status locally and the working tree is clean.");
    expect(result.hadToolCallText).toBe(false);
  });
});
