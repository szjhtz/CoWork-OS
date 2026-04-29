import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Sidebar, truncateSidebarTitleAtWordBoundary } from "../Sidebar";

describe("Sidebar top-level destinations", () => {
  it("truncates sidebar titles at whole words", () => {
    const measureByCharacters = (value: string) => value.length;

    expect(
      truncateSidebarTitleAtWordBoundary(
        'check the "new country for onboarding',
        25,
        measureByCharacters,
      ),
    ).toBe('check the "new country...');

    expect(
      truncateSidebarTitleAtWordBoundary(
        "I need to create a presentation",
        20,
        measureByCharacters,
      ),
    ).toBe("I need to create...");
  });

  it("does not show a partial first word when a sidebar title is very narrow", () => {
    const measureByCharacters = (value: string) => value.length;

    expect(
      truncateSidebarTitleAtWordBoundary(
        "Presentation",
        5,
        measureByCharacters,
      ),
    ).toBe("...");
  });

  it("renders Agents as a primary destination and keeps More collapsed by default", () => {
    const markup = renderToStaticMarkup(
      React.createElement(Sidebar, {
        workspace: { id: "ws-1", name: "Workspace", path: "/workspace" } as Any,
        tasks: [] as Any,
        selectedTaskId: null,
        isAgentsActive: true,
        onSelectTask: () => {},
        onOpenHome: () => {},
        onOpenIdeas: () => {},
        onOpenInboxAgent: () => {},
        onOpenAgents: () => {},
        onOpenHealth: () => {},
        onNewSession: () => {},
        onOpenSettings: () => {},
        onOpenMissionControl: () => {},
        onOpenDevices: () => {},
        onTasksChanged: () => {},
      }),
    );

    expect(markup).toContain("Agents");
    expect(markup).toContain("More");
    expect(markup).not.toContain("Mission Control");
    expect(markup).toContain("aria-pressed=\"true\"");
  });

  it("expands More when a nested destination is active", () => {
    const markup = renderToStaticMarkup(
      React.createElement(Sidebar, {
        workspace: { id: "ws-1", name: "Workspace", path: "/workspace" } as Any,
        tasks: [] as Any,
        selectedTaskId: null,
        isMissionControlActive: true,
        onSelectTask: () => {},
        onOpenHome: () => {},
        onOpenIdeas: () => {},
        onOpenInboxAgent: () => {},
        onOpenAgents: () => {},
        onOpenHealth: () => {},
        onNewSession: () => {},
        onOpenSettings: () => {},
        onOpenMissionControl: () => {},
        onOpenDevices: () => {},
        onTasksChanged: () => {},
      }),
    );

    expect(markup).toContain("aria-expanded=\"true\"");
    expect(markup).toContain("Mission Control");
  });

  it("prioritizes the session title over time while a session is awaiting response", () => {
    const markup = renderToStaticMarkup(
      React.createElement(Sidebar, {
        workspace: { id: "ws-1", name: "Workspace", path: "/workspace" } as Any,
        tasks: [
          {
            id: "task-1",
            title: "Investigate the onboarding session",
            prompt: "Investigate the onboarding session",
            status: "paused",
            workspaceId: "ws-1",
            createdAt: Date.now() - 13 * 60 * 1000,
            updatedAt: Date.now() - 13 * 60 * 1000,
          },
        ] as Any,
        selectedTaskId: null,
        onSelectTask: () => {},
        onOpenHome: () => {},
        onOpenIdeas: () => {},
        onOpenInboxAgent: () => {},
        onOpenAgents: () => {},
        onOpenHealth: () => {},
        onNewSession: () => {},
        onOpenSettings: () => {},
        onOpenMissionControl: () => {},
        onOpenDevices: () => {},
        onTasksChanged: () => {},
      }),
    );

    expect(markup).toContain("Investigate the onboarding session");
    expect(markup).toContain("cli-task-title-row-awaiting");
    expect(markup).toContain("Awaiting response");
    expect(markup).not.toContain("cli-task-status awaiting");
    expect(markup).not.toContain("cli-session-indicator-awaiting");
    expect(markup).not.toContain("cli-task-time");
  });

  it("places the completion attention dot directly before the session time", () => {
    const now = Date.now();
    const markup = renderToStaticMarkup(
      React.createElement(Sidebar, {
        workspace: { id: "ws-1", name: "Workspace", path: "/workspace" } as Any,
        tasks: [
          {
            id: "task-1",
            title: "Heartbeat: Pending work from inbox",
            prompt: "Heartbeat: Pending work from inbox",
            status: "completed",
            source: "manual",
            workspaceId: "ws-1",
            createdAt: now - 60 * 1000,
            updatedAt: now - 60 * 1000,
          },
        ] as Any,
        completionAttentionTaskIds: ["task-1"],
        selectedTaskId: null,
        onSelectTask: () => {},
        onOpenHome: () => {},
        onOpenIdeas: () => {},
        onOpenInboxAgent: () => {},
        onOpenAgents: () => {},
        onOpenHealth: () => {},
        onNewSession: () => {},
        onOpenSettings: () => {},
        onOpenMissionControl: () => {},
        onOpenDevices: () => {},
        onTasksChanged: () => {},
      }),
    );

    expect(markup).toContain("cli-task-time-wrap");
    expect(markup).toContain("task-completion-unread-dot");
    expect(markup.indexOf("task-completion-unread-dot")).toBeLessThan(
      markup.indexOf("class=\"cli-task-time\""),
    );
  });
});
