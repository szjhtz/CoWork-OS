import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, it, expect, vi } from "vitest";
import { BrowserTools } from "../browser-tools";
import { GuardrailManager } from "../../../guardrails/guardrail-manager";

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

  const makeTools = (browserWorkbenchService?: Any, workspaceOverride: Any = workspace) => {
    const daemon = {
      logEvent: vi.fn(),
      registerArtifact: vi.fn(),
    } as Any;

    return {
      tools: new BrowserTools(workspaceOverride, daemon, "task-1", browserWorkbenchService),
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
      confirm_real_browser_control: true,
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
      confirm_real_browser_control: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Chrome is already running with that profile");
    expect(result.retryableWithVisibleWorkbench).toBe(true);
    expect(browserWorkbenchService.navigate).not.toHaveBeenCalled();
    expect((tools as Any).browserService.navigate).not.toHaveBeenCalled();
  });

  it("requires explicit consent before reusing the system Chrome profile", async () => {
    const browserWorkbenchService = {
      getSession: vi.fn().mockReturnValue(null),
      navigate: vi.fn(),
    };
    const { tools } = makeTools(browserWorkbenchService);
    (tools as Any).ensureBrowserConfigured = vi.fn();

    const result = await tools.executeTool("browser_navigate", {
      url: "https://example.com/chat",
      profile: "user",
      browser_channel: "chrome",
    });

    expect(result.success).toBe(false);
    expect(result.consentRequired).toBe(true);
    expect((tools as Any).ensureBrowserConfigured).not.toHaveBeenCalled();
  });

  it("requires explicit consent before attaching to a real browser", async () => {
    const { tools } = makeTools();
    (tools as Any).browserService = {
      close: vi.fn(),
      init: vi.fn(),
    };

    const result = await tools.executeTool("browser_attach", {
      debugger_url: "http://localhost:9222",
    });

    expect(result.success).toBe(false);
    expect(result.consentRequired).toBe(true);
    expect((tools as Any).browserService.init).not.toHaveBeenCalled();
  });

  it("enforces guardrails before visible workbench navigation", async () => {
    const browserWorkbenchService = {
      getSession: vi.fn().mockReturnValue(null),
      navigate: vi.fn(),
    };
    const { tools } = makeTools(browserWorkbenchService);
    vi.spyOn(GuardrailManager, "isDomainAllowed").mockReturnValueOnce(false);
    vi.spyOn(GuardrailManager, "loadSettings").mockReturnValueOnce({
      allowedDomains: ["allowed.example"],
    } as Any);

    await expect(
      tools.executeTool("browser_navigate", {
        url: "https://blocked.example",
      }),
    ).rejects.toThrow("Domain not allowed");
    expect(browserWorkbenchService.navigate).not.toHaveBeenCalled();
  });

  it("routes ref clicks to the visible Browser V2 session", async () => {
    const browserWorkbenchService = {
      getSession: vi.fn().mockReturnValue({
        taskId: "task-1",
        sessionId: "default",
        webContentsId: 123,
      }),
      clickRef: vi.fn().mockResolvedValue({
        success: true,
        ref: "b2:snap:1",
      }),
    };
    const { tools } = makeTools(browserWorkbenchService);

    const result = await tools.executeTool("browser_click", {
      ref: "b2:snap:1",
    });

    expect(result.success).toBe(true);
    expect(browserWorkbenchService.clickRef).toHaveBeenCalledWith(
      "task-1",
      "b2:snap:1",
      undefined,
    );
  });

  it("rejects browser_upload_file when a workspace path resolves outside through a symlink", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "browser-upload-workspace-"));
    const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "browser-upload-external-"));
    const externalFile = path.join(externalRoot, "secret.txt");
    const linkPath = path.join(workspaceRoot, "upload.txt");
    fs.writeFileSync(externalFile, "secret");
    try {
      fs.symlinkSync(externalFile, linkPath);
    } catch {
      return;
    }

    const browserWorkbenchService = {
      getSession: vi.fn().mockReturnValue({
        taskId: "task-1",
        sessionId: "default",
        webContentsId: 123,
      }),
      uploadFile: vi.fn(),
    };
    const { tools } = makeTools(browserWorkbenchService, {
      ...workspace,
      path: workspaceRoot,
      permissions: {
        ...workspace.permissions,
        allowedPaths: [],
        unrestrictedFileAccess: false,
      },
    });

    await expect(
      tools.executeTool("browser_upload_file", {
        file_path: "upload.txt",
        selector: "input[type=file]",
      }),
    ).rejects.toThrow("Read permission not granted");
    expect(browserWorkbenchService.uploadFile).not.toHaveBeenCalled();
  });

  it("does not emit fake Browser V2 refs for headless snapshot fallback", async () => {
    const { tools } = makeTools({
      getSession: vi.fn().mockReturnValue(null),
    });
    (tools as Any).browserService = {
      getContent: vi.fn().mockResolvedValue({
        url: "https://example.com",
        title: "Example",
        links: [{ text: "Docs", href: "https://example.com/docs" }],
      }),
    };

    const result = await tools.executeTool("browser_snapshot", {});

    expect(result.success).toBe(true);
    expect(result.refSupport).toBe(false);
    expect(result.nodes[0].ref).toBeUndefined();
  });
});
