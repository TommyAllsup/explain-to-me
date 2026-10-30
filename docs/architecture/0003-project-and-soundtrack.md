# Architecture Decision 0003: Saved project and soundtrack boundaries

- Status: implemented in 0.3.0
- Date: 2026-10-21
- Scope: [implementation plan](../plans/0.3-saved-project.md)

The version-1 project binds one existing source/manifest, direction hints,
narrator, pronunciations, pacing, optional local soundtrack, and preview output.
It is orchestration configuration; the existing renderer-neutral production
manifest remains the script/scene contract. There is no second renderer or
production engine.

`plan --project` runs ingestion/direction only and copies approved image assets
into a new plan directory. The editable `manifest.json` is kept separate from
source/direction provenance in `plan.json`. Preview/build require an explicitly
selected plan, verify its source binding, and record its current hash. A changed
input, direction, or project title requires a new plan. Narration/visual edits to
the plan are permitted. General revision history and approval management remain
deferred; no command invents human approval.

Project preparation preserves reviewed spoken forms and returns a mapping from
every prepared chunk to its original passage ID. Pacing resolves passage over
scene over project default, using bounded absolute multipliers. Apple maps pace
1 to 170 WPM; Kokoro maps it to speed 1. Preview and full builds use the same
preparation/synthesis path and chunk cache identities.

For project builds, desired duration guides planning and chosen pacing determines
measured production timing. Optional strict mode synthesizes at that pace once
and checks ±1 second, failing with measured recovery guidance on mismatch. The
duration-correction policy in Decision 0001 still applies to legacy commands;
it does not override explicit project pacing. Speech is never truncated or padded
to fit, and production does not send a reviewed plan back to direction.

The narration cache includes effective spoken text, selected voice, effective
chunk rate, and adapter/runtime identity. Measured samples rebuild the existing
timeline and captions. The visual cache includes the manifest, measured timeline,
assets and renderer identity. Soundtrack settings, track hash and rights text are
absent from narration and visual cache identities. Music-only changes therefore
reuse speech and rendered frames; the mixer, mux and QC run again.

Optional Kokoro connected delivery adds scene context and explicit bounded
sentence/clause pause minimums. Contiguous passages share a synthesis context only
when their resolved pace matches and joined text fits the 1,600-character bound.
Native model phoneme starts partition that PCM into the original passage IDs;
exact phoneme-stream matching and complete sample coverage are required. The
cache unit is the entire context group, including ordered text and delivery
settings. These changes do not add duration fitting or modify approved words.
Without delivery settings, existing passage synthesis remains unchanged.

Connected previews retain the complete selected scene context and use the same
group cache as production. The short audible excerpt is extracted at measured
passage boundaries after synthesis. A selected passage therefore has the same
samples in preview and full builds, including context-sensitive inflection.

Captions are rendered into video frames. The mux explicitly selects only video
and audio, without an embedded selectable subtitle stream; SRT/VTT remain sidecars.

One local track is bound to a canonical project-contained regular file and hash.
Its bytes are bounded and rechecked before copying to private decode scratch.
The decoder selects a known audio demuxer, permits only the file protocol, and
decodes at most the narration duration plus one detection sample. Deterministic
PCM processing applies gain, narration-energy ducking and start/end fades without
depending on optional bundled FFmpeg filters. Existing subprocess execution and
owned scratch cleanup remain in use; this does not add a sandbox or whole-process
network proof.

`audio.wav` stays narration. `music.wav` is the processed aligned music stem;
`mixed.wav` is its sum with unmodified narration. Both have exactly the narration
sample count. A short track fades at its end and contributes zero afterward;
a long track fades at narration end. No loops or crossfades are added. Clipping
fails instead of changing narration levels. The MP4 carries the mixture.

Existing narration signal, timeline, captions, A/V, frame and full-decode checks
remain mandatory. Soundtrack sample counts, clipping and narration preservation
are checked separately and reported with source/stem/mix hashes and unverified
user-supplied rights text. All commands refuse existing output targets and retain
failed staging diagnostics. Automated QC, agent inspection, actual human
watch/listen approval and whole-process egress evidence remain separate records.
