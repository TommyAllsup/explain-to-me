# Security

This is early-stage local software, not a security-audited execution sandbox. Keep dependencies current and review generated narration and the files you choose to process.

## Report a vulnerability

Do not post credentials, private documents, exploitable details or sensitive build logs in a public issue.

If GitHub private vulnerability reporting is available for this repository, use **Security → Report a vulnerability**. Otherwise open a minimal issue asking the maintainer for a private reporting channel, without including the vulnerability or sensitive data. Repository publication alone does not guarantee private reporting is enabled.

This is a personal project; no response-time or long-term-support SLA is promised. Reports should identify the affected version, impact and a minimal synthetic reproduction. Fixes target the current development line; there is no supported older-version matrix yet.

## Intended boundaries and limitations

- The model produces constrained manifest data, never arbitrary renderer code or shell commands.
- Local raster references are bounded, canonicalized and copied before rendering.
- The local director uses a random private Unix-socket directory and owned-process cleanup.
- Native Windows currently uses template direction, Kokoro narration, and a compiled browser launcher that preserves renderer proxy checks. Windows jobs use Job Objects for owned process-tree cleanup; owned private directories receive explicit access controls. Reparse/network/device paths and ambiguous Windows filenames are refused. File checks are not an atomic Windows no-follow sandbox.
- Setup intentionally downloads dependencies, browsers and optional models. Runtime browser requests are restricted/audited, but whole-process no-egress enforcement has not been demonstrated.
- Existing output directories are refused; failed builds may retain diagnostics. Those files can contain source excerpts and local paths: inspect and redact before sharing.

These controls reduce risk; they are not a claim that untrusted input or every dependency is safe.
