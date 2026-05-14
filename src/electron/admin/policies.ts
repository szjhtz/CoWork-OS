/**
 * Admin Policy System
 *
 * Controls plugin pack availability and enforcement at the organization level.
 * Policies are stored in a JSON file and can be managed via IPC or manual editing.
 *
 * Policy capabilities:
 * - Allow/block specific plugin packs by ID
 * - Mark packs as required (auto-activated, cannot be disabled)
 * - Set organization-level connector restrictions
 * - Control heartbeat frequency limits
 */

import * as fs from "fs";
import * as path from "path";
import { getUserDataDir } from "../utils/user-data-dir";
import type { PermissionMode } from "../../shared/types";

export type AdminSandboxType = "macos" | "docker" | "none";
export type AdminNetworkDefault = "allow" | "deny";

/**
 * Admin policy configuration schema
 */
export interface AdminPolicies {
  /** Policy format version */
  version: 1;

  /** Timestamp of last policy update */
  updatedAt: string;

  /** Plugin pack policies */
  packs: {
    /** Explicitly allowed pack IDs (empty = allow all) */
    allowed: string[];
    /** Explicitly blocked pack IDs (takes precedence over allowed) */
    blocked: string[];
    /** Required pack IDs (auto-activated, users cannot disable) */
    required: string[];
  };

  /** Connector policies */
  connectors: {
    /** Blocked connector IDs */
    blocked: string[];
  };

  /** Agent policies */
  agents: {
    /** Maximum heartbeat frequency in seconds (minimum 60) */
    maxHeartbeatFrequencySec: number;
    /** Maximum concurrent agents per workspace */
    maxConcurrentAgents: number;
  };

  /** Runtime safety requirements */
  runtime: {
    /** Permission modes users/tasks may select. Empty = all modes allowed. */
    allowedPermissionModes: PermissionMode[];
    /** Sandbox backends permitted for shell/code execution. */
    allowedSandboxTypes: AdminSandboxType[];
    /** Require OS-level sandboxing for shell commands. */
    requireSandboxForShell: boolean;
    /** Whether explicit env-gated unsandboxed shell fallback is allowed. */
    allowUnsandboxedShell: boolean;
    /** Network policy applied before legacy guardrail domain checks. */
    network: {
      defaultAction: AdminNetworkDefault;
      allowedDomains: string[];
      blockedDomains: string[];
      /** Coarse shell egress switch. Shell network cannot yet be domain-scoped. */
      allowShellNetwork: boolean;
    };
    /** Narrow automatic review of low-risk permission prompts. */
    autoReview: {
      enabled: boolean;
    };
    /** Optional task-event telemetry export. */
    telemetry: {
      enabled: boolean;
      otlpEndpoint?: string;
    };
  };

  /** General policies */
  general: {
    /** Whether users can install custom plugin packs */
    allowCustomPacks: boolean;
    /** Whether users can install packs from git repos */
    allowGitInstall: boolean;
    /** Whether users can install packs from URLs */
    allowUrlInstall: boolean;
    /** Organization name (shown in UI) */
    orgName?: string;
    /** Path to organization plugin packs directory */
    orgPluginDir?: string;
  };
}

/** Default policies (permissive) */
const DEFAULT_POLICIES: AdminPolicies = {
  version: 1,
  updatedAt: new Date().toISOString(),
  packs: {
    allowed: [],
    blocked: [],
    required: [],
  },
  connectors: {
    blocked: [],
  },
  agents: {
    maxHeartbeatFrequencySec: 60,
    maxConcurrentAgents: 10,
  },
  runtime: {
    allowedPermissionModes: [],
    allowedSandboxTypes: ["macos", "docker"],
    requireSandboxForShell: false,
    allowUnsandboxedShell: false,
    network: {
      defaultAction: "allow",
      allowedDomains: [],
      blockedDomains: [],
      allowShellNetwork: false,
    },
    autoReview: {
      enabled: true,
    },
    telemetry: {
      enabled: false,
    },
  },
  general: {
    allowCustomPacks: true,
    allowGitInstall: true,
    allowUrlInstall: true,
  },
};

/**
 * Get the path to the admin policies file
 */
function getPoliciesPath(): string {
  const userDataPath = getUserDataDir();
  return path.join(userDataPath, "policies.json");
}

/**
 * Get the organization plugin packs directory from policies
 */
export function getOrgPluginDir(policies?: AdminPolicies): string | null {
  const p = policies || loadPolicies();
  if (p.general.orgPluginDir && fs.existsSync(p.general.orgPluginDir)) {
    return p.general.orgPluginDir;
  }
  const userDataPath = getUserDataDir();
  const defaultOrgDir = path.join(userDataPath, "org-plugins");
  if (fs.existsSync(defaultOrgDir)) {
    return defaultOrgDir;
  }
  return null;
}

/**
 * Load admin policies from disk
 */
export function loadPolicies(): AdminPolicies {
  const policiesPath = getPoliciesPath();

  if (!fs.existsSync(policiesPath)) {
    return { ...DEFAULT_POLICIES };
  }

  try {
    const raw = fs.readFileSync(policiesPath, "utf-8");
    const parsed = JSON.parse(raw);

    // Merge with defaults to ensure all fields exist
    return {
      version: parsed.version || 1,
      updatedAt: parsed.updatedAt || new Date().toISOString(),
      packs: {
        allowed: Array.isArray(parsed.packs?.allowed) ? parsed.packs.allowed : [],
        blocked: Array.isArray(parsed.packs?.blocked) ? parsed.packs.blocked : [],
        required: Array.isArray(parsed.packs?.required) ? parsed.packs.required : [],
      },
      connectors: {
        blocked: Array.isArray(parsed.connectors?.blocked) ? parsed.connectors.blocked : [],
      },
      agents: {
        maxHeartbeatFrequencySec: Math.max(60, parsed.agents?.maxHeartbeatFrequencySec || 60),
        maxConcurrentAgents: Math.max(1, parsed.agents?.maxConcurrentAgents || 10),
      },
      runtime: {
        allowedPermissionModes: normalizePermissionModes(parsed.runtime?.allowedPermissionModes),
        allowedSandboxTypes: normalizeSandboxTypes(parsed.runtime?.allowedSandboxTypes),
        requireSandboxForShell:
          typeof parsed.runtime?.requireSandboxForShell === "boolean"
            ? parsed.runtime.requireSandboxForShell
            : DEFAULT_POLICIES.runtime.requireSandboxForShell,
        allowUnsandboxedShell:
          typeof parsed.runtime?.allowUnsandboxedShell === "boolean"
            ? parsed.runtime.allowUnsandboxedShell
            : DEFAULT_POLICIES.runtime.allowUnsandboxedShell,
        network: {
          defaultAction: parsed.runtime?.network?.defaultAction === "deny" ? "deny" : "allow",
          allowedDomains: normalizeStringList(parsed.runtime?.network?.allowedDomains),
          blockedDomains: normalizeStringList(parsed.runtime?.network?.blockedDomains),
          allowShellNetwork: parsed.runtime?.network?.allowShellNetwork === true,
        },
        autoReview: {
          enabled: parsed.runtime?.autoReview?.enabled !== false,
        },
        telemetry: {
          enabled: parsed.runtime?.telemetry?.enabled === true,
          otlpEndpoint:
            typeof parsed.runtime?.telemetry?.otlpEndpoint === "string"
              ? parsed.runtime.telemetry.otlpEndpoint
              : undefined,
        },
      },
      general: {
        allowCustomPacks: parsed.general?.allowCustomPacks !== false,
        allowGitInstall: parsed.general?.allowGitInstall !== false,
        allowUrlInstall: parsed.general?.allowUrlInstall !== false,
        orgName: parsed.general?.orgName,
        orgPluginDir: parsed.general?.orgPluginDir,
      },
    };
  } catch (error) {
    console.error("[AdminPolicies] Failed to load policies:", error);
    return { ...DEFAULT_POLICIES };
  }
}

/**
 * Save admin policies to disk
 */
export function savePolicies(policies: AdminPolicies): void {
  const policiesPath = getPoliciesPath();

  // Ensure directory exists
  const dir = path.dirname(policiesPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  policies.updatedAt = new Date().toISOString();
  fs.writeFileSync(policiesPath, JSON.stringify(policies, null, 2), "utf-8");
}

/**
 * Check whether a plugin pack is allowed by policy
 */
export function isPackAllowed(packId: string, policies?: AdminPolicies): boolean {
  const p = policies || loadPolicies();

  // Blocked list always takes precedence
  if (p.packs.blocked.includes(packId)) {
    return false;
  }

  // If allowed list is non-empty, only those packs are permitted
  if (p.packs.allowed.length > 0) {
    return p.packs.allowed.includes(packId);
  }

  // No restrictions
  return true;
}

/**
 * Check whether a plugin pack is required (cannot be disabled)
 */
export function isPackRequired(packId: string, policies?: AdminPolicies): boolean {
  const p = policies || loadPolicies();
  return p.packs.required.includes(packId);
}

/**
 * Check whether a connector is blocked by policy
 */
export function isConnectorBlocked(connectorId: string, policies?: AdminPolicies): boolean {
  const p = policies || loadPolicies();
  return p.connectors.blocked.includes(connectorId);
}

function normalizeStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    : [];
}

const VALID_PERMISSION_MODES = new Set<PermissionMode>([
  "default",
  "plan",
  "dangerous_only",
  "accept_edits",
  "dont_ask",
  "bypass_permissions",
]);

function normalizePermissionModes(value: unknown): PermissionMode[] {
  return normalizeStringList(value).filter((mode): mode is PermissionMode =>
    VALID_PERMISSION_MODES.has(mode as PermissionMode),
  );
}

const VALID_SANDBOX_TYPES = new Set<AdminSandboxType>(["macos", "docker", "none"]);

function normalizeSandboxTypes(value: unknown): AdminSandboxType[] {
  const normalized = normalizeStringList(value).filter((mode): mode is AdminSandboxType =>
    VALID_SANDBOX_TYPES.has(mode as AdminSandboxType),
  );
  return normalized.length > 0 ? normalized : [...DEFAULT_POLICIES.runtime.allowedSandboxTypes];
}

/**
 * Validate that a policy change is well-formed
 */
export function validatePolicies(policies: unknown): string | null {
  if (!policies || typeof policies !== "object") {
    return "Policies must be an object";
  }

  const p = policies as Record<string, unknown>;

  if (p.packs && typeof p.packs === "object") {
    const packs = p.packs as Record<string, unknown>;
    const allowed = Array.isArray(packs.allowed) ? packs.allowed : null;
    const blocked = Array.isArray(packs.blocked) ? packs.blocked : null;
    const required = Array.isArray(packs.required) ? packs.required : null;

    if (packs.allowed && !Array.isArray(packs.allowed)) {
      return "packs.allowed must be an array";
    }
    if (packs.blocked && !Array.isArray(packs.blocked)) {
      return "packs.blocked must be an array";
    }
    if (packs.required && !Array.isArray(packs.required)) {
      return "packs.required must be an array";
    }

    if (required && blocked && required.some((id) => blocked.includes(id))) {
      return "A pack ID cannot be both required and blocked";
    }

    if (required && allowed && allowed.length > 0 && required.some((id) => !allowed.includes(id))) {
      return "All required packs must also be in allowed list when allowlist is set";
    }
  }

  if (p.agents && typeof p.agents === "object") {
    const agents = p.agents as Record<string, unknown>;
    if (
      agents.maxHeartbeatFrequencySec !== undefined &&
      (typeof agents.maxHeartbeatFrequencySec !== "number" || agents.maxHeartbeatFrequencySec < 60)
    ) {
      return "agents.maxHeartbeatFrequencySec must be a number >= 60";
    }
    if (
      agents.maxConcurrentAgents !== undefined &&
      (typeof agents.maxConcurrentAgents !== "number" || agents.maxConcurrentAgents < 1)
    ) {
      return "agents.maxConcurrentAgents must be a number >= 1";
    }
  }

  if (p.runtime && typeof p.runtime === "object") {
    const runtime = p.runtime as Record<string, unknown>;
    const allowedPermissionModes = runtime.allowedPermissionModes;
    if (
      allowedPermissionModes !== undefined &&
      (!Array.isArray(allowedPermissionModes) ||
        allowedPermissionModes.some((mode) => !VALID_PERMISSION_MODES.has(mode as PermissionMode)))
    ) {
      return "runtime.allowedPermissionModes contains an invalid permission mode";
    }
    const allowedSandboxTypes = runtime.allowedSandboxTypes;
    if (
      allowedSandboxTypes !== undefined &&
      (!Array.isArray(allowedSandboxTypes) ||
        allowedSandboxTypes.some((mode) => !VALID_SANDBOX_TYPES.has(mode as AdminSandboxType)))
    ) {
      return "runtime.allowedSandboxTypes contains an invalid sandbox type";
    }
    if (
      runtime.requireSandboxForShell !== undefined &&
      typeof runtime.requireSandboxForShell !== "boolean"
    ) {
      return "runtime.requireSandboxForShell must be a boolean";
    }
    if (
      runtime.allowUnsandboxedShell !== undefined &&
      typeof runtime.allowUnsandboxedShell !== "boolean"
    ) {
      return "runtime.allowUnsandboxedShell must be a boolean";
    }
    const network = runtime.network as Record<string, unknown> | undefined;
    if (network) {
      if (
        network.defaultAction !== undefined &&
        network.defaultAction !== "allow" &&
        network.defaultAction !== "deny"
      ) {
        return "runtime.network.defaultAction must be allow or deny";
      }
      if (network.allowedDomains !== undefined && !Array.isArray(network.allowedDomains)) {
        return "runtime.network.allowedDomains must be an array";
      }
      if (network.blockedDomains !== undefined && !Array.isArray(network.blockedDomains)) {
        return "runtime.network.blockedDomains must be an array";
      }
      if (
        network.allowShellNetwork !== undefined &&
        typeof network.allowShellNetwork !== "boolean"
      ) {
        return "runtime.network.allowShellNetwork must be a boolean";
      }
    }
    const telemetry = runtime.telemetry as Record<string, unknown> | undefined;
    if (telemetry) {
      if (telemetry.enabled !== undefined && typeof telemetry.enabled !== "boolean") {
        return "runtime.telemetry.enabled must be a boolean";
      }
      if (telemetry.otlpEndpoint !== undefined && typeof telemetry.otlpEndpoint !== "string") {
        return "runtime.telemetry.otlpEndpoint must be a string";
      }
    }
  }

  return null;
}
