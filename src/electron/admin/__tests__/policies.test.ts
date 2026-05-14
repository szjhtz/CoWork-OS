import { describe, expect, it } from "vitest";

import { validatePolicies } from "../policies";

describe("validatePolicies", () => {
  it("accepts non-conflicting pack policy lists", () => {
    expect(
      validatePolicies({
        packs: {
          allowed: ["alpha", "beta"],
          blocked: ["blocked-pack"],
          required: ["alpha"],
        },
      }),
    ).toBeNull();
  });

  it("rejects required IDs that are also blocked", () => {
    expect(
      validatePolicies({
        packs: {
          allowed: [],
          blocked: ["shared-pack"],
          required: ["shared-pack", "other-pack"],
        },
      }),
    ).toBe("A pack ID cannot be both required and blocked");
  });

  it("requires required IDs to be in allowlist when allowlist is set", () => {
    expect(
      validatePolicies({
        packs: {
          allowed: ["core-pack"],
          blocked: [],
          required: ["missing-pack"],
        },
      }),
    ).toBe("All required packs must also be in allowed list when allowlist is set");
  });

  it("accepts runtime safety policies", () => {
    expect(
      validatePolicies({
        runtime: {
          allowedPermissionModes: ["default", "dangerous_only"],
          allowedSandboxTypes: ["macos", "docker"],
          requireSandboxForShell: true,
          allowUnsandboxedShell: false,
          network: {
            defaultAction: "deny",
            allowedDomains: ["docs.example.com"],
            blockedDomains: ["*.tracking.example"],
            allowShellNetwork: false,
          },
          telemetry: {
            enabled: true,
            otlpEndpoint: "http://127.0.0.1:4318/v1/traces",
          },
        },
      }),
    ).toBeNull();
  });

  it("rejects invalid runtime sandbox types", () => {
    expect(
      validatePolicies({
        runtime: {
          allowedSandboxTypes: ["bare-metal"],
        },
      }),
    ).toBe("runtime.allowedSandboxTypes contains an invalid sandbox type");
  });

  it("rejects invalid shell network policy type", () => {
    expect(
      validatePolicies({
        runtime: {
          network: {
            allowShellNetwork: "yes",
          },
        },
      }),
    ).toBe("runtime.network.allowShellNetwork must be a boolean");
  });
});
