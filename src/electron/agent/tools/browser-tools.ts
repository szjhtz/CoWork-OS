import * as os from "os";
import * as path from "path";
import { Workspace } from "../../../shared/types";
import { AgentDaemon } from "../daemon";
import { BrowserService } from "../browser/browser-service";
import {
  BrowserWorkbenchService,
  getBrowserWorkbenchService,
} from "../../browser/browser-workbench-service";

// oxlint-disable-next-line typescript-eslint/no-explicit-any
type Any = any;

/**
 * BrowserTools provides browser automation capabilities to the agent
 */
export class BrowserTools {
  private browserService: BrowserService;
  private browserState: {
    headless: boolean;
    profile: string | null;
    browserChannel: "chromium" | "chrome" | "brave";
    debuggerUrl: string | null;
  } = {
    headless: true,
    profile: null,
    browserChannel: "chromium",
    debuggerUrl: null,
  };

  constructor(
    private workspace: Workspace,
    private daemon: AgentDaemon,
    private taskId: string,
    private browserWorkbenchService: BrowserWorkbenchService = getBrowserWorkbenchService(),
  ) {
    this.browserService = new BrowserService(workspace, {
      headless: true,
      timeout: 90000, // 90 seconds - time for browser launch + navigation + consent popup handling
    });
  }

  /**
   * Update the workspace for this tool
   * Recreates the browser service with the new workspace
   */
  setWorkspace(workspace: Workspace): void {
    this.workspace = workspace;
    // Recreate browser service with new workspace (and reset to defaults)
    this.browserService = new BrowserService(workspace, {
      headless: true,
      timeout: 90000,
    });
    this.browserState = {
      headless: true,
      profile: null,
      browserChannel: "chromium",
      debuggerUrl: null,
    };
  }

  private getTimeoutMs(input: unknown): number | undefined {
    const toolInput = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
    const rawTimeout = toolInput?.timeout_ms;
    if (typeof rawTimeout === "number" && Number.isFinite(rawTimeout) && rawTimeout > 0) {
      return Math.round(rawTimeout);
    }
    return undefined;
  }

  private getSessionId(input: unknown): string | undefined {
    const toolInput = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
    return typeof toolInput.session_id === "string" && toolInput.session_id.trim()
      ? toolInput.session_id.trim()
      : undefined;
  }

  private shouldPreferVisibleWorkbench(input: unknown): boolean {
    const toolInput = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
    const forceHeadless =
      toolInput.force_headless === true ||
      toolInput.mode === "headless" ||
      toolInput.visible === false ||
      toolInput.browser_surface === "headless";
    if (forceHeadless) return false;
    if (typeof toolInput.debugger_url === "string" && toolInput.debugger_url.trim()) return false;
    if (this.hasVisibleWorkbenchSession(input)) return true;
    if (typeof toolInput.profile === "string" && toolInput.profile.trim()) return false;
    if (typeof toolInput.browser_channel === "string" && toolInput.browser_channel.trim()) return false;
    if (this.browserState.profile || this.browserState.debuggerUrl) return false;
    return true;
  }

  private isProfileLaunchConflict(error: unknown): boolean {
    const message = String((error as Error)?.message || error || "");
    return /ProcessSingleton|SingletonLock|profile.*in use|already running with this profile|already in use/i.test(
      message,
    );
  }

  private profileLaunchConflictResult(error: unknown): Any {
    const message = String((error as Error)?.message || error || "");
    return {
      success: false,
      error:
        "Chrome is already running with that profile, so I could not launch a separate profile-backed browser. Continue in the visible Browser Use session, or attach to an already-running Chrome instance with browser_attach and a debugger_url.",
      details: message,
      browserMode: "external_profile",
      retryableWithVisibleWorkbench: true,
    };
  }

  private hasVisibleWorkbenchSession(input: unknown): boolean {
    return Boolean(this.browserWorkbenchService.getSession(this.taskId, this.getSessionId(input)));
  }

  private getPersistentUserDataDir(profile: string): string {
    const trimmed = profile.trim().toLowerCase();
    if (trimmed === "user") {
      return this.getSystemChromeUserDataDir();
    }
    if (trimmed === "chrome-relay") {
      return path.join(this.workspace.path, ".cowork", "browser-profiles", "chrome-relay");
    }
    if (trimmed === "workspace") {
      return path.join(this.workspace.path, ".cowork", "browser-profiles", "default");
    }
    const safe =
      path
        .basename(profile.trim())
        .replace(/[^a-zA-Z0-9._-]+/g, "_")
        .slice(0, 64) || "default";
    return path.join(this.workspace.path, ".cowork", "browser-profiles", safe);
  }

  private getSystemChromeUserDataDir(): string {
    const home = os.homedir();
    if (process.platform === "darwin") {
      return path.join(home, "Library", "Application Support", "Google", "Chrome");
    }
    if (process.platform === "win32") {
      const local = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
      return path.join(local, "Google", "Chrome", "User Data");
    }
    return path.join(home, ".config", "google-chrome");
  }

  private async ensureBrowserConfigured(opts: {
    headless?: unknown;
    profile?: unknown;
    browser_channel?: unknown;
    debugger_url?: unknown;
  }): Promise<void> {
    const requestedHeadless = typeof opts.headless === "boolean" ? opts.headless : undefined;
    const profileRaw = typeof opts.profile === "string" ? opts.profile.trim() : undefined;
    const requestedProfile =
      profileRaw !== undefined ? (profileRaw ? profileRaw : null) : undefined;
    const channelRaw =
      typeof opts.browser_channel === "string" ? opts.browser_channel.trim().toLowerCase() : "";
    const requestedChannel =
      channelRaw === "chrome" || channelRaw === "chromium" || channelRaw === "brave"
        ? channelRaw
        : undefined;
    const debuggerUrlRaw =
      typeof opts.debugger_url === "string" ? opts.debugger_url.trim() || null : null;

    const nextHeadless = requestedHeadless ?? this.browserState.headless;
    const nextProfile = requestedProfile ?? this.browserState.profile;
    const nextChannel =
      requestedChannel ??
      (nextProfile?.toLowerCase() === "user" ? "chrome" : this.browserState.browserChannel);
    const nextDebuggerUrl =
      requestedProfile !== undefined || requestedChannel !== undefined
        ? null
        : debuggerUrlRaw ?? this.browserState.debuggerUrl;

    if (
      nextHeadless === this.browserState.headless &&
      nextProfile === this.browserState.profile &&
      nextChannel === this.browserState.browserChannel &&
      nextDebuggerUrl === this.browserState.debuggerUrl
    ) {
      return;
    }

    await this.browserService.close();
    this.browserService = new BrowserService(this.workspace, {
      headless: nextHeadless,
      timeout: 90000,
      userDataDir: nextProfile ? this.getPersistentUserDataDir(nextProfile) : undefined,
      channel: nextChannel,
      debuggerUrl: nextDebuggerUrl ?? undefined,
    });
    this.browserState = {
      headless: nextHeadless,
      profile: nextProfile,
      browserChannel: nextChannel,
      debuggerUrl: nextDebuggerUrl,
    };
  }

  /**
   * Get the tool definitions for browser automation
   */
  static getToolDefinitions() {
    return [
      {
        name: "browser_attach",
        description:
          "Attach to an existing Chrome browser session via Chrome DevTools Protocol. " +
          "Use when you need to control a signed-in browser (e.g. Gmail, social media). " +
          "Setup: Launch Chrome with --remote-debugging-port=9222, or visit chrome://inspect/#devices. " +
          "The debugger_url is typically http://localhost:9222 or the WebSocket URL from the version endpoint. " +
          "After attach, use browser_navigate and other browser_* tools on the attached session.",
        input_schema: {
          type: "object" as const,
          properties: {
            debugger_url: {
              type: "string",
              description:
                "Chrome DevTools endpoint (e.g. http://localhost:9222 or ws://127.0.0.1:9222/... from chrome://inspect)",
            },
          },
          required: ["debugger_url"],
        },
      },
      {
        name: "browser_navigate",
        description:
          "Navigate the browser to a URL. For interactive testing, this opens and controls the visible in-app browser workbench for the active task by default. " +
          "If a visible workbench session already exists, continue using it even when profile/browser_channel options are supplied. " +
          "The legacy headless flag is compatibility-only and does not override the visible workbench for normal site testing. " +
          "Optional: set force_headless=true only when the user explicitly asks for background/headless Playwright. " +
          "Optional: set profile to use a Playwright browser profile or external signed-in Chrome fallback (not the embedded workbench). " +
          'Optional: set browser_channel to "chrome" (system Google Chrome) or "brave" (system Brave); default is bundled Chromium. ' +
          "NOTE: For RESEARCH tasks (finding news, trends, discussions), use web_search instead - it aggregates results from multiple sources. " +
          "For simply reading a specific URL, use web_fetch - it is faster and lighter. " +
          "Use browser_navigate ONLY when you need to interact with the page (click, fill forms, take screenshots) or when the page requires JavaScript rendering.",
        input_schema: {
          type: "object" as const,
          properties: {
            url: {
              type: "string",
              description: "The URL to navigate to",
            },
            wait_until: {
              type: "string",
              enum: ["load", "domcontentloaded", "networkidle"],
              description: "When to consider navigation complete. Default: load",
            },
            headless: {
              type: "boolean",
              description:
                "Compatibility flag for legacy Playwright fallback. Ignored for normal visible in-app browser workbench routing.",
            },
            force_headless: {
              type: "boolean",
              description:
                "Force the legacy headless Playwright path. Use only when the user explicitly asks for background/headless browsing.",
            },
            profile: {
              type: "string",
              description:
                "Optional profile. Presets: 'user' (system Chrome signed-in), 'chrome-relay' (extension relay), 'workspace' (workspace default). " +
                "Or any name for .cowork/browser-profiles/<name>.",
            },
            browser_channel: {
              type: "string",
              enum: ["chromium", "chrome", "brave"],
              description:
                'Which browser binary to use (default: chromium). "chrome" requires Google Chrome; "brave" requires Brave (or BRAVE_PATH).',
            },
            session_id: {
              type: "string",
              description:
                "Optional visible in-app browser workbench session id. Defaults to the active task browser session.",
            },
          },
          required: ["url"],
        },
      },
      {
        name: "browser_screenshot",
        description: "Take a screenshot of the current page",
        input_schema: {
          type: "object" as const,
          properties: {
            filename: {
              type: "string",
              description: "Filename for the screenshot (optional, will generate if not provided)",
            },
            full_page: {
              type: "boolean",
              description: "Capture the full scrollable page. Default: false",
            },
            require_selector: {
              type: "string",
              description:
                "Optional CSS selector that must be present/visible before taking the screenshot",
            },
            disallow_url_contains: {
              type: "array",
              items: { type: "string" },
              description: "If current URL contains any of these substrings, abort screenshot",
            },
            max_wait_ms: {
              type: "number",
              description: "Max wait time for require_selector (ms). Default: 10000",
            },
            allow_consent: {
              type: "boolean",
              description: "Allow screenshots of consent pages (default: false)",
            },
            session_id: {
              type: "string",
              description: "Optional visible in-app browser workbench session id.",
            },
          },
        },
      },
      {
        name: "browser_get_content",
        description:
          "Get the text content, links, and forms from the current page. " +
          "NOTE: For RESEARCH tasks, use web_search first - it is more efficient for finding information across multiple sources. " +
          "If you just need to read a specific URL, use web_fetch - it is faster and does not require opening a browser. " +
          "Use this only after browser_navigate when you need JavaScript-rendered content or to inspect forms/links for interaction.",
        input_schema: {
          type: "object" as const,
          properties: {
            session_id: {
              type: "string",
              description: "Optional visible in-app browser workbench session id.",
            },
          },
        },
      },
      {
        name: "browser_click",
        description: "Click on an element on the page",
        input_schema: {
          type: "object" as const,
          properties: {
            selector: {
              type: "string",
              description:
                'CSS selector or text selector (e.g., "button.submit", "text=Login", "#myButton")',
            },
            timeout_ms: {
              type: "number",
              description: "Action timeout in ms. Use 60000+ for slow pages (default: 90_000)",
            },
            session_id: {
              type: "string",
              description: "Optional visible in-app browser workbench session id.",
            },
          },
          required: ["selector"],
        },
      },
      {
        name: "browser_fill",
        description: "Fill a form field with text",
        input_schema: {
          type: "object" as const,
          properties: {
            selector: {
              type: "string",
              description:
                'CSS selector for the input field (e.g., "input[name=email]", "#username")',
            },
            value: {
              type: "string",
              description: "The text to fill in",
            },
            timeout_ms: {
              type: "number",
              description: "Action timeout in ms. Use 60000+ for slow pages (default: 90_000)",
            },
            session_id: {
              type: "string",
              description: "Optional visible in-app browser workbench session id.",
            },
          },
          required: ["selector", "value"],
        },
      },
      {
        name: "browser_type",
        description: "Type text character by character (useful for search boxes with autocomplete)",
        input_schema: {
          type: "object" as const,
          properties: {
            selector: {
              type: "string",
              description: "CSS selector for the input field",
            },
            text: {
              type: "string",
              description: "The text to type",
            },
            delay: {
              type: "number",
              description: "Delay between keystrokes in ms. Default: 50",
            },
            timeout_ms: {
              type: "number",
              description: "Action timeout in ms. Use 60000+ for slow pages (default: 90_000)",
            },
            session_id: {
              type: "string",
              description: "Optional visible in-app browser workbench session id.",
            },
          },
          required: ["selector", "text"],
        },
      },
      {
        name: "browser_press",
        description: "Press a keyboard key (e.g., Enter, Tab, Escape)",
        input_schema: {
          type: "object" as const,
          properties: {
            key: {
              type: "string",
              description: 'The key to press (e.g., "Enter", "Tab", "Escape", "ArrowDown")',
            },
            session_id: {
              type: "string",
              description: "Optional visible in-app browser workbench session id.",
            },
          },
          required: ["key"],
        },
      },
      {
        name: "browser_wait",
        description: "Wait for an element to appear on the page",
        input_schema: {
          type: "object" as const,
          properties: {
            selector: {
              type: "string",
              description: "CSS selector to wait for",
            },
            timeout: {
              type: "number",
              description: "Max time to wait in ms. Default: 30000",
            },
            session_id: {
              type: "string",
              description: "Optional visible in-app browser workbench session id.",
            },
          },
          required: ["selector"],
        },
      },
      {
        name: "browser_scroll",
        description: "Scroll the page",
        input_schema: {
          type: "object" as const,
          properties: {
            direction: {
              type: "string",
              enum: ["up", "down", "top", "bottom"],
              description: "Direction to scroll",
            },
            amount: {
              type: "number",
              description: "Pixels to scroll (for up/down). Default: 500",
            },
            session_id: {
              type: "string",
              description: "Optional visible in-app browser workbench session id.",
            },
          },
          required: ["direction"],
        },
      },
      {
        name: "browser_select",
        description: "Select an option from a dropdown",
        input_schema: {
          type: "object" as const,
          properties: {
            selector: {
              type: "string",
              description: "CSS selector for the select element",
            },
            value: {
              type: "string",
              description: "Value to select",
            },
            session_id: {
              type: "string",
              description: "Optional visible in-app browser workbench session id.",
            },
          },
          required: ["selector", "value"],
        },
      },
      {
        name: "browser_get_text",
        description: "Get the text content of an element",
        input_schema: {
          type: "object" as const,
          properties: {
            selector: {
              type: "string",
              description: "CSS selector for the element",
            },
            session_id: {
              type: "string",
              description: "Optional visible in-app browser workbench session id.",
            },
          },
          required: ["selector"],
        },
      },
      {
        name: "browser_evaluate",
        description: "Execute JavaScript code in the browser context",
        input_schema: {
          type: "object" as const,
          properties: {
            script: {
              type: "string",
              description: "JavaScript code to execute",
            },
            session_id: {
              type: "string",
              description: "Optional visible in-app browser workbench session id.",
            },
          },
          required: ["script"],
        },
      },
      {
        name: "browser_back",
        description: "Go back in browser history",
        input_schema: {
          type: "object" as const,
          properties: {
            session_id: {
              type: "string",
              description: "Optional visible in-app browser workbench session id.",
            },
          },
        },
      },
      {
        name: "browser_forward",
        description: "Go forward in browser history",
        input_schema: {
          type: "object" as const,
          properties: {
            session_id: {
              type: "string",
              description: "Optional visible in-app browser workbench session id.",
            },
          },
        },
      },
      {
        name: "browser_reload",
        description: "Reload the current page",
        input_schema: {
          type: "object" as const,
          properties: {
            session_id: {
              type: "string",
              description: "Optional visible in-app browser workbench session id.",
            },
          },
        },
      },
      {
        name: "browser_save_pdf",
        description: "Save the current page as a PDF",
        input_schema: {
          type: "object" as const,
          properties: {
            filename: {
              type: "string",
              description: "Filename for the PDF (optional)",
            },
          },
        },
      },
      {
        name: "browser_act_batch",
        description:
          "Execute a batch of browser actions in sequence. Use for multi-step interactions (e.g. fill form, click submit, wait for result). " +
          "Each action can have an optional delay_ms before it runs. Actions: click, fill, type, press, wait, scroll.",
        input_schema: {
          type: "object" as const,
          properties: {
            actions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: {
                    type: "string",
                    enum: ["click", "fill", "type", "press", "wait", "scroll"],
                    description: "Action type",
                  },
                  selector: {
                    type: "string",
                    description: "CSS selector (required for click, fill, type, wait)",
                  },
                  value: { type: "string", description: "Value for fill" },
                  text: { type: "string", description: "Text for type" },
                  key: { type: "string", description: "Key for press (e.g. Enter, Tab)" },
                  direction: {
                    type: "string",
                    enum: ["up", "down", "top", "bottom"],
                    description: "Scroll direction",
                  },
                  amount: { type: "number", description: "Scroll amount in pixels" },
                  timeout_ms: { type: "number", description: "Wait timeout for wait action" },
                  delay_ms: {
                    type: "number",
                    description: "Delay before this action (ms)",
                  },
                },
                required: ["type"],
              },
              description: "Array of actions to execute in order",
            },
            session_id: {
              type: "string",
              description: "Optional visible in-app browser workbench session id.",
            },
          },
          required: ["actions"],
        },
      },
      {
        name: "browser_close",
        description: "Close the browser",
        input_schema: {
          type: "object" as const,
          properties: {},
        },
      },
    ];
  }

  /**
   * Execute a browser tool
   */
  async executeTool(toolName: string, input: Any): Promise<Any> {
    switch (toolName) {
      case "browser_attach": {
        const debuggerUrl = typeof input?.debugger_url === "string" ? input.debugger_url.trim() : "";
        if (!debuggerUrl) {
          return {
            success: false,
            error: "debugger_url is required. Use http://localhost:9222 or the WebSocket URL from chrome://inspect",
          };
        }
        await this.browserService.close();
        this.browserService = new BrowserService(this.workspace, {
          headless: true,
          timeout: 90000,
          debuggerUrl,
        });
        this.browserState = {
          ...this.browserState,
          debuggerUrl,
        };
        await this.browserService.init();
        const url = this.browserService.getUrl();
        this.daemon.logEvent(this.taskId, "browser_action", {
          action: "attach",
          debuggerUrl: debuggerUrl.replace(/\/[^/]*$/, "/..."),
        });
        return {
          success: true,
          message: "Attached to existing Chrome session",
          currentUrl: url || "(new tab)",
        };
      }

      case "browser_navigate": {
        if (this.shouldPreferVisibleWorkbench(input)) {
          const visibleResult = await this.browserWorkbenchService.navigate({
            taskId: this.taskId,
            sessionId: this.getSessionId(input),
            url: input?.url,
            waitUntil: input?.wait_until || "load",
          });
          if (visibleResult) {
            this.daemon.logEvent(this.taskId, "browser_action", {
              action: "navigate",
              url: visibleResult.url,
              title: visibleResult.title,
              sessionId: this.getSessionId(input) || "default",
              visible: true,
            });
            return visibleResult;
          }
        }
        let result;
        try {
          await this.ensureBrowserConfigured({
            headless: input?.force_headless === true ? true : input?.headless,
            profile: input?.profile,
            browser_channel: input?.browser_channel,
            debugger_url: this.browserState.debuggerUrl,
          });
          result = await this.browserService.navigate(input.url, input.wait_until || "load");
        } catch (error) {
          if (this.isProfileLaunchConflict(error)) {
            const conflictResult = this.profileLaunchConflictResult(error);
            this.daemon.logEvent(this.taskId, "browser_action", {
              action: "navigate",
              url: input?.url,
              success: false,
              browserMode: "external_profile",
              profileLaunchConflict: true,
            });
            return conflictResult;
          }
          throw error;
        }
        this.daemon.logEvent(this.taskId, "browser_action", {
          action: "navigate",
          url: result.url,
          title: result.title,
        });
        if (result.isError) {
          const statusText =
            typeof result.status === "number" ? `HTTP ${result.status}` : "unknown HTTP status";
          return {
            success: false,
            error: `Navigation failed with ${statusText}`,
            ...result,
          };
        }

        return {
          success: true,
          ...result,
        };
      }

      case "browser_screenshot": {
        const {
          filename,
          full_page,
          require_selector,
          disallow_url_contains,
          max_wait_ms,
          allow_consent,
        } = input || {};

        if (this.shouldPreferVisibleWorkbench(input) && this.hasVisibleWorkbenchSession(input)) {
          if (require_selector) {
            const waitResult = await this.browserWorkbenchService.waitForSelector(
              this.taskId,
              require_selector,
              max_wait_ms || 10000,
              this.getSessionId(input),
            );
            if (!waitResult?.success) {
              throw new Error(`Required selector not found: ${require_selector}`);
            }
          }
          const current = await this.browserWorkbenchService.getContent(
            this.taskId,
            this.getSessionId(input),
          );
          const currentUrl = typeof current?.url === "string" ? current.url : "";
          if (!allow_consent && currentUrl.includes("consent.google.com")) {
            throw new Error("Consent page detected; dismiss consent before taking screenshot.");
          }
          if (Array.isArray(disallow_url_contains) && disallow_url_contains.length > 0) {
            for (const fragment of disallow_url_contains) {
              if (fragment && currentUrl.includes(fragment)) {
                throw new Error(`Current URL matches disallowed fragment: ${fragment}`);
              }
            }
          }
          const result = await this.browserWorkbenchService.screenshot({
            taskId: this.taskId,
            sessionId: this.getSessionId(input),
            workspacePath: this.workspace.path,
            filename,
          });
          if (result) {
            const fullPath = path.join(this.workspace.path, result.path);
            this.daemon.logEvent(this.taskId, "file_created", {
              path: result.path,
              type: "screenshot",
            });
            this.daemon.registerArtifact(this.taskId, fullPath, "image/png");
            return { success: true, ...result, visible: true };
          }
        }

        if (require_selector) {
          const waitResult = await this.browserService.waitForSelector(
            require_selector,
            max_wait_ms || 10000,
          );
          if (!waitResult.success) {
            throw new Error(`Required selector not found: ${require_selector}`);
          }
        }

        if (!allow_consent) {
          const currentUrl = await this.browserService.getCurrentUrl();
          if (currentUrl.includes("consent.google.com")) {
            throw new Error("Consent page detected; dismiss consent before taking screenshot.");
          }
        }

        if (Array.isArray(disallow_url_contains) && disallow_url_contains.length > 0) {
          const currentUrl = await this.browserService.getCurrentUrl();
          for (const fragment of disallow_url_contains) {
            if (fragment && currentUrl.includes(fragment)) {
              throw new Error(`Current URL matches disallowed fragment: ${fragment}`);
            }
          }
        }

        const result = await this.browserService.screenshot(filename, full_page || false);
        // Construct full path for the screenshot
        const fullPath = path.join(this.workspace.path, result.path);

        this.daemon.logEvent(this.taskId, "file_created", {
          path: result.path,
          type: "screenshot",
        });

        // Register as artifact so it can be sent back to the user
        this.daemon.registerArtifact(this.taskId, fullPath, "image/png");

        return result;
      }

      case "browser_get_content": {
        if (this.shouldPreferVisibleWorkbench(input) && this.hasVisibleWorkbenchSession(input)) {
          const result = await this.browserWorkbenchService.getContent(
            this.taskId,
            this.getSessionId(input),
          );
          if (result) {
            this.daemon.logEvent(this.taskId, "browser_action", {
              action: "get_content",
              url: result.url,
              visible: true,
            });
            return { success: true, ...result };
          }
        }
        const result = await this.browserService.getContent();
        this.daemon.logEvent(this.taskId, "browser_action", {
          action: "get_content",
          url: result.url,
        });
        return result;
      }

      case "browser_click": {
        if (this.shouldPreferVisibleWorkbench(input) && this.hasVisibleWorkbenchSession(input)) {
          const result = await this.browserWorkbenchService.click(
            this.taskId,
            input.selector,
            this.getSessionId(input),
          );
          if (result) {
            this.daemon.logEvent(this.taskId, "browser_action", {
              action: "click",
              selector: input.selector,
              success: result.success,
              visible: true,
            });
            return result;
          }
        }
        const result = await this.browserService.click(input.selector, this.getTimeoutMs(input));
        this.daemon.logEvent(this.taskId, "browser_action", {
          action: "click",
          selector: input.selector,
          success: result.success,
        });
        return result;
      }

      case "browser_fill": {
        if (this.shouldPreferVisibleWorkbench(input) && this.hasVisibleWorkbenchSession(input)) {
          const result = await this.browserWorkbenchService.fill(
            this.taskId,
            input.selector,
            input.value,
            this.getSessionId(input),
          );
          if (result) {
            this.daemon.logEvent(this.taskId, "browser_action", {
              action: "fill",
              selector: input.selector,
              success: result.success,
              visible: true,
            });
            return result;
          }
        }
        const result = await this.browserService.fill(
          input.selector,
          input.value,
          this.getTimeoutMs(input),
        );
        this.daemon.logEvent(this.taskId, "browser_action", {
          action: "fill",
          selector: input.selector,
          success: result.success,
        });
        return result;
      }

      case "browser_type": {
        if (this.shouldPreferVisibleWorkbench(input) && this.hasVisibleWorkbenchSession(input)) {
          const result = await this.browserWorkbenchService.type(
            this.taskId,
            input.selector,
            input.text,
            this.getSessionId(input),
          );
          if (result) {
            this.daemon.logEvent(this.taskId, "browser_action", {
              action: "type",
              selector: input.selector,
              success: result.success,
              visible: true,
            });
            return result;
          }
        }
        const result = await this.browserService.type(
          input.selector,
          input.text,
          input.delay || 50,
          this.getTimeoutMs(input),
        );
        this.daemon.logEvent(this.taskId, "browser_action", {
          action: "type",
          selector: input.selector,
          success: result.success,
        });
        return result;
      }

      case "browser_press": {
        if (this.shouldPreferVisibleWorkbench(input) && this.hasVisibleWorkbenchSession(input)) {
          const result = await this.browserWorkbenchService.press(
            this.taskId,
            input.key,
            this.getSessionId(input),
          );
          if (result) {
            this.daemon.logEvent(this.taskId, "browser_action", {
              action: "press",
              key: input.key,
              success: result.success,
              visible: true,
            });
            return result;
          }
        }
        const result = await this.browserService.press(input.key);
        this.daemon.logEvent(this.taskId, "browser_action", {
          action: "press",
          key: input.key,
          success: result.success,
        });
        return result;
      }

      case "browser_wait": {
        if (this.shouldPreferVisibleWorkbench(input) && this.hasVisibleWorkbenchSession(input)) {
          const result = await this.browserWorkbenchService.waitForSelector(
            this.taskId,
            input.selector,
            input.timeout,
            this.getSessionId(input),
          );
          if (result) {
            this.daemon.logEvent(this.taskId, "browser_action", {
              action: "wait",
              selector: input.selector,
              success: result.success,
              visible: true,
            });
            return result;
          }
        }
        const result = await this.browserService.waitForSelector(input.selector, input.timeout);
        this.daemon.logEvent(this.taskId, "browser_action", {
          action: "wait",
          selector: input.selector,
          success: result.success,
        });
        return result;
      }

      case "browser_scroll": {
        if (this.shouldPreferVisibleWorkbench(input) && this.hasVisibleWorkbenchSession(input)) {
          const result = await this.browserWorkbenchService.scroll(
            this.taskId,
            input.direction,
            input.amount,
            this.getSessionId(input),
          );
          if (result) {
            this.daemon.logEvent(this.taskId, "browser_action", {
              action: "scroll",
              direction: input.direction,
              visible: true,
            });
            return result;
          }
        }
        const result = await this.browserService.scroll(input.direction, input.amount);
        this.daemon.logEvent(this.taskId, "browser_action", {
          action: "scroll",
          direction: input.direction,
        });
        return result;
      }

      case "browser_select": {
        if (this.shouldPreferVisibleWorkbench(input) && this.hasVisibleWorkbenchSession(input)) {
          const result = await this.browserWorkbenchService.select(
            this.taskId,
            input.selector,
            input.value,
            this.getSessionId(input),
          );
          if (result) {
            this.daemon.logEvent(this.taskId, "browser_action", {
              action: "select",
              selector: input.selector,
              success: result.success,
              visible: true,
            });
            return result;
          }
        }
        const result = await this.browserService.select(input.selector, input.value);
        this.daemon.logEvent(this.taskId, "browser_action", {
          action: "select",
          selector: input.selector,
          success: result.success,
        });
        return result;
      }

      case "browser_get_text": {
        if (this.shouldPreferVisibleWorkbench(input) && this.hasVisibleWorkbenchSession(input)) {
          const result = await this.browserWorkbenchService.getText(
            this.taskId,
            input.selector,
            this.getSessionId(input),
          );
          if (result) return result;
        }
        const result = await this.browserService.getText(input.selector);
        return result;
      }

      case "browser_evaluate": {
        const script = typeof input?.script === "string" ? input.script : "";
        if (/(require\s*\(|child_process|execSync|exec\(|spawn\()/i.test(script)) {
          throw new Error(
            "browser_evaluate cannot run Node.js APIs. Use run_command for shell commands.",
          );
        }
        if (this.shouldPreferVisibleWorkbench(input) && this.hasVisibleWorkbenchSession(input)) {
          const result = await this.browserWorkbenchService.evaluate(
            this.taskId,
            input.script,
            this.getSessionId(input),
          );
          if (result) {
            this.daemon.logEvent(this.taskId, "browser_action", {
              action: "evaluate",
              success: result.success,
              visible: true,
            });
            return result;
          }
        }
        const result = await this.browserService.evaluate(input.script);
        this.daemon.logEvent(this.taskId, "browser_action", {
          action: "evaluate",
          success: result.success,
        });
        return result;
      }

      case "browser_back": {
        if (this.shouldPreferVisibleWorkbench(input) && this.hasVisibleWorkbenchSession(input)) {
          const result = await this.browserWorkbenchService.goBack(
            this.taskId,
            this.getSessionId(input),
          );
          if (result) {
            this.daemon.logEvent(this.taskId, "browser_action", {
              action: "back",
              url: result.url,
              visible: true,
            });
            return result;
          }
        }
        const result = await this.browserService.goBack();
        this.daemon.logEvent(this.taskId, "browser_action", {
          action: "back",
          url: result.url,
        });
        return result;
      }

      case "browser_forward": {
        if (this.shouldPreferVisibleWorkbench(input) && this.hasVisibleWorkbenchSession(input)) {
          const result = await this.browserWorkbenchService.goForward(
            this.taskId,
            this.getSessionId(input),
          );
          if (result) {
            this.daemon.logEvent(this.taskId, "browser_action", {
              action: "forward",
              url: result.url,
              visible: true,
            });
            return result;
          }
        }
        const result = await this.browserService.goForward();
        this.daemon.logEvent(this.taskId, "browser_action", {
          action: "forward",
          url: result.url,
        });
        return result;
      }

      case "browser_reload": {
        if (this.shouldPreferVisibleWorkbench(input) && this.hasVisibleWorkbenchSession(input)) {
          const result = await this.browserWorkbenchService.reload(
            this.taskId,
            this.getSessionId(input),
          );
          if (result) {
            this.daemon.logEvent(this.taskId, "browser_action", {
              action: "reload",
              url: result.url,
              visible: true,
            });
            return result;
          }
        }
        const result = await this.browserService.reload();
        this.daemon.logEvent(this.taskId, "browser_action", {
          action: "reload",
          url: result.url,
        });
        return result;
      }

      case "browser_save_pdf": {
        const result = await this.browserService.savePdf(input.filename);
        this.daemon.logEvent(this.taskId, "file_created", {
          path: result.path,
          type: "pdf",
        });
        return result;
      }

      case "browser_act_batch": {
        const actions = Array.isArray(input?.actions) ? input.actions : [];
        if (actions.length === 0) {
          return { success: false, error: "actions array is required and must not be empty" };
        }
        if (this.shouldPreferVisibleWorkbench(input) && this.hasVisibleWorkbenchSession(input)) {
          const results: Array<{ type: string; success: boolean; error?: string }> = [];
          for (let i = 0; i < actions.length; i++) {
            const act = actions[i] as Record<string, unknown>;
            const delayMs = typeof act.delay_ms === "number" && act.delay_ms > 0 ? act.delay_ms : 0;
            if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
            const actType = String(act.type || "").toLowerCase();
            try {
              let result: Any = null;
              if (actType === "click") {
                result = await this.browserWorkbenchService.click(
                  this.taskId,
                  String(act.selector || ""),
                  this.getSessionId(input),
                );
              } else if (actType === "fill") {
                result = await this.browserWorkbenchService.fill(
                  this.taskId,
                  String(act.selector || ""),
                  String(act.value ?? ""),
                  this.getSessionId(input),
                );
              } else if (actType === "type") {
                result = await this.browserWorkbenchService.type(
                  this.taskId,
                  String(act.selector || ""),
                  String(act.text ?? ""),
                  this.getSessionId(input),
                );
              } else if (actType === "press") {
                result = await this.browserWorkbenchService.press(
                  this.taskId,
                  String(act.key || ""),
                  this.getSessionId(input),
                );
              } else if (actType === "wait") {
                result = await this.browserWorkbenchService.waitForSelector(
                  this.taskId,
                  String(act.selector || ""),
                  (act.timeout_ms as number) || 10000,
                  this.getSessionId(input),
                );
              } else if (actType === "scroll") {
                const direction =
                  act.direction === "up" ||
                  act.direction === "down" ||
                  act.direction === "top" ||
                  act.direction === "bottom"
                    ? act.direction
                    : "down";
                result = await this.browserWorkbenchService.scroll(
                  this.taskId,
                  direction,
                  typeof act.amount === "number" ? act.amount : undefined,
                  this.getSessionId(input),
                );
              } else {
                results.push({ type: actType, success: false, error: `Unknown action type: ${actType}` });
                break;
              }
              results.push({
                type: actType,
                success: result?.success !== false,
                error: result?.error,
              });
              if (result?.success === false) break;
            } catch (err) {
              results.push({
                type: actType,
                success: false,
                error: err instanceof Error ? err.message : String(err),
              });
              break;
            }
          }
          const allSuccess = results.every((r) => r.success);
          this.daemon.logEvent(this.taskId, "browser_action", {
            action: "act_batch",
            count: actions.length,
            completed: results.length,
            success: allSuccess,
            visible: true,
          });
          return {
            success: allSuccess,
            results,
            completed: results.length,
            total: actions.length,
          };
        }
        const results: Array<{ type: string; success: boolean; error?: string }> = [];
        const timeoutMs = this.getTimeoutMs(input);
        for (let i = 0; i < actions.length; i++) {
          const act = actions[i] as Record<string, unknown>;
          const delayMs = typeof act.delay_ms === "number" && act.delay_ms > 0 ? act.delay_ms : 0;
          if (delayMs > 0) {
            await new Promise((r) => setTimeout(r, delayMs));
          }
          const actType = String(act.type || "").toLowerCase();
          try {
            if (actType === "click") {
              const r = await this.browserService.click(
                String(act.selector || ""),
                (act.timeout_ms as number) || timeoutMs,
              );
              results.push({ type: "click", success: r.success, error: r.error });
              if (!r.success) break;
            } else if (actType === "fill") {
              const r = await this.browserService.fill(
                String(act.selector || ""),
                String(act.value ?? ""),
                (act.timeout_ms as number) || timeoutMs,
              );
              results.push({ type: "fill", success: r.success, error: r.error });
              if (!r.success) break;
            } else if (actType === "type") {
              const r = await this.browserService.type(
                String(act.selector || ""),
                String(act.text ?? ""),
                typeof act.delay_ms === "number" ? act.delay_ms : 50,
                (act.timeout_ms as number) || timeoutMs,
              );
              results.push({ type: "type", success: r.success, error: r.error });
              if (!r.success) break;
            } else if (actType === "press") {
              const r = await this.browserService.press(String(act.key || ""));
              results.push({ type: "press", success: r.success, error: (r as Any).error });
              if (!r.success) break;
            } else if (actType === "wait") {
              const r = await this.browserService.waitForSelector(
                String(act.selector || ""),
                (act.timeout_ms as number) || timeoutMs || 10000,
              );
              results.push({ type: "wait", success: r.success, error: (r as Any).error });
              if (!r.success) break;
            } else if (actType === "scroll") {
              const direction =
                act.direction === "up" ||
                act.direction === "down" ||
                act.direction === "top" ||
                act.direction === "bottom"
                  ? act.direction
                  : "down";
              const r = await this.browserService.scroll(
                direction,
                typeof act.amount === "number" ? act.amount : undefined,
              );
              results.push({ type: "scroll", success: (r as Any).success });
            } else {
              results.push({ type: actType, success: false, error: `Unknown action type: ${actType}` });
              break;
            }
          } catch (err) {
            results.push({
              type: actType,
              success: false,
              error: err instanceof Error ? err.message : String(err),
            });
            break;
          }
        }
        const allSuccess = results.every((r) => r.success);
        this.daemon.logEvent(this.taskId, "browser_action", {
          action: "act_batch",
          count: actions.length,
          completed: results.length,
          success: allSuccess,
        });
        return {
          success: allSuccess,
          results,
          completed: results.length,
          total: actions.length,
        };
      }

      case "browser_close": {
        await this.browserService.close();
        this.daemon.logEvent(this.taskId, "browser_action", {
          action: "close",
        });
        return { success: true };
      }

      default:
        throw new Error(`Unknown browser tool: ${toolName}`);
    }
  }

  /**
   * Check if a tool name is a browser tool
   */
  static isBrowserTool(toolName: string): boolean {
    return toolName.startsWith("browser_");
  }

  /**
   * Close the browser when done
   */
  async cleanup(): Promise<void> {
    await this.browserService.close();
  }
}
