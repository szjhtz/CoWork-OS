/**
 * Confirmation Gate
 *
 * Pre-flight check called before tool execution for mutating tools.
 * Uses RiskClassifier to determine risk level, then:
 *   - low   → auto-allow
 *   - medium → UI confirmation via daemon.requestApproval()
 *   - high  → blocks unless autonomousMode overrides or user approves
 *
 * Also writes a JSONL audit trail for offline inspection.
 */

import * as fs from "fs";
import * as path from "path";
import { RiskClassifier, RiskContext } from "./RiskClassifier";
import type { GuardrailSettings } from "../../shared/types";
import { getUserDataDir } from "../utils/user-data-dir";

export interface ConfirmationGateResult {
  proceed: boolean;
  risk: string;
  reason: string;
  autoAllowed?: boolean;
}

export interface ConfirmationGateDeps {
  requestApproval: (
    taskId: string,
    type: string,
    description: string,
    details: unknown,
  ) => Promise<boolean>;
  getGuardrailSettings?: () => GuardrailSettings | undefined;
  getTaskAutonomousMode?: (taskId: string) => boolean;
}

export class ConfirmationGate {
  private auditDir: string;

  constructor(private deps: ConfirmationGateDeps) {
    this.auditDir = path.join(getUserDataDir(), "audit");
  }

  /**
   * Check whether a tool call should proceed.
   * Call this before dispatching any mutating tool.
   */
  async checkTool(
    taskId: string,
    toolName: string,
    toolInput: Record<string, unknown>,
    ctx: RiskContext = {},
  ): Promise<ConfirmationGateResult> {
    const settings = this.deps.getGuardrailSettings?.();

    // HITL disabled → fast path
    if (!settings?.hitlEnabled) {
      return { proceed: true, risk: "low", reason: "hitl_disabled", autoAllowed: true };
    }

    const classification = RiskClassifier.classify(toolName, toolInput, ctx);
    const requiresConfirmation = RiskClassifier.shouldRequireConfirmation(classification, settings);

    const entry: AuditEntry = {
      ts: new Date().toISOString(),
      taskId,
      toolName,
      risk: classification.risk,
      reason: classification.reason,
      decision: "pending",
    };

    if (!requiresConfirmation) {
      entry.decision = "auto_allowed";
      this.appendAuditEntry(entry);
      return {
        proceed: true,
        risk: classification.risk,
        reason: classification.reason,
        autoAllowed: true,
      };
    }

    // High risk: block by default unless approved
    const description =
      `Risk gate (${classification.risk}): ${classification.reason}. ` +
      `Approve to allow "${toolName}" to proceed.`;

    const approved = await this.deps.requestApproval(taskId, "risk_gate", description, {
      toolName,
      toolInput,
      risk: classification.risk,
      reason: classification.reason,
    });

    entry.decision = approved ? "approved" : "denied";
    this.appendAuditEntry(entry);

    return {
      proceed: approved,
      risk: classification.risk,
      reason: approved ? "user_approved" : "user_denied",
    };
  }

  private appendAuditEntry(entry: AuditEntry): void {
    try {
      if (!fs.existsSync(this.auditDir)) {
        fs.mkdirSync(this.auditDir, { recursive: true });
      }
      const date = entry.ts.slice(0, 10); // YYYY-MM-DD
      const file = path.join(this.auditDir, `hitl-${date}.jsonl`);
      fs.appendFileSync(file, JSON.stringify(entry) + "\n", "utf-8");
    } catch {
      // Non-fatal: audit write failures should not block execution
    }
  }
}

interface AuditEntry {
  ts: string;
  taskId: string;
  toolName: string;
  risk: string;
  reason: string;
  decision: "pending" | "auto_allowed" | "approved" | "denied";
}
