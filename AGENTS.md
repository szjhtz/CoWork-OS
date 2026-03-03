# AGENTS.md

## Failure Triage

When a user reports a failure, error, or unexpected behavior:

1. Check development logs first, if available.
2. Read `logs/dev-latest.log` for the most recent captured run.
3. If needed, inspect the newest timestamped file in `logs/dev-*.log` for full context.
4. Quote relevant error lines with timestamps when summarizing findings.
5. If logs are missing, state that clearly and continue with other diagnostics.

## Dev Log Availability

- Log capture is controlled by **Settings -> Appearance -> Developer logging** (default off).
- A forced capture run can be started with `npm run dev:log`.
- Optional local toggle state may exist at `.cowork/dev-log-settings.json`.
