import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SUBCONSCIOUS_SETTINGS } from "../../../shared/subconscious";

type Any = any;

const nativeSqliteAvailable = await import("better-sqlite3")
  .then((module) => {
    try {
      const Database = module.default;
      const probe = new Database(":memory:");
      probe.close();
      return true;
    } catch {
      return false;
    }
  })
  .catch(() => false);

const describeWithSqlite = nativeSqliteAvailable ? describe : describe.skip;

describeWithSqlite("SubconsciousLoopService", () => {
  let tmpDir: string;
  let previousUserDataDir: string | undefined;
  let manager: import("../../database/schema").DatabaseManager;
  let db: ReturnType<import("../../database/schema").DatabaseManager["getDatabase"]>;

  const insertWorkspace = (name = "workspace") => {
    const workspaceId = randomUUID();
    const workspacePath = path.join(tmpDir, name);
    fs.mkdirSync(workspacePath, { recursive: true });
    db.prepare(
      `
        INSERT INTO workspaces (id, name, path, created_at, last_used_at, permissions)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
    ).run(
      workspaceId,
      name,
      workspacePath,
      Date.now(),
      Date.now(),
      JSON.stringify({
        read: true,
        write: true,
        delete: true,
        network: true,
        shell: true,
      }),
    );
    return { id: workspaceId, name, path: workspacePath };
  };

  const initGitRepo = (repoPath: string, originUrl?: string) => {
    execFileSync("git", ["init"], { cwd: repoPath });
    if (originUrl) {
      execFileSync("git", ["remote", "add", "origin", originUrl], { cwd: repoPath });
    }
  };

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cowork-subconscious-"));
    previousUserDataDir = process.env.COWORK_USER_DATA_DIR;
    process.env.COWORK_USER_DATA_DIR = tmpDir;

    const [{ DatabaseManager }, { SecureSettingsRepository }] = await Promise.all([
      import("../../database/schema"),
      import("../../database/SecureSettingsRepository"),
    ]);

    manager = new DatabaseManager();
    db = manager.getDatabase();
    new SecureSettingsRepository(db);
    const { SubconsciousSettingsManager } = await import("../SubconsciousSettingsManager");
    SubconsciousSettingsManager.clearCache();

    db.exec(`
      CREATE TABLE IF NOT EXISTS event_triggers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        source TEXT NOT NULL,
        conditions TEXT NOT NULL,
        condition_logic TEXT,
        action TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        cooldown_ms INTEGER,
        last_fired_at INTEGER,
        fire_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS briefing_config (
        workspace_id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 0,
        schedule_time TEXT,
        enabled_sections TEXT,
        delivery_channel_type TEXT,
        delivery_channel_id TEXT,
        updated_at INTEGER NOT NULL
      );
    `);
  });

  afterEach(() => {
    manager?.close();
    vi.restoreAllMocks();
    if (previousUserDataDir === undefined) {
      delete process.env.COWORK_USER_DATA_DIR;
    } else {
      process.env.COWORK_USER_DATA_DIR = previousUserDataDir;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("normalizes tasks, mailbox, heartbeat, scheduled jobs, triggers, briefing, and playbook signals into stable target refs", async () => {
    const workspace = insertWorkspace("alpha");
    initGitRepo(workspace.path, "https://github.com/CoWork-OS/CoWork-OS.git");
    const now = Date.now();

    db.prepare(
      `INSERT INTO tasks (id, title, prompt, status, workspace_id, created_at, updated_at, failure_class)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), "Fix failing test", "Investigate", "failed", workspace.id, now, now, "verification_failed");

    db.prepare(
      `INSERT INTO memory_markdown_files (workspace_id, path, content_hash, mtime, size, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(workspace.id, ".cowork/playbook.md", "hash", now, 100, now);

    db.prepare(
      `INSERT INTO mailbox_events (
        id, fingerprint, workspace_id, event_type, thread_id, provider, subject, summary_text, payload_json, created_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), "mailbox-fp", workspace.id, "message_received", "thread-1", "gmail", "Launch", "Need a reply", "{}", now, now);

    db.prepare(
      `INSERT INTO agent_roles (
        id, name, display_name, capabilities, created_at, updated_at, heartbeat_enabled, last_heartbeat_at, heartbeat_status, heartbeat_last_pulse_result
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    ).run("role-1", "Researcher", "Researcher", "[]", now, now, now, "active", "Pulse landed");

    db.prepare(
      `INSERT INTO heartbeat_runs (
        id, workspace_id, agent_role_id, run_type, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run("hb-1", workspace.id, "role-1", "pulse", "completed", now, now);

    db.prepare(
      `INSERT INTO event_triggers (
        id, name, enabled, source, conditions, action, workspace_id, created_at, updated_at
      ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)`,
    ).run("trigger-1", "Deploy trigger", "webhook", "[]", "{}", workspace.id, now, now);

    db.prepare(
      `INSERT INTO briefing_config (
        workspace_id, enabled, schedule_time, enabled_sections, updated_at
      ) VALUES (?, 1, ?, ?, ?)`,
    ).run(workspace.id, "08:00", "{}", now);

    const cronDir = path.join(tmpDir, "cron");
    fs.mkdirSync(cronDir, { recursive: true });
    fs.writeFileSync(
      path.join(cronDir, "jobs.json"),
      JSON.stringify({
        version: 1,
        jobs: [
          {
            id: "job-1",
            name: "Morning sync",
            enabled: true,
            createdAtMs: now,
            updatedAtMs: now,
            schedule: { kind: "every", everyMs: 3600000 },
            workspaceId: workspace.id,
            taskPrompt: "Summarize the state of the workspace",
            state: {},
          },
        ],
      }),
    );

    const { SubconsciousLoopService } = await import("../SubconsciousLoopService");
    const service = new SubconsciousLoopService(db, { getGlobalRoot: () => workspace.path });

    const result = await service.refreshTargets();
    const targets = service.listTargets();
    const keys = new Set(targets.map((target) => target.key));

    expect(result.targetCount).toBeGreaterThanOrEqual(8);
    expect(keys).toEqual(
      expect.setContaining([
        "global:brain",
        `workspace:${workspace.id}`,
        "code_workspace:github:CoWork-OS/CoWork-OS",
        "mailbox_thread:thread-1",
        "agent_role:role-1",
        "scheduled_task:job-1",
        "event_trigger:trigger-1",
        `briefing:${workspace.id}`,
      ]),
    );
  });

  it("deduplicates code targets by repo and prefers the canonical CoWork OS workspace root", async () => {
    const repoRootWorkspace = insertWorkspace("cowork-root");
    initGitRepo(repoRootWorkspace.path, "git@github.com:CoWork-OS/CoWork-OS.git");
    const nestedPath = path.join(repoRootWorkspace.path, "apps", "desktop");
    fs.mkdirSync(nestedPath, { recursive: true });
    const nestedWorkspaceId = randomUUID();
    db.prepare(
      `
        INSERT INTO workspaces (id, name, path, created_at, last_used_at, permissions)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
    ).run(
      nestedWorkspaceId,
      "cowork-nested",
      nestedPath,
      Date.now(),
      Date.now() + 5000,
      JSON.stringify({
        read: true,
        write: true,
        delete: true,
        network: true,
        shell: true,
      }),
    );

    const now = Date.now();
    db.prepare(
      `INSERT INTO tasks (id, title, prompt, status, workspace_id, created_at, updated_at, failure_class)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("root-task", "Fix coordinator drift", "Investigate", "failed", repoRootWorkspace.id, now, now, "verification_failed");
    db.prepare(
      `INSERT INTO tasks (id, title, prompt, status, workspace_id, created_at, updated_at, failure_class)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("nested-task", "Fix renderer drift", "Investigate", "failed", nestedWorkspaceId, now, now, "verification_failed");

    const { SubconsciousLoopService } = await import("../SubconsciousLoopService");
    const service = new SubconsciousLoopService(db, { getGlobalRoot: () => repoRootWorkspace.path });

    await service.refreshTargets();
    const codeTargets = service.listTargets().filter((target) => target.target.kind === "code_workspace");

    expect(codeTargets).toHaveLength(1);
    expect(codeTargets[0]?.key).toBe("code_workspace:github:CoWork-OS/CoWork-OS");
    expect(codeTargets[0]?.target.workspaceId).toBe(repoRootWorkspace.id);
    expect(codeTargets[0]?.target.codeWorkspacePath).toBe(repoRootWorkspace.path);

    const detail = await service.getTargetDetail("code_workspace:github:CoWork-OS/CoWork-OS");
    expect(detail?.latestEvidence).toHaveLength(2);
  });

  it("writes durable artifacts and sqlite index rows for a code workspace run", async () => {
    const workspace = insertWorkspace("beta");
    initGitRepo(workspace.path, "https://github.com/CoWork-OS/CoWork-OS.git");
    const now = Date.now();
    db.prepare(
      `INSERT INTO tasks (id, title, prompt, status, workspace_id, created_at, updated_at, failure_class)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("task-1", "Patch flaky tests", "Fix the regression", "failed", workspace.id, now, now, "verification_failed");

    const { SubconsciousLoopService } = await import("../SubconsciousLoopService");
    const createTask = vi.fn().mockResolvedValue({ id: "dispatch-task-1" });
    const getWorktreeManager = vi.fn(() => ({
      shouldUseWorktree: vi.fn().mockResolvedValue(true),
    }));
    const service = new SubconsciousLoopService(db, { getGlobalRoot: () => workspace.path });
    service.saveSettings({
      ...DEFAULT_SUBCONSCIOUS_SETTINGS,
      enabled: true,
      autoRun: false,
    });
    await service.start({
      createTask,
      getWorktreeManager,
    } as unknown as import("../../agent/daemon").AgentDaemon);

    const run = await service.runNow("code_workspace:github:CoWork-OS/CoWork-OS");
    expect(run).not.toBeNull();
    expect(createTask).toHaveBeenCalledTimes(1);

    const runRoot = path.join(
      workspace.path,
      ".cowork",
      "subconscious",
      "targets",
      "code_workspace_github_CoWork-OS_CoWork-OS",
      "runs",
      run!.id,
    );

    for (const artifact of [
      "evidence.json",
      "ideas.jsonl",
      "critique.jsonl",
      "decision.json",
      "winning-recommendation.md",
      "next-backlog.md",
      "dispatch.json",
    ]) {
      expect(fs.existsSync(path.join(runRoot, artifact))).toBe(true);
    }

    const counts = {
      runs: Number((db.prepare("SELECT COUNT(*) as count FROM subconscious_runs").get() as Any).count),
      hypotheses: Number((db.prepare("SELECT COUNT(*) as count FROM subconscious_hypotheses").get() as Any).count),
      critiques: Number((db.prepare("SELECT COUNT(*) as count FROM subconscious_critiques").get() as Any).count),
      decisions: Number((db.prepare("SELECT COUNT(*) as count FROM subconscious_decisions").get() as Any).count),
      backlog: Number((db.prepare("SELECT COUNT(*) as count FROM subconscious_backlog_items").get() as Any).count),
      dispatches: Number((db.prepare("SELECT COUNT(*) as count FROM subconscious_dispatch_records").get() as Any).count),
      legacyCampaigns: Number((db.prepare("SELECT COUNT(*) as count FROM improvement_campaigns").get() as Any).count),
    };

    expect(counts.runs).toBeGreaterThan(0);
    expect(counts.hypotheses).toBeGreaterThan(0);
    expect(counts.critiques).toBeGreaterThan(0);
    expect(counts.decisions).toBeGreaterThan(0);
    expect(counts.backlog).toBeGreaterThan(0);
    expect(counts.dispatches).toBeGreaterThan(0);
    expect(counts.legacyCampaigns).toBe(0);

    await service.stop();
  });
});
