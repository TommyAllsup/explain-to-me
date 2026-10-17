# Windows Kokoro/template validation

**Date:** 2026-10-17
**Scope:** Development changes based on `97a456f` (`v0.2.0`), Windows 11 x64. Native local AI direction remains unavailable. This evidence does not change the scope of the existing release tag.

## Installation

`node scripts/setup.mjs` completed from PowerShell with global pnpm, uv, Python, and FFmpeg omitted from PATH. It prepared pinned pnpm dependencies, the browser, the native launcher, and Kokoro, then passed doctor. No global package-manager/FFmpeg install or administrator elevation was used. The machine already had Windows' .NET/Visual C++ runtime prerequisites.

The bootstrap downloaded local uv 0.12.20 with its release checksum. A separate `UV_PYTHON_PREFERENCE=only-managed` check downloaded Python 3.11.16, created a fresh environment with the unchanged pinned Kokoro requirements, and synthesized 32,368 samples at 24 kHz. The ordinary build environment used its existing isolated Python 3.11.2 environment; the managed-environment check demonstrates that global Python is not a prerequisite.

Checks used Node 24.19.0 and pnpm 10.18.3. The shell's default Node 23.6.0 is below the project requirement; the Node 24 executable was selected explicitly. Application/OS sandbox restrictions caused media executable and DACL failures, so native integration checks ran outside that sandbox as the ordinary Windows user. This was not Windows administrator elevation.

## Regression checks

- Typecheck: passed (`tsc --noEmit`).
- TypeScript suite with `EXPLAIN_TO_ME_RENDER_SMOKE=1` and `EXPLAIN_TO_ME_MEDIA_SMOKE=1`: **40 passed, 1 skipped, 0 failed**.
- Python agent suite: **16 passed, 1 skipped, 0 failed**. Kokoro bridge contract suite: **4 passed**.
- The two skipped cases require file-symlink privilege/Developer Mode. Junction escape tests ran without that privilege. Unix CI retains the file-symlink cases.
- Native launcher tests preserve empty/quoted/Unicode/trailing-backslash arguments, standard I/O, exit status, and forced descendant cleanup.
- Job Object tests cover timeout, cancellation, parent success with surviving descendants, and process-handle cleanup when cleanup itself raises.
- Real Chromium permits the approved bundle and blocks/audits external HTTP, HTTPS CONNECT, and unapproved loopback requests. A real render also verifies that scratch files honor the job temp directory and receive private-directory protection.
- Media regression checks independently verify the first/middle/final decoded frame colors. A corrupted H.264 packet that passes stream copying fails the full-decode check.

Remotion's bundled Windows FFmpeg omits `select` and null's default `wrapped_avframe` encoder. QC therefore uses exact frame-bound `trim` extraction and explicit rawvideo/PCM decoding to the null sink. The supported checks were preserved without another FFmpeg download.

## Full builds

Both inputs requested 60 seconds at 1280×720, 24 fps, with Kokoro voice `af_heart`. Each warm build used a new output directory and the same cache as its cold build. Cold builds and some regression checks overlapped; these timings demonstrate observed behavior, not an isolated hardware benchmark or a general speed promise.

| Input | Cold through automated validation | Warm through automated validation | Measured container duration | Warm cache |
|---|---:|---:|---:|---|
| Bundled `whisper-vs-tts.json` manifest | 104.58 s | 7.91 s | 60.917 s | 42 narration hits, 0 misses; render hit |
| Bundled caching document plus image, through agent launcher | 78.60 s | 10.86 s | 59.375 s | 11 narration hits, 0 misses; direction and render hits |

Every build passed all existing gates: requested duration tolerance, A/V sync, captions, caption end, clipping, silence, frame count, scene-boundary samples, full decoding, WAV format, and PCM/timeline agreement. The agent builds returned `state: automated-ready`. Their video, WAV, captions, and manifest hashes matched across the cold/warm pair; reports differ because cache/timing records differ.

The template build ran in a separate local-drive workspace containing spaces and `é` in its path. It exercised image, bullet, code, statement, title, and outro scenes, approved-image copying, private job/temp/cache paths, nested browser Job Objects, and source fingerprinting. Representative image/bullet/code boundary frames were visually inspected and fit the layout.

Local artifacts retained for review:

- Manifest builds: `out/windows-golden-cold/` and `out/windows-golden-warm/`.
- Agent jobs in the separate validation workspace: `template-cold-loh4of89` and `template-warm-tnbtfr28`, each retaining `job.json`, `build.log`, and `output/`.
- Production source fingerprint recorded by both agent jobs: `3ac8bf6800d60f6714bb3e952596984f46fbb36e2c4b6990203c2edbf3c91fbb`. This evidence document was added afterward.

## Reproduce

After `node scripts/setup.mjs`, run the pinned setup-local package manager for static checks:

```powershell
node .cache/setup/node_modules/pnpm/bin/pnpm.cjs typecheck
$env:EXPLAIN_TO_ME_RENDER_SMOKE = '1'
$env:EXPLAIN_TO_ME_MEDIA_SMOKE = '1'
node .cache/setup/node_modules/pnpm/bin/pnpm.cjs test
node .cache/setup/node_modules/pnpm/bin/pnpm.cjs test:agent
```

Use the commands in [Windows setup](../windows.md) for prepared manifests and private-workspace template jobs. Choose fresh output names/cache roots for independent cold runs.

Windows/Linux static CI was configured but not executed remotely in this local task. A macOS media regression was not run on this Windows host. Automated media checks and sampled-frame inspection do not constitute end-to-end human watch/listen approval. Whole-process egress remains unverified and is reported separately from renderer request auditing.
