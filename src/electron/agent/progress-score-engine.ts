import type { TaskEvent } from "../../shared/types";

export interface ProgressScoreAssessment {
  progressScore: number;
  loopRiskIndex: number;
  repeatedFingerprintCount: number;
  dominantFingerprint?: string;
  windowSummary: {
    stepCompleted: number;
    writeMutations: number;
    resolvedErrorRecoveries: number;
    repeatedErrorPenalty: number;
    emptyNoOpTurns: number;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getEffectiveType(event: TaskEvent): string {
  return typeof event.legacyType === "string" && event.legacyType.length > 0
    ? event.legacyType
    : event.type;
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((key) => `${key}:${stableStringify(obj[key])}`).join(",")}}`;
}

function buildToolErrorFingerprint(event: TaskEvent): string {
  const payload =
    event.payload && typeof event.payload === "object"
      ? (event.payload as Record<string, unknown>)
      : {};
  const tool = typeof payload.tool === "string" ? payload.tool : "unknown_tool";
  const input = stableStringify(payload.input);
  const error =
    typeof payload.error === "string"
      ? payload.error
      : typeof payload.message === "string"
        ? payload.message
        : "unknown_error";
  return `${tool}::${input}::${error}`.slice(0, 1200);
}

export class ProgressScoreEngine {
  static assessWindow(events: TaskEvent[]): ProgressScoreAssessment {
    let stepCompleted = 0;
    let writeMutations = 0;
    let resolvedErrorRecoveries = 0;
    let emptyNoOpTurns = 0;
    let repeatedErrorPenalty = 0;
    let unresolvedErrorSeen = false;

    const errorFingerprints: string[] = [];
    const fingerprintCounts = new Map<string, number>();

    for (const event of events) {
      const type = getEffectiveType(event);

      if (type === "step_completed") {
        stepCompleted += 1;
        if (unresolvedErrorSeen) {
          resolvedErrorRecoveries += 1;
          unresolvedErrorSeen = false;
        }
      }

      if (
        type === "file_created" ||
        type === "file_modified" ||
        type === "file_deleted" ||
        type === "artifact_created"
      ) {
        writeMutations += 1;
      }

      if (type === "tool_error" || type === "error" || type === "llm_error" || type === "step_failed") {
        unresolvedErrorSeen = true;
      }

      if (type === "tool_error") {
        const fingerprint = buildToolErrorFingerprint(event);
        errorFingerprints.push(fingerprint);
        const next = (fingerprintCounts.get(fingerprint) || 0) + 1;
        fingerprintCounts.set(fingerprint, next);
      }

      if (type === "assistant_message") {
        const payload =
          event.payload && typeof event.payload === "object"
            ? (event.payload as Record<string, unknown>)
            : {};
        const message =
          typeof payload.message === "string"
            ? payload.message
            : typeof payload.text === "string"
              ? payload.text
              : "";
        if (!String(message).trim()) {
          emptyNoOpTurns += 1;
        }
      }
    }

    let dominantFingerprint: string | undefined;
    let repeatedFingerprintCount = 0;
    for (const [fingerprint, count] of fingerprintCounts.entries()) {
      if (count > repeatedFingerprintCount) {
        repeatedFingerprintCount = count;
        dominantFingerprint = fingerprint;
      }
      if (count > 1) {
        repeatedErrorPenalty += (count - 1) * 0.8;
      }
    }

    const rawScore =
      stepCompleted * 1.0 +
      writeMutations * 0.6 +
      resolvedErrorRecoveries * 0.4 -
      repeatedErrorPenalty -
      emptyNoOpTurns * 1.0;
    const progressScore = clamp(rawScore / 4, -1, 1);

    const recentFingerprints = errorFingerprints.slice(-8);
    let loopRiskIndex = 0;
    if (recentFingerprints.length > 0) {
      const recentCounts = new Map<string, number>();
      for (const fp of recentFingerprints) {
        recentCounts.set(fp, (recentCounts.get(fp) || 0) + 1);
      }
      const maxRepeat = Math.max(...recentCounts.values());
      const uniqueCount = recentCounts.size;
      const concentration =
        recentFingerprints.length <= 1
          ? 0
          : (recentFingerprints.length - uniqueCount) / (recentFingerprints.length - 1);
      const repetitionBase = maxRepeat >= 3 ? 0.7 : maxRepeat === 2 ? 0.4 : 0.1;
      loopRiskIndex = clamp(repetitionBase + concentration * 0.3, 0, 1);
    }

    return {
      progressScore,
      loopRiskIndex,
      repeatedFingerprintCount,
      dominantFingerprint,
      windowSummary: {
        stepCompleted,
        writeMutations,
        resolvedErrorRecoveries,
        repeatedErrorPenalty,
        emptyNoOpTurns,
      },
    };
  }
}
