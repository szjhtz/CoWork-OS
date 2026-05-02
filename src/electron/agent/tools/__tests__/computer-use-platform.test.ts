import { afterEach, describe, expect, it, vi } from "vitest";
import { ComputerUseTools } from "../computer-use-tools";
import { setComputerUseProviderFactoryForTesting } from "../../../computer-use/provider";

const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: platform,
  });
}

afterEach(() => {
  setPlatform(originalPlatform);
  setComputerUseProviderFactoryForTesting(null);
});

describe("ComputerUseTools platform exposure", () => {
  it("exposes computer-use tools on macOS", () => {
    setPlatform("darwin");
    const tools = ComputerUseTools.getToolDefinitions({ headless: false }).map((tool) => tool.name);
    expect(tools).toContain("screenshot");
    expect(tools).toContain("click");
    expect(tools).toContain("type_text");
  });

  it("exposes computer-use tools on Windows", () => {
    setPlatform("win32");
    const tools = ComputerUseTools.getToolDefinitions({ headless: false }).map((tool) => tool.name);
    expect(tools).toContain("screenshot");
    expect(tools).toContain("click");
    expect(tools).toContain("type_text");
  });

  it("hides computer-use tools in headless mode", () => {
    setPlatform("win32");
    expect(ComputerUseTools.getToolDefinitions({ headless: true })).toEqual([]);
  });

  it("hides computer-use tools on unsupported desktop platforms", () => {
    setPlatform("linux");
    expect(ComputerUseTools.getToolDefinitions({ headless: false })).toEqual([]);
  });

  it("resolves the helper through the provider interface", async () => {
    setPlatform("win32");
    const provider = {
      ensureReadyWithInteractivePermissions: vi.fn().mockResolvedValue(undefined),
      getFrontmost: vi.fn().mockResolvedValue({ appName: "Notepad", pid: 42, windowId: 100 }),
      listWindows: vi.fn().mockResolvedValue([
        {
          windowId: 100,
          title: "Untitled - Notepad",
          framePoints: { x: 0, y: 0, w: 300, h: 200 },
          scaleFactor: 1,
          isMinimized: false,
          isOnscreen: true,
          isMain: true,
          isFocused: true,
        },
      ]),
      unminimizeWindow: vi.fn().mockResolvedValue(undefined),
      activateApp: vi.fn().mockResolvedValue(undefined),
      raiseWindow: vi.fn().mockResolvedValue(undefined),
      screenshot: vi.fn().mockResolvedValue({
        pngBase64: Buffer.from("png").toString("base64"),
        width: 300,
        height: 200,
        scaleFactor: 1,
      }),
    };
    setComputerUseProviderFactoryForTesting(() => provider as Any);
    const daemon = { logEvent: vi.fn() };
    const tools = new ComputerUseTools({ id: "w", name: "W", path: "/tmp", createdAt: 0, permissions: {} } as Any, daemon as Any, "task-1");

    await tools.screenshot();

    expect(provider.ensureReadyWithInteractivePermissions).toHaveBeenCalled();
    expect(provider.screenshot).toHaveBeenCalledWith(100);
  });
});
