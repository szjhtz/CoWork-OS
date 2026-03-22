# Release Notes 0.5.12

This page summarizes the product changes included in `0.5.12`, based on commits merged after `v0.5.11` on 2026-03-20.

## Overview

The 0.5.12 release restructures the heartbeat system around a signal-driven Pulse/Dispatch pipeline (Heartbeat v3), introduces the Ideas panel as a curated entry point for common workflows, adds Azure Anthropic as a new built-in provider, expands image generation to OpenRouter and additional providers, adds document editing sessions for PDF and DOCX files, adds video generation support, and tightens task routing, memory compression, and agent execution behavior throughout.

## What Changed

### Heartbeat v3

The heartbeat system has been fully refactored into a two-lane signal-driven pipeline. See [Heartbeat v3](heartbeat-v3.md) for the full architecture doc.

- **Pulse/Dispatch pipeline**: `Pulse` runs cheap deterministic state reduction and gating with no LLM calls. `Dispatch` escalates into visible work only when Pulse justifies it — a single idle or deferred Pulse cycle no longer triggers task creation.
- **Signal ledger**: event producers emit normalized heartbeat signals rather than free-form wake requests. Signals with the same fingerprint merge instead of accumulating, keeping ambient file/git/awareness activity cheap.
- **Deferred-state compression**: when a user-facing task is already active, Pulse records a deferred state and compresses pending signals into a resumable summary, eliminating unbounded wake queue growth and low-value wakes during active work.
- **Run tracking**: every Pulse and every Dispatch gets a run record. Heartbeat tasks carry a non-null `heartbeatRunId` for traceability in Mission Control.
- **Heartbeat profiles**: execution behavior is now controlled by `heartbeatProfile` (`observer`, `operator`, `dispatcher`) rather than `autonomyLevel`.
- **Dispatch guardrails**: one in-flight dispatch per agent/workspace, cooldown after success, daily dispatch budget (`maxDispatchesPerDay`), and evidence-ref requirements before task creation.
- **Foreground suppression**: heartbeats automatically pause during active foreground tasks. Manual `wake now` remains available as an override.
- **Mission Control status**: the operator surface now centers last pulse result, last dispatch result, deferred state, compressed signal count, due proactive count, dispatch cooldown, and budget state.
- **Agent heartbeat controls**: agents can now expose heartbeat control actions directly in Mission Control.

### Ideas Panel

A new curated Ideas panel provides a launch surface for common CoWork OS use cases.

- **Ideas navigation**: accessible from the sidebar above Sessions.
- **Curated launch panel**: displays a grid of pre-written idea prompts organized by category.
- **Ideas route**: the gateway router now handles `/ideas` for direct deep-linking.
- **Capabilities documented**: see [Ideas Panel: Supported Capabilities](ideas-capabilities.md) for the full list of tools each idea relies on and their graceful fallbacks.

### Azure Anthropic Provider

Azure Anthropic is now available as a built-in provider.

- Configure API key, endpoint, and deployment name in **Settings > LLM > Azure Anthropic**.
- Uses the Anthropic messages format routed through your Azure-hosted Claude deployment.
- Separate from the existing Azure OpenAI provider.
- Provider routing and role labels visible in Mission Control agent detail views.

### Image Generation Expanded

Image generation now routes through additional providers.

- **OpenRouter image generation**: OpenRouter can now route image generation requests, including preset model support for common image models.
- **Provider ordering**: image provider selection uses a configurable priority ordering so the best available provider is used without manual intervention.
- **New image tool routing**: image tools detect and route to the correct provider (Gemini, OpenAI, Azure OpenAI, OpenRouter) based on configuration.

### Document Editing Sessions

Inline document editing is now supported for PDF and DOCX files.

- **DOCX block replacement**: agents can replace specific content blocks in Word documents without rewriting the whole file.
- **PDF region edits**: PDF files support targeted region editing.
- **Inline document surfaces**: documents can be opened inline within a task session.
- **Version browsing**: previous document versions are browsable from the document surface.
- **Document-aware file viewing**: the file viewer recognizes active document sessions and surfaces the correct edit controls.

### Video Generation

Video generation is now available through new providers.

- **Video generation providers**: new provider routing layer for text-to-video and image-to-video models.
- **Video model settings**: configure preferred video model in **Settings > LLM**.
- **Polling tools**: video generation jobs can be polled for completion.
- **Inline video preview**: generated videos render inline in the task feed.

### Mission Control Task Controls

Mission Control now exposes task-level controls directly in the operator surface.

- Start, pause, stop, and retry task actions are accessible from Mission Control without navigating to the individual task view.

### Memory Compression Improvements

Context management has been tightened for long-running sessions.

- **Batch compression**: workspace context summaries are now compressed in batches rather than one-at-a-time, reducing redundancy.
- **Compact workspace summaries**: workspace context is summarized compactly and preserved across session compaction.
- **Concise playbook imports**: the playbook memory injection keeps entries concise to leave more budget for task context.
- **Chat prompt summarization**: imported ChatGPT history entries are summarized before injection.
- **Context summary validation**: workspace context summaries are validated for coherence before use.

### Task Routing and Execution Tightening

Several task routing and execution behaviors have been refined.

- **Chat mode locking**: chat-mode sessions are locked to user-configured tasks and cannot be silently upgraded to tool-using runs.
- **Execution contracts**: task execution contracts are more explicit, reducing ambiguous completion signals.
- **Strategy tool selection**: the task strategy layer now selects tools from a tighter allowlist appropriate for each execution mode.
- **Skill routing queries**: skill routing queries are more precise, reducing false matches on broad topics.
- **Visual QA plan insertion**: QA plans can be inserted into the task strategy at the right point in execution.
- **Completion contract parsing**: completion signal parsing is tighter, reducing spurious done/continue misclassifications.
- **Daemon completion flow**: the background daemon handles task completion signals more reliably.
- **Structured input handling**: structured input (multiple-choice pause prompts) is handled more robustly in plan-mode flows.
- **Child task handling**: child task lifecycle (creation, status sync, completion) is more consistent.
- **Tool allowlist for chat tasks**: chat-mode tasks now operate under a specific tool allowlist rather than inheriting the full task toolset.
- **Automated task model routing**: automated (heartbeat/cron) tasks can be routed to a different model than interactive tasks.

### Agent Role Labels

Agent role labels are now formatted consistently across the UI.

- Role labels appear in Mission Control agent detail views and collaborative task headers.
- Label formatting follows a uniform pattern regardless of role source (persona, team assignment, or dynamic).

### Provider Factory Routing

The provider factory now supports custom routing rules.

- Per-provider overrides can redirect specific model patterns to a different provider without a full config change.
- Azure Anthropic and OpenRouter routing are implemented as first-class factory routes.

### Documentation

- **Heartbeat v3**: new comprehensive architecture doc at [docs/heartbeat-v3.md](heartbeat-v3.md).
- **Ideas capabilities**: new reference doc at [docs/ideas-capabilities.md](ideas-capabilities.md) listing tools and fallbacks used by each Ideas panel prompt.
- **Providers**: Azure Anthropic added to the built-in providers table.
- **Features**: Ideas panel, document editing sessions, and video generation sections added.
- **CHANGELOG**: updated.

## Notes

- Heartbeat v3 is the new default. The legacy `heartbeatIntervalMinutes` field remains as a compatibility fallback but the v3 fields (`pulseEveryMinutes`, `dispatchCooldownMinutes`, `maxDispatchesPerDay`, `heartbeatProfile`) are the source of truth.
- Video generation requires a compatible provider configured in Settings. No video provider is available by default.
- Document editing sessions require the file to be opened from the Files panel or task artifact surface.
- This page is the canonical summary for the changes included in `0.5.12`.
