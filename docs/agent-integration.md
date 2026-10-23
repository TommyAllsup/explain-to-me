# Agent integration

In the 0.2.5 development checkout, animated Claudia is part of the normal build. Complete the optional [local runtime setup](claudia-setup.md), then pass `--presenter claudia` to the CLI or agent wrapper. A manifest can also select `visual.presenter.character: "claudia"` per supported scene. Automatic voice/backend selection uses the accepted Chatterbox/Bella profile; requested duration is advisory for its natural delivery. See the [presenter workflow](claudia.md) for outputs, scene selection, and the still-image pack alternative. The tag-pinned installation instructions below describe the published 0.2.1 release.

## Windows v0.2.1

Start with the [tag-pinned installer prompt](install-windows-agent.txt) in an existing Codex, Claude Code, or other local terminal-capable harness. [Agent setup examples](quick-install.md#windows-021-with-codex-or-claude-code) describe that workflow. The prompt installs Explain-to-Me; it does not install or reconfigure the harness.

On Windows 11 x64, clone `v0.2.1` and run `node scripts/setup.mjs` once, then use the setup-created `.venv-kokoro/Scripts/python.exe` with `scripts/agent-explainer.py`. No global Python, pnpm, uv, or FFmpeg installation is needed. Select `--tts kokoro` and `--director template` for document inputs. Prepared manifests bypass direction. Native Windows local AI direction is deferred.

The launcher uses Windows Job Objects for owned cleanup and sets the job's `TEMP`, `TMP`, and `TMPDIR`. See [Windows setup](windows.md) for exact commands and supported local paths. Scoped harness approval may be needed for setup downloads, private workspace access, Chromium/media execution, or Windows directory protection. Report the blocked operation when policy prevents it; do not change unrelated harness settings.

## macOS release workflow

Use `python3 scripts/agent-explainer.py doctor --workspace /absolute/private/workspace` followed by `build --workspace ... --manifest /absolute/private/workspace/story.json --tts apple --duration 60s`. For text input, use `--input source.md --director local --tts kokoro --voice af_heart` with installed optional models. Python 3.9+, Git and the normal runtime prerequisites are required. Invoke the script by absolute path from any working directory; it resolves its own software checkout.

## Common job contract

The private workspace must already exist outside the software checkout. Input and pronunciation-map paths must remain within it after symlink resolution. Unique jobs, explicit cache/temp roots, subprocess deadlines and QC-gated JSON results keep orchestration separate from production implementation. No shell interpolation, model installs, Git updates or uploads are performed.

Job files live under `<workspace>/.explain-to-me/jobs/<unique-id>/`: `job.json`, `build.log` and `output/`. Source version/commit/dirty state/fingerprint and artifact hashes provide provenance; they do not certify a released tag, factual correctness or whole-process no-egress. The wrapper trusts the local CLI's configured QC report and checks required artifacts/gates; it is not an independent decoder or an execution sandbox.

`state: automated-ready` is not human approval. Read `humanReview` and `egress` separately. Failures/cancellations return nonzero and retain diagnostics; do not share logs without redaction. A source/input change during a job refuses readiness. Do not edit the software tree while a build is running.

Per-project agent skills should point to this launcher and document explicit input/output bindings. Music and per-sentence rate settings remain separate from the 0.2.5 Claudia integration. Keep private adapters and stories outside the reusable source tree. Run launcher/bridge tests with `node .cache/setup/node_modules/pnpm/bin/pnpm.cjs test:agent` after Windows setup, or the pinned pnpm launcher from the macOS instructions.
