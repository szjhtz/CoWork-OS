import { describe, expect, it } from "vitest";
import {
  GOOGLE_SCOPE_PRESENTATIONS,
  GOOGLE_SCOPE_TASKS,
  GOOGLE_WORKSPACE_DEFAULT_SCOPES,
  getMissingGoogleWorkspaceScopes,
  mergeGoogleWorkspaceScopes,
} from "../google-workspace";

describe("Google Workspace OAuth scopes", () => {
  it("includes Tasks and Slides scopes in the default Workspace consent set", () => {
    expect(GOOGLE_WORKSPACE_DEFAULT_SCOPES).toEqual(
      expect.arrayContaining([GOOGLE_SCOPE_TASKS, GOOGLE_SCOPE_PRESENTATIONS]),
    );
  });

  it("merges new required Workspace scopes into older saved scope lists", () => {
    expect(mergeGoogleWorkspaceScopes(["https://www.googleapis.com/auth/drive"])).toEqual(
      expect.arrayContaining([GOOGLE_SCOPE_TASKS, GOOGLE_SCOPE_PRESENTATIONS]),
    );
  });

  it("reports missing scopes only when a saved scope list is available", () => {
    expect(getMissingGoogleWorkspaceScopes(undefined)).toEqual([]);
    expect(getMissingGoogleWorkspaceScopes(["https://www.googleapis.com/auth/drive"])).toEqual(
      expect.arrayContaining([GOOGLE_SCOPE_TASKS, GOOGLE_SCOPE_PRESENTATIONS]),
    );
  });
});
