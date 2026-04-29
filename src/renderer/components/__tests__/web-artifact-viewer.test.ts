import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WebArtifactViewer } from "../WebArtifactViewer";

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

describe("WebArtifactViewer", () => {
  it("shows the web filename only in the header", () => {
    const markup = render(
      React.createElement(WebArtifactViewer, {
        filePath: "/workspace/index.html",
        workspacePath: "/workspace",
        mode: "sidebar",
        onClose: () => {},
        onFullscreen: () => {},
        onExitFullscreen: () => {},
      }),
    );

    expect(markup.match(/index\.html/g)?.length).toBe(1);
    expect(markup).toContain("Open web page in full screen");
  });

  it("renders fullscreen turn context collapsed by default", () => {
    const markup = render(
      React.createElement(WebArtifactViewer, {
        filePath: "/workspace/index.html",
        workspacePath: "/workspace",
        mode: "fullscreen",
        onClose: () => {},
        onFullscreen: () => {},
        onExitFullscreen: () => {},
        onSendMessage: async () => {},
        turnContext: {
          statusLabel: "Latest turn",
          summary: "Created the page.",
          artifactPath: "/workspace/index.html",
          artifactName: "index.html",
        },
      }),
    );

    expect(markup).toContain("spreadsheet-viewer-turn-frame collapsed");
    expect(markup).toContain("Latest turn");
    expect(markup).not.toContain("Created the page.");
  });

  it("renders review controls before an HTML preview is loaded", () => {
    const markup = render(
      React.createElement(WebArtifactViewer, {
        filePath: "/workspace/index.html",
        workspacePath: "/workspace",
        mode: "sidebar",
        onClose: () => {},
        onFullscreen: () => {},
        onExitFullscreen: () => {},
      }),
    );

    expect(markup).toContain("HTML");
    expect(markup).toContain("Copy");
    expect(markup).toContain("Folder");
  });
});
