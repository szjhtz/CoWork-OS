import Database from "better-sqlite3";
import { inferLlmProvider } from "../../shared/llmProviderInfer";
import { usageLocalDateKey } from "../../shared/usageInsightsDates";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export interface UsageInsightsCostByModelRow {
  model: string;
  cost: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  distinctTasks: number;
}

export interface UsageInsightsLlmSummary {
  totalLlmCalls: number;
  totalCost: number;
  /** Percentage of LLM calls with cost > 0; null if no calls */
  chargeableCallRate: number | null;
  avgTokensPerCall: number | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  /** cached / input as percentage when input > 0 */
  cacheReadRate: number | null;
  distinctTaskCount: number;
}

export interface UsageInsightsRequestDay {
  dateKey: string;
  llmCalls: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

export interface UsageInsightsProviderSlice {
  provider: string;
  calls: number;
  cost: number;
  percent: number;
}

export interface UsageInsightsPersonaMetric {
  personaId: string;
  personaName: string;
  total: number;
  completed: number;
  failed: number;
  cancelled: number;
  successRate: number;
  avgCompletionTimeMs: number | null;
  avgAttempts: number | null;
  totalCost: number;
}

export interface UsageInsightsFeedbackMetrics {
  totalFeedback: number;
  accepted: number;
  rejected: number;
  satisfactionRate: number | null;
  topRejectionReasons: Array<{ reason: string; count: number }>;
}

export interface UsageInsightsRetryMetrics {
  avgAttempts: number | null;
  retriedTasks: number;
  retriedRate: number | null;
  maxAttempts: number;
}

export interface UsageInsights {
  periodStart: number;
  periodEnd: number;
  workspaceId: string | null;
  generatedAt: number;

  taskMetrics: {
    totalCreated: number;
    completed: number;
    failed: number;
    cancelled: number;
    avgCompletionTimeMs: number | null;
  };

  costMetrics: {
    totalCost: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    costByModel: UsageInsightsCostByModelRow[];
  };

  /** LLM call success: llm_usage / (llm_usage + llm_error events); null if no denominator */
  llmSuccessRate: number | null;

  llmSummary: UsageInsightsLlmSummary;

  requestsByDay: UsageInsightsRequestDay[];

  providerBreakdown: UsageInsightsProviderSlice[];

  activityPattern: {
    tasksByDayOfWeek: number[];
    tasksByHour: number[];
    mostActiveDay: string;
    mostActiveHour: number;
  };

  topSkills: Array<{ skill: string; count: number }>;

  personaMetrics: UsageInsightsPersonaMetric[];

  feedbackMetrics: UsageInsightsFeedbackMetrics;

  retryMetrics: UsageInsightsRetryMetrics;

  executionMetrics: {
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
    totalLlmCalls: number;
    avgTokensPerLlmCall: number | null;
    avgTokensPerTask: number | null;
    outputInputRatio: number | null;
    totalToolCalls: number;
    totalToolResults: number;
    toolErrors: number;
    toolBlocked: number;
    toolWarnings: number;
    toolCompletionRate: number | null;
    uniqueTools: number;
    topTools: Array<{ tool: string; calls: number; errors: number }>;
  };

  awuMetrics: {
    awuCount: number;
    totalTokens: number;
    totalCost: number;
    tokensPerAwu: number | null;
    costPerAwu: number | null;
    awuPerDollar: number | null;
    trend: {
      previousAwuCount: number;
      previousTokensPerAwu: number | null;
      previousCostPerAwu: number | null;
      tokensPerAwuChange: number | null;
      costPerAwuChange: number | null;
    };
  };

  formatted: string;
}

interface LlmUsageScanResult {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  totalLlmCalls: number;
  chargeableCalls: number;
  distinctTaskIds: Set<string>;
  byModel: Map<
    string,
    {
      cost: number;
      calls: number;
      inputTokens: number;
      outputTokens: number;
      cachedTokens: number;
      taskIds: Set<string>;
    }
  >;
  byDay: Map<
    string,
    {
      llmCalls: number;
      cost: number;
      inputTokens: number;
      outputTokens: number;
      cachedTokens: number;
    }
  >;
  byProvider: Map<string, { calls: number; cost: number }>;
}

/** Returns a SQL WHERE fragment and params for optional workspace filtering. */
function wsFilter(
  workspaceId: string | null,
  alias: string,
): { clause: string; params: unknown[] } {
  if (workspaceId) return { clause: `${alias}workspace_id = ? AND `, params: [workspaceId] };
  return { clause: "", params: [] };
}

function emptyLlmScan(): LlmUsageScanResult {
  return {
    totalCost: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCachedTokens: 0,
    totalLlmCalls: 0,
    chargeableCalls: 0,
    distinctTaskIds: new Set(),
    byModel: new Map(),
    byDay: new Map(),
    byProvider: new Map(),
  };
}

function collectLocalDateKeysInRange(periodStart: number, periodEnd: number): string[] {
  const keys: string[] = [];
  const d = new Date(periodStart);
  d.setHours(0, 0, 0, 0);
  const end = new Date(periodEnd);
  end.setHours(0, 0, 0, 0);
  while (d.getTime() <= end.getTime()) {
    keys.push(usageLocalDateKey(d.getTime()));
    d.setDate(d.getDate() + 1);
  }
  return keys;
}

/**
 * Aggregates usage data from the tasks and task_events tables
 * to produce weekly/monthly insight reports.
 */
interface LlmPricingRow {
  model_key: string;
  input_cost_per_mtok: number;
  output_cost_per_mtok: number;
  cached_input_cost_per_mtok: number;
}

export class UsageInsightsService {
  private pricingMap: Map<string, LlmPricingRow> | null = null;

  constructor(private db: Database.Database) {}

  private loadPricingMap(): Map<string, LlmPricingRow> {
    if (this.pricingMap) return this.pricingMap;
    const map = new Map<string, LlmPricingRow>();
    try {
      const rows = this.db
        .prepare("SELECT model_key, input_cost_per_mtok, output_cost_per_mtok, cached_input_cost_per_mtok FROM llm_pricing")
        .all() as LlmPricingRow[];
      for (const r of rows) {
        map.set(r.model_key, r);
        map.set(r.model_key.toLowerCase(), r);
      }
    } catch {
      // Table may not exist yet
    }
    this.pricingMap = map;
    return map;
  }

  private lookupPricing(modelKey: string): LlmPricingRow | undefined {
    const map = this.loadPricingMap();
    const lc = modelKey.toLowerCase();
    if (map.has(modelKey)) return map.get(modelKey);
    if (map.has(lc)) return map.get(lc);
    // Bare version numbers like "5.4" → try "gpt-5.4"
    if (/^\d/.test(lc) && map.has(`gpt-${lc}`)) return map.get(`gpt-${lc}`);
    if (/^(sonnet|opus|haiku)-/.test(lc) && map.has(`claude-${lc}`)) return map.get(`claude-${lc}`);
    if (lc.includes(":free") || lc.includes("ollama") || lc.includes(":latest"))
      return { model_key: modelKey, input_cost_per_mtok: 0, output_cost_per_mtok: 0, cached_input_cost_per_mtok: 0 };
    for (const [k, v] of map) {
      if (lc.startsWith(k.toLowerCase()) || k.toLowerCase().startsWith(lc)) return v;
    }
    return undefined;
  }

  private estimateCost(
    modelKey: string,
    inputTokens: number,
    outputTokens: number,
    cachedTokens: number,
  ): number {
    const p = this.lookupPricing(modelKey);
    if (!p) return 0;
    const billableInput = Math.max(0, inputTokens - cachedTokens);
    return (
      (billableInput / 1_000_000) * p.input_cost_per_mtok +
      (outputTokens / 1_000_000) * p.output_cost_per_mtok +
      (cachedTokens / 1_000_000) * p.cached_input_cost_per_mtok
    );
  }

  private applyUsageScanEntry(
    out: LlmUsageScanResult,
    entry: {
      taskId?: string | null;
      timestamp: number;
      modelKey?: string | null;
      modelId?: string | null;
      inputTokens?: number;
      outputTokens?: number;
      cachedTokens?: number;
      cost?: number;
    },
  ): void {
    const deltaInput =
      typeof entry.inputTokens === "number" && Number.isFinite(entry.inputTokens) ? entry.inputTokens : 0;
    const deltaOutput =
      typeof entry.outputTokens === "number" && Number.isFinite(entry.outputTokens) ? entry.outputTokens : 0;
    const deltaCached =
      typeof entry.cachedTokens === "number" && Number.isFinite(entry.cachedTokens) ? entry.cachedTokens : 0;
    const modelKey =
      (typeof entry.modelKey === "string" && entry.modelKey) ||
      (typeof entry.modelId === "string" && entry.modelId) ||
      "unknown";
    const rawCost = typeof entry.cost === "number" && Number.isFinite(entry.cost) ? entry.cost : 0;
    const deltaCost =
      rawCost > 0
        ? rawCost
        : deltaInput + deltaOutput > 0
          ? this.estimateCost(modelKey, deltaInput, deltaOutput, deltaCached)
          : 0;

    out.totalCost += deltaCost;
    out.totalInputTokens += deltaInput;
    out.totalOutputTokens += deltaOutput;
    out.totalCachedTokens += deltaCached;
    out.totalLlmCalls += 1;
    if (deltaCost > 0) out.chargeableCalls += 1;
    if (entry.taskId) out.distinctTaskIds.add(entry.taskId);

    const byModel =
      out.byModel.get(modelKey) ?? {
        cost: 0,
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        taskIds: new Set<string>(),
      };
    byModel.cost += deltaCost;
    byModel.calls += 1;
    byModel.inputTokens += deltaInput;
    byModel.outputTokens += deltaOutput;
    byModel.cachedTokens += deltaCached;
    if (entry.taskId) byModel.taskIds.add(entry.taskId);
    out.byModel.set(modelKey, byModel);

    const dayKey = usageLocalDateKey(entry.timestamp);
    const day =
      out.byDay.get(dayKey) ?? {
        llmCalls: 0,
        cost: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
      };
    day.llmCalls += 1;
    day.cost += deltaCost;
    day.inputTokens += deltaInput;
    day.outputTokens += deltaOutput;
    day.cachedTokens += deltaCached;
    out.byDay.set(dayKey, day);

    const provider = inferLlmProvider(entry.modelKey || undefined, entry.modelId || undefined);
    const byProvider = out.byProvider.get(provider) ?? { calls: 0, cost: 0 };
    byProvider.calls += 1;
    byProvider.cost += deltaCost;
    out.byProvider.set(provider, byProvider);
  }

  getEarliestActivityMs(workspaceId: string | null): number | null {
    const ws = wsFilter(workspaceId, "");
    const row = this.db
      .prepare(
        `SELECT MIN(created_at) as earliest FROM tasks WHERE ${ws.clause} created_at IS NOT NULL`,
      )
      .get(...ws.params) as { earliest: number | null } | undefined;
    return row?.earliest ?? null;
  }

  generate(workspaceId: string | null, periodDays = 7): UsageInsights {
    this.pricingMap = null;
    const now = Date.now();
    const periodStart = now - periodDays * 24 * 60 * 60 * 1000;
    const periodEnd = now;

    const taskMetrics = this.getTaskMetrics(workspaceId, periodStart, periodEnd);
    const llmScan = this.collectLlmUsageScan(workspaceId, periodStart, periodEnd);
    const llmErrorCount = this.countLlmErrors(workspaceId, periodStart, periodEnd);

    const costMetrics = this.costMetricsFromScan(llmScan);
    const llmSummary = this.llmSummaryFromScan(llmScan);
    const requestsByDay = this.requestsByDayFromScan(llmScan, periodStart, periodEnd);
    const providerBreakdown = this.providerBreakdownFromScan(llmScan);

    const denom = llmScan.totalLlmCalls + llmErrorCount;
    const llmSuccessRate = denom > 0 ? (llmScan.totalLlmCalls / denom) * 100 : null;

    const activityPattern = this.getActivityPattern(workspaceId, periodStart, periodEnd);
    const topSkills = this.getTopSkills(workspaceId, periodStart, periodEnd);
    const personaMetrics = this.getPersonaMetrics(workspaceId, periodStart, periodEnd);
    const feedbackMetrics = this.getFeedbackMetrics(workspaceId, periodStart, periodEnd);
    const retryMetrics = this.getRetryMetrics(workspaceId, periodStart, periodEnd, taskMetrics.totalCreated);
    const executionMetrics = this.getExecutionMetrics(
      workspaceId,
      periodStart,
      periodEnd,
      taskMetrics,
      llmScan,
    );
    const awuMetrics = this.getAwuMetrics(workspaceId, periodStart, periodEnd, costMetrics);

    const formatted = this.formatReport(
      periodDays,
      taskMetrics,
      costMetrics,
      activityPattern,
      topSkills,
      personaMetrics,
      feedbackMetrics,
      retryMetrics,
      executionMetrics,
      awuMetrics,
      llmSummary,
      llmSuccessRate,
      llmErrorCount,
    );

    return {
      periodStart,
      periodEnd,
      workspaceId,
      generatedAt: now,
      taskMetrics,
      costMetrics,
      llmSuccessRate,
      llmSummary,
      requestsByDay,
      providerBreakdown,
      activityPattern,
      topSkills,
      personaMetrics,
      feedbackMetrics,
      retryMetrics,
      executionMetrics,
      awuMetrics,
      formatted,
    };
  }

  private collectLlmUsageScan(
    workspaceId: string | null,
    periodStart: number,
    periodEnd: number,
  ): LlmUsageScanResult {
    const out = emptyLlmScan();
    try {
      const ws = wsFilter(workspaceId, "t.");
      const rows = this.db
        .prepare(
          `SELECT te.task_id as task_id, te.timestamp as timestamp, te.payload as payload
           FROM task_events te
           JOIN tasks t ON te.task_id = t.id
           WHERE ${ws.clause}(te.type = 'llm_usage' OR te.legacy_type = 'llm_usage')
             AND te.timestamp >= ? AND te.timestamp <= ?`,
        )
        .all(...ws.params, periodStart, periodEnd) as Array<{
        task_id: string;
        timestamp: number;
        payload: string;
      }>;

      for (const row of rows) {
        try {
          const payload = JSON.parse(row.payload) as {
            delta?: {
              cost?: number;
              inputTokens?: number;
              outputTokens?: number;
              cachedTokens?: number;
            };
            modelKey?: string;
            modelId?: string;
          };
          const delta = payload.delta ?? {};
          this.applyUsageScanEntry(out, {
            taskId: row.task_id,
            timestamp: row.timestamp,
            modelKey: payload.modelKey,
            modelId: payload.modelId,
            inputTokens: delta.inputTokens,
            outputTokens: delta.outputTokens,
            cachedTokens: delta.cachedTokens,
            cost: delta.cost,
          });
        } catch {
          // Skip malformed payloads
        }
      }
    } catch {
      // task_events table may not exist
    }

    try {
      const rows = workspaceId
        ? (this.db
            .prepare(
              `SELECT task_id, timestamp, model_key, model_id, input_tokens, output_tokens, cached_tokens, cost
               FROM llm_call_events
               WHERE success = 1
                 AND workspace_id = ?
                 AND timestamp >= ? AND timestamp <= ?`,
            )
            .all(workspaceId, periodStart, periodEnd) as Array<{
            task_id: string | null;
            timestamp: number;
            model_key: string | null;
            model_id: string | null;
            input_tokens: number;
            output_tokens: number;
            cached_tokens: number;
            cost: number;
          }>)
        : (this.db
            .prepare(
              `SELECT task_id, timestamp, model_key, model_id, input_tokens, output_tokens, cached_tokens, cost
               FROM llm_call_events
               WHERE success = 1
                 AND timestamp >= ? AND timestamp <= ?`,
            )
            .all(periodStart, periodEnd) as Array<{
            task_id: string | null;
            timestamp: number;
            model_key: string | null;
            model_id: string | null;
            input_tokens: number;
            output_tokens: number;
            cached_tokens: number;
            cost: number;
          }>);

      for (const row of rows) {
        this.applyUsageScanEntry(out, {
          taskId: row.task_id,
          timestamp: row.timestamp,
          modelKey: row.model_key,
          modelId: row.model_id,
          inputTokens: row.input_tokens,
          outputTokens: row.output_tokens,
          cachedTokens: row.cached_tokens,
          cost: row.cost,
        });
      }
    } catch {
      // llm_call_events table may not exist yet
    }
    return out;
  }

  private countLlmErrors(
    workspaceId: string | null,
    periodStart: number,
    periodEnd: number,
  ): number {
    let total = 0;
    try {
      const ws = wsFilter(workspaceId, "t.");
      const row = this.db
        .prepare(
          `SELECT COUNT(*) as c
           FROM task_events te
           JOIN tasks t ON te.task_id = t.id
           WHERE ${ws.clause}(te.type = 'llm_error' OR te.legacy_type = 'llm_error')
             AND te.timestamp >= ? AND te.timestamp <= ?`,
        )
        .get(...ws.params, periodStart, periodEnd) as { c: number } | undefined;
      total += row?.c ?? 0;
    } catch {
      // Ignore legacy event read failures.
    }

    try {
      const row = workspaceId
        ? (this.db
            .prepare(
              `SELECT COUNT(*) as c
               FROM llm_call_events
               WHERE success = 0
                 AND workspace_id = ?
                 AND timestamp >= ? AND timestamp <= ?`,
            )
            .get(workspaceId, periodStart, periodEnd) as { c: number } | undefined)
        : (this.db
            .prepare(
              `SELECT COUNT(*) as c
               FROM llm_call_events
               WHERE success = 0
                 AND timestamp >= ? AND timestamp <= ?`,
            )
            .get(periodStart, periodEnd) as { c: number } | undefined);
      total += row?.c ?? 0;
    } catch {
      // Ignore global telemetry read failures.
    }

    return total;
  }

  private costMetricsFromScan(scan: LlmUsageScanResult): UsageInsights["costMetrics"] {
    const costByModel: UsageInsightsCostByModelRow[] = Array.from(scan.byModel.entries())
      .map(([model, data]) => ({
        model,
        cost: data.cost,
        calls: data.calls,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        cachedTokens: data.cachedTokens,
        distinctTasks: data.taskIds.size,
      }))
      .sort((a, b) => {
        if (b.cost !== a.cost) return b.cost - a.cost;
        return b.calls - a.calls;
      });

    return {
      totalCost: scan.totalCost,
      totalInputTokens: scan.totalInputTokens,
      totalOutputTokens: scan.totalOutputTokens,
      costByModel,
    };
  }

  private llmSummaryFromScan(scan: LlmUsageScanResult): UsageInsightsLlmSummary {
    const totalTokens = scan.totalInputTokens + scan.totalOutputTokens;
    const avgTokensPerCall =
      scan.totalLlmCalls > 0 ? Math.round(totalTokens / scan.totalLlmCalls) : null;
    const chargeableCallRate =
      scan.totalLlmCalls > 0 ? (scan.chargeableCalls / scan.totalLlmCalls) * 100 : null;
    const cacheReadRate =
      scan.totalInputTokens > 0
        ? Math.min(100, (scan.totalCachedTokens / scan.totalInputTokens) * 100)
        : null;

    return {
      totalLlmCalls: scan.totalLlmCalls,
      totalCost: scan.totalCost,
      chargeableCallRate,
      avgTokensPerCall,
      totalInputTokens: scan.totalInputTokens,
      totalOutputTokens: scan.totalOutputTokens,
      totalCachedTokens: scan.totalCachedTokens,
      cacheReadRate,
      distinctTaskCount: scan.distinctTaskIds.size,
    };
  }

  private requestsByDayFromScan(
    scan: LlmUsageScanResult,
    periodStart: number,
    periodEnd: number,
  ): UsageInsightsRequestDay[] {
    const keys = collectLocalDateKeysInRange(periodStart, periodEnd);
    return keys.map((dateKey) => {
      const d = scan.byDay.get(dateKey);
      return {
        dateKey,
        llmCalls: d?.llmCalls ?? 0,
        cost: d?.cost ?? 0,
        inputTokens: d?.inputTokens ?? 0,
        outputTokens: d?.outputTokens ?? 0,
        cachedTokens: d?.cachedTokens ?? 0,
      };
    });
  }

  private providerBreakdownFromScan(scan: LlmUsageScanResult): UsageInsightsProviderSlice[] {
    const entries = Array.from(scan.byProvider.entries()).map(([provider, v]) => ({
      provider,
      calls: v.calls,
      cost: v.cost,
      percent: 0,
    }));

    if (scan.totalCost > 0) {
      for (const e of entries) {
        e.percent = (e.cost / scan.totalCost) * 100;
      }
    } else if (scan.totalLlmCalls > 0) {
      for (const e of entries) {
        e.percent = (e.calls / scan.totalLlmCalls) * 100;
      }
    }

    return entries.sort((a, b) => {
      if (scan.totalCost > 0) return b.cost - a.cost;
      return b.calls - a.calls;
    });
  }

  private getPeriodScanTotals(
    workspaceId: string | null,
    periodStart: number,
    periodEnd: number,
  ): { totalCost: number; totalInputTokens: number; totalOutputTokens: number } {
    const scan = this.collectLlmUsageScan(workspaceId, periodStart, periodEnd);
    return {
      totalCost: scan.totalCost,
      totalInputTokens: scan.totalInputTokens,
      totalOutputTokens: scan.totalOutputTokens,
    };
  }

  private getTaskMetrics(
    workspaceId: string | null,
    periodStart: number,
    periodEnd: number,
  ): UsageInsights["taskMetrics"] {
    const ws = wsFilter(workspaceId, "");
    const rows = this.db
      .prepare(
        `SELECT status, COUNT(*) as count,
                AVG(CASE WHEN status = 'completed' AND completed_at IS NOT NULL THEN completed_at - created_at END) as avg_time
         FROM tasks
         WHERE ${ws.clause}created_at >= ? AND created_at <= ?
         GROUP BY status`,
      )
      .all(...ws.params, periodStart, periodEnd) as Array<{
      status: string;
      count: number;
      avg_time: number | null;
    }>;

    const statusMap = new Map(rows.map((r) => [r.status, r]));
    const totalCreated = rows.reduce((sum, r) => sum + r.count, 0);
    const avgTime = statusMap.get("completed")?.avg_time ?? null;

    return {
      totalCreated,
      completed: statusMap.get("completed")?.count ?? 0,
      failed: statusMap.get("failed")?.count ?? 0,
      cancelled: statusMap.get("cancelled")?.count ?? 0,
      avgCompletionTimeMs: avgTime,
    };
  }

  private getActivityPattern(
    workspaceId: string | null,
    periodStart: number,
    periodEnd: number,
  ): UsageInsights["activityPattern"] {
    const tasksByDayOfWeek = Array.from({ length: 7 }, () => 0);
    const tasksByHour = Array.from({ length: 24 }, () => 0);

    try {
      const ws = wsFilter(workspaceId, "");
      const rows = this.db
        .prepare(
          `SELECT created_at FROM tasks WHERE ${ws.clause}created_at >= ? AND created_at <= ?`,
        )
        .all(...ws.params, periodStart, periodEnd) as Array<{ created_at: number }>;

      for (const row of rows) {
        const d = new Date(row.created_at);
        tasksByDayOfWeek[d.getDay()] += 1;
        tasksByHour[d.getHours()] += 1;
      }
    } catch {
      // Gracefully handle missing table
    }

    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const maxDayIdx = tasksByDayOfWeek.indexOf(Math.max(...tasksByDayOfWeek));
    const mostActiveDay = dayNames[maxDayIdx] || "N/A";
    const mostActiveHour = tasksByHour.indexOf(Math.max(...tasksByHour));

    return { tasksByDayOfWeek, tasksByHour, mostActiveDay, mostActiveHour };
  }

  private getTopSkills(
    workspaceId: string | null,
    periodStart: number,
    periodEnd: number,
  ): UsageInsights["topSkills"] {
    try {
      const ws = wsFilter(workspaceId, "t.");
      const rows = this.db
        .prepare(
          `SELECT te.payload
           FROM task_events te
           JOIN tasks t ON te.task_id = t.id
           WHERE ${ws.clause}(te.type = 'skill_used' OR te.legacy_type = 'skill_used')
             AND te.timestamp >= ? AND te.timestamp <= ?`,
        )
        .all(...ws.params, periodStart, periodEnd) as Array<{ payload: string }>;

      const skillCounts = new Map<string, number>();
      for (const row of rows) {
        try {
          const payload = JSON.parse(row.payload);
          const skill = payload.skillName || payload.name || "unknown";
          skillCounts.set(skill, (skillCounts.get(skill) || 0) + 1);
        } catch {
          // Skip
        }
      }

      return Array.from(skillCounts.entries())
        .map(([skill, count]) => ({ skill, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
    } catch {
      return [];
    }
  }

  private getPersonaMetrics(
    workspaceId: string | null,
    periodStart: number,
    periodEnd: number,
  ): UsageInsightsPersonaMetric[] {
    try {
      const ws = wsFilter(workspaceId, "t.");
      const rows = this.db
        .prepare(
          `SELECT
             COALESCE(t.assigned_agent_role_id, 'unassigned') as persona_id,
             COALESCE(ar.display_name, ar.name, 'Unassigned') as persona_name,
             COUNT(*) as total,
             SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completed,
             SUM(CASE WHEN t.status = 'failed' THEN 1 ELSE 0 END) as failed,
             SUM(CASE WHEN t.status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
             AVG(CASE WHEN t.status = 'completed' AND t.completed_at IS NOT NULL THEN t.completed_at - t.created_at END) as avg_time,
             AVG(CASE WHEN t.current_attempt IS NOT NULL THEN t.current_attempt ELSE NULL END) as avg_attempts
           FROM tasks t
           LEFT JOIN agent_roles ar ON ar.id = t.assigned_agent_role_id
           WHERE ${ws.clause}t.created_at >= ? AND t.created_at <= ?
           GROUP BY COALESCE(t.assigned_agent_role_id, 'unassigned'), COALESCE(ar.display_name, ar.name, 'Unassigned')
           ORDER BY total DESC`,
        )
        .all(...ws.params, periodStart, periodEnd) as Array<{
        persona_id: string;
        persona_name: string;
        total: number;
        completed: number;
        failed: number;
        cancelled: number;
        avg_time: number | null;
        avg_attempts: number | null;
      }>;

      const costMap = new Map<string, number>();
      const costRows = this.db
        .prepare(
          `SELECT
             COALESCE(t.assigned_agent_role_id, 'unassigned') as persona_id,
             te.payload
           FROM task_events te
           JOIN tasks t ON te.task_id = t.id
           WHERE ${ws.clause}(te.type = 'llm_usage' OR te.legacy_type = 'llm_usage')
             AND te.timestamp >= ? AND te.timestamp <= ?`,
        )
        .all(...ws.params, periodStart, periodEnd) as Array<{ persona_id: string; payload: string }>;
      for (const row of costRows) {
        try {
          const payload = JSON.parse(row.payload) as {
            modelKey?: string;
            delta?: {
              cost?: number;
              inputTokens?: number;
              outputTokens?: number;
              cachedTokens?: number;
            };
          };
          const delta = payload.delta ?? {};
          const cost =
            typeof delta.cost === "number" && delta.cost > 0
              ? delta.cost
              : this.estimateCost(
                  payload.modelKey || "unknown",
                  delta.inputTokens || 0,
                  delta.outputTokens || 0,
                  delta.cachedTokens || 0,
                );
          costMap.set(row.persona_id, (costMap.get(row.persona_id) || 0) + cost);
        } catch {
          // Ignore malformed payloads.
        }
      }

      return rows.map((row) => ({
        personaId: row.persona_id,
        personaName: row.persona_name,
        total: row.total,
        completed: row.completed,
        failed: row.failed,
        cancelled: row.cancelled,
        successRate: row.total > 0 ? (row.completed / row.total) * 100 : 0,
        avgCompletionTimeMs: row.avg_time,
        avgAttempts: row.avg_attempts,
        totalCost: costMap.get(row.persona_id) || 0,
      }));
    } catch {
      return [];
    }
  }

  private getFeedbackMetrics(
    workspaceId: string | null,
    periodStart: number,
    periodEnd: number,
  ): UsageInsightsFeedbackMetrics {
    try {
      const ws = wsFilter(workspaceId, "t.");
      const rows = this.db
        .prepare(
          `SELECT te.payload
           FROM task_events te
           JOIN tasks t ON te.task_id = t.id
           WHERE ${ws.clause}(te.type = 'user_feedback' OR te.legacy_type = 'user_feedback')
             AND te.timestamp >= ? AND te.timestamp <= ?`,
        )
        .all(...ws.params, periodStart, periodEnd) as Array<{ payload: string }>;
      let accepted = 0;
      let rejected = 0;
      const rejectionReasons = new Map<string, number>();
      for (const row of rows) {
        try {
          const payload = JSON.parse(row.payload) as {
            decision?: "accepted" | "rejected";
            rating?: "positive" | "negative";
            reason?: string;
            kind?: "message" | "task";
          };
          const acceptedDecision =
            payload.decision === "accepted" || payload.rating === "positive";
          const rejectedDecision =
            payload.decision === "rejected" || payload.rating === "negative";
          if (acceptedDecision) accepted += 1;
          if (rejectedDecision) rejected += 1;
          if (rejectedDecision && payload.reason) {
            rejectionReasons.set(payload.reason, (rejectionReasons.get(payload.reason) || 0) + 1);
          }
        } catch {
          // Ignore malformed payloads.
        }
      }
      const totalFeedback = accepted + rejected;
      return {
        totalFeedback,
        accepted,
        rejected,
        satisfactionRate: totalFeedback > 0 ? (accepted / totalFeedback) * 100 : null,
        topRejectionReasons: Array.from(rejectionReasons.entries())
          .map(([reason, count]) => ({ reason, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5),
      };
    } catch {
      return {
        totalFeedback: 0,
        accepted: 0,
        rejected: 0,
        satisfactionRate: null,
        topRejectionReasons: [],
      };
    }
  }

  private getRetryMetrics(
    workspaceId: string | null,
    periodStart: number,
    periodEnd: number,
    totalTasks: number,
  ): UsageInsightsRetryMetrics {
    try {
      const ws = wsFilter(workspaceId, "");
      const row = this.db
        .prepare(
          `SELECT
             AVG(CASE WHEN current_attempt IS NOT NULL THEN current_attempt ELSE NULL END) as avg_attempts,
             SUM(CASE WHEN COALESCE(current_attempt, 1) > 1 THEN 1 ELSE 0 END) as retried_tasks,
             MAX(COALESCE(current_attempt, 1)) as max_attempts
           FROM tasks
           WHERE ${ws.clause}created_at >= ? AND created_at <= ?`,
        )
        .get(...ws.params, periodStart, periodEnd) as {
        avg_attempts: number | null;
        retried_tasks: number | null;
        max_attempts: number | null;
      };
      const retriedTasks = row?.retried_tasks || 0;
      return {
        avgAttempts: row?.avg_attempts ?? null,
        retriedTasks,
        retriedRate: totalTasks > 0 ? (retriedTasks / totalTasks) * 100 : null,
        maxAttempts: row?.max_attempts || 0,
      };
    } catch {
      return {
        avgAttempts: null,
        retriedTasks: 0,
        retriedRate: null,
        maxAttempts: 0,
      };
    }
  }

  private getExecutionMetrics(
    workspaceId: string | null,
    periodStart: number,
    periodEnd: number,
    taskMetrics: UsageInsights["taskMetrics"],
    llmScan: LlmUsageScanResult,
  ): UsageInsights["executionMetrics"] {
    const totalPromptTokens = llmScan.totalInputTokens;
    const totalCompletionTokens = llmScan.totalOutputTokens;
    const totalTokens = totalPromptTokens + totalCompletionTokens;
    const totalLlmCalls = llmScan.totalLlmCalls;

    const avgTokensPerLlmCall = totalLlmCalls > 0 ? Math.round(totalTokens / totalLlmCalls) : null;
    const avgTokensPerTask =
      taskMetrics.totalCreated > 0 ? Math.round(totalTokens / taskMetrics.totalCreated) : null;
    const outputInputRatio = totalPromptTokens > 0 ? totalCompletionTokens / totalPromptTokens : null;

    let totalToolCalls = 0;
    let totalToolResults = 0;
    let toolErrors = 0;
    let toolBlocked = 0;
    let toolWarnings = 0;
    const toolMap = new Map<string, { calls: number; errors: number }>();

    try {
      const ws = wsFilter(workspaceId, "t.");
      const rows = this.db
        .prepare(
          `SELECT te.type, te.legacy_type as legacy_type, te.payload
           FROM task_events te
           JOIN tasks t ON te.task_id = t.id
           WHERE ${ws.clause}te.timestamp >= ? AND te.timestamp <= ?
             AND (
               te.type IN ('tool_call', 'tool_result', 'tool_error', 'tool_blocked', 'tool_warning')
               OR te.legacy_type IN ('tool_call', 'tool_result', 'tool_error', 'tool_blocked', 'tool_warning')
             )`,
        )
        .all(...ws.params, periodStart, periodEnd) as Array<{
        type: string;
        legacy_type?: string;
        payload: string;
      }>;

      for (const row of rows) {
        const eventType =
          row.type === "tool_call" ||
          row.type === "tool_result" ||
          row.type === "tool_error" ||
          row.type === "tool_blocked" ||
          row.type === "tool_warning"
            ? row.type
            : row.legacy_type === "tool_call" ||
                row.legacy_type === "tool_result" ||
                row.legacy_type === "tool_error" ||
                row.legacy_type === "tool_blocked" ||
                row.legacy_type === "tool_warning"
              ? row.legacy_type
              : null;

        if (!eventType) continue;

        let tool = "";
        try {
          const payload = JSON.parse(row.payload);
          tool =
            (typeof payload?.tool === "string" && payload.tool) ||
            (typeof payload?.name === "string" && payload.name) ||
            (typeof payload?.toolName === "string" && payload.toolName) ||
            "";
        } catch {
          // Ignore malformed payloads
        }

        if (tool && !toolMap.has(tool)) {
          toolMap.set(tool, { calls: 0, errors: 0 });
        }

        if (eventType === "tool_call") {
          totalToolCalls += 1;
          if (tool && toolMap.has(tool)) {
            const entry = toolMap.get(tool)!;
            entry.calls += 1;
            toolMap.set(tool, entry);
          }
          continue;
        }

        if (eventType === "tool_result") {
          totalToolResults += 1;
          continue;
        }

        if (eventType === "tool_error") {
          toolErrors += 1;
          if (tool && toolMap.has(tool)) {
            const entry = toolMap.get(tool)!;
            entry.errors += 1;
            toolMap.set(tool, entry);
          }
          continue;
        }

        if (eventType === "tool_blocked") {
          toolBlocked += 1;
          continue;
        }

        if (eventType === "tool_warning") {
          toolWarnings += 1;
        }
      }
    } catch {
      // Gracefully handle missing columns/table
    }

    const topTools = Array.from(toolMap.entries())
      .map(([tool, data]) => ({ tool, calls: data.calls, errors: data.errors }))
      .filter((tool) => tool.calls > 0 || tool.errors > 0)
      .sort((a, b) => {
        if (b.calls !== a.calls) return b.calls - a.calls;
        return b.errors - a.errors;
      })
      .slice(0, 8);

    const toolCompletionRate =
      totalToolCalls > 0 ? Math.min(100, (totalToolResults / totalToolCalls) * 100) : null;

    return {
      totalPromptTokens,
      totalCompletionTokens,
      totalTokens,
      totalLlmCalls,
      avgTokensPerLlmCall,
      avgTokensPerTask,
      outputInputRatio,
      totalToolCalls,
      totalToolResults,
      toolErrors,
      toolBlocked,
      toolWarnings,
      toolCompletionRate,
      uniqueTools: toolMap.size,
      topTools,
    };
  }

  private countAwus(workspaceId: string | null, periodStart: number, periodEnd: number): number {
    try {
      const ws = wsFilter(workspaceId, "");
      const row = this.db
        .prepare(
          `SELECT COUNT(*) as count FROM tasks
           WHERE ${ws.clause}completed_at >= ? AND completed_at <= ?
             AND status = 'completed'
             AND (terminal_status IN ('ok', 'partial_success', 'needs_user_action') OR terminal_status IS NULL)`,
        )
        .get(...ws.params, periodStart, periodEnd) as { count: number } | undefined;
      return row?.count ?? 0;
    } catch {
      return 0;
    }
  }

  private getAwuMetrics(
    workspaceId: string | null,
    periodStart: number,
    periodEnd: number,
    costMetrics: UsageInsights["costMetrics"],
  ): UsageInsights["awuMetrics"] {
    const awuCount = this.countAwus(workspaceId, periodStart, periodEnd);

    const totalTokens = costMetrics.totalInputTokens + costMetrics.totalOutputTokens;
    const totalCost = costMetrics.totalCost;

    const tokensPerAwu = awuCount > 0 ? Math.round(totalTokens / awuCount) : null;
    const costPerAwu = awuCount > 0 ? totalCost / awuCount : null;
    const awuPerDollar = totalCost > 0 ? awuCount / totalCost : null;

    const periodLengthMs = periodEnd - periodStart;
    const prevStart = periodStart - periodLengthMs;
    const prevEnd = periodStart;

    const previousAwuCount = this.countAwus(workspaceId, prevStart, prevEnd);
    const prevCost = this.getPeriodScanTotals(workspaceId, prevStart, prevEnd);
    const prevTokens = prevCost.totalInputTokens + prevCost.totalOutputTokens;

    const previousTokensPerAwu =
      previousAwuCount > 0 ? Math.round(prevTokens / previousAwuCount) : null;
    const previousCostPerAwu = previousAwuCount > 0 ? prevCost.totalCost / previousAwuCount : null;

    const tokensPerAwuChange =
      tokensPerAwu !== null && previousTokensPerAwu !== null && previousTokensPerAwu > 0
        ? ((tokensPerAwu - previousTokensPerAwu) / previousTokensPerAwu) * 100
        : null;

    const costPerAwuChange =
      costPerAwu !== null && previousCostPerAwu !== null && previousCostPerAwu > 0
        ? ((costPerAwu - previousCostPerAwu) / previousCostPerAwu) * 100
        : null;

    return {
      awuCount,
      totalTokens,
      totalCost,
      tokensPerAwu,
      costPerAwu,
      awuPerDollar,
      trend: {
        previousAwuCount,
        previousTokensPerAwu,
        previousCostPerAwu,
        tokensPerAwuChange,
        costPerAwuChange,
      },
    };
  }

  private formatReport(
    periodDays: number,
    taskMetrics: UsageInsights["taskMetrics"],
    costMetrics: UsageInsights["costMetrics"],
    activityPattern: UsageInsights["activityPattern"],
    topSkills: UsageInsights["topSkills"],
    personaMetrics: UsageInsightsPersonaMetric[],
    feedbackMetrics: UsageInsightsFeedbackMetrics,
    retryMetrics: UsageInsightsRetryMetrics,
    executionMetrics: UsageInsights["executionMetrics"],
    awuMetrics: UsageInsights["awuMetrics"],
    llmSummary: UsageInsightsLlmSummary,
    llmSuccessRate: number | null,
    llmErrorCount: number,
  ): string {
    const lines: string[] = [];
    const label = periodDays === 7 ? "Weekly" : `${periodDays}-Day`;

    lines.push(`**${label} Usage Insights**`, "");

    lines.push("**Tasks:**");
    lines.push(
      `- ${taskMetrics.totalCreated} created, ${taskMetrics.completed} completed, ${taskMetrics.failed} failed`,
    );
    if (taskMetrics.avgCompletionTimeMs !== null) {
      const avgMins = Math.round(taskMetrics.avgCompletionTimeMs / 60000);
      lines.push(`- Average completion time: ${avgMins} min`);
    }
    lines.push("");

    if (llmSummary.totalLlmCalls > 0 || llmErrorCount > 0) {
      lines.push("**LLM usage:**");
      lines.push(`- LLM calls: ${llmSummary.totalLlmCalls}`);
      if (llmSuccessRate !== null) {
        lines.push(
          `- LLM call success: ${llmSuccessRate.toFixed(1)}% (${llmErrorCount} logged errors)`,
        );
      }
      if (llmSummary.chargeableCallRate !== null) {
        lines.push(`- Chargeable calls: ${llmSummary.chargeableCallRate.toFixed(1)}%`);
      }
      if (llmSummary.cacheReadRate !== null && llmSummary.totalCachedTokens > 0) {
        lines.push(`- Cache read (of prompt tokens): ${llmSummary.cacheReadRate.toFixed(1)}%`);
      }
      lines.push("");
    }

    if (costMetrics.totalCost > 0) {
      lines.push("**Cost & Tokens:**");
      lines.push(`- Total cost: $${costMetrics.totalCost.toFixed(4)}`);
      lines.push(
        `- Tokens: ${(costMetrics.totalInputTokens / 1000).toFixed(1)}K input, ${(costMetrics.totalOutputTokens / 1000).toFixed(1)}K output`,
      );
      if (costMetrics.costByModel.length > 0) {
        lines.push("- By model:");
        for (const m of costMetrics.costByModel.slice(0, 5)) {
          lines.push(`  - ${m.model}: $${m.cost.toFixed(4)} (${m.calls} calls)`);
        }
      }
      lines.push("");
    }

    if (executionMetrics.totalTokens > 0 || executionMetrics.totalToolCalls > 0) {
      lines.push("**Token & Tool Insights:**");
      lines.push(
        `- Tokens: ${formatTokens(executionMetrics.totalPromptTokens)} prompt, ${formatTokens(executionMetrics.totalCompletionTokens)} completion, ${formatTokens(executionMetrics.totalTokens)} total`,
      );
      if (executionMetrics.totalLlmCalls > 0) {
        lines.push(
          `- LLM calls: ${executionMetrics.totalLlmCalls} (${formatTokens(executionMetrics.avgTokensPerLlmCall || 0)} avg tokens/call)`,
        );
      }
      if (executionMetrics.totalToolCalls > 0) {
        lines.push(
          `- Tool calls: ${executionMetrics.totalToolCalls} (${executionMetrics.totalToolResults} results, ${executionMetrics.toolErrors} errors)`,
        );
      }
      if (executionMetrics.topTools.length > 0) {
        const top = executionMetrics.topTools
          .slice(0, 3)
          .map((t) => `${t.tool} (${t.calls})`)
          .join(", ");
        lines.push(`- Top tools: ${top}`);
      }
      lines.push("");
    }

    if (personaMetrics.length > 0) {
      lines.push("**Top Personas:**");
      for (const persona of personaMetrics.slice(0, 5)) {
        lines.push(
          `- ${persona.personaName}: ${persona.completed}/${persona.total} completed (${persona.successRate.toFixed(0)}%), $${persona.totalCost.toFixed(4)}`,
        );
      }
      lines.push("");
    }

    if (feedbackMetrics.totalFeedback > 0 || retryMetrics.retriedTasks > 0) {
      lines.push("**Quality Signals:**");
      if (feedbackMetrics.totalFeedback > 0 && feedbackMetrics.satisfactionRate !== null) {
        lines.push(
          `- Satisfaction: ${feedbackMetrics.satisfactionRate.toFixed(1)}% (${feedbackMetrics.accepted} positive, ${feedbackMetrics.rejected} negative)`,
        );
      }
      if (retryMetrics.retriedTasks > 0) {
        lines.push(
          `- Retried tasks: ${retryMetrics.retriedTasks}${retryMetrics.retriedRate !== null ? ` (${retryMetrics.retriedRate.toFixed(1)}%)` : ""}`,
        );
      }
      lines.push("");
    }

    if (awuMetrics.awuCount > 0) {
      lines.push("**Agent Efficiency (AWU):**");
      lines.push(`- Work units completed: ${awuMetrics.awuCount}`);
      if (awuMetrics.tokensPerAwu !== null) {
        lines.push(`- Tokens per AWU: ${formatTokens(awuMetrics.tokensPerAwu)}`);
      }
      if (awuMetrics.costPerAwu !== null) {
        lines.push(`- Cost per AWU: $${awuMetrics.costPerAwu.toFixed(4)}`);
      }
      if (awuMetrics.awuPerDollar !== null) {
        lines.push(`- AWUs per dollar: ${awuMetrics.awuPerDollar.toFixed(1)}`);
      }
      if (awuMetrics.trend.tokensPerAwuChange !== null) {
        const dir = awuMetrics.trend.tokensPerAwuChange <= 0 ? "improved" : "worsened";
        lines.push(
          `- Efficiency trend: ${dir} by ${Math.abs(awuMetrics.trend.tokensPerAwuChange).toFixed(0)}% vs previous period`,
        );
      }
      lines.push("");
    }

    lines.push("**Activity Pattern:**");
    lines.push(`- Most active day: ${activityPattern.mostActiveDay}`);
    lines.push(
      `- Peak hour: ${activityPattern.mostActiveHour}:00\u2013${activityPattern.mostActiveHour + 1}:00`,
    );
    lines.push("");

    if (topSkills.length > 0) {
      lines.push("**Top Skills:**");
      for (const s of topSkills.slice(0, 5)) {
        lines.push(`- ${s.skill}: ${s.count} uses`);
      }
    }

    return lines.join("\n");
  }
}
