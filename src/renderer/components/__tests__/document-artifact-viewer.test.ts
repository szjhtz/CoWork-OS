import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DocumentArtifactViewer } from "../DocumentArtifactViewer";

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

describe("DocumentArtifactViewer", () => {
  it("shows the document filename only in the header", () => {
    const markup = render(
      React.createElement(DocumentArtifactViewer, {
        filePath: "/workspace/sample.docx",
        workspacePath: "/workspace",
        mode: "sidebar",
        onClose: () => {},
        onFullscreen: () => {},
        onExitFullscreen: () => {},
      }),
    );

    expect(markup.match(/sample\.docx/g)?.length).toBe(1);
    expect(markup).toContain("Open document in full screen");
  });

  it("renders fullscreen turn context collapsed by default", () => {
    const markup = render(
      React.createElement(DocumentArtifactViewer, {
        filePath: "/workspace/sample.docx",
        workspacePath: "/workspace",
        mode: "fullscreen",
        onClose: () => {},
        onFullscreen: () => {},
        onExitFullscreen: () => {},
        onSendMessage: async () => {},
        turnContext: {
          statusLabel: "Latest turn",
          summary: "Created the sample document.",
          artifactPath: "/workspace/sample.docx",
          artifactName: "sample.docx",
        },
      }),
    );

    expect(markup).toContain("spreadsheet-viewer-turn-frame collapsed");
    expect(markup).toContain("Latest turn");
    expect(markup).not.toContain("Created the sample document.");
  });

  it("does not render edit controls before a DOCX preview is loaded", () => {
    const markup = render(
      React.createElement(DocumentArtifactViewer, {
        filePath: "/workspace/sample.rtf",
        workspacePath: "/workspace",
        mode: "sidebar",
        onClose: () => {},
        onFullscreen: () => {},
        onExitFullscreen: () => {},
      }),
    );

    expect(markup).not.toContain(">Edit</button>");
    expect(markup).toContain("Copy");
  });
});
