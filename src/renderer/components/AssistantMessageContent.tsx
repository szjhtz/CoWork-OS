import { lazy, Suspense } from "react";
import { InlineHtmlPreview, InlineHtmlSourcePreview } from "./InlineHtmlPreview";
import { InlineVideoPreview } from "./InlineVideoPreview";
import { normalizeInlineLists, unwrapMarkdownCodeBlocks } from "../utils/markdown-inline-lists";
import { sanitizeToolCallTextFromAssistant } from "../../shared/tool-call-text-sanitizer";

type AssistantMessageContentProps = {
  message: string;
  markdownComponents: Any;
  workspacePath?: string;
  onOpenViewer?: (path: string) => void;
};

type VideoDirective = {
  path: string;
  title?: string;
  poster?: string;
  muted?: boolean;
  loop?: boolean;
};

type HtmlDirective = {
  path: string;
  title?: string;
};

type MessageSegment =
  | { type: "markdown"; content: string }
  | { type: "command_excerpt"; text: string; label: string; raw: string }
  | { type: "video"; directive: VideoDirective; raw: string }
  | { type: "video_error"; raw: string; error: string }
  | { type: "html"; directive: HtmlDirective; raw: string }
  | { type: "html_source"; html: string; title?: string; raw: string }
  | { type: "html_error"; raw: string; error: string };

const LazyMarkdownRenderer = lazy(() =>
  import("./MarkdownRenderer").then((module) => ({ default: module.MarkdownRenderer })),
);

function DeferredMarkdown({
  children,
  components,
}: {
  children: string;
  components?: unknown;
}) {
  return (
    <Suspense fallback={<span className="markdown-deferred-text">{children}</span>}>
      <LazyMarkdownRenderer components={components}>{children}</LazyMarkdownRenderer>
    </Suspense>
  );
}

const VIDEO_DIRECTIVE_LINE_REGEX = /^\s*::video\{(.+)\}\s*$/;
const HTML_DIRECTIVE_LINE_REGEX = /^\s*::html\{(.+)\}\s*$/;
const HTML_FENCE_START_REGEX = /^\s*```(?:html|HTML)\s*$/;
const FENCE_END_REGEX = /^\s*```\s*$/;
const DIRECTIVE_ATTR_REGEX = /(\w+)\s*=\s*("(?:[^"\\]|\\.)*"|true|false)/g;
const LONG_OSASCRIPT_MIN_CHARS = 220;
const OSASCRIPT_START_REGEX = /\b(?:Command failed:\s*)?osascript\b/i;

function normalizeCommandExcerptText(value: string): string {
  return value
    .replace(/^\s*[-*]\s+(?=(?:Command failed:\s*)?osascript\b|Command failed:\s+osascript\b)/i, "")
    .trim();
}

export function isLongOsascriptCommandText(value: string): boolean {
  const normalized = normalizeCommandExcerptText(String(value || ""));
  if (!OSASCRIPT_START_REGEX.test(normalized)) return false;
  const osascriptArgCount = normalized.match(/(?:^|\s)-e(?:\s|$)/g)?.length ?? 0;
  return (
    normalized.length >= LONG_OSASCRIPT_MIN_CHARS ||
    osascriptArgCount >= 4 ||
    (normalized.length >= 120 && /\btell application\b/i.test(normalized))
  );
}

function collectOsascriptCommandBlock(
  lines: string[],
  startIndex: number,
): { text: string; endIndex: number } | null {
  const startLine = lines[startIndex] ?? "";
  const startMatch = OSASCRIPT_START_REGEX.exec(startLine);
  if (!startMatch) return null;

  const prefix = startLine.slice(0, startMatch.index).trim();
  if (prefix && !/^[-*]$/.test(prefix)) return null;

  const blockLines = [startLine.slice(startMatch.index)];
  let endIndex = startIndex + 1;

  while (endIndex < lines.length) {
    const line = lines[endIndex];
    if (!line || line.trim().length === 0) break;
    if (!isOsascriptContinuationLine(line)) break;
    blockLines.push(line);
    endIndex += 1;
  }

  const text = normalizeCommandExcerptText(blockLines.join("\n"));
  if (!isLongOsascriptCommandText(text)) return null;
  return { text, endIndex };
}

function isOsascriptContinuationLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^[-*]\s+(?:I|Next|Retry|Tool|Then|After|Because|Summary)\b/i.test(trimmed)) {
    return false;
  }
  return (
    /(?:^|\s)-e(?:\s|$)/.test(trimmed) ||
    /^[-*]\s*(?:[)&]|epochUtc\b|US\b|RS\b)/i.test(trimmed) ||
    /\b(?:AppleScript|Calendar|calendarIdentifier|epochUtc|outRows|calList|evSummary|evLoc|evDesc|evStartSec|evEndSec)\b/i.test(
      trimmed,
    ) ||
    /^(?:set|tell|end|return|try|on|repeat|if|error|make)\b/i.test(trimmed)
  );
}

export function OsascriptCommandExcerpt({
  text,
  label = "Command failed: osascript",
}: {
  text: string;
  label?: string;
}) {
  return (
    <div className="assistant-command-excerpt" role="region" aria-label={label}>
      <div className="assistant-command-excerpt-header">
        <span>{label}</span>
        <span className="assistant-command-excerpt-hint">Scrollable preview</span>
      </div>
      <div className="assistant-command-excerpt-scroll">
        <pre>
          <code>{text}</code>
        </pre>
      </div>
    </div>
  );
}

function decodeQuotedValue(value: string): string {
  if (!value.startsWith("\"") || !value.endsWith("\"")) return value;
  return value.slice(1, -1).replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
}

function parseVideoDirective(line: string): MessageSegment {
  const match = line.match(VIDEO_DIRECTIVE_LINE_REGEX);
  if (!match) {
    return { type: "markdown", content: line };
  }

  const attrs = match[1];
  const parsed: Partial<VideoDirective> = {};
  const seenKeys = new Set<string>();
  let attrMatch: RegExpExecArray | null;

  DIRECTIVE_ATTR_REGEX.lastIndex = 0;
  while ((attrMatch = DIRECTIVE_ATTR_REGEX.exec(attrs)) !== null) {
    const key = attrMatch[1];
    const rawValue = attrMatch[2];
    seenKeys.add(key);

    if (rawValue === "true" || rawValue === "false") {
      (parsed as Record<string, unknown>)[key] = rawValue === "true";
      continue;
    }

    (parsed as Record<string, unknown>)[key] = decodeQuotedValue(rawValue);
  }

  const unmatched = attrs.replace(DIRECTIVE_ATTR_REGEX, "").trim();
  if (unmatched.length > 0) {
    return {
      type: "video_error",
      raw: line,
      error: "Invalid video directive syntax",
    };
  }

  if (!seenKeys.has("path") || typeof parsed.path !== "string" || parsed.path.trim().length === 0) {
    return {
      type: "video_error",
      raw: line,
      error: "Video embed requires a path",
    };
  }

  return {
    type: "video",
    raw: line,
    directive: {
      path: parsed.path.trim(),
      title: typeof parsed.title === "string" ? parsed.title.trim() : undefined,
      poster: typeof parsed.poster === "string" ? parsed.poster.trim() : undefined,
      muted: parsed.muted === true,
      loop: parsed.loop === true,
    },
  };
}

function parseHtmlDirective(line: string): MessageSegment {
  const match = line.match(HTML_DIRECTIVE_LINE_REGEX);
  if (!match) {
    return { type: "markdown", content: line };
  }

  const attrs = match[1];
  const parsed: Partial<HtmlDirective> = {};
  const seenKeys = new Set<string>();
  let attrMatch: RegExpExecArray | null;

  DIRECTIVE_ATTR_REGEX.lastIndex = 0;
  while ((attrMatch = DIRECTIVE_ATTR_REGEX.exec(attrs)) !== null) {
    const key = attrMatch[1];
    const rawValue = attrMatch[2];
    seenKeys.add(key);

    if (rawValue === "true" || rawValue === "false") {
      return {
        type: "html_error",
        raw: line,
        error: "HTML embed does not support boolean attributes",
      };
    }

    (parsed as Record<string, unknown>)[key] = decodeQuotedValue(rawValue);
  }

  const unmatched = attrs.replace(DIRECTIVE_ATTR_REGEX, "").trim();
  if (unmatched.length > 0) {
    return {
      type: "html_error",
      raw: line,
      error: "Invalid HTML directive syntax",
    };
  }

  if (!seenKeys.has("path") || typeof parsed.path !== "string" || parsed.path.trim().length === 0) {
    return {
      type: "html_error",
      raw: line,
      error: "HTML embed requires a path",
    };
  }

  return {
    type: "html",
    raw: line,
    directive: {
      path: parsed.path.trim(),
      title: typeof parsed.title === "string" ? parsed.title.trim() : undefined,
    },
  };
}

function getRenderableHtmlTitle(html: string): string | undefined {
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch?.[1]
    ?.replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (title) return title;

  const headingMatch = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const heading = headingMatch?.[1]
    ?.replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return heading || undefined;
}

function looksLikeRenderableHtml(html: string): boolean {
  const trimmed = html.trim();
  if (trimmed.length < 80) return false;
  if (!/<(?:!doctype|html|head|body|form|style|script|input|textarea|select|button)\b/i.test(trimmed)) {
    return false;
  }
  return /<(?:form|input|textarea|select|button)\b/i.test(trimmed) || /<html\b/i.test(trimmed);
}

export function parseAssistantMessageSegments(message: string): MessageSegment[] {
  const sanitized = sanitizeToolCallTextFromAssistant(String(message || "")).text;
  const lines = sanitized.split("\n");
  const segments: MessageSegment[] = [];
  let markdownBuffer: string[] = [];

  const flushMarkdown = () => {
    if (markdownBuffer.length === 0) return;
    segments.push({ type: "markdown", content: markdownBuffer.join("\n") });
    markdownBuffer = [];
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];

    if (HTML_FENCE_START_REGEX.test(line)) {
      const htmlLines: string[] = [];
      let endIndex = lineIndex + 1;
      while (endIndex < lines.length && !FENCE_END_REGEX.test(lines[endIndex])) {
        htmlLines.push(lines[endIndex]);
        endIndex += 1;
      }

      if (endIndex < lines.length) {
        const html = htmlLines.join("\n");
        if (looksLikeRenderableHtml(html)) {
          flushMarkdown();
          segments.push({
            type: "html_source",
            html,
            title: getRenderableHtmlTitle(html),
            raw: lines.slice(lineIndex, endIndex + 1).join("\n"),
          });
          lineIndex = endIndex;
          continue;
        }
      }
    }

    const commandBlock = collectOsascriptCommandBlock(lines, lineIndex);
    if (commandBlock) {
      flushMarkdown();
      segments.push({
        type: "command_excerpt",
        text: commandBlock.text,
        label: "Command failed: osascript",
        raw: lines.slice(lineIndex, commandBlock.endIndex).join("\n"),
      });
      lineIndex = commandBlock.endIndex - 1;
      continue;
    }

    if (line.trimStart().startsWith("::video{")) {
      flushMarkdown();
      const parsed = parseVideoDirective(line);
      if (parsed.type === "markdown") {
        markdownBuffer.push(line);
      } else {
        segments.push(parsed);
      }
      continue;
    }
    if (line.trimStart().startsWith("::html{")) {
      flushMarkdown();
      const parsed = parseHtmlDirective(line);
      if (parsed.type === "markdown") {
        markdownBuffer.push(line);
      } else {
        segments.push(parsed);
      }
      continue;
    }
    markdownBuffer.push(line);
  }

  flushMarkdown();
  return segments;
}

export function AssistantMessageContent({
  message,
  markdownComponents,
  workspacePath,
  onOpenViewer,
}: AssistantMessageContentProps) {
  const segments = parseAssistantMessageSegments(message);

  return (
    <>
      {segments.map((segment, index) => {
        if (segment.type === "markdown") {
          if (!segment.content.trim()) return null;
          const normalizedContent = normalizeInlineLists(unwrapMarkdownCodeBlocks(segment.content));
          return (
            <DeferredMarkdown key={`md-${index}`} components={markdownComponents}>
              {normalizedContent}
            </DeferredMarkdown>
          );
        }

        if (segment.type === "command_excerpt") {
          return (
            <OsascriptCommandExcerpt
              key={`command-excerpt-${index}`}
              text={segment.text}
              label={segment.label}
            />
          );
        }

        if (segment.type === "video_error") {
          return (
            <div key={`video-error-${index}`} className="assistant-video-error">
              {segment.error}
            </div>
          );
        }

        if (segment.type === "html_error") {
          return (
            <div key={`html-error-${index}`} className="assistant-html-error">
              {segment.error}
            </div>
          );
        }

        if (segment.type === "html_source") {
          return (
            <div key={`html-source-${index}`} className="assistant-html-embed assistant-html-source-embed">
              <InlineHtmlSourcePreview
                htmlContent={segment.html}
                title={segment.title}
                className="inline-html-preview-embedded"
              />
            </div>
          );
        }

        if (!workspacePath) {
          return (
            <div
              key={`directive-missing-workspace-${index}`}
              className={segment.type === "html" ? "assistant-html-error" : "assistant-video-error"}
            >
              {segment.type === "html"
                ? "HTML embeds require a workspace-backed file."
                : "Video embeds require a workspace-backed file."}
            </div>
          );
        }

        if (segment.type === "html") {
          return (
            <div key={`html-${index}`} className="assistant-html-embed">
              <InlineHtmlPreview
                filePath={segment.directive.path}
                workspacePath={workspacePath}
                title={segment.directive.title}
                onOpenViewer={onOpenViewer}
                className="inline-html-preview-embedded"
              />
            </div>
          );
        }

        return (
          <div key={`video-${index}`} className="assistant-video-embed">
            <InlineVideoPreview
              filePath={segment.directive.path}
              workspacePath={workspacePath}
              title={segment.directive.title}
              posterPath={segment.directive.poster}
              muted={segment.directive.muted}
              loop={segment.directive.loop}
              onOpenViewer={onOpenViewer}
              className="inline-video-preview-embedded"
            />
          </div>
        );
      })}
    </>
  );
}
