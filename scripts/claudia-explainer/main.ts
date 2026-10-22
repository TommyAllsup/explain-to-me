import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { extractPcmDataFromWav, writeWavFromPcm } from "../../packages/audio/src/synthesize.js";
import { assertNoLinkedPath, ensurePrivateDirectory } from "../../packages/assets/src/file-safety.js";
import { configureMediaTools } from "../../packages/runtime/src/tools.js";
import { mouthEnvelope, sha256 } from "../claudia-character/motion.js";
import { buildMouthTrack } from "../claudia-character/lipsync.js";
import { renderCharacterTest } from "../claudia-character/render.js";
import type { ExplainerProps, ExplainerScene } from "./types.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const FPS = 24, RATE = 24_000, SAMPLES_PER_FRAME = RATE / FPS;
const REFERENCE = "3188194b9e9cacc7e35b48fbb2095b5d139adfe967abd4c2f5dd5cc5bade1733";
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
const textKey = (text: string) => text.toLowerCase().replaceAll("’", "'").match(/[a-z0-9]+(?:'[a-z]+)?/gu)?.join(" ") ?? "";
const timeShape = {start: z.number().finite().nonnegative(), end: z.number().finite().nonnegative()};
const scriptSchema = z.object({
  version: z.literal(1), title: z.string(), targetDurationSeconds: z.number().positive(), music: z.string(),
  scenes: z.array(z.object({id: z.string(), title: z.string(), visual: z.string(), displayText: z.union([z.string(), z.array(z.string())]), narration: z.string()})).length(8),
  sources: z.array(z.object({title: z.string(), url: z.url(), supports: z.string()})),
});
const narrationSchema = z.object({
  schema: z.literal("claudia-explainer-narration/v1"), voice: z.literal("chatterbox-bella"),
  scriptSha256: z.string(), sampleRate: z.literal(RATE), durationSeconds: z.number().positive(),
  scenes: z.array(z.object({
    id: z.string(), text: z.string(), voice: z.literal("chatterbox-bella"), audio: z.string(), audioSha256: z.string(),
    referenceSha256: z.literal(REFERENCE), samples: z.number().int().positive(), sampleRate: z.literal(RATE), durationSeconds: z.number().positive(),
    words: z.array(z.object({text: z.string().min(1), ...timeShape})).min(1),
    phonemes: z.array(z.object({phoneme: z.string().min(1), ...timeShape})).min(1),
  })).length(8),
});

function verifyIntervals(items: {start: number; end: number}[], duration: number, label: string) {
  let previousEnd = 0;
  for (const item of items) {
    if (item.start < previousEnd - .00001 || item.end <= item.start || item.end > duration + 1 / RATE) {
      throw new Error(`Invalid ${label} interval ${item.start}..${item.end}`);
    }
    previousEnd = item.end;
  }
}

/** Short readable captions follow the measured voice, including sentence pauses. */
function makeCaptions(words: ExplainerScene["words"]): NonNullable<ExplainerScene["captions"]> {
  const cues: NonNullable<ExplainerScene["captions"]> = [];
  let start = 0;
  for (let i = 0; i < words.length; i++) {
    const group = words.slice(start, i + 1);
    const line = group.map(word => word.text).join(" ");
    const next = words[i + 1];
    const separatesTerm = /^e$/iu.test(words[i]!.text) && /^girl\b/iu.test(next?.text ?? "");
    if (separatesTerm) continue;
    if (!next || /[.!?]$/u.test(words[i]!.text) || group.length >= 9 || line.length + (next?.text.length ?? 0) > 67) {
      const last = words[i]!;
      cues.push({text: line.replace(/\be girl\b/giu, "e-girl"), start: group[0]!.start,
        end: Math.min(last.end + .12, next?.start ?? last.end + .2)});
      start = i + 1;
    }
  }
  return cues;
}

function timestamp(seconds: number, separator: string): string {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3_600_000)).padStart(2,"0")}:${String(Math.floor(ms / 60_000) % 60).padStart(2,"0")}:${String(Math.floor(ms / 1000) % 60).padStart(2,"0")}${separator}${String(ms % 1000).padStart(3,"0")}`;
}

async function prepare(output: string, narrationDirectory: string) {
  const scriptPath = join(ROOT, "scripts/claudia-explainer/ben-egirls.json");
  const scriptBytes = await readFile(scriptPath);
  const script = scriptSchema.parse(JSON.parse(scriptBytes.toString("utf8")));
  const timingBytes = await readFile(join(narrationDirectory, "narration.json"));
  const narration = narrationSchema.parse(JSON.parse(timingBytes.toString("utf8")));
  if (narration.scriptSha256 !== sha256(scriptBytes)) throw new Error("Narration was generated from a different script");
  const scenes: ExplainerScene[] = [], audio: Buffer[] = [];
  const provenance = [];
  let from = 0;
  for (let index = 0; index < script.scenes.length; index++) {
    const scene = script.scenes[index]!, timing = narration.scenes[index]!;
    if (scene.id !== timing.id || textKey(scene.narration) !== textKey(timing.text)
      || textKey(timing.words.map(word => word.text).join(" ")) !== textKey(scene.narration)) {
      throw new Error(`Scene ${scene.id} does not match its narration and complete aligned words`);
    }
    await assertNoLinkedPath(timing.audio);
    const wav = await readFile(timing.audio), pcm = extractPcmDataFromWav(wav);
    if (sha256(wav) !== timing.audioSha256 || pcm.length !== timing.samples * 2
      || Math.abs(timing.durationSeconds - timing.samples / RATE) > 1 / RATE) throw new Error(`Changed audio for ${scene.id}`);
    verifyIntervals(timing.words, timing.samples / RATE, `${scene.id} word`);
    verifyIntervals(timing.phonemes, timing.samples / RATE, `${scene.id} phoneme`);
    const leadFrames = index === 0 ? 42 : 0;
    const tailFrames = index === script.scenes.length - 1 ? 72 : 10;
    const durationInFrames = leadFrames + Math.ceil(timing.samples / SAMPLES_PER_FRAME) + tailFrames;
    const padded = Buffer.alloc(durationInFrames * SAMPLES_PER_FRAME * 2);
    pcm.copy(padded, leadFrames * SAMPLES_PER_FRAME * 2);
    const lead = leadFrames / FPS;
    const words = timing.words.map(word => ({...word, start: word.start + lead, end: word.end + lead}));
    const phonemes = timing.phonemes.map(phone => ({...phone, start: phone.start + lead, end: phone.end + lead}));
    const mouth = buildMouthTrack(phonemes, mouthEnvelope(padded, FPS), FPS);
    if (mouth.length !== durationInFrames) throw new Error("Mouth and frame count differ");
    scenes.push({...scene, from, durationInFrames, words, mouth, captions: makeCaptions(words)});
    audio.push(padded);
    provenance.push({id: scene.id, from, durationInFrames, leadFrames, tailFrames, samples: timing.samples,
      audio: timing.audio, audioSha256: timing.audioSha256, referenceSha256: timing.referenceSha256});
    from += durationInFrames;
  }
  const durationSeconds = from / FPS;
  // The final mixer also checks the actual supplied song rather than trusting this bound.
  if (durationSeconds > 192.936) throw new Error("Explainer exceeds the requested song");
  const props: ExplainerProps = {fps: FPS, durationInFrames: from, scenes};
  const pcm = Buffer.concat(audio);
  await assertNoLinkedPath(dirname(output));
  await mkdir(output, {recursive: false});
  await ensurePrivateDirectory(output);
  const write = (name: string, value: string | Buffer) => writeFile(join(output, name), value, {flag: "wx"});
  const globalCaptions = scenes.flatMap(scene => scene.captions!.map(cue => ({...cue,
    start: cue.start + scene.from / FPS, end: cue.end + scene.from / FPS})));
  const captions = (separator: string) => globalCaptions.map((cue,index) => `${index + 1}\n${timestamp(cue.start,separator)} --> ${timestamp(cue.end,separator)}\n${cue.text}\n`).join("\n");
  await Promise.all([
    write("narration.pcm", pcm), write("render-props.json", json(props)), write("script.json", scriptBytes),
    write("captions.srt", captions(",")), write("captions.vtt", "WEBVTT\n\n" + captions(".")),
    write("sources.txt", script.sources.map(source => `${source.title}\n${source.url}\n${source.supports}\n`).join("\n")),
    write("build.json", json({schema:"claudia-explainer-build/v1", title:script.title, voice:"chatterbox-bella",
      character:{name:"Claudia", credit:"Claudia by anabology", canonUrl:"https://claudia.gallery/claudia/", rig:"manual-svg"},
      fps:FPS, width:1280, height:720, durationInFrames:from, durationSeconds,
      targetDurationSeconds:script.targetDurationSeconds, sampleRate:RATE, samples:pcm.length / 2,
      scriptSha256:sha256(scriptBytes), timingSha256:sha256(timingBytes), narrationPcmSha256:sha256(pcm),
      referenceSha256:REFERENCE, music:script.music, scenes:provenance,
      performance:"Natural-speed Chatterbox voice; approved Claudia rig with new audio-aligned mouth and word-anchored expressions",
      sources:script.sources})),
  ]);
  configureMediaTools();
  await writeWavFromPcm(join(output,"narration.pcm"), join(output,"narration.wav"));
  console.log(`Prepared ${scenes.length} scenes, ${from} frames, ${durationSeconds.toFixed(3)} seconds: ${output}`);
  return props;
}

async function main() {
  const {values} = parseArgs({options:{output:{type:"string"}, narration:{type:"string"}, "prepare-only":{type:"boolean"}, "render-only":{type:"boolean"}}, strict:true});
  if (values["prepare-only"] && values["render-only"]) throw new Error("Choose prepare-only or render-only");
  const output = resolve(values.output ?? join(ROOT,"out/ben-egirls"));
  const props: ExplainerProps = values["render-only"]
    ? JSON.parse(await readFile(join(output,"render-props.json"),"utf8"))
    : await prepare(output, resolve(values.narration ?? join(ROOT,"out/ben-egirls-narration")));
  if (values["prepare-only"]) return;
  configureMediaTools();
  const report = await renderCharacterTest({outputDirectory:output, inputProps:{...props}, durationInFrames:props.durationInFrames,
    fps:props.fps, entryPoint:join(ROOT,"scripts/claudia-explainer/entry.tsx"), compositionId:"ClaudiaExplainer"});
  await writeFile(join(output,"render-report.json"), json(report), {flag:"wx"});
  console.log(`Rendered: ${report.outputPath}`);
}

main().catch((error: unknown) => {console.error(error); process.exitCode = 1;});
