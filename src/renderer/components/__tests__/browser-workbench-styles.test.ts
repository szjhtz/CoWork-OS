import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const stylesPath = fileURLToPath(new URL("../../styles/index.css", import.meta.url));

describe("Browser workbench styles", () => {
  it("keeps sidebar chrome below the app title bar", () => {
    const source = readFileSync(stylesPath, "utf8");

    expect(source).toMatch(
      /\.browser-workbench-sidebar\s*\{[^}]*padding-top:\s*var\(--title-bar-height\);/s,
    );
  });

  it("keeps fullscreen chrome below the app title bar", () => {
    const source = readFileSync(stylesPath, "utf8");

    expect(source).toMatch(
      /\.browser-workbench-fullscreen\s*\{[^}]*padding-top:\s*var\(--title-bar-height\);/s,
    );
  });

  it("keeps fullscreen tabs close to the left edge", () => {
    const source = readFileSync(stylesPath, "utf8");

    expect(source).toMatch(
      /\.browser-workbench-fullscreen\s+\.browser-workbench-header\s*\{[^}]*padding-left:\s*max\(14px,\s*env\(safe-area-inset-left\)\);/s,
    );
  });

  it("renders header button icons with the current theme color", () => {
    const source = readFileSync(stylesPath, "utf8");

    expect(source).toMatch(
      /\.browser-workbench-icon-btn svg\s*\{[^}]*stroke:\s*currentColor;/s,
    );
  });

  it("renders the new tab icon with explicit SVG styling", () => {
    const source = readFileSync(stylesPath, "utf8");

    expect(source).toMatch(
      /\.browser-workbench-tab-add svg\s*\{[^}]*stroke:\s*currentColor;[^}]*opacity:\s*1;/s,
    );
  });

  it("renders close tab icons without native button chrome", () => {
    const source = readFileSync(stylesPath, "utf8");

    expect(source).toMatch(
      /\.browser-workbench-tab-close\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;/s,
    );
    expect(source).toMatch(
      /\.browser-workbench-tab-close svg\s*\{[^}]*stroke:\s*currentColor;[^}]*opacity:\s*1;/s,
    );
  });
});
