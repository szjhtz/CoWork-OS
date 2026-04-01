#!/usr/bin/env node
/**
 * Signs the local node_modules Electron.app with a developer identity so
 * corporate EDR / endpoint-protection tools stop flagging it as unsigned.
 *
 * Runs automatically via the npm "postinstall" hook.  Can also be invoked
 * manually:   node scripts/codesign_electron_dev.mjs
 *
 * Configure the signing identity in one of two ways (highest priority first):
 *   1. COWORK_CODESIGN_IDENTITY  env var  (full name or SHA-1 hash)
 *   2. Automatic: picks the first "Apple Development" identity found in the keychain
 *
 * Set  COWORK_CODESIGN_SKIP=1  to skip signing entirely (CI, Linux, etc.).
 */

import { execSync, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const ELECTRON_APP = path.resolve(
  import.meta.dirname,
  "..",
  "node_modules",
  "electron",
  "dist",
  "Electron.app",
);

const ENTITLEMENTS = path.resolve(
  import.meta.dirname,
  "..",
  "build",
  "entitlements.mac.plist",
);

function log(msg) {
  process.stdout.write(`[codesign-dev] ${msg}\n`);
}

if (process.env.COWORK_CODESIGN_SKIP === "1") {
  log("Skipping (COWORK_CODESIGN_SKIP=1).");
  process.exit(0);
}

if (process.platform !== "darwin") {
  log("Skipping on non-macOS platform.");
  process.exit(0);
}

if (!existsSync(ELECTRON_APP)) {
  log(`Electron.app not found at ${ELECTRON_APP} — skipping.`);
  process.exit(0);
}

function detectIdentity() {
  if (process.env.COWORK_CODESIGN_IDENTITY) {
    return process.env.COWORK_CODESIGN_IDENTITY;
  }

  try {
    const output = execSync(
      "security find-identity -v -p codesigning",
      { encoding: "utf8", timeout: 10_000 },
    );
    const identities = output
      .split("\n")
      .map((line) => line.match(/"([^"]+)"/)?.[1] ?? null)
      .filter((value) => typeof value === "string" && value.length > 0);
    const preferredIdentity = identities.find((value) => value.startsWith("Apple Development:"));
    if (preferredIdentity) return preferredIdentity;
    if (identities.length > 0) return identities[0];
  } catch {
    // Keychain query failed — fall through.
  }

  return null;
}

function isAlreadySigned() {
  try {
    const info = execFileSync(
      "codesign",
      ["-dvvv", ELECTRON_APP],
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
    const stderr = info; // codesign writes details to stderr
    return false; // We'll check below
  } catch {
    return false;
  }
}

function checkCurrentSignature() {
  try {
    const result = execSync(`codesign -dvvv "${ELECTRON_APP}" 2>&1`, {
      encoding: "utf8",
      timeout: 10_000,
    });
    if (result.includes("Signature=adhoc")) return "adhoc";
    const teamMatch = result.match(/TeamIdentifier=(\S+)/);
    if (teamMatch && teamMatch[1] !== "not" && teamMatch[1] !== "not set") {
      return "signed";
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

const currentSig = checkCurrentSignature();
if (currentSig === "signed") {
  log("Electron.app is already signed with a team identity — skipping.");
  process.exit(0);
}

const identity = detectIdentity();
if (!identity) {
  log(
    "No signing identity found. Install an Apple Development certificate or " +
    "set COWORK_CODESIGN_IDENTITY. Skipping.",
  );
  process.exit(0);
}

log(`Signing Electron.app with: ${identity}`);

const entitlementsArgs = existsSync(ENTITLEMENTS)
  ? ["--entitlements", ENTITLEMENTS]
  : [];

try {
  execFileSync(
    "codesign",
    [
      "--force",
      "--deep",
      "--sign",
      identity,
      ...entitlementsArgs,
      "--timestamp",
      ELECTRON_APP,
    ],
    { stdio: "inherit", timeout: 60_000 },
  );
  log("Done — Electron.app signed successfully.");
} catch (err) {
  log(`Signing failed: ${err.message}`);
  log("Development will still work, but EDR may flag the unsigned binary.");
  process.exit(0); // Non-fatal — don't break npm install
}
