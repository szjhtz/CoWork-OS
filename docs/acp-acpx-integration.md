# ACP / acpx Integration Guide

How to integrate an OpenClaw + acpx–style coding agent stack into Cowork OS.

## Context

**OpenClaw + acpx** is a coding-agent stack where:

- **acpx** is a headless CLI for the [Agent Client Protocol (ACP)](https://agentclientprotocol.com)
- Orchestrators talk to coding agents (Codex, Claude Code, Pi, Gemini) over a **structured protocol** instead of PTY scraping
- acpx provides: persistent sessions, prompt queueing, typed output (thinking, tool calls, diffs), crash reconnect, and a single command surface for multiple agents

**Cowork OS** already has:

- Full **ACP server** on the Control Plane (`acp.discover`, `acp.task.create`, `acp.agent.register`, etc.)
- Coding agents invoked via **bash + PTY** (`run_command` wrapping `codex exec`, `claude`, etc.)
- `spawn_agent` for child tasks, but those run Cowork’s own executor, not an external ACP runtime

## Integration Options

### Option 1: acpx as CLI Wrapper (Lowest Friction)

Use acpx instead of raw `codex` / `claude` commands. Cowork’s executor keeps using `run_command`, but the command becomes `acpx codex "..."` instead of `codex exec "..."`.

**Benefits:**

- Structured output (`--format json`) for automation
- Session management, prompt queueing, cooperative cancel
- No protocol changes; drop-in replacement for existing coding-agent flows

**Implementation:**

1. **Update coding-agent skill** to prefer acpx when available:

   ```bash
   # Detect acpx
   which acpx || npx acpx@latest --version

   # One-shot (replaces codex exec)
   acpx codex exec "fix the failing tests"

   # Persistent session (replaces codex with background)
   acpx codex sessions ensure
   acpx codex "fix the failing tests"
   ```

2. **Add acpx detection** in `cli-agent-detection.ts`:

   - Extend patterns for `acpx codex`, etc.
   - Render `CliAgentFrame` for acpx-backed tasks

3. **Use JSON output** when running from tools:

   ```bash
   acpx --format json --cwd $WORKDIR codex exec "review this PR" | jq -r 'select(.type=="tool_call") | .title'
   ```

**Files to touch:**

- `resources/skills/coding-agent/references/full-guidance.md` — add acpx patterns
- `resources/skills/codex-cli/references/full-guidance.md` — acpx as preferred path
- `src/shared/cli-agent-detection.ts` — detect `acpx codex`
- `src/electron/agent/tools/shell-tools.ts` — ensure `acpx` is in `CLI_AGENT_ENV_KEYS` if it needs special env

---

### Option 2: acpx as ACP Runtime (OpenClaw-Style)

Add an “ACP runtime” mode so that when the user says “run this in Codex”, Cowork spawns acpx as the ACP backend instead of raw Codex. acpx manages the Codex process and speaks ACP.

**Flow:**

1. User: “Run this in Codex”
2. Cowork creates a child task with `capability_hint: "cli-agent"` and `runtime: "acp"`
3. Instead of `run_command("codex exec ...")`, Cowork invokes acpx (e.g. `acpx codex "..."` or acpx’s programmatic API if available)
4. acpx spawns Codex, runs the task, returns structured output

**Implementation sketch:**

- Add `runtime` to task config: `"native"` (default) vs `"acp"`
- In executor/tool routing, when `runtime === "acp"` and target is a coding agent, call acpx instead of raw CLI
- Optionally: acpx `--format json` output can be parsed and surfaced as structured events (tool calls, thinking, diffs) in the timeline

**Files to touch:**

- `src/electron/agent/executor.ts` — route to acpx when `runtime: "acp"`
- Task types — add `runtime?: "native" | "acp"`
- `src/electron/agent/tools/shell-tools.ts` — acpx invocation path
- Skills — document when to use `runtime: "acp"`

---

### Option 3: acpx Connects to Cowork as ACP Client

Run acpx in a mode where it connects to Cowork’s Control Plane and registers as a **remote ACP agent**. Cowork’s orchestrator discovers it via `acp.discover` and delegates via `acp.task.create`.

**Flow:**

1. acpx runs as a service, connects to `ws://127.0.0.1:18789` (Cowork Control Plane)
2. acpx calls `acp.agent.register` with `name: "codex-via-acpx"`, `capabilities: [{ id: "code", ... }]`
3. User: “Run this in Codex”
4. Cowork’s executor calls `acp.task.create` with `assigneeId: "remote:codex-via-acpx"`
5. acpx (or a bridge) must poll for tasks or receive them via Control Plane events
6. acpx spawns Codex, runs the task, updates task status/result

**Gap:** Cowork’s ACP handler creates tasks for **local** agents by calling `createTask` (CoWork task system). For **remote** agents, it only stores the ACP task in memory; nothing polls or pushes to the remote agent. You’d need:

- A bridge process that connects to the Control Plane, subscribes to ACP events, and forwards new tasks to acpx
- Or acpx (or an adapter) implementing a “pull” loop: periodically call `acp.task.list` for tasks assigned to itself, then execute them

**Files to touch:**

- New bridge: `src/electron/acp/acpx-bridge.ts` — connects to Control Plane, registers as remote agent, polls `acp.task.list` or listens for `acp.task.updated`, invokes acpx for each task
- Control Plane — ensure remote agents can receive task assignments (already supported; bridge does the rest)

---

### Option 4: Cowork as acpx Target (Reverse)

Configure acpx to use Cowork as an ACP server. OpenClaw’s config shows:

```json
{
  "agents": {
    "openclaw": {
      "command": "openclaw acp --url ws://127.0.0.1:18789 --token-file ~/.openclaw/gateway.token ..."
    }
  }
}
```

So acpx’s “openclaw” agent runs OpenClaw’s ACP bridge, which connects to OpenClaw’s gateway. For Cowork to be an acpx target, you’d need:

- A Cowork ACP bridge that speaks the same WebSocket/ACP format acpx expects
- Cowork’s Control Plane already has `acp.*` methods; the question is wire format compatibility with [ACP spec](https://agentclientprotocol.com)

If compatible, you could add a `cowork` agent to acpx:

```json
{
  "agents": {
    "cowork": {
      "command": "node ./cowork-acp-bridge.js --url ws://127.0.0.1:18789 --token $TOKEN"
    }
  }
}
```

Then `acpx cowork "run this task"` would delegate to Cowork’s agent.

---

## Recommended Path

**Short term:** Option 1 (acpx as CLI wrapper). Minimal changes, immediate benefit from structured output and session management.

**Medium term:** Option 2 (acpx as ACP runtime). Formalize `runtime: "acp"` so coding-agent tasks consistently go through acpx, with optional structured event streaming.

**Long term:** Option 3 or 4 if you want Cowork and acpx to interoperate as first-class ACP peers (e.g. acpx discovering Cowork’s agents, or Cowork delegating to acpx-registered agents).

---

## acpx Quick Reference

```bash
# Install
npm install -g acpx@latest

# One-shot (replaces codex exec)
acpx codex exec "summarize this repo"

# Session-based (replaces persistent codex)
acpx codex sessions ensure
acpx codex "fix the tests"

# JSON output for automation
acpx --format json --cwd ~/project codex exec "review PR"

# Custom workdir
acpx --cwd ~/repos/backend codex "refactor auth"

# Permissions
acpx --approve-all codex "apply patch and run tests"
```

---

## References

- [acpx GitHub](https://github.com/openclaw/acpx)
- [OpenClaw ACP Agents docs](https://docs.openclaw.ai/tools/acp-agents)
- [Agent Client Protocol](https://agentclientprotocol.com)
- Cowork ACP: `src/electron/acp/`, `src/electron/control-plane/protocol.ts` (ACPMethods, ACPEvents)
