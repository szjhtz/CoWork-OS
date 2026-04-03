import { describe, expect, it } from "vitest";

import {
  friendlyToolCallTitle,
  friendlyToolLaneCompletedLabel,
  friendlyToolResultTitle,
  friendlyToolRunningLabel,
} from "../timeline-tool-labels";

describe("timeline-tool-labels", () => {
  it("uses plain-language running labels", () => {
    expect(friendlyToolRunningLabel("web_fetch")).toBe("Fetching a web page");
    expect(friendlyToolRunningLabel("http_request")).toBe("Fetching a web page");
    expect(friendlyToolRunningLabel("grep")).toBe("Searching in files");
  });

  it("formats tool_call titles with context", () => {
    expect(
      friendlyToolCallTitle("web_search", {
        query: "premium athletic apparel trends",
      }),
    ).toContain("Web search:");
    expect(
      friendlyToolCallTitle("web_search", {
        query: "latest news",
        provider: "brave",
      }),
    ).toContain("via Brave");
    expect(friendlyToolCallTitle("read_file", { path: "src/a.md" })).toBe("Read a.md");
    expect(
      friendlyToolCallTitle("http_request", {
        url: "https://api.github.com/repos/foo/bar/releases",
      }),
    ).toContain("api.github.com/repos/foo/bar/releases");
    expect(
      friendlyToolCallTitle("web_fetch", {
        url: "https://github.com/openclaw/openclaw/releases",
      }),
    ).toBe("Fetching github.com/openclaw/openclaw/releases");
    expect(
      friendlyToolCallTitle("search_files", {
        query: "SessionRuntime",
      }),
    ).toBe("Search files: SessionRuntime");
    expect(
      friendlyToolCallTitle("read_files", {
        patterns: ["src/renderer/**/*.tsx", "!src/**/*.test.ts"],
      }),
    ).toBe("Read files: src/renderer/**/*.tsx, !src/**/*.test.ts");
  });

  it("formats tool_result titles with detail", () => {
    expect(
      friendlyToolResultTitle(
        "http_request",
        { success: true, url: "https://example.com", title: "Example" },
        true,
      ),
    ).toBe("Fetched Example");
    expect(
      friendlyToolResultTitle(
        "web_fetch",
        { url: "https://github.com/foo/bar", title: "Releases · foo/bar · GitHub" },
        true,
      ),
    ).toBe("Fetched Releases · foo/bar · GitHub");
    expect(
      friendlyToolResultTitle(
        "web_search",
        { query: "trending news", provider: "brave" },
        true,
      ),
    ).toBe("Searched via Brave: trending news");
    expect(
      friendlyToolResultTitle(
        "read_files",
        {
          files: [{ path: "src/a.ts" }, { path: "src/b.ts" }],
        },
        true,
      ),
    ).toBe("Read files: a.ts, b.ts");
    expect(
      friendlyToolResultTitle(
        "grep",
        { pattern: "SessionRuntime", totalMatches: 2 },
        true,
      ),
    ).toBe("Searched in files: SessionRuntime");
    expect(friendlyToolResultTitle("grep", { success: true, matches: [{}, {}] }, true)).toContain(
      "match",
    );
  });

  it("uses short lane completion labels", () => {
    expect(friendlyToolLaneCompletedLabel("web_fetch", false)).toBe("Fetched page");
    expect(friendlyToolLaneCompletedLabel("web_search", true)).toBe("Search failed");
  });
});
