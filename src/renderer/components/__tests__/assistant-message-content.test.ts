import { describe, expect, it } from "vitest";
import { parseAssistantMessageSegments } from "../AssistantMessageContent";

describe("AssistantMessageContent", () => {
  it("splits markdown and video directives", () => {
    const segments = parseAssistantMessageSegments(
      "Here is the clip.\n\n::video{path=\"artifacts/demo.mp4\" title=\"Demo clip\" muted=true loop=false}\n\nWrap up.",
    );

    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({ type: "markdown" });
    expect(segments[1]).toMatchObject({
      type: "video",
      directive: {
        path: "artifacts/demo.mp4",
        title: "Demo clip",
        muted: true,
        loop: false,
      },
    });
    expect(segments[2]).toMatchObject({ type: "markdown" });
  });

  it("returns a compact error segment for malformed directives", () => {
    const segments = parseAssistantMessageSegments("::video{title=\"Missing path\"}");
    expect(segments).toEqual([
      {
        type: "video_error",
        raw: "::video{title=\"Missing path\"}",
        error: "Video embed requires a path",
      },
    ]);
  });

  it("splits markdown and html directives", () => {
    const segments = parseAssistantMessageSegments(
      "Here is the diagram.\n\n::html{path=\"artifacts/diagram.html\" title=\"Architecture diagram\"}\n\nWrap up.",
    );

    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({ type: "markdown" });
    expect(segments[1]).toMatchObject({
      type: "html",
      directive: {
        path: "artifacts/diagram.html",
        title: "Architecture diagram",
      },
    });
    expect(segments[2]).toMatchObject({ type: "markdown" });
  });

  it("returns a compact error segment for malformed html directives", () => {
    const segments = parseAssistantMessageSegments("::html{title=\"Missing path\"}");
    expect(segments).toEqual([
      {
        type: "html_error",
        raw: "::html{title=\"Missing path\"}",
        error: "HTML embed requires a path",
      },
    ]);
  });

  it("renders full html form fences as interactive source previews", () => {
    const html = [
      "<!doctype html>",
      "<html>",
      "<head><title>Demand letter details</title></head>",
      "<body>",
      "<form>",
      "<label>Matter title <textarea name=\"title\"></textarea></label>",
      "<button type=\"submit\">Continue</button>",
      "</form>",
      "</body>",
      "</html>",
    ].join("\n");
    const segments = parseAssistantMessageSegments(
      `Answer in the form.\n\n\`\`\`html\n${html}\n\`\`\`\n\nThen I will draft the intake.`,
    );

    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({ type: "markdown", content: "Answer in the form.\n" });
    expect(segments[1]).toMatchObject({
      type: "html_source",
      title: "Demand letter details",
      html,
    });
    expect(segments[2]).toMatchObject({
      type: "markdown",
      content: "\nThen I will draft the intake.",
    });
  });

  it("keeps small html snippets as markdown code fences", () => {
    const segments = parseAssistantMessageSegments("```html\n<span>Label</span>\n```");
    expect(segments).toEqual([
      {
        type: "markdown",
        content: "```html\n<span>Label</span>\n```",
      },
    ]);
  });

  it("sanitizes leaked tool transcript prefixes before segment parsing", () => {
    const segments = parseAssistantMessageSegments(
      'Tackling: {"id":"call_skill_list","tool":"skill_list","input":{}} <tool name="skill_list">{}</tool>\n{"description":"Real content"}',
    );

    expect(segments).toEqual([
      {
        type: "markdown",
        content: 'Tackling:\n{"description":"Real content"}',
      },
    ]);
  });

  it("extracts long osascript command failures into a scrollable command segment", () => {
    const command = [
      "Command failed: osascript",
      ...Array.from({ length: 30 }, (_, index) => `-e set value${index} to "${index}"`),
    ].join(" ");

    const segments = parseAssistantMessageSegments(
      `Today failed.\n\n- ${command}\n\nI can retry with a smaller query.`,
    );

    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({ type: "markdown", content: "Today failed.\n" });
    expect(segments[1]).toMatchObject({
      type: "command_excerpt",
      label: "Command failed: osascript",
      text: expect.stringContaining("Command failed: osascript"),
    });
    expect(segments[1]).toMatchObject({
      text: expect.stringContaining('-e set value29 to "29"'),
    });
    expect(segments[2]).toMatchObject({
      type: "markdown",
      content: "\nI can retry with a smaller query.",
    });
  });

  it("does not absorb the next normal markdown bullet after a command excerpt", () => {
    const command = [
      "Command failed: osascript",
      ...Array.from({ length: 12 }, (_, index) => `-e set value${index} to "${index}"`),
    ].join(" ");

    const segments = parseAssistantMessageSegments(`- ${command}\n- Retry with a shorter query.`);

    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({
      type: "command_excerpt",
      text: expect.not.stringContaining("Retry with a shorter query"),
    });
    expect(segments[1]).toEqual({
      type: "markdown",
      content: "- Retry with a shorter query.",
    });
  });

  it("keeps short osascript mentions in normal markdown", () => {
    const segments = parseAssistantMessageSegments("Run `osascript -e 'return 1'` manually.");
    const commandOnlySegments = parseAssistantMessageSegments("osascript -e 'return 1'");

    expect(segments).toEqual([
      {
        type: "markdown",
        content: "Run `osascript -e 'return 1'` manually.",
      },
    ]);
    expect(commandOnlySegments).toEqual([
      {
        type: "markdown",
        content: "osascript -e 'return 1'",
      },
    ]);
  });
});
