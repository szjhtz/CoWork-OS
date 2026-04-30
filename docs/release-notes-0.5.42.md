# Release Notes 0.5.42

Release `0.5.42` is a Windows installer hotfix for `0.5.41`.

## Fixed

- **Windows installer architecture**: the Windows release artifact is now built as an x64 app package, so standard Windows PCs install `CoWork OS.exe` correctly and desktop shortcuts point to a runnable executable.
- **Release packaging guardrail**: added an explicit `package:win:x64` packaging command so Windows release artifacts are not accidentally built with the host Mac architecture.

## Notes

The `0.5.41` npm package remains published, but the GitHub `v0.5.41` release is immutable and its Windows asset cannot be replaced in place. Use `0.5.42` for Windows installs.
