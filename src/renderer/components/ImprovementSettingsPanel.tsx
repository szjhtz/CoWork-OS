import { useEffect, useMemo, useState } from "react";
import type {
  ImprovementCandidate,
  ImprovementLoopSettings,
  ImprovementRun,
  Workspace,
} from "../../shared/types";

const ALL_WORKSPACES_VALUE = "__all_workspaces__";

const DEFAULT_SETTINGS: ImprovementLoopSettings = {
  enabled: false,
  autoRun: true,
  includeDevLogs: true,
  intervalMinutes: 24 * 60,
  maxConcurrentExperiments: 1,
  maxOpenCandidatesPerWorkspace: 25,
  requireWorktree: true,
  reviewRequired: true,
  promotionMode: "github_pr",
  evalWindowDays: 14,
};

const SCROLL_PANEL_STYLE = {
  maxHeight: 360,
  overflowY: "auto" as const,
  paddingRight: 6,
};

function getWorkspaceModeMeta(workspace: Workspace | undefined) {
  if (!workspace) {
    return {
      label: "Unknown",
      tone: "#6b7280",
      description: "Workspace details are unavailable.",
    };
  }
  if (workspace.id === ALL_WORKSPACES_VALUE) {
    return {
      label: "Aggregate View",
      tone: "var(--color-accent-primary)",
      description: "Showing issues and runs across every workspace.",
    };
  }
  if (workspace.isTemp) {
    return {
      label: "Direct Apply",
      tone: "#b7791f",
      description: "Temporary workspaces can run improvements, but successful runs apply directly instead of opening a PR.",
    };
  }
  return {
    label: "Promotable If Git-Backed",
    tone: "#2f855a",
    description: "If this workspace supports git worktrees, successful runs can move into review and open a PR or merge.",
  };
}

export function ImprovementSettingsPanel(props?: {
  initialWorkspaceId?: string;
  onOpenTask?: (taskId: string) => void;
}) {
  const [settings, setSettings] = useState<ImprovementLoopSettings>(DEFAULT_SETTINGS);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [candidates, setCandidates] = useState<ImprovementCandidate[]>([]);
  const [runs, setRuns] = useState<ImprovementRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<string>("");
  const [candidateStatusFilter, setCandidateStatusFilter] = useState("all");
  const [candidateSourceFilter, setCandidateSourceFilter] = useState("all");

  const pendingReviewRuns = useMemo(
    () =>
      runs.filter(
        (run) =>
          run.status === "passed" &&
          (run.reviewStatus === "pending" || run.promotionStatus === "promotion_failed"),
      ),
    [runs],
  );
  const recentPromotedRuns = useMemo(
    () =>
      [...runs]
        .filter(
          (run) =>
            run.promotionStatus === "applied" ||
            run.promotionStatus === "merged" ||
            run.promotionStatus === "pr_opened",
        )
        .sort((a, b) => (b.promotedAt || b.createdAt) - (a.promotedAt || a.createdAt))
        .slice(0, 5),
    [runs],
  );
  const workspaceNameById = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace.name])),
    [workspaces],
  );
  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId),
    [workspaces, selectedWorkspaceId],
  );
  const selectedWorkspaceMode = useMemo(
    () => getWorkspaceModeMeta(selectedWorkspace),
    [selectedWorkspace],
  );
  const recentRuns = useMemo(
    () =>
      [...runs]
        .sort((a, b) => (b.startedAt || b.createdAt) - (a.startedAt || a.createdAt))
        .slice(0, 10),
    [runs],
  );
  const filteredCandidates = useMemo(
    () =>
      candidates.filter((candidate) => {
        const statusMatches =
          candidateStatusFilter === "all" || candidate.status === candidateStatusFilter;
        const sourceMatches =
          candidateSourceFilter === "all" || candidate.source === candidateSourceFilter;
        return statusMatches && sourceMatches;
      }),
    [candidateStatusFilter, candidateSourceFilter, candidates],
  );

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    if (!selectedWorkspaceId) return;
    void refreshWorkspaceData(selectedWorkspaceId);
  }, [selectedWorkspaceId]);

  const loadAll = async () => {
    try {
      setLoading(true);
      const [nextSettings, nextWorkspaces, tempWorkspace] = await Promise.all([
        window.electronAPI.getImprovementSettings().catch(() => DEFAULT_SETTINGS),
        window.electronAPI.listWorkspaces().catch(() => [] as Workspace[]),
        window.electronAPI.getTempWorkspace().catch(() => null as Workspace | null),
      ]);
      const combined: Workspace[] = [
        {
          id: ALL_WORKSPACES_VALUE,
          name: "All Workspaces",
          path: "",
          createdAt: 0,
          permissions: { read: true, write: true, delete: false, network: true, shell: false },
        },
        ...(tempWorkspace ? [tempWorkspace] : []),
        ...nextWorkspaces.filter((workspace) => workspace.id !== tempWorkspace?.id),
      ];
      setSettings(nextSettings);
      setWorkspaces(combined);
      const preferred = props?.initialWorkspaceId || combined[0]?.id || "";
      setSelectedWorkspaceId(preferred);
      if (preferred) {
        await refreshWorkspaceData(preferred);
      }
    } finally {
      setLoading(false);
    }
  };

  const refreshWorkspaceData = async (workspaceId: string) => {
    const filterWorkspaceId = workspaceId === ALL_WORKSPACES_VALUE ? undefined : workspaceId;
    const [nextCandidates, nextRuns] = await Promise.all([
      window.electronAPI.listImprovementCandidates(filterWorkspaceId),
      window.electronAPI.listImprovementRuns(filterWorkspaceId),
    ]);
    setCandidates(nextCandidates);
    setRuns(nextRuns);
  };

  const saveSettings = async (updates: Partial<ImprovementLoopSettings>) => {
    const next = { ...settings, ...updates };
    setSettings(next);
    try {
      setBusy(true);
      await window.electronAPI.saveImprovementSettings(next);
    } finally {
      setBusy(false);
    }
  };

  const refreshCandidates = async () => {
    try {
      setBusy(true);
      const result = await window.electronAPI.refreshImprovementCandidates();
      if (selectedWorkspaceId) {
        await refreshWorkspaceData(selectedWorkspaceId);
      }
      setActionMessage(`Signals refreshed. ${result.candidateCount} candidate(s) currently in backlog.`);
    } finally {
      setBusy(false);
    }
  };

  const runNextExperiment = async () => {
    try {
      setBusy(true);
      const run = await window.electronAPI.runNextImprovementExperiment();
      if (selectedWorkspaceId) {
        await refreshWorkspaceData(selectedWorkspaceId);
      }
      if (run?.taskId) {
        setActionMessage(`Started improvement run for task ${run.taskId}. See Run Activity below.`);
      } else {
        setActionMessage(
          "No eligible experiment was started. Check that the loop is enabled, no other improvement run is active, and at least one open candidate is available.",
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const dismissCandidate = async (candidateId: string) => {
    try {
      setBusy(true);
      await window.electronAPI.dismissImprovementCandidate(candidateId);
      if (selectedWorkspaceId) {
        await refreshWorkspaceData(selectedWorkspaceId);
      }
    } finally {
      setBusy(false);
    }
  };

  const reviewRun = async (runId: string, reviewStatus: "accepted" | "dismissed") => {
    try {
      setBusy(true);
      await window.electronAPI.reviewImprovementRun(runId, reviewStatus);
      if (selectedWorkspaceId) {
        await refreshWorkspaceData(selectedWorkspaceId);
      }
    } finally {
      setBusy(false);
    }
  };

  const retryRun = async (runId: string) => {
    try {
      setBusy(true);
      const run = await window.electronAPI.retryImprovementRun(runId);
      if (selectedWorkspaceId) {
        await refreshWorkspaceData(selectedWorkspaceId);
      }
      if (run?.taskId) {
        setActionMessage(`Retried improvement run with task ${run.taskId}. See Run Activity below.`);
      } else {
        setActionMessage("Retry could not start. Check that no other improvement run is active and the candidate still exists.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "Retry could not start.");
      setActionMessage(message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="settings-section">
        <div className="settings-loading">Loading self-improvement settings...</div>
      </div>
    );
  }

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Self-Improvement</h2>
      <p className="settings-section-description">
        Mine recurring failures, run repair experiments in the active workspace, and use branch-isolated
        promotion when git worktrees are available.
      </p>

      <div className="settings-subsection">
        <h3>How It Works</h3>
        <div className="settings-form-group">
          <p className="settings-form-hint" style={{ margin: 0 }}>
            <strong>1. Observation</strong> Cowork watches failed tasks, verification failures, user feedback,
            and optional dev logs to build a backlog of recurring issues.
          </p>
        </div>
        <div className="settings-form-group">
          <p className="settings-form-hint" style={{ margin: 0 }}>
            <strong>2. Investigation</strong> Cowork launches an <code>Improve: ...</code> task for the highest
            priority candidate and tries to reproduce and fix the problem.
          </p>
        </div>
        <div className="settings-form-group">
          <p className="settings-form-hint" style={{ margin: 0 }}>
            <strong>3. Outcome</strong> If the workspace supports git worktrees, successful runs can move into the
            review queue and then open a PR or merge. If not, successful runs stay in the review queue when manual
            review is enabled, then become <code>applied</code> after approval because the fix was made directly in
            the workspace.
          </p>
        </div>
        <div className="settings-form-group">
          <p className="settings-form-hint" style={{ margin: 0 }}>
            <strong>4. Review</strong> The review queue can hold either promotable branch runs or direct-apply runs.
            Only promotable runs can open a PR or merge; direct-apply runs become <code>applied</code> after you
            accept them.
          </p>
        </div>
      </div>

      <div className="settings-subsection">
        <h3>Loop Settings</h3>

        <ToggleRow
          label="Enable Self-Improvement Loop"
          description="Allow Cowork to build a backlog of recurring failures and run repair experiments."
          checked={settings.enabled}
          disabled={busy}
          onChange={(checked) => void saveSettings({ enabled: checked })}
        />
        <ToggleRow
          label="Auto-Run Experiments"
          description="Pick the highest-priority candidate on a schedule and launch one autonomous experiment."
          checked={settings.autoRun}
          disabled={busy || !settings.enabled}
          onChange={(checked) => void saveSettings({ autoRun: checked })}
        />
        <ToggleRow
          label="Require Worktree Isolation"
          description="Use git worktrees when available; otherwise improvement runs apply directly in the workspace."
          checked={settings.requireWorktree}
          disabled={busy || !settings.enabled}
          onChange={(checked) => void saveSettings({ requireWorktree: checked })}
        />
        <ToggleRow
          label="Include Dev Logs"
          description="Parse `logs/dev-latest.log` when looking for recurring local runtime failures."
          checked={settings.includeDevLogs}
          disabled={busy || !settings.enabled}
          onChange={(checked) => void saveSettings({ includeDevLogs: checked })}
        />
        <ToggleRow
          label="Manual Review Required"
          description="Keep successful experiments in a review queue until you accept or dismiss them."
          checked={settings.reviewRequired}
          disabled={busy || !settings.enabled}
          onChange={(checked) => void saveSettings({ reviewRequired: checked })}
        />
        <SelectRow
          label="Promotion Mode"
          value={settings.promotionMode}
          disabled={busy || !settings.enabled}
          options={[
            { value: "github_pr", label: "Open GitHub PR" },
            { value: "merge", label: "Merge to Base Branch" },
          ]}
          onChange={(value) =>
            void saveSettings({ promotionMode: value as ImprovementLoopSettings["promotionMode"] })
          }
        />

        <NumberRow
          label="Run Interval (minutes)"
          value={settings.intervalMinutes}
          disabled={busy || !settings.enabled}
          min={15}
          max={10080}
          onChange={(value) => void saveSettings({ intervalMinutes: value })}
        />
        <NumberRow
          label="Eval Window (days)"
          value={settings.evalWindowDays}
          disabled={busy || !settings.enabled}
          min={1}
          max={90}
          onChange={(value) => void saveSettings({ evalWindowDays: value })}
        />
      </div>

      <div className="settings-subsection">
        <div
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}
        >
          <div>
            <h3 style={{ marginBottom: 4 }}>Workspace Candidates</h3>
            <p className="settings-form-hint" style={{ margin: 0 }}>
              Observation happens here first. Refresh signals to update the backlog, then run the next
              investigation manually if you do not want to wait for auto-run.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="settings-button" onClick={() => void refreshCandidates()} disabled={busy}>
              Refresh Signals
            </button>
            <button
              className="settings-button"
              onClick={() => void runNextExperiment()}
              disabled={busy || !settings.enabled}
            >
              Run Next Experiment
            </button>
          </div>
        </div>
        {actionMessage ? (
          <p className="settings-form-hint" style={{ marginTop: 10, marginBottom: 0 }}>
            {actionMessage}
          </p>
        ) : null}

        {workspaces.length > 0 ? (
          <div className="settings-form-group" style={{ maxWidth: 520 }}>
            <label className="settings-label">Workspace</label>
            <select
              value={selectedWorkspaceId}
              onChange={(event) => setSelectedWorkspaceId(event.target.value)}
              className="settings-select"
            >
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
            <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "4px 10px",
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 600,
                  color: selectedWorkspaceMode.tone,
                  background: "color-mix(in srgb, currentColor 10%, transparent)",
                  border: "1px solid color-mix(in srgb, currentColor 25%, transparent)",
                }}
              >
                {selectedWorkspaceMode.label}
              </span>
              <span className="settings-form-hint" style={{ margin: 0 }}>
                {selectedWorkspaceMode.description}
              </span>
            </div>
          </div>
        ) : null}

        <div
          className="settings-form-group"
          style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}
        >
          <div style={{ width: 260, maxWidth: "100%" }}>
            <label className="settings-label">Issue Status</label>
            <select
              value={candidateStatusFilter}
              onChange={(event) => setCandidateStatusFilter(event.target.value)}
              className="settings-select"
            >
              <option value="all">All Statuses</option>
              <option value="open">Open</option>
              <option value="running">Running</option>
              <option value="review">Review</option>
              <option value="resolved">Resolved</option>
              <option value="dismissed">Dismissed</option>
            </select>
          </div>
          <div style={{ width: 260, maxWidth: "100%" }}>
            <label className="settings-label">Issue Type</label>
            <select
              value={candidateSourceFilter}
              onChange={(event) => setCandidateSourceFilter(event.target.value)}
              className="settings-select"
            >
              <option value="all">All Types</option>
              <option value="task_failure">Task Failure</option>
              <option value="verification_failure">Verification Failure</option>
              <option value="user_feedback">User Feedback</option>
              <option value="dev_log">Dev Log</option>
            </select>
          </div>
        </div>

        <p className="settings-form-hint" style={{ marginTop: 0 }}>
          Showing <code>{filteredCandidates.length}</code> of <code>{candidates.length}</code> candidate issue(s)
          for the current workspace filter.
        </p>
        <div>
          <h3 style={{ marginTop: 0, marginBottom: 8 }}>Issues</h3>
          <div style={SCROLL_PANEL_STYLE}>
            {filteredCandidates.length === 0 ? (
              <p className="settings-form-hint">No candidate issues match the current filters.</p>
            ) : (
              filteredCandidates.map((candidate) => (
                <div key={candidate.id} className="settings-form-group">
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>
                        {candidate.title}
                      </div>
                      <p className="settings-form-hint" style={{ margin: "4px 0 0 0" }}>
                        {candidate.summary}
                      </p>
                      <p className="settings-form-hint" style={{ margin: "6px 0 0 0" }}>
                        Source: <code>{candidate.source}</code> | Status: <code>{candidate.status}</code> |
                        Priority: <code>{candidate.priorityScore.toFixed(2)}</code> | Recurrence:{" "}
                        <code>{candidate.recurrenceCount}</code>
                        {selectedWorkspaceId === ALL_WORKSPACES_VALUE ? (
                          <>
                            {" "}
                            | Workspace:{" "}
                            <code>{workspaceNameById.get(candidate.workspaceId) || candidate.workspaceId}</code>
                          </>
                        ) : null}
                      </p>
                    </div>
                    <div style={{ flexShrink: 0 }}>
                      {candidate.status !== "dismissed" ? (
                        <button
                          className="settings-button settings-button-secondary"
                          onClick={() => void dismissCandidate(candidate.id)}
                          disabled={busy}
                        >
                          Dismiss
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div style={{ marginTop: 20 }}>
          <h3 style={{ marginTop: 0, marginBottom: 8 }}>Runs</h3>
          <div style={SCROLL_PANEL_STYLE}>
            <p className="settings-form-hint" style={{ marginTop: 0 }}>
              Monitor queued, running, failed, applied, and review-ready improvement runs here.
            </p>

            <div className="settings-form-group">
              <div style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>Review Queue</div>
              <p className="settings-form-hint" style={{ margin: "4px 0 0 0" }}>
                Git-backed successful runs waiting for PR or merge approval.
              </p>
            </div>
            {pendingReviewRuns.length === 0 ? (
              <p className="settings-form-hint">No successful experiments are waiting for review.</p>
            ) : (
              pendingReviewRuns.map((run) => (
                <div key={`review-${run.id}`} className="settings-form-group">
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>
                        {run.verdictSummary || "Successful improvement experiment"}
                      </div>
                      <p className="settings-form-hint" style={{ margin: "4px 0 0 0" }}>
                        Task: <code>{run.taskId || "pending"}</code>
                        {run.branchName ? (
                          <>
                            {" "}
                            | Branch: <code>{run.branchName}</code>
                          </>
                        ) : null}
                        {" "} | Promotion: <code>{run.promotionStatus || "idle"}</code>
                      </p>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                      <button
                        className="settings-button"
                        onClick={() => void reviewRun(run.id, "accepted")}
                        disabled={busy}
                      >
                        {run.promotionStatus === "promotion_failed"
                          ? settings.promotionMode === "github_pr"
                            ? "Retry PR"
                            : "Retry Merge"
                          : settings.promotionMode === "github_pr"
                            ? "Accept + Open PR"
                            : "Accept + Merge"}
                      </button>
                      <button
                        className="settings-button settings-button-secondary"
                        onClick={() => void reviewRun(run.id, "dismissed")}
                        disabled={busy}
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}

            <div className="settings-form-group">
              <div style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>Recent Promotions</div>
              <p className="settings-form-hint" style={{ margin: "4px 0 0 0" }}>
                Recent PRs, merges, and direct-apply improvements.
              </p>
            </div>
            {recentPromotedRuns.length === 0 ? (
              <p className="settings-form-hint">No improvements have been promoted yet.</p>
            ) : (
              recentPromotedRuns.map((run) => (
                <div key={`promo-${run.id}`} className="settings-form-group">
                  <div style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>
                    {run.verdictSummary || "Promoted improvement run"}
                  </div>
                  <p className="settings-form-hint" style={{ margin: "4px 0 0 0" }}>
                    Status: <code>{run.promotionStatus || "idle"}</code>
                    {selectedWorkspaceId === ALL_WORKSPACES_VALUE ? (
                      <>
                        {" "}
                        | Observed In: <code>{workspaceNameById.get(run.workspaceId) || run.workspaceId}</code>
                      </>
                    ) : null}
                    {(run.executionWorkspaceId || run.workspaceId) !== run.workspaceId ? (
                      <>
                        {" "}
                        | Runs In:{" "}
                        <code>
                          {workspaceNameById.get(run.executionWorkspaceId || "") ||
                            run.executionWorkspaceId ||
                            run.workspaceId}
                        </code>
                      </>
                    ) : null}
                  </p>
                </div>
              ))
            )}

            <div className="settings-form-group">
              <div style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>Run Activity</div>
            </div>
            {recentRuns.length === 0 ? (
              <p className="settings-form-hint">No improvement runs have been recorded for this view yet.</p>
            ) : (
              recentRuns.map((run) => (
                <div key={`run-${run.id}`} className="settings-form-group">
                  <div style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>
                    {run.verdictSummary || "Improvement run"}
                  </div>
                  <p className="settings-form-hint" style={{ margin: "4px 0 0 0" }}>
                    Run: <code>{run.status}</code> | Review: <code>{run.reviewStatus}</code> | Promotion:{" "}
                    <code>{run.promotionStatus || "idle"}</code>
                    {run.taskId ? (
                      <>
                        {" "}
                        | Task: <code>{run.taskId}</code>
                      </>
                    ) : null}
                    {selectedWorkspaceId === ALL_WORKSPACES_VALUE ? (
                      <>
                        {" "}
                        | Observed In: <code>{workspaceNameById.get(run.workspaceId) || run.workspaceId}</code>
                      </>
                    ) : null}
                    {(run.executionWorkspaceId || run.workspaceId) !== run.workspaceId ? (
                      <>
                        {" "}
                        | Runs In:{" "}
                        <code>
                          {workspaceNameById.get(run.executionWorkspaceId || "") ||
                            run.executionWorkspaceId ||
                            run.workspaceId}
                        </code>
                      </>
                    ) : null}
                  </p>
                  {run.taskId && props?.onOpenTask ? (
                    <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        className="settings-button settings-button-secondary"
                        onClick={() => props.onOpenTask?.(run.taskId!)}
                      >
                        Open Task
                      </button>
                      {(run.status === "failed" || run.status === "cancelled") && (
                        <button
                          className="settings-button settings-button-secondary"
                          onClick={() => void retryRun(run.id)}
                          disabled={busy}
                        >
                          Retry Run
                        </button>
                      )}
                    </div>
                  ) : (run.status === "failed" || run.status === "cancelled") ? (
                    <div style={{ marginTop: 8 }}>
                      <button
                        className="settings-button settings-button-secondary"
                        onClick={() => void retryRun(run.id)}
                        disabled={busy}
                      >
                        Retry Run
                      </button>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ToggleRow(props: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="settings-form-group">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 500, color: "var(--color-text-primary)" }}>{props.label}</div>
          <p className="settings-form-hint" style={{ marginTop: 4, marginBottom: 0 }}>
            {props.description}
          </p>
        </div>
        <label className="settings-toggle" style={{ flexShrink: 0, marginTop: 2 }}>
          <input
            type="checkbox"
            checked={props.checked}
            disabled={props.disabled}
            onChange={(event) => props.onChange(event.target.checked)}
          />
          <span className="toggle-slider" />
        </label>
      </div>
    </div>
  );
}

function NumberRow(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="settings-form-group">
      <label className="settings-label">{props.label}</label>
      <input
        type="number"
        className="settings-input"
        min={props.min}
        max={props.max}
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => props.onChange(Number(event.target.value) || props.min)}
      />
    </div>
  );
}

function SelectRow(props: {
  label: string;
  value: string;
  disabled?: boolean;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="settings-form-group">
      <label className="settings-label">{props.label}</label>
      <select
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.value)}
        className="settings-select"
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
