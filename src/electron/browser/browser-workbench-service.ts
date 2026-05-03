import * as fs from "fs/promises";
import * as path from "path";
import { IPC_CHANNELS } from "../../shared/types";
import {
  BrowserSessionManager,
  getBrowserSessionManager,
} from "./browser-session-manager";

type AnyRecord = Record<string, unknown>;

export interface BrowserWorkbenchOpenRequest {
  requestId: string;
  taskId: string;
  sessionId: string;
  url?: string;
}

export interface BrowserWorkbenchSessionRegistration {
  taskId: string;
  sessionId: string;
  webContentsId: number;
  url?: string;
  title?: string;
}

export interface BrowserWorkbenchCursorEvent {
  taskId: string;
  sessionId: string;
  x: number;
  y: number;
  kind:
    | "move"
    | "click"
    | "fill"
    | "type"
    | "press"
    | "scroll"
    | "wait"
    | "select"
    | "read"
    | "navigate";
  label?: string;
  pulse?: boolean;
  at: number;
}

type BrowserWorkbenchSession = BrowserWorkbenchSessionRegistration & {
  registeredAt: number;
};

function normalizeSessionId(sessionId?: unknown): string {
  const value = typeof sessionId === "string" ? sessionId.trim() : "";
  return value || "default";
}

function sessionKey(taskId: string, sessionId?: unknown): string {
  return `${taskId}:${normalizeSessionId(sessionId)}`;
}

function normalizeUrl(rawUrl?: unknown): string {
  const value = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (!value) return "";
  if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(value)) return value;
  if (/^(localhost|127\.0\.0\.1|::1)(?::\d+)?(?:\/|$)/i.test(value)) {
    return `http://${value}`;
  }
  return `https://${value}`;
}

function compactTextScript(selector: string): string {
  return `
    (() => {
      const selector = ${JSON.stringify(selector)};
      const candidates = selector.startsWith("text=")
        ? Array.from(document.querySelectorAll("button, a, input, textarea, select, [role=button], [tabindex], *"))
            .filter((el) => (el.textContent || el.value || "").toLowerCase().includes(selector.slice(5).toLowerCase()))
        : Array.from(document.querySelectorAll(selector));
      const el = candidates.find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        const style = window.getComputedStyle(candidate);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      }) || candidates[0];
      if (!el) return null;
      return el;
    })()
  `;
}

function findElementActionScript(selector: string, action: string): string {
  return `
    (() => {
      const selector = ${JSON.stringify(selector)};
      const el = ${compactTextScript(selector)};
      if (!el) return { success: false, error: "Element not found: ${selector.replace(/"/g, '\\"')}" };
      el.scrollIntoView({ block: "center", inline: "center" });
      ${action}
    })()
  `;
}

export class BrowserWorkbenchService {
  private mainWindow: Any | null = null;
  private sessions = new Map<string, BrowserWorkbenchSession>();
  private waiters = new Map<string, Array<(session: BrowserWorkbenchSession | null) => void>>();

  constructor(private browserSessionManager: BrowserSessionManager = getBrowserSessionManager()) {}

  setMainWindow(window: Any | null): void {
    this.mainWindow = window;
  }

  registerSession(registration: BrowserWorkbenchSessionRegistration): BrowserWorkbenchSession {
    const session: BrowserWorkbenchSession = {
      ...registration,
      sessionId: normalizeSessionId(registration.sessionId),
      registeredAt: Date.now(),
    };
    const key = sessionKey(session.taskId, session.sessionId);
    this.sessions.set(key, session);
    this.browserSessionManager.registerElectronWorkbenchSession(session);
    const waiters = this.waiters.get(key);
    if (waiters) {
      this.waiters.delete(key);
      for (const resolve of waiters) resolve(session);
    }
    return session;
  }

  unregisterSession(input: { taskId: string; sessionId?: string; webContentsId?: number }): void {
    const key = sessionKey(input.taskId, input.sessionId);
    const existing = this.sessions.get(key);
    if (!existing) return;
    if (typeof input.webContentsId === "number" && existing.webContentsId !== input.webContentsId) {
      return;
    }
    this.sessions.delete(key);
    this.browserSessionManager.unregisterSession(input);
  }

  updateSessionStatus(input: {
    taskId: string;
    sessionId?: string;
    webContentsId?: number;
    url?: string;
    title?: string;
  }): void {
    const key = sessionKey(input.taskId, input.sessionId);
    const existing = this.sessions.get(key);
    if (!existing) return;
    if (typeof input.webContentsId === "number" && existing.webContentsId !== input.webContentsId) {
      return;
    }
    this.sessions.set(key, {
      ...existing,
      url: input.url ?? existing.url,
      title: input.title ?? existing.title,
    });
    this.browserSessionManager.updateSession(input);
  }

  getSession(taskId: string, sessionId?: unknown): BrowserWorkbenchSession | null {
    const session = this.sessions.get(sessionKey(taskId, sessionId));
    if (!session) return null;
    return session;
  }

  async requestOpen(input: { taskId: string; sessionId?: unknown; url?: unknown }): Promise<BrowserWorkbenchSession | null> {
    const sessionId = normalizeSessionId(input.sessionId);
    const existing = this.getSession(input.taskId, sessionId);
    if (existing) return existing;
    if (!this.mainWindow || this.mainWindow.isDestroyed?.()) return null;

    const request: BrowserWorkbenchOpenRequest = {
      requestId: `browser-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      taskId: input.taskId,
      sessionId,
      url: normalizeUrl(input.url),
    };
    this.mainWindow.webContents.send(IPC_CHANNELS.BROWSER_WORKBENCH_OPEN_REQUEST, request);
    return await this.waitForSession(input.taskId, sessionId, 12_000);
  }

  async navigate(input: { taskId: string; sessionId?: unknown; url: unknown; waitUntil?: string }): Promise<AnyRecord | null> {
    const url = normalizeUrl(input.url);
    if (!url) return null;
    const session =
      this.getSession(input.taskId, input.sessionId) ||
      (await this.requestOpen({ taskId: input.taskId, sessionId: input.sessionId, url }));
    const contents = await this.getWebContents(session);
    if (!contents) return null;
    this.emitCursor(session, { x: 32, y: 32, kind: "navigate", label: "Navigate", pulse: true });
    const loadPromise = this.waitForLoad(contents, 45_000);
    try {
      await contents.loadURL(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("ERR_ABORTED")) {
        throw error;
      }
    }
    await loadPromise.catch(() => undefined);
    return {
      success: true,
      url: contents.getURL?.() || url,
      title: contents.getTitle?.() || "",
      status: null,
      visible: true,
    };
  }

  async getContent(taskId: string, sessionId?: unknown): Promise<AnyRecord | null> {
    const contents = await this.getWebContents(this.getSession(taskId, sessionId));
    if (!contents) return null;
    return await contents.executeJavaScript(`
      (() => ({
        url: location.href,
        title: document.title || "",
        text: (document.body?.innerText || "").replace(/\\s+/g, " ").trim(),
        links: Array.from(document.links).slice(0, 200).map((link) => ({ text: (link.innerText || link.textContent || "").trim(), href: link.href })),
        forms: Array.from(document.forms).map((form) => ({
          action: form.action || "",
          method: form.method || "get",
          inputs: Array.from(form.elements).map((el) => el.getAttribute("name") || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.tagName.toLowerCase()).filter(Boolean),
        })),
      }))()
    `);
  }

  async snapshot(taskId: string, sessionId?: unknown): Promise<AnyRecord | null> {
    return (await this.browserSessionManager.snapshot({ taskId, sessionId })) as AnyRecord | null;
  }

  async clickRef(taskId: string, ref: string, sessionId?: unknown): Promise<AnyRecord | null> {
    const session = this.getSession(taskId, sessionId);
    const result = await this.browserSessionManager.clickRef({ taskId, sessionId, ref });
    if (session && result?.success) {
      this.emitCursor(session, { x: 42, y: 42, kind: "click", label: "Click", pulse: true });
    }
    return result;
  }

  async hoverRef(taskId: string, ref: string, sessionId?: unknown): Promise<AnyRecord | null> {
    const session = this.getSession(taskId, sessionId);
    const result = await this.browserSessionManager.hoverRef({ taskId, sessionId, ref });
    if (session && result?.success) {
      this.emitCursor(session, { x: 42, y: 42, kind: "move", label: "Hover" });
    }
    return result;
  }

  async dragRef(
    taskId: string,
    fromRef: string,
    toRef: string,
    sessionId?: unknown,
  ): Promise<AnyRecord | null> {
    const session = this.getSession(taskId, sessionId);
    const result = await this.browserSessionManager.dragRef({ taskId, sessionId, fromRef, toRef });
    if (session && result?.success) {
      this.emitCursor(session, { x: 42, y: 42, kind: "click", label: "Drag", pulse: true });
    }
    return result;
  }

  async fillRef(
    taskId: string,
    ref: string,
    value: string,
    sessionId?: unknown,
  ): Promise<AnyRecord | null> {
    const session = this.getSession(taskId, sessionId);
    const result = await this.browserSessionManager.fillRef({ taskId, sessionId, ref, value });
    if (session && result?.success) {
      this.emitCursor(session, { x: 42, y: 42, kind: "fill", label: "Fill" });
    }
    return result;
  }

  async typeRef(
    taskId: string,
    ref: string,
    text: string,
    sessionId?: unknown,
  ): Promise<AnyRecord | null> {
    const session = this.getSession(taskId, sessionId);
    const result = await this.browserSessionManager.typeRef({ taskId, sessionId, ref, text });
    if (session && result?.success) {
      this.emitCursor(session, { x: 42, y: 42, kind: "type", label: "Type" });
    }
    return result;
  }

  async getTextRef(taskId: string, ref: string, sessionId?: unknown): Promise<AnyRecord | null> {
    return await this.browserSessionManager.getTextRef({ taskId, sessionId, ref });
  }

  async uploadFile(input: {
    taskId: string;
    sessionId?: unknown;
    filePath: string;
    ref?: string;
    selector?: string;
  }): Promise<AnyRecord | null> {
    return await this.browserSessionManager.uploadFile(input);
  }

  async handleDialog(input: {
    taskId: string;
    sessionId?: unknown;
    accept?: boolean;
    promptText?: string;
  }): Promise<AnyRecord | null> {
    return await this.browserSessionManager.handleDialog(input);
  }

  getTabs(taskId: string, sessionId?: unknown): AnyRecord[] {
    return this.browserSessionManager.getTabs(taskId, sessionId) as unknown as AnyRecord[];
  }

  getConsole(taskId: string, sessionId?: unknown): AnyRecord | null {
    return this.browserSessionManager.getConsole(taskId, sessionId);
  }

  getNetwork(taskId: string, sessionId?: unknown): AnyRecord | null {
    return this.browserSessionManager.getNetwork(taskId, sessionId);
  }

  getDownloads(taskId: string, sessionId?: unknown): AnyRecord | null {
    return this.browserSessionManager.getDownloads(taskId, sessionId);
  }

  async getStorage(taskId: string, sessionId?: unknown): Promise<AnyRecord | null> {
    return await this.browserSessionManager.getStorage(taskId, sessionId);
  }

  async emulate(input: {
    taskId: string;
    sessionId?: unknown;
    width?: number;
    height?: number;
    deviceScaleFactor?: number;
    mobile?: boolean;
  }): Promise<AnyRecord | null> {
    return await this.browserSessionManager.emulate(input);
  }

  async traceStart(taskId: string, sessionId?: unknown): Promise<AnyRecord | null> {
    return await this.browserSessionManager.traceStart(taskId, sessionId);
  }

  async traceStop(taskId: string, sessionId?: unknown): Promise<AnyRecord | null> {
    return await this.browserSessionManager.traceStop(taskId, sessionId);
  }

  async click(taskId: string, selector: string, sessionId?: unknown): Promise<AnyRecord | null> {
    const session = this.getSession(taskId, sessionId);
    const contents = await this.getWebContents(session);
    if (!contents) return null;
    const point = await this.moveCursorToElement(session, contents, selector, "click", "Click");
    const result = await contents.executeJavaScript(findElementActionScript(selector, `
      el.click();
      return { success: true, element: selector, url: location.href, content: (document.body?.innerText || "").slice(0, 2000) };
    `));
    if (point && result?.success) {
      this.emitCursor(session, { ...point, kind: "click", label: "Click", pulse: true });
    }
    return result;
  }

  async fill(taskId: string, selector: string, value: string, sessionId?: unknown): Promise<AnyRecord | null> {
    const session = this.getSession(taskId, sessionId);
    const contents = await this.getWebContents(session);
    if (!contents) return null;
    await this.moveCursorToElement(session, contents, selector, "fill", "Fill");
    return await contents.executeJavaScript(findElementActionScript(selector, `
      el.focus();
      el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { success: true, selector, value: el.value, url: location.href };
    `));
  }

  async type(taskId: string, selector: string, text: string, sessionId?: unknown): Promise<AnyRecord | null> {
    const session = this.getSession(taskId, sessionId);
    const contents = await this.getWebContents(session);
    if (!contents) return null;
    await this.moveCursorToElement(session, contents, selector, "type", "Type");
    const focusResult = await contents.executeJavaScript(findElementActionScript(selector, `
      el.focus();
      return { success: true };
    `));
    if (!focusResult?.success) return focusResult;
    await contents.insertText(String(text || ""));
    return { success: true, selector, url: contents.getURL?.() || "" };
  }

  async press(taskId: string, key: string, sessionId?: unknown): Promise<AnyRecord | null> {
    const session = this.getSession(taskId, sessionId);
    const contents = await this.getWebContents(session);
    if (!contents) return null;
    const keyCode = String(key || "");
    this.emitCursor(session, { x: 42, y: 42, kind: "press", label: keyCode || "Key", pulse: true });
    contents.sendInputEvent({ type: "keyDown", keyCode });
    contents.sendInputEvent({ type: "keyUp", keyCode });
    return { success: true, key: keyCode, url: contents.getURL?.() || "" };
  }

  async scroll(taskId: string, direction: string, amount?: number, sessionId?: unknown): Promise<AnyRecord | null> {
    const session = this.getSession(taskId, sessionId);
    const contents = await this.getWebContents(session);
    if (!contents) return null;
    const viewport = await this.getViewportCenter(contents);
    this.emitCursor(session, {
      x: viewport.x,
      y: viewport.y,
      kind: "scroll",
      label: direction === "up" ? "Scroll up" : direction === "top" ? "Top" : direction === "bottom" ? "Bottom" : "Scroll",
      pulse: true,
    });
    return await contents.executeJavaScript(`
      (() => {
        const direction = ${JSON.stringify(direction)};
        const amount = ${Number.isFinite(amount) ? Number(amount) : 500};
        if (direction === "top") window.scrollTo({ top: 0, behavior: "smooth" });
        else if (direction === "bottom") window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
        else window.scrollBy({ top: direction === "up" ? -amount : amount, behavior: "smooth" });
        return { success: true, scrollY: window.scrollY, url: location.href };
      })()
    `);
  }

  async waitForSelector(taskId: string, selector: string, timeoutMs?: number, sessionId?: unknown): Promise<AnyRecord | null> {
    const session = this.getSession(taskId, sessionId);
    const contents = await this.getWebContents(session);
    if (!contents) return null;
    const result = await contents.executeJavaScript(`
      new Promise((resolve) => {
        const selector = ${JSON.stringify(selector)};
        const deadline = Date.now() + ${Math.max(1000, Number(timeoutMs) || 30000)};
        const tick = () => {
          const el = ${compactTextScript(selector)};
          if (el) return resolve({ success: true, selector, url: location.href });
          if (Date.now() > deadline) return resolve({ success: false, selector, error: "Timed out waiting for selector" });
          setTimeout(tick, 250);
        };
        tick();
      })
    `);
    if (result?.success) {
      await this.moveCursorToElement(session, contents, selector, "wait", "Found");
    }
    return result;
  }

  async select(taskId: string, selector: string, value: string, sessionId?: unknown): Promise<AnyRecord | null> {
    const session = this.getSession(taskId, sessionId);
    const contents = await this.getWebContents(session);
    if (!contents) return null;
    await this.moveCursorToElement(session, contents, selector, "select", "Select");
    return await contents.executeJavaScript(findElementActionScript(selector, `
      if (!(el instanceof HTMLSelectElement)) {
        return { success: false, selector, error: "Element is not a select dropdown" };
      }
      el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { success: true, selector, value: el.value, url: location.href };
    `));
  }

  async getText(taskId: string, selector: string, sessionId?: unknown): Promise<AnyRecord | null> {
    const session = this.getSession(taskId, sessionId);
    const contents = await this.getWebContents(session);
    if (!contents) return null;
    const point = await this.moveCursorToElement(session, contents, selector, "read", "Read");
    const result = await contents.executeJavaScript(findElementActionScript(selector, `
      return { success: true, text: (el.innerText || el.textContent || el.value || "").trim(), selector };
    `));
    if (point && result?.success) {
      this.emitCursor(session, { ...point, kind: "read", label: "Read" });
    }
    return result;
  }

  async evaluate(taskId: string, script: string, sessionId?: unknown): Promise<AnyRecord | null> {
    const contents = await this.getWebContents(this.getSession(taskId, sessionId));
    if (!contents) return null;
    const result = await contents.executeJavaScript(String(script || ""));
    return { success: true, result };
  }

  async goBack(taskId: string, sessionId?: unknown): Promise<AnyRecord | null> {
    const session = this.getSession(taskId, sessionId);
    const contents = await this.getWebContents(session);
    if (!contents) return null;
    this.emitCursor(session, { x: 24, y: 24, kind: "navigate", label: "Back", pulse: true });
    if (contents.canGoBack?.()) contents.goBack();
    return { success: true, url: contents.getURL?.() || "" };
  }

  async goForward(taskId: string, sessionId?: unknown): Promise<AnyRecord | null> {
    const session = this.getSession(taskId, sessionId);
    const contents = await this.getWebContents(session);
    if (!contents) return null;
    this.emitCursor(session, { x: 56, y: 24, kind: "navigate", label: "Forward", pulse: true });
    if (contents.canGoForward?.()) contents.goForward();
    return { success: true, url: contents.getURL?.() || "" };
  }

  async reload(taskId: string, sessionId?: unknown): Promise<AnyRecord | null> {
    const session = this.getSession(taskId, sessionId);
    const contents = await this.getWebContents(session);
    if (!contents) return null;
    this.emitCursor(session, { x: 88, y: 24, kind: "navigate", label: "Reload", pulse: true });
    contents.reload();
    return { success: true, url: contents.getURL?.() || "" };
  }

  async screenshot(input: {
    taskId: string;
    sessionId?: unknown;
    workspacePath: string;
    filename?: string;
    includeDataUrl?: boolean;
    fullPage?: boolean;
  }): Promise<{ path: string; fullPath: string; width: number; height: number; dataUrl?: string } | null> {
    const contents = await this.getWebContents(this.getSession(input.taskId, input.sessionId));
    if (!contents) return null;
    const capture = input.fullPage === true
      ? await this.captureFullPage(contents).catch(() => null)
      : null;
    const image = capture ? null : await contents.capturePage();
    const size = capture?.size || image.getSize();
    const png = capture?.png || image.toPNG();
    const safeName =
      typeof input.filename === "string" && input.filename.trim()
        ? path.basename(input.filename.trim())
        : `browser-screenshot-${Date.now()}.png`;
    const relativePath = path.join("artifacts", safeName.endsWith(".png") ? safeName : `${safeName}.png`);
    const fullPath = path.join(input.workspacePath, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, png);
    return {
      path: relativePath,
      fullPath,
      width: size.width,
      height: size.height,
      dataUrl: input.includeDataUrl ? `data:image/png;base64,${png.toString("base64")}` : undefined,
    };
  }

  private async captureFullPage(contents: Any): Promise<{ png: Buffer; size: { width: number; height: number } }> {
    const debug = contents.debugger;
    if (!debug) throw new Error("Browser debugger is not available for full-page capture");
    if (!debug.isAttached()) debug.attach("1.3");
    await debug.sendCommand("Page.enable").catch(() => undefined);
    const metrics = await debug.sendCommand("Page.getLayoutMetrics");
    const contentSize = metrics?.contentSize || {};
    const width = Math.max(1, Math.ceil(contentSize.width || 0));
    const height = Math.max(1, Math.ceil(contentSize.height || 0));
    const screenshot = await debug.sendCommand("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height, scale: 1 },
    });
    const data = typeof screenshot?.data === "string" ? screenshot.data : "";
    if (!data) throw new Error("Full-page screenshot returned empty data");
    return {
      png: Buffer.from(data, "base64"),
      size: { width, height },
    };
  }

  private waitForSession(taskId: string, sessionId: string, timeoutMs: number): Promise<BrowserWorkbenchSession | null> {
    const existing = this.getSession(taskId, sessionId);
    if (existing) return Promise.resolve(existing);
    const key = sessionKey(taskId, sessionId);
    return new Promise((resolve) => {
      let wrapped: ((session: BrowserWorkbenchSession | null) => void) | null = null;
      const timer = setTimeout(() => {
        const waiters = this.waiters.get(key) || [];
        const nextWaiters = waiters.filter((waiter) => waiter !== wrapped);
        if (nextWaiters.length > 0) this.waiters.set(key, nextWaiters);
        else this.waiters.delete(key);
        resolve(null);
      }, timeoutMs);
      timer.unref?.();
      wrapped = (session: BrowserWorkbenchSession | null) => {
        clearTimeout(timer);
        resolve(session);
      };
      const waiters = this.waiters.get(key) || [];
      waiters.push(wrapped);
      this.waiters.set(key, waiters);
    });
  }

  private waitForLoad(contents: Any, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      timer.unref?.();
      const finish = () => {
        clearTimeout(timer);
        contents.removeListener?.("did-finish-load", finish);
        contents.removeListener?.("did-fail-load", finish);
        resolve();
      };
      contents.once?.("did-finish-load", finish);
      contents.once?.("did-fail-load", finish);
    });
  }

  private emitCursor(
    session: BrowserWorkbenchSession | null,
    event: Omit<BrowserWorkbenchCursorEvent, "taskId" | "sessionId" | "at">,
  ): void {
    if (!session || !this.mainWindow || this.mainWindow.isDestroyed?.()) return;
    this.mainWindow.webContents.send(IPC_CHANNELS.BROWSER_WORKBENCH_CURSOR, {
      taskId: session.taskId,
      sessionId: session.sessionId,
      x: Math.max(0, Math.round(event.x)),
      y: Math.max(0, Math.round(event.y)),
      kind: event.kind,
      label: event.label,
      pulse: event.pulse,
      at: Date.now(),
    } satisfies BrowserWorkbenchCursorEvent);
  }

  private async moveCursorToElement(
    session: BrowserWorkbenchSession | null,
    contents: Any,
    selector: string,
    kind: BrowserWorkbenchCursorEvent["kind"],
    label: string,
  ): Promise<{ x: number; y: number } | null> {
    const point = await this.getElementPoint(contents, selector).catch(() => null);
    if (!point) return null;
    this.emitCursor(session, { x: point.x, y: point.y, kind, label });
    await this.sleep(140);
    return point;
  }

  private async getElementPoint(contents: Any, selector: string): Promise<{ x: number; y: number } | null> {
    const result = await contents.executeJavaScript(`
      (() => {
        const selector = ${JSON.stringify(selector)};
        const el = ${compactTextScript(selector)};
        if (!el) return null;
        el.scrollIntoView({ block: "center", inline: "center" });
        const rect = el.getBoundingClientRect();
        if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top)) return null;
        const x = Math.max(0, Math.min(window.innerWidth || rect.right, rect.left + rect.width / 2));
        const y = Math.max(0, Math.min(window.innerHeight || rect.bottom, rect.top + Math.min(rect.height / 2, 24)));
        return { x, y };
      })()
    `);
    if (!result || typeof result.x !== "number" || typeof result.y !== "number") return null;
    return { x: result.x, y: result.y };
  }

  private async getViewportCenter(contents: Any): Promise<{ x: number; y: number }> {
    const result = await contents.executeJavaScript(`
      (() => ({
        x: Math.max(24, Math.round((window.innerWidth || 800) / 2)),
        y: Math.max(24, Math.round((window.innerHeight || 600) / 2)),
      }))()
    `).catch(() => null);
    if (!result || typeof result.x !== "number" || typeof result.y !== "number") {
      return { x: 120, y: 120 };
    }
    return { x: result.x, y: result.y };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      timer.unref?.();
    });
  }

  private async getWebContents(session: BrowserWorkbenchSession | null): Promise<Any | null> {
    if (!session) return null;
    const electron = await import("electron");
    const contents = (electron as Any).webContents?.fromId?.(session.webContentsId);
    if (!contents || contents.isDestroyed?.()) {
      this.unregisterSession(session);
      return null;
    }
    return contents;
  }
}

const browserWorkbenchService = new BrowserWorkbenchService();

export function getBrowserWorkbenchService(): BrowserWorkbenchService {
  return browserWorkbenchService;
}
