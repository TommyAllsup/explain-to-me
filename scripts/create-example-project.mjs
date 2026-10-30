#!/usr/bin/env node
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export async function createExampleProject(output) {
  await mkdir(dirname(output), { recursive: true });
  // mkdir without recursive refuses existing destinations and preserves previous work.
  await mkdir(output, { mode: 0o700 });
  for (const file of ["project.json", "story.json"]) await copyFile(join(root, "fixtures/projects/measured-walk", file), join(output, file));
  const rate = 24000;
  const seconds = 18;
  const pcm = Buffer.alloc(seconds * rate * 2);
  for (let sample = 0; sample < seconds * rate; sample += 1) {
    const t = sample / rate;
    const envelope = Math.min(1, t / 0.25, (seconds - t) / 0.25);
    const chord = (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 275 * t) + Math.sin(2 * Math.PI * 330 * t)) / 3;
    pcm.writeInt16LE(Math.round(chord * 7000 * envelope * (0.85 + 0.15 * Math.sin(t * Math.PI / 4))), sample * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF"); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  await writeFile(join(output, "pad.wav"), Buffer.concat([header, pcm]), { flag: "wx", mode: 0o600 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 4 || process.argv[2] !== "--output") throw new Error("Usage: node scripts/create-example-project.mjs --output <new-directory>");
  const output = resolve(process.argv[3]);
  await createExampleProject(output);
  console.log(`Saved example project: ${output}`);
}
