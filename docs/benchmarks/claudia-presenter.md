# Claudia presenter experiment validation

2026-10-22 · Windows x64 · Node 24.19.0 · existing local Kokoro and Remotion 4.0.535 setup.

## Checks

- TypeScript: `tsc --noEmit` passed.
- Repository suite: 58 passed, 5 skipped (63 tests); opt-in browser/media tests and platform-specific coverage retain their existing skip conditions.
- Final renderer staging regression, added after the suite started: 1 passed; 2 opt-in browser tests skipped. Covers presenter-only staging, shared-asset deduplication, missing/unsupported references, provenance, and changed bytes.
- Agent launcher: 17 Python tests, 1 skipped; Windows process helpers: 4 passed.
- `doctor`: required local narrator, browser/launcher, and bundled media tools ready. Windows local AI direction remains optional/unavailable.
- `git diff --check`: passed.

The default system Node here was 23.6.0. Verification used the already installed bundled Node 24.19.0 executable; no toolchain installation or global PATH change was performed. The documented CLI requires Node 24+.

## Real local demo

```sh
node scripts/explain.mjs presenter --manifest fixtures/presenters/claudia/story.json --pack fixtures/presenters/claudia/pack.json --scenes welcome,receipts,finish --output out/claudia-story
node scripts/explain.mjs build --manifest out/claudia-story/manifest.json --tts kokoro --voice af_heart --output out/claudia-movie
node scripts/explain.mjs build --manifest out/claudia-movie/manifest.json --tts kokoro --voice af_heart --output out/claudia-rebuild
```

| Observation | Result |
|---|---|
| Video | 1280×720, 24 fps, 721 frames, 30.041667 seconds |
| First build | 63.72 seconds through automated validation |
| Portable rebuild | 6.41 seconds through automated validation |
| Rebuild narration cache | 21 hits, 0 misses |
| Rebuild render cache | Hit; no new render |
| MP4 SHA-256, both runs | `ea7c96dad074d0d3d6b26731ed7ef16a24331b5a88ecd9372847f3402773ab2e` |
| AV end difference | 11.667 ms |
| Caption end difference | 0 ms |
| Media checks | All 11 gates passed, including full decode |
| Provenance | Exact fixture metadata retained; `welcome`, `receipts`, `finish` listed as users of the still |

Inspected end-frame images for title, bullets, and outro. Presenter, full credit, AI disclosure, teaching copy, and caption lane are visible without overlap. Source fixture remains unchanged. Preparation tests also relocate a prepared bundle and remove its original inputs before resolving its copied assets.

These are observations from one local run, not general performance guarantees. End-to-end human watching/listening remains pending; automated checks and sampled frames do not establish that approval. Browser request auditing reported no external attempts; whole-process no-egress verification remains unverified. Asset provenance is declared history, not independent proof of authorship or generation.

Generated movies, reports, and samples remain under ignored `out/`; they are not committed. Reproduce with the [workflow](../claudia.md).
