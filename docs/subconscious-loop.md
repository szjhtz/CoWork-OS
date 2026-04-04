# Subconscious Reflective Loop

CoWork OS now treats `Subconscious` as the primary reflective automation layer.

It is not a narrow code-fix campaign system. It is a broader loop that continuously collects evidence, generates hypotheses, critiques them, chooses one winning recommendation, writes durable artifacts, and dispatches the result into the right workflow when an executor exists.

## What Changed

The older improvement model was centered on candidates, campaigns, variants, and promotion gates for repo-focused experiments.

The current product shape is different:

- one global coordinator
- namespaced state per workflow target
- durable artifacts in `.cowork/subconscious/`
- SQLite indexing for search, filtering, and UI summaries
- automatic dispatch into downstream workflow executors
- recommendation-only completion when no executor mapping exists

Code change workflows still matter, but they are now one executor kind inside the broader reflective system.

## Core Concepts

| Concept | Purpose |
|---|---|
| `SubconsciousTargetRef` | Stable workflow identity for `global`, `workspace`, `agent_role`, `mailbox_thread`, `scheduled_task`, `event_trigger`, `briefing`, and `code_workspace` targets |
| `SubconsciousRun` | One reflective pass across `collecting_evidence`, `ideating`, `critiquing`, `synthesizing`, `dispatching`, `completed`, `blocked`, or `failed` |
| `SubconsciousHypothesis` | A candidate direction produced from evidence |
| `SubconsciousCritique` | Objections, weaknesses, and supporting evidence against a hypothesis |
| `SubconsciousDecision` | The winning recommendation plus rejected paths and rationale |
| `SubconsciousBacklogItem` | Follow-up work the next run should sharpen or execute |
| `SubconsciousDispatchRecord` | The durable record of what was dispatched, where, and with what result |
| `SubconsciousSettings` | Cadence, enabled target kinds, model routing, dispatch defaults, retention, and executor policy flags |

## Reflective Pipeline

Every run follows the same fixed sequence:

1. collect evidence
2. generate 3-5 hypotheses
3. critique each hypothesis against objections and evidence
4. synthesize one winner plus rejected paths plus next-step backlog
5. dispatch immediately when an executor mapping exists
6. persist all artifacts before marking the run complete

The loop only compounds if persistence happens before completion. That is why artifacts are part of the contract, not an optional log.

## Evidence Sources

The coordinator normalizes existing platform signals into target-scoped evidence:

- tasks and timeline events
- workspace memory and playbook signals
- mailbox events and thread activity
- heartbeat signals
- scheduled tasks
- event triggers
- briefing state
- workspace code failures

This lets one reflective system cover operational work, not just repository maintenance.

## Runtime Roles And Model Routing

The loop reuses the existing worker-role runtime instead of inventing a second agent stack.

| Role | Responsibility |
|---|---|
| `researcher` | ideation and candidate hypothesis generation |
| `verifier` | critique, objections, and evidence pressure-testing |
| `synthesizer` | winner selection, decision writing, and backlog creation |
| `implementer` | downstream execution only when a mutating dispatch is required |

Model routing is phase-aware:

- ideation prefers cheaper or local models
- critique and synthesis use stronger judgment models
- dispatch uses the target workflow's normal runtime or executor profile

## Durable State

Workspace artifacts are written under:

```text
.cowork/subconscious/
  brain/state.json
  brain/memory.jsonl
  targets/<targetKey>/state.json
  targets/<targetKey>/memory.jsonl
  targets/<targetKey>/backlog.md
  targets/<targetKey>/runs/<runId>/evidence.json
  targets/<targetKey>/runs/<runId>/ideas.jsonl
  targets/<targetKey>/runs/<runId>/critique.jsonl
  targets/<targetKey>/runs/<runId>/decision.json
  targets/<targetKey>/runs/<runId>/winning-recommendation.md
  targets/<targetKey>/runs/<runId>/next-backlog.md
  targets/<targetKey>/runs/<runId>/dispatch.json
```

SQLite stores indexed summaries for:

- target discovery
- run history
- last winner
- backlog status
- dispatch history
- deduplication and evidence fingerprinting

The files remain the source of truth. SQLite is the fast index and query layer.

## Global Brain, Namespaced Targets

`Global brain` does not mean one mixed backlog.

The coordinator keeps:

- one top-level ranking and prioritization state
- separate histories per target
- separate winners per target
- separate backlog streams per target

That split matters because the system should learn globally while still preserving local truth for each workflow.

## Dispatch Model

`Subconscious` writes a decision even when it cannot dispatch. Dispatch is opportunistic, not required for a successful reflective run.

First-class dispatch kinds are:

- `task`
- `suggestion`
- `scheduled_task`
- `briefing`
- `event_trigger_update`
- `mailbox_automation`
- `code_change_task`

If a target has no valid executor mapping, the run still ends successfully with winner, rejected paths, and next backlog written to disk and indexed as recommendation-only output.

## Code Workflow Support

Code changes are now a downstream executor type, not the primary abstraction.

When the winner maps to `code_change_task`, the normal code executor still applies:

- git-backed target resolution
- worktree isolation where required
- review-aware runtime behavior
- verification before completion
- PR-capable flows when configured

The difference is where that work comes from: a subconscious decision rather than a candidate/campaign/variant stack.

## Product Surface

The main cockpit is now `Settings > Automations > Subconscious`.

The UI exposes:

- global brain status and cadence
- target list with health and last winner
- active runs
- latest hypotheses, critique, and winner for the selected target
- namespaced backlog
- dispatch history
- policy and settings controls

Mission Control still links to dispatched tasks, but it is not the primary reflective cockpit.

## Safety Model

`Subconscious` is a general-availability feature.

There is no owner-only enrollment gate. Safety remains enforced at the executor boundary by the existing permission, capability, approval, and runtime policies.

That keeps the reflective layer broad without turning it into an unrestricted autopilot.

## Relation To The Learning Stack

The reflective loop sits on top of the existing learning substrate:

- `PlaybookService`
- `MemoryService`
- `UserProfileService`
- `RelationshipMemoryService`
- `FeedbackService`

Those systems still capture durable knowledge. `Subconscious` turns that knowledge, plus fresh workflow evidence, into explicit hypotheses, critique, winner selection, backlog, and dispatch.

## Operational Notes

- The service initializes after memory services are ready.
- Code dispatch only targets real git-backed repositories.
- Worktree-backed code execution uses persisted worktree settings.
- Legacy improvement data is treated as migration input, not as an active parallel system.

See also:

- [Features](features.md)
- [Mission Control](mission-control.md)
- [Getting Started](getting-started.md)
- [Troubleshooting](troubleshooting.md#subconscious-startup-warnings-in-development)
