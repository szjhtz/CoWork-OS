import { useEffect, useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import type { FileViewerResult } from "../../electron/preload";

type InlineHtmlPreviewProps = {
  filePath: string;
  workspacePath: string;
  title?: string;
  className?: string;
  onOpenViewer?: (path: string) => void;
};

type InlineHtmlSourcePreviewProps = {
  htmlContent: string;
  title?: string;
  className?: string;
};

const formatFileSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
};

function extractHtmlTitle(htmlContent: string): string {
  const titleMatch = htmlContent.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch?.[1]
    ?.replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (title) return title;

  const headingMatch = htmlContent.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const heading = headingMatch?.[1]
    ?.replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return heading || "Interactive HTML";
}

function InlineHtmlHeader({
  displayTitle,
  subtitle,
  onOpen,
}: {
  displayTitle: string;
  subtitle?: string;
  onOpen?: () => void;
}) {
  return (
    <div className="inline-html-header">
      <div className="inline-html-header-left">
        <div className="inline-html-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M4 4h16v16H4z" stroke="currentColor" strokeWidth="2" />
            <path
              d="m9 10-2 2 2 2M15 10l2 2-2 2M13 8l-2 8"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div className="inline-html-name-wrap">
          <div className="inline-html-filename" title={displayTitle}>
            {displayTitle}
          </div>
          {subtitle && <div className="inline-html-subtitle">{subtitle}</div>}
        </div>
      </div>
      {onOpen && (
        <div className="inline-html-header-actions">
          <button
            className="inline-html-action-btn"
            type="button"
            onClick={onOpen}
            title="Open preview"
            aria-label="Open HTML preview"
          >
            <ExternalLink size={16} strokeWidth={2.25} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}

export function InlineHtmlSourcePreview({
  htmlContent,
  title,
  className = "",
}: InlineHtmlSourcePreviewProps) {
  const displayTitle = title || extractHtmlTitle(htmlContent);

  return (
    <div className={`inline-html-preview inline-html-preview-source ${className}`.trim()}>
      <InlineHtmlHeader displayTitle={displayTitle} subtitle="HTML form" />
      <div className="inline-html-frame-wrap">
        <iframe
          className="inline-html-frame"
          srcDoc={htmlContent}
          sandbox="allow-scripts allow-forms"
          title={displayTitle}
        />
      </div>
    </div>
  );
}

export function InlineHtmlPreview({
  filePath,
  workspacePath,
  title,
  className = "",
  onOpenViewer,
}: InlineHtmlPreviewProps) {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<FileViewerResult["data"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const subtitle = useMemo(() => {
    if (!result) return "";
    return ["HTML", formatFileSize(result.size)].filter(Boolean).join(" • ");
  }, [result]);

  const displayTitle = title || result?.fileName || filePath.split("/").pop() || filePath;

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setError(null);
      setResult(null);

      try {
        const response = await window.electronAPI.readFileForViewer(filePath, workspacePath);
        if (cancelled) return;
        if (!response.success || !response.data) {
          setError(response.error || "Failed to load HTML preview");
          return;
        }
        if (response.data.fileType !== "html" || !response.data.htmlContent) {
          setError("File is not a previewable HTML document.");
          return;
        }
        setResult(response.data);
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load HTML preview");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    if (filePath && workspacePath) {
      void run();
    } else {
      setLoading(false);
    }

    return () => {
      cancelled = true;
    };
  }, [filePath, workspacePath]);

  const handleOpen = async () => {
    if (onOpenViewer) {
      onOpenViewer(filePath);
      return;
    }
    try {
      await window.electronAPI.openFile(filePath, workspacePath);
    } catch (e) {
      console.error("Failed to open HTML preview:", e);
    }
  };

  return (
    <div className={`inline-html-preview ${className}`.trim()}>
      {loading && <div className="inline-html-loading">Loading HTML preview…</div>}

      {!loading && error && <div className="inline-html-error">{error}</div>}

      {!loading && !error && result?.htmlContent && (
        <>
          <InlineHtmlHeader displayTitle={displayTitle} subtitle={subtitle} onOpen={handleOpen} />

          <div className="inline-html-frame-wrap">
            <iframe
              className="inline-html-frame"
              srcDoc={result.htmlContent}
              sandbox="allow-scripts allow-forms"
              title={displayTitle}
            />
          </div>
        </>
      )}
    </div>
  );
}
