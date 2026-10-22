import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { extractPcmDataFromWav } from "../../packages/audio/src/synthesize.js";
import { assertNoLinkedPath, ensurePrivateDirectory } from "../../packages/assets/src/file-safety.js";
import { configureMediaTools } from "../../packages/runtime/src/tools.js";
import { renderSrt, renderWebVtt } from "../../packages/timeline/src/timeline.js";
import { confirmAllArtifacts, extractSceneBoundarySamples, muxAudioIntoVideo, validateRenderedMedia } from "../../packages/validation/src/qc.js";
import { mouthEnvelope, prepareTimeline, sha256, verifyTiming, type CharacterTestProps } from "./motion.js";
import { renderCharacterTest } from "./render.js";
import { buildMouthTrack } from "./lipsync.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function boundedRead(path: string, max: number): Promise<Buffer> {
  await assertNoLinkedPath(path);
  const info = await stat(path);
  if (!info.isFile() || info.size > max) throw new Error(`Expected bounded regular input: ${path}`);
  return readFile(path);
}

async function main(): Promise<void> {
  const { values } = parseArgs({options: {performance: {type:"string"}, output: {type:"string"}}, allowPositionals: false, strict: true});
  if (!values.performance || !values.output) throw new Error("Usage: node --import tsx scripts/claudia-character/main.ts --performance <timed-Bella-directory> --output <new-directory>");
  const performanceDirectory = resolve(values.performance);
  const outputDirectory = resolve(values.output);
  const [wav, timingBytes, performanceBytes, configBytes, selectedBytes] = await Promise.all([
    boundedRead(join(performanceDirectory, "audio.wav"), 2 * 24_000 * 30 + 4096),
    boundedRead(join(performanceDirectory, "timings.json"), 256 * 1024),
    boundedRead(join(performanceDirectory, "report.json"), 128 * 1024),
    readFile(join(root, "fixtures/presenters/claudia/voice-audition.json")),
    readFile(join(root, "fixtures/presenters/claudia/selected-voice.json")),
  ]);
  const config = JSON.parse(configBytes.toString("utf8"));
  const selected = JSON.parse(selectedBytes.toString("utf8"));
  if (selected.voice !== "af_bella" || selected.speed !== 1) throw new Error("Expected the selected Bella voice");
  const pcm = extractPcmDataFromWav(wav);
  const timing = verifyTiming(JSON.parse(timingBytes.toString("utf8")), wav, pcm, config.text);
  const {timeline, captions, beats} = prepareTimeline(timing);
  const mouth = buildMouthTrack(timing.phonemes, mouthEnvelope(pcm, timeline.fps), timeline.fps);
  const props: CharacterTestProps = {durationInFrames: timeline.durationInFrames, fps: timeline.fps, mouth, beats, voiceLabel:"BELLA / A"};
  await assertNoLinkedPath(dirname(outputDirectory));
  await mkdir(outputDirectory, {recursive:false});
  await ensurePrivateDirectory(outputDirectory);
  const write = (name: string, data: string | Buffer) => writeFile(join(outputDirectory, name), data, {flag:"wx"});
  const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
  const sourcePaths = ["Claudia.tsx", "Body.tsx", "Mouth.tsx", "Eye.tsx", "acting.ts", "posture.ts", "expressions.ts", "lipsync.ts", "video.tsx", "motion.ts", "entry.tsx", "render.ts", "main.ts", "prepare-performance.py"];
  const sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async (name) => [name, sha256(await readFile(join(root, "scripts/claudia-character", name)))])));
  const manifest = {
    schema: "claudia-character-test/v4", purpose:"Standalone animation experiment; not a ProductionManifest",
    title:"Claudia — remember the work", selectedVoice: selected,
    character:{name:"Claudia", origin:"manual-svg-rig", credit:"Claudia by anabology", canonUrl:"https://claudia.gallery/claudia/", canonReviewedAt:"2026-10-22", aiAssisted:true},
    motion:{mouth:"blended IPA visemes from saved model timing; expression corners preserve lip closure and rounding", face:"intent-led gaze holds, eyelid-clipped irises, full blinks, asymmetric brows, connected cheek and smile cues", body:"planted pelvis, shared spine and shoulder deformation, fixed-length arms, delayed fingers and head counterbalance", acting:"chest-led explanation and closing invitation; warm greeting, reflective question and thoughtful caution", determinism:"frame-derived; no random values, timers or live services"},
    fps:timeline.fps, width:1280, height:720, durationInFrames:timeline.durationInFrames, samples:timing.samples,
    audioSha256:sha256(wav), timingSha256:sha256(timingBytes), text:timing.text, beats, sourceHashes,
  };
  await Promise.all([
    write("audio.wav", wav), write("audio.pcm", pcm), write("timings.json", timingBytes),
    write("performance-report.json", performanceBytes), write("captions.vtt", renderWebVtt(captions)),
    write("captions.srt", renderSrt(captions)), write("manifest.json", json(manifest)), write("render-props.json", json(props)),
  ]);
  configureMediaTools();
  console.log(`Rendering Bella: ${timing.samples} samples / ${timeline.durationInFrames} frames`);
  const render = await renderCharacterTest({outputDirectory, inputProps:{...props}, durationInFrames:timeline.durationInFrames, fps:timeline.fps});
  await muxAudioIntoVideo(render.outputPath, join(outputDirectory,"audio.wav"), join(outputDirectory,"video.mp4"));
  const boundarySamples = await extractSceneBoundarySamples(join(outputDirectory,"video.mp4"), timeline, join(outputDirectory,"samples"));
  const qc = await validateRenderedMedia({outputDir:outputDirectory, pcmPath:join(outputDirectory,"audio.pcm"), timeline, captions, targetDurationMs:timeline.durationMs, rendererFrameCount:render.durationInFrames, boundarySamples});
  await write("report.json", json({status:"passed", selectedVoice:selected, performance:JSON.parse(performanceBytes.toString("utf8")), renderer:render, qc, videoSha256:sha256(await readFile(join(outputDirectory,"video.mp4")))}));
  await confirmAllArtifacts(outputDirectory);
  console.log(`Passed ${Object.keys(qc.checks).length} media checks: ${join(outputDirectory,"video.mp4")}`);
}

main().catch((error: unknown) => {console.error(error); process.exitCode = 1;});
