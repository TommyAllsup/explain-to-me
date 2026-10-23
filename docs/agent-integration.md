# Agent integration

## Repository GitHub identity

This repository uses `TommyAllsup` for GitHub operations and `Tommy Allsup <tommy.allsup@gmail.com>` for Git authorship. Run `git gh <command>` using the configured repository-local alias, or `node scripts/gh.mjs <command>`. The wrapper privately retrieves that stored account's token, verifies the authenticated login, and passes it only to the requested child process. Inherited authentication overrides are removed. Authentication changes and token output are deliberately unavailable through this wrapper.

The local Git credential helper uses the same verification for HTTPS `github.com`; failures stop credential fallback. The local alias/helper configuration is shared by linked worktrees, uses absolute paths to Node and this checkout's script, and must be restored if those paths move. New clones need their own local configuration. Raw `gh` is not intercepted and may use a different globally active account; agents must use the wrapper. Global Git/GitHub settings are left unchanged.

Check with `git gh api user --jq .login`, and run the isolated identity regressions with `node --test scripts/gh.test.mjs`. No token is stored in this repository. Authentication maintenance, if needed, happens outside the wrapper; never paste tokens into commands, logs, or project files.

To restore local configuration in a new or moved checkout, substitute the actual absolute Node/script paths below (POSIX shell or Git Bash):

```sh
git config --local user.name 'Tommy Allsup'
git config --local user.email 'tommy.allsup@gmail.com'
git config --local credential.https://github.com.username TommyAllsup
git config --local --replace-all credential.https://github.com.helper ''
git config --local --add credential.https://github.com.helper '!"/absolute/path/to/node" "/absolute/path/to/explain-to-me/scripts/gh.mjs" --git-credential'
git config --local alias.gh '!"/absolute/path/to/node" "/absolute/path/to/explain-to-me/scripts/gh.mjs"'
```

## Saved projects in the 0.3 working tree

An agent with local file/terminal access can invoke the [project CLI](projects.md) directly: `plan --project ... --output ...`, review/edit the saved `manifest.json`, then `preview --project ... --plan ...` and `build --project ... --plan ...`. Keep private projects, plans, output revisions, and caches in the selected private workspace. Paths inside project JSON are relative to that file's directory. Use new output directories and retain the project, plan, provenance, and report with the exact reviewed artifact.

`scripts/agent-explainer.py` remains the legacy source/prepared-manifest job launcher. It has no project/plan flags or project JSON job contract in 0.3. Invoke `node scripts/explain.mjs` from the updated software checkout for project commands; do not claim the legacy launcher's structured job guarantees for those invocations. The CLI retains staging diagnostics and checks selected project/source/plan bindings during production.

Project pacing overrides desired duration; `strict` checks the chosen pace without rate fitting or rewriting. Claudia in a saved manifest selects Chatterbox when backend/voice are automatic; it requires effective pace `1` and no Kokoro `delivery` settings. Use a preview for pronunciation/pacing review, then inspect the full movie. Automated QC, scripted fixture edits, and an agent selecting `--plan` do not certify human approval. Music source hashes and supplied rights text record provenance without certifying permission. The [project guide](projects.md) documents artifact meanings and music-only reuse checks. The [Claudia merge verification](benchmarks/0.3-claudia-merge.md) records Windows Kokoro and Chatterbox project builds; use these backends with prepared manifests/template direction on Windows.

## Animated Claudia from v0.2.5

In 0.2.5, animated Claudia is an optional part of the normal build. Complete the separate advanced [Windows/CUDA runtime setup](claudia-setup.md), then pass `--presenter claudia` to the CLI or agent wrapper. A manifest can also select `visual.presenter.character: "claudia"` per supported scene. Automatic voice/backend selection uses the accepted Chatterbox/Bella profile; requested duration is advisory for its natural delivery. See the [presenter workflow](claudia.md) for outputs, scene selection, and the still-image pack alternative. The tag-pinned installation instructions below use Kokoro and do not install Chatterbox.

## Windows v0.2.5

Start with the [tag-pinned installer prompt](install-windows-agent.txt) in an existing Codex, Claude Code, or other local terminal-capable harness. [Agent setup examples](quick-install.md#windows-025-with-codex-or-claude-code) describe that workflow. The prompt installs Explain-to-Me; it does not install or reconfigure the harness.

On Windows 11 x64, clone `v0.2.5` and run `node scripts/setup.mjs` once, then use the setup-created `.venv-kokoro/Scripts/python.exe` with `scripts/agent-explainer.py`. No global Python, pnpm, uv, or FFmpeg installation is needed. Select `--tts kokoro` and `--director template` for document inputs. Prepared manifests bypass direction. Native Windows local AI direction is deferred.

The launcher uses Windows Job Objects for owned cleanup and sets the job's `TEMP`, `TMP`, and `TMPDIR`. See [Windows setup](windows.md) for exact commands and supported local paths. Scoped harness approval may be needed for setup downloads, private workspace access, Chromium/media execution, or Windows directory protection. Report the blocked operation when policy prevents it; do not change unrelated harness settings.

## macOS release workflow

Use `python3 scripts/agent-explainer.py doctor --workspace /absolute/private/workspace` followed by `build --workspace ... --manifest /absolute/private/workspace/story.json --tts apple --duration 60s`. For text input, use `--input source.md --director local --tts kokoro --voice af_heart` with installed optional models. Python 3.9+, Git and the normal runtime prerequisites are required. Invoke the script by absolute path from any working directory; it resolves its own software checkout.

## Common job contract

The private workspace must already exist outside the software checkout. Input and pronunciation-map paths must remain within it after symlink resolution. Unique jobs, explicit cache/temp roots, subprocess deadlines and QC-gated JSON results keep orchestration separate from production implementation. No shell interpolation, model installs, Git updates or uploads are performed.

Job files live under `<workspace>/.explain-to-me/jobs/<unique-id>/`: `job.json`, `build.log` and `output/`. Source version/commit/dirty state/fingerprint and artifact hashes provide provenance; they do not certify a released tag, factual correctness or whole-process no-egress. The wrapper trusts the local CLI's configured QC report and checks required artifacts/gates; it is not an independent decoder or an execution sandbox.

`state: automated-ready` is not human approval. Read `humanReview` and `egress` separately. Failures/cancellations return nonzero and retain diagnostics; do not share logs without redaction. A source/input change during a job refuses readiness. Do not edit the software tree while a build is running.

Per-project agent skills using the legacy job contract should point to this launcher and document explicit input/output bindings. Version 0.2.5 has no music or per-passage pace flags; the unreleased 0.3 project CLI above adds those settings separately. General cartoon authoring beyond the fixed Claudia presenter remains outside both workflows. Keep private adapters and stories outside the reusable source tree. Run launcher/bridge tests with `node .cache/setup/node_modules/pnpm/bin/pnpm.cjs test:agent` after Windows setup, or the pinned pnpm launcher from the macOS instructions.
