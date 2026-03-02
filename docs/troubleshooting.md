# Troubleshooting

## macOS app won't launch (unsigned build)

CoWork OS is currently distributed as an unsigned build. On first launch, use **System Settings > Privacy & Security > Open Anyway** once.

Terminal fallback:

```bash
xattr -dr com.apple.quarantine "/Applications/CoWork OS.app"
```

If the app closes immediately with a `dyld` signature error:

```bash
codesign --force --deep --sign - "/Applications/CoWork OS.app"
```

> `spctl --add` / `spctl --enable` are deprecated on newer macOS and may show "This operation is no longer supported".

## npm install fails with SIGKILL

If install fails with `SIGKILL` during `node_modules/electron/install.js`, use a two-step install:

```bash
npm install --ignore-scripts cowork-os@latest --no-audit --no-fund
npm run setup
```

For local package testing, use the same `--ignore-scripts` flow with the tarball:

```bash
npm init -y
npm install --ignore-scripts /path/to/cowork-os-<version>.tgz
```

## macOS "Killed: 9" during setup

If you see `Killed: 9` during `npm run setup`, macOS terminated a native build due to memory pressure.

`npm run setup` already retries native setup automatically with backoff. Let it continue until it exits. If it still exits non-zero, close heavy apps and run the same command again:

```bash
npm run setup
```

## Windows native setup fails (`better-sqlite3`)

If first launch exits after:

```text
[cowork] $ npm.cmd rebuild --ignore-scripts=false better-sqlite3
[cowork] Native setup failed.
```

install native build prerequisites, then retry:

1. Install [Visual Studio Build Tools 2022](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with:
   - Desktop development with C++
   - MSVC v143 build tools
   - Windows 10/11 SDK
2. Install Python 3 and verify:

```powershell
py -3 --version
```

3. Set node-gyp MSVC env vars, then retry from a new terminal:

```powershell
setx GYP_MSVS_VERSION 2022
setx npm_config_msvs_version 2022
cowork-os
```

Windows ARM64 note:
- Setup now auto-tries x64 Electron emulation if ARM64 native rebuild fails.
- To disable that fallback and force native ARM64 only, set `COWORK_SETUP_SKIP_X64_FALLBACK=1`.

## App shows "vUnknown" or remote method error

If the app opens but shows `vUnknown` or `Error invoking remote method 'app:getVersion'`, you likely connected to an older already-running instance.

```bash
pkill -f '/cowork-os' || true
cowork-os
```

## Windows opens to a black screen (`ERR_FILE_NOT_FOUND dist/renderer/index.html`)

If terminal logs include:

```text
Failed to load URL .../dist/renderer/index.html with error: ERR_FILE_NOT_FOUND
```

the published package is missing renderer build assets.

For users:

```powershell
npm uninstall -g cowork-os
npm cache clean --force
npm install -g cowork-os@latest --no-audit --no-fund
```

For maintainers (before publish), verify tarball contains renderer assets:

```bash
npm run build
npm pack --json --dry-run | jq -r '.[0].files[].path' | grep '^dist/renderer/index.html$'
```

## VPS: "tsc: not found"

If you see `sh: 1: tsc: not found` right after `npx coworkd-node`, you are on an older broken npm publish. Upgrade and retry:

```bash
npm install cowork-os@latest --no-audit --no-fund
```

## "Tool-call budget exhausted: 42/42"

If you see:

```text
Tool-call budget exhausted: 42/42
```

that means hard executor budget contracts are enabled.

Current default behavior:

- `COWORK_AGENT_BUDGET_CONTRACTS=false` (opt-in only)

If your environment still enforces this cap, check for an explicit override and unset it:

```bash
unset COWORK_AGENT_BUDGET_CONTRACTS
```

Or explicitly disable it:

```bash
export COWORK_AGENT_BUDGET_CONTRACTS=false
```

To restore legacy strict budget-contract behavior, set:

```bash
export COWORK_AGENT_BUDGET_CONTRACTS=true
```

## "web_search budget exhausted: X/Y"

If a research step logs:

```text
web_search budget exhausted: 12/12
```

the task now uses a soft landing path for web-search-specific budget limits:

- The `web_search` tool call returns a structured error (`failureClass=budget_exhausted`) instead of throwing a hard executor exception.
- Execution can continue using already-collected evidence.
- Terminal completion can resolve as `partial_success` (instead of being hard blocked), and budget-constrained failed steps are auto-waived in the completion gate when appropriate.

To tune behavior, use Guardrails > Web Search Policy:

- `Mode`: `disabled | cached | live`
- `Max uses per task`
- `Max uses per step`
- `Allowed domains` / `Blocked domains`

Notes:

- `cached` is the default mode.
- If strict cached provider behavior is unavailable, runtime falls back to `live` and emits `web_search_mode_fallback_live`.
- Domain filtering emits `web_search_domain_filtered_result_count`. If all results are filtered, `web_search` returns a structured policy error.
