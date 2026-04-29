import { describe, expect, it, vi } from "vitest";
import { TaskExecutor } from "../executor";

describe("TaskExecutor image attachment routing", () => {
  it("emits a user-facing switch-model message when the active provider cannot accept images", async () => {
    const executor = Object.create(TaskExecutor.prototype) as Any;
    executor.provider = { type: "gemini" };
    executor.emitEvent = vi.fn();

    const result = await executor.buildUserContent("What is in this image?", [
      {
        data: "AA==",
        mimeType: "image/png",
        filename: "image.png",
        sizeBytes: 2,
      },
    ]);

    expect(result).toBe(
      "I can't analyze attached images with the current model. Switch to an image-capable model/provider and resend the image.",
    );
    expect(executor.emitEvent).toHaveBeenCalledWith("assistant_message", {
      message:
        "I can't analyze attached images with the current model. Switch to an image-capable model/provider and resend the image.",
    });
  });
});
