import { describe, it, expect, vi } from "vitest";
import { BrowserTools } from "../browser-tools";

describe("BrowserTools browser_navigate", () => {
  const workspace = {
    id: "workspace-1",
    path: "/tmp",
    permissions: {
      read: true,
      write: true,
      delete: true,
      network: true,
      shell: true,
    },
  } as Any;

  const makeTools = (browserWorkbenchService?: Any) => {
    const daemon = {
      logEvent: vi.fn(),
      registerArtifact: vi.fn(),
    } as Any;

    return {
      tools: new BrowserTools(workspace, daemon, "task-1", browserWorkbenchService),
      daemon,
    };
  };

  it("returns success=false when navigation receives HTTP 4xx/5xx", async () => {
    const { tools } = makeTools();

    (tools as Any).browserService = {
      navigate: vi.fn().mockResolvedValue({
        url: "https://example.com/paywall",
        title: "Forbidden",
        status: 403,
        isError: true,
      }),
      close: vi.fn(),
    };

    const result = await tools.executeTool("browser_navigate", {
      url: "https://example.com/paywall",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("HTTP 403");
  });

  it("returns success=true for successful navigation", async () => {
    const { tools } = makeTools();

    (tools as Any).browserService = {
      navigate: vi.fn().mockResolvedValue({
        url: "https://example.com",
        title: "Example Domain",
        status: 200,
        isError: false,
      }),
      close: vi.fn(),
    };

    const result = await tools.executeTool("browser_navigate", {
      url: "https://example.com",
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe(200);
  });

  it("uses the visible in-app browser workbench by default when available", async () => {
    const browserWorkbenchService = {
      getSession: vi.fn().mockReturnValue(null),
      navigate: vi.fn().mockResolvedValue({
        success: true,
        url: "https://example.com",
        title: "Example Domain",
        status: null,
        visible: true,
      }),
    };
    const { tools } = makeTools(browserWorkbenchService);
    const headlessNavigate = vi.fn();
    (tools as Any).browserService = {
      navigate: headlessNavigate,
      close: vi.fn(),
    };

    const result = await tools.executeTool("browser_navigate", {
      url: "https://example.com",
    });

    expect(result.success).toBe(true);
    expect(result.visible).toBe(true);
    expect(browserWorkbenchService.navigate).toHaveBeenCalledWith({
      taskId: "task-1",
      sessionId: undefined,
      url: "https://example.com",
      waitUntil: "load",
    });
    expect(headlessNavigate).not.toHaveBeenCalled();
  });

  it("keeps using an active visible workbench when profile options are supplied later", async () => {
    const browserWorkbenchService = {
      getSession: vi.fn().mockReturnValue({
        taskId: "task-1",
        sessionId: "default",
        webContentsId: 123,
      }),
      navigate: vi.fn().mockResolvedValue({
        success: true,
        url: "https://example.com/chat",
        title: "Signed in",
        status: null,
        visible: true,
      }),
    };
    const { tools } = makeTools(browserWorkbenchService);
    const headlessNavigate = vi.fn();
    (tools as Any).browserService = {
      navigate: headlessNavigate,
      close: vi.fn(),
    };

    const result = await tools.executeTool("browser_navigate", {
      url: "https://example.com/chat",
      profile: "user",
      browser_channel: "chrome",
    });

    expect(result.success).toBe(true);
    expect(result.visible).toBe(true);
    expect(browserWorkbenchService.navigate).toHaveBeenCalledWith({
      taskId: "task-1",
      sessionId: undefined,
      url: "https://example.com/chat",
      waitUntil: "load",
    });
    expect(headlessNavigate).not.toHaveBeenCalled();
  });

  it("ignores the legacy headless flag for normal visible workbench routing", async () => {
    const browserWorkbenchService = {
      getSession: vi.fn().mockReturnValue(null),
      navigate: vi.fn().mockResolvedValue({
        success: true,
        url: "https://example.com",
        title: "Example Domain",
        status: null,
        visible: true,
      }),
    };
    const { tools } = makeTools(browserWorkbenchService);
    (tools as Any).browserService = {
      navigate: vi.fn(),
      close: vi.fn(),
    };

    const result = await tools.executeTool("browser_navigate", {
      url: "https://example.com",
      headless: true,
    });

    expect(result.success).toBe(true);
    expect(result.visible).toBe(true);
    expect(browserWorkbenchService.navigate).toHaveBeenCalled();
    expect((tools as Any).browserService.navigate).not.toHaveBeenCalled();
  });

  it("uses headless Playwright when forced", async () => {
    const browserWorkbenchService = {
      getSession: vi.fn().mockReturnValue(null),
      navigate: vi.fn(),
    };
    const { tools } = makeTools(browserWorkbenchService);
    (tools as Any).browserService = {
      navigate: vi.fn().mockResolvedValue({
        url: "https://example.com",
        title: "Example Domain",
        status: 200,
        isError: false,
      }),
      close: vi.fn(),
    };

    const result = await tools.executeTool("browser_navigate", {
      url: "https://example.com",
      force_headless: true,
    });

    expect(result.success).toBe(true);
    expect(browserWorkbenchService.navigate).not.toHaveBeenCalled();
    expect((tools as Any).browserService.navigate).toHaveBeenCalled();
  });

  it("returns a structured result when system Chrome profile launch is locked", async () => {
    const browserWorkbenchService = {
      getSession: vi.fn().mockReturnValue(null),
      navigate: vi.fn(),
    };
    const { tools } = makeTools(browserWorkbenchService);
    (tools as Any).ensureBrowserConfigured = vi
      .fn()
      .mockRejectedValue(new Error("Failed to create /Users/test/Chrome/SingletonLock"));
    (tools as Any).browserService = {
      navigate: vi.fn(),
      close: vi.fn(),
    };

    const result = await tools.executeTool("browser_navigate", {
      url: "https://example.com/chat",
      profile: "user",
      browser_channel: "chrome",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Chrome is already running with that profile");
    expect(result.retryableWithVisibleWorkbench).toBe(true);
    expect(browserWorkbenchService.navigate).not.toHaveBeenCalled();
    expect((tools as Any).browserService.navigate).not.toHaveBeenCalled();
  });
});
