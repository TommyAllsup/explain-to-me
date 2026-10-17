# Native Windows support proposal

**Status:** Scope approved and implemented in the development checkout. See [Windows setup](../windows.md); validation evidence is recorded in `docs/benchmarks/windows-support.md`.
**Date:** 2026-10-17
**Baseline:** `main` at `97a456f16ad4262d66b87c5189598edd090af523` (`v0.2.0`).
**Proposed first target:** Windows 11 x64, ordinary user account, PowerShell, Node.js 24+, Python 3.11 through uv, FFmpeg/ffprobe, and a preinstalled Remotion Headless Shell.

## Recommended scope

Ship a first native Windows path using **Kokoro narration with prepared manifests or template-directed Markdown/plain text**. Preserve the existing manifest, measured-audio timeline, captions, output artifacts, cache provenance, and media QC. The renderer and media pipeline can remain TypeScript/Remotion/FFmpeg.

Kokoro is the smallest narration change because the adapter already exists. Its setup/model download becomes required for this Windows path. Native Windows speech could later restore a first-run experience without model downloads, but needs a separate adapter, voice discovery, rate correction, provenance, and backend-selection work.

Treat local model direction as a second milestone. The current Windows transport mismatch requires an adapter design, beyond executable-path fixes. Keep `--director template` available, report an explicit reason for `--director local` being unavailable, and disclose any `auto` fallback in the build report. Apple speech remains a macOS backend. Scope ARM64, older Windows versions, and WSL separately after real validation.

## Findings

| Area | Current behavior | Required change |
|---|---|---|
| CLI executable discovery | `apps/cli/src/index.ts` splits PATH on `:` and searches extensionless names; doctor requires macOS and Apple speech even with Kokoro installed. | Use native path delimiters and executable extensions, validate regular files, and share capability/backend selection between doctor and build. Doctor should require a usable narrator for the selected platform. |
| Narration selection | `packages/audio/src/synthesize.ts` defaults to Apple; `auto` always falls back to `/usr/bin/say`. | On Windows, select ready Kokoro or fail with an actionable setup message. Reject explicit Apple early. Cover default, auto, explicit backend, and voice behavior together. |
| Kokoro Python | `packages/audio/src/kokoro.ts` and `scripts/setup-kokoro.py` use `.venv-kokoro/bin/python`. | Use `.venv-kokoro/Scripts/python.exe` on Windows. Keep the venv root independent of executable layout; preserve model checksums and pinned dependencies. |
| Kokoro readiness | Queries distribution metadata without proving DLL loading or inference. | Add a bounded actual phonemization/synthesis check during setup/doctor, with clear missing-runtime diagnostics. Preserve 24 kHz mono signed 16-bit PCM and duration gates. |
| Browser discovery | Already recognizes Remotion's `win64` cache, `.exe` filenames, and explicit `CHROME_PATH`. | Prefer the documented preinstalled Headless Shell. Optional system-Chrome discovery should use Windows locations and `.exe` names. Validate launch, not just discovery. |
| Browser launch | `apps/renderer-remotion/src/render.ts` generates `renderer-chrome.mjs` with a Unix shebang and supplies it as `browserExecutable`. | Add a Windows launch mechanism that preserves restricting-proxy flags, request auditing, argument boundaries, process handles, and cleanup. |
| File protection | Cache and ingest readers use `O_NOFOLLOW`; private directories use POSIX modes. | Define and verify Windows ACL/reparse-point behavior. Native Node 24 reports `O_NOFOLLOW` as undefined, so the current bitwise flags silently become ordinary reads. POSIX mode bits do not establish equivalent Windows privacy. |
| Agent launcher | `scripts/agent-explainer.py` cancels with `os.killpg`/`SIGKILL` and sets only `TMPDIR`. | Use owned Windows process-tree cleanup and set `TEMP`, `TMP`, and `TMPDIR` to the job's temp directory. Apply socket-length limits only to a transport that uses them. |
| Local director | Hardcodes `/opt/homebrew/bin/llama-server` and uses Node HTTP `socketPath` with a `.sock` endpoint. | Generalize executable identity separately; design a compatible private Windows transport before enabling local direction. |
| Tests and CI | Ubuntu-only CI; Unix separators/mode assertions, unconditional symlink creation, and `python3` assumptions. | Add Windows CI and platform-specific assertions while retaining containment and cleanup coverage. Exercise ordinary-account operation. |

Ingestion already handles CRLF and uses native path containment. Forward-slash relative image references can remain the portable document format. Media validation already passes FFmpeg arguments as arrays rather than shell commands. Windows font layout still requires visual review.

## Implementation sequence

### 1. Establish a Windows test baseline and platform capabilities

- Add Windows alongside Ubuntu in static CI, with Node 24, pinned pnpm, and explicit Python setup.
- Fix path-separator assumptions; retain Unix permission tests on Unix and add meaningful Windows file-boundary tests. Separate tests requiring symlink privileges from ordinary-account coverage; include junction escape tests.
- Centralize executable lookup, venv layout, narrator availability, and director transport capability. Test Windows drive paths and PATH entries containing spaces.
- Make doctor and build use the same backend-selection policy. Unsupported local direction must not make a prepared-manifest/template build fail.
- Verify PowerShell-safe install and test commands. The documented npm launcher failed to find pnpm on this host; invoking the downloaded pinned pnpm script through Node worked. Diagnose the launcher separately before documenting a universal command.

### 2. Prove Windows rendering before expanding the implementation

The installed **Remotion 4.0.535** source exposes no public arbitrary-Chromium-arguments/proxy option. Its `open-browser.js` explicitly adds `--no-proxy-server`, a direct proxy, and a wildcard bypass. The current wrapper removes those flags and inserts the restricting proxy.

Recommended spike: a small Windows `.exe` launcher behind the supported `browserExecutable` option, retaining the existing Unix launcher on Unix. Keep its source in the repository and define a reproducible build/distribution path; do not require ordinary users to install a compiler without an explicit packaging decision. A `.cmd` or PowerShell script alone will not work with Remotion's shell-free process launch.

The launcher must remove the three conflicting proxy arguments, inject the approved proxy settings, forward argument boundaries and inherited handles/stdout/stderr correctly, return the browser's exit status, and terminate owned descendants. Prove DevTools communication and a tiny render, then verify a synthetic external request is blocked, audited, and fails the build. Do not enable Windows by bypassing the proxy. A pinned Remotion patch or upstream launch-argument support is an alternative if the executable helper is impractical; internal APIs add maintenance risk.

### 3. Enable and exercise Kokoro

- Fix setup/runtime venv paths and share platform-aware backend selection.
- Install the pinned Python environment and model assets during setup only. Check actual eSpeak/ONNX loading and a short synthesis, including paths with spaces and non-ASCII characters.
- Diagnose missing Windows runtime libraries and invalid voices. The dependency wheel checks support feasibility, but do not prove this pinned stack works end to end.
- Keep audio measurements, bounded rate corrections, cache identity, and duration failures intact. Test a cold synthesis followed by a cache hit.

### 4. Preserve owned jobs and file boundaries

- Implement Windows process ownership, preferably Job Objects with kill-on-close and assignment before descendants can escape. Ensure timeout/cancellation waits for owned descendants and releases logs, browsers, Python processes, and FFmpeg handles.
- Establish current-user access for private job/model/cache directories. Document the actual boundary rather than treating `chmod`/`umask` as Windows access controls.
- Add explicit reparse-point/file-handle handling where no-follow reads are required. Cover junction/symlink escape, path swaps, different drives, UNC inputs, alternate data streams, and reserved names; reject unsupported forms clearly.
- Keep output overwrite refusal, canonical approved roots, asset hashes, bounded reads, and retained failure diagnostics.

### 5. Validate and document the first supported path

- Run typecheck and the TypeScript/Python suites on Windows and Ubuntu; verify existing macOS speech/media behavior on a Mac.
- Run the bundled 60-second prepared manifest and a template-directed document containing a local image. Require video/audio/caption/report artifacts and existing automated QC gates to pass.
- Build into a second new output directory using the same cache and prove narration/render reuse. Include spaces/non-ASCII paths and an ordinary user account.
- Exercise cancellation during synthesis and rendering, missing prerequisites, blocked external requests, and existing-output refusal.
- Watch/listen to the result and inspect Windows text/code layout. Update README, quick-install, agent integration, support statements, and third-party prerequisites only to the scope actually verified.

### 6. Design native local model direction separately

The setup script already uses `shutil.which('llama-server')`; the TypeScript runtime ignores that discovered location in favor of a Homebrew path. Resolve an explicit/discovered absolute executable and retain binary/model fingerprints and setup provenance.

The transport is a separate issue: [Node IPC uses named pipes on Windows](https://nodejs.org/api/net.html#ipc-support), while [llama.cpp selects AF_UNIX for `.sock` hosts](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/server-http.cpp). Current upstream's Windows AF_UNIX support does not make Node's named-pipe client compatible.

Evaluate a bounded stdio inference adapter, an audited native AF_UNIX client bridge, or upstream named-pipe support with an appropriate DACL. Preserve schema-constrained responses, bounded payloads/timeouts, model identity, private transport, and owned cleanup. Specify and validate any alternate local-service design explicitly before adoption. WSL can retain Unix transport if all components run inside Linux, but also needs executable discovery and its own validation.

## Evidence collected on this Windows host

- Fresh clone of upstream `main`; no preexisting checkout or local source changes.
- Default shell Node is `23.6.0`, below the repository requirement. Checks used the bundled **Node 24.19.0** and downloaded **pnpm 10.18.3**, with frozen-lockfile installation succeeding.
- TypeScript typecheck passed.
- TypeScript tests outside the sandbox: **17 passed, 1 failed**. Failure: `director.test.ts` asserts `location.directory.startsWith(fittingPath + "/")`. Its later POSIX mode assertion also needs platform-specific treatment. An earlier sandbox run had additional filesystem permission errors; those disappeared outside the sandbox.
- Doctor fails on Windows and reports installed FFmpeg/ffprobe as missing, consistent with its Unix PATH parsing. Kokoro and a render browser were not installed for this audit.
- Python tests failed in the sandbox, including missing symlink privilege, Unix socket-budget assumptions, and `AttributeError` from `os.killpg` during timeout cleanup. A separate Git fixture failed due to sandbox permissions; do not attribute that error to product portability.
- Node 24 Windows probe: `fs.constants.O_NOFOLLOW === undefined`. Python 3.11 Windows exposes neither `os.killpg` nor `signal.SIGKILL`.
- No model downloads, synthesis, or full media render were performed. This is feasibility evidence and a plan, not a Windows support claim.

## Dependency references

The pinned [ONNX Runtime 1.31.0](https://pypi.org/project/onnxruntime/1.31.0/), [NumPy 2.4.6](https://pypi.org/project/numpy/2.4.6/), [cffi 2.1.1](https://pypi.org/project/cffi/2.1.1/), and [espeakng-loader 0.2.4](https://pypi.org/project/espeakng-loader/0.2.4/) publish Windows wheels. [ONNX Runtime's installation guide](https://onnxruntime.ai/docs/install/) describes Windows Visual C++ runtime prerequisites. Pinned [phonemizer 3.4.0](https://github.com/bootphon/phonemizer/blob/v3.4.0/phonemizer/backend/espeak/api.py) has Windows DLL handling; test the existing pin before introducing a fork. Native speech remains an optional follow-up using [System.Speech WAV output](https://learn.microsoft.com/en-us/dotnet/api/system.speech.synthesis.speechsynthesizer.setoutputtowavefile?view=netframework-4.8.1).
