# Release Notes 0.5.21

## Summary

Release `0.5.21` republishes the current runtime refresh as a publishable build. The codebase changes are the same feature set shipped in `0.5.20`: shared turn kernel, metadata-driven tool scheduling, normalized orchestration graph, typed worker roles, stricter verification, semantic batch summaries, and the UI/completion updates that surface them.

## New Features

- Shared `TurnKernel` for steps, follow-ups, subagents, and verification flows.
- Metadata-driven `ToolScheduler` with automatic batching for safe reads and scoped serialization for writes.
- Normalized orchestration graph engine for delegated work, workflow phases, and ACP-backed task state.
- Built-in worker roles: `researcher`, `implementer`, `verifier`, and `synthesizer`.
- Stricter verification runtime with verdict/report output.
- Semantic tool-batch summaries surfaced in timeline and completion projections.

## Enhancements

- Completion UI now carries richer terminal text from result summaries, semantic summaries, and verifier output.
- Follow-up messages remain visible in task timelines, including orphaned follow-ups handled after a main task completes.
- Screenshot-heavy visual refinement loops render more compactly in summary mode.
- Renderer surfaces were updated across the main content view, CLI frame, dispatched agents panel, and task event compatibility logic.
- Mission Control, task detail views, gateway relays, cron exports, and supervisor notifications consume the richer completion payload.

## Fixes

- Fixed terminal-state divergence between task events and the task row for follow-up completion paths.
- Fixed visibility for orphaned follow-up prompts in the timeline.
- Reduced noisy screenshot rendering during iterative canvas work.

## Docs

- Updated the README, release index, and release note references to point at `0.5.21`.
- Added a session note describing the runtime migration work completed in this cycle.

## Internal / Runtime Changes

- Shared turn ownership now lives in the runtime kernel.
- Tool batching, transcript normalization, and ordered tool-result handling are centralized.
- Delegated work is graph-backed across child tasks, workflow phases, collaborative teams, and ACP.
- Verification now uses a dedicated read-only worker role and verdict-based completion semantics.
- Tool-batch summaries are generated once per scheduler batch and attached to projections.

## Test / Build Changes

- Expanded unit coverage for the turn kernel, scheduler, orchestration graph, worker roles, verification, and completion projections.
- Improved build and packaging flow for the macOS release bundle.
- Release packaging now emits `0.5.21` artifact names and version metadata.

## Upgrade Notes

- `0.5.21` is a repackaged release of the same runtime work introduced in `0.5.20`.
- If you already evaluated `0.5.20`, there are no additional runtime changes in this release.
