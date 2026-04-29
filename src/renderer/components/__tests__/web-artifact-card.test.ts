import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WebArtifactCard } from "../WebArtifactCard";

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

describe("WebArtifactCard", () => {
  it("renders a compact Codex-style web page output card", () => {
    const markup = render(
      React.createElement(WebArtifactCard, {
        filePath: "/workspace/artifacts/index.html",
        workspacePath: "/workspace",
        onOpenViewer: () => {},
      }),
    );

    expect(markup).toContain("web-artifact-card");
    expect(markup).toContain("index.html");
    expect(markup).toContain("Web page · HTML");
    expect(markup).toContain("Open");
    expect(markup).toContain("web-artifact-menu-btn");
    expect(markup).not.toContain('role="menu"');
  });

  it("labels htm outputs", () => {
    const markup = render(
      React.createElement(WebArtifactCard, {
        filePath: "/workspace/output.htm",
        workspacePath: "/workspace",
        onOpenViewer: () => {},
      }),
    );

    expect(markup).toContain("Web page · HTM");
  });
});
