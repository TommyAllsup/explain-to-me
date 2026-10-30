# Contributing

Thanks for helping make explanations clearer. This is a local-first CLI project by Tommy Allsup, with macOS, Windows 11 x64, and Linux/Kokoro workflows. Start with the [README](README.md) and [roadmap](ROADMAP.md).

## Before starting

For a substantial feature, open an issue to agree on scope. Small fixes, documentation improvements and synthetic examples are welcome. Keep changes focused; do not mix feature work with unrelated refactoring.

Use Node.js 24+ and pnpm 10.18.3. The README shows setup without a global pnpm installation. The `v0.3.0` Windows release uses `node scripts/setup.mjs` for Kokoro/template builds; macOS retains Apple speech and optional local models. [Windows setup](docs/windows.md) prepares the local toolchain; [Linux setup](docs/linux.md) covers required Kokoro and media tools. [Agent setup](docs/quick-install.md) includes Codex and Claude Code examples. Unit tests and typechecking are configured in Windows and Linux CI.

Animated Claudia uses separate optional [Windows/CUDA setup](docs/claudia-setup.md). The ordinary installer does not install Chatterbox, and static checks do not require its models.

## Check a change

```bash
npm exec --cache .cache/npm --offline --yes --package=pnpm@10.18.3 -- pnpm typecheck
npm exec --cache .cache/npm --offline --yes --package=pnpm@10.18.3 -- pnpm test
```

Tests inherit `TMPDIR`. If your terminal supplies an extremely long temporary path, select a shorter user-owned temporary root before running socket-path tests. No models or browser downloads are needed for the static CI checks.

On Windows, run checks through the setup-local pnpm launcher:

```powershell
node .cache/setup/node_modules/pnpm/bin/pnpm.cjs typecheck
node .cache/setup/node_modules/pnpm/bin/pnpm.cjs test
node .cache/setup/node_modules/pnpm/bin/pnpm.cjs test:agent
```

Python tests use the local Kokoro interpreter when available, or CI's configured Python. After browser/launcher/Kokoro setup, set `EXPLAIN_TO_ME_RENDER_SMOKE=1` and `EXPLAIN_TO_ME_MEDIA_SMOKE=1` to include real browser/proxy and media-decoding tests. The [Windows validation record](docs/benchmarks/windows-support.md) records the exercised checks and limits.

A restrictive agent sandbox can deny directory access-control changes or Chromium/media execution. Inspect the failure and use the harness's scoped command/path approval when permitted, or run the documented command from an ordinary PowerShell session. This is distinct from administrator elevation; do not disable unrelated safeguards.

- Add a focused regression test for changed behavior; run it before and after the fix.
- Preserve the validated manifest boundary, bounded local assets, private socket transport and owned-process cleanup.
- Run a representative media build when audio, timing or rendering changes; documentation-only changes do not need a render.
- Include actual commands/results and limitations in the pull request. Do not substitute automated checks for human approval.
- Keep generated outputs, model weights, caches, credentials and client/private material out of commits and issue attachments.
- Use synthetic, shareable fixtures. Imported assets must have documented redistribution permission.

## Pull requests

Explain the problem, narrow solution and checks. Update relevant docs when commands or supported behavior change. New public CLI/project-format contracts should be discussed before implementation.

Project code is MIT-licensed; contributions must be compatible with that license. Third-party dependencies and supplied models/assets retain their own terms. See [third-party notices](THIRD_PARTY_NOTICES.md).

For vulnerabilities, follow [SECURITY.md](SECURITY.md), not a public bug report.
