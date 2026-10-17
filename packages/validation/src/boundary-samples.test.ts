import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { deflateSync, inflateSync } from "node:zlib";
import { runProcess } from "../../audio/src/synthesize.js";
import { configureMediaTools } from "../../runtime/src/tools.js";
import type { Timeline } from "../../timeline/src/timeline.js";
import { decodeMediaFully, extractSceneBoundarySamples, muxAudioIntoVideo, probeMedia } from "./qc.js";

test("boundary samples contain the exact first, middle, and final decoded frames", {
  skip: process.env.EXPLAIN_TO_ME_MEDIA_SMOKE !== "1", timeout: 60_000,
}, async () => {
  configureMediaTools();
  const scratch = join(process.cwd(), ".cache", "tests");
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, "boundary spaces é-"));
  try {
    const colors = [[255, 0, 0], [0, 255, 0], [0, 0, 255]] as const;
    for (const [frame, color] of colors.entries()) {
      await writeFile(join(directory, `frame-${frame}.png`), solidPng(color));
    }
    const video = join(directory, "source.mp4");
    runProcess("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-y",
      "-framerate", "1", "-start_number", "0", "-i", join(directory, "frame-%d.png"),
      "-c:v", "libx264", "-crf", "0", "-preset", "ultrafast", "-pix_fmt", "yuv444p", video]);
    const timeline: Timeline = {
      fps: 1, durationMs: 3_000, durationInFrames: 3, chunks: [],
      scenes: colors.map((_color, frame) => ({ sceneId: `scene-${frame}`, from: frame, durationInFrames: 1, startMs: frame * 1_000, endMs: (frame + 1) * 1_000 })),
    };
    const samples = await extractSceneBoundarySamples(video, timeline, join(directory, "samples"));
    assert.equal(samples.length, 6);
    for (const sample of samples) {
      const imagePath = join(directory, sample.file);
      const decoded = decodeRgbPng(await readFile(imagePath));
      assert.equal(decoded.length, 16 * 16 * 3);
      const expected = colors[sample.frame]!;
      for (let pixel = 0; pixel < 16 * 16; pixel += 1) {
        for (let channel = 0; channel < 3; channel += 1) {
          assert.ok(Math.abs(decoded[pixel * 3 + channel]! - expected[channel]!) <= 2, `Incorrect frame ${sample.frame} ${sample.edge}`);
        }
      }
      assert.equal(sample.timeMs, sample.frame * 1_000);
      assert.ok(sample.bytes > 0);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("full media QC decodes video and audio and detects broken video packets", {
  skip: process.env.EXPLAIN_TO_ME_MEDIA_SMOKE !== "1", timeout: 60_000,
}, async () => {
  configureMediaTools();
  const scratch = join(process.cwd(), ".cache", "tests");
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, "decode spaces é-"));
  try {
    await writeFile(join(directory, "frame.png"), solidPng([255, 0, 0]));
    const videoOnly = join(directory, "video-only.mp4");
    runProcess("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-loop", "1", "-framerate", "24", "-i", join(directory, "frame.png"),
      "-t", "1", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", videoOnly]);
    const wav = join(directory, "audio.wav");
    const pcm = Buffer.alloc(24_000 * 2);
    for (let sample = 0; sample < 24_000; sample += 1) pcm.writeInt16LE(Math.round(Math.sin(sample * 2 * Math.PI * 440 / 24_000) * 8_000), sample * 2);
    const header = Buffer.alloc(44);
    header.write("RIFF", 0); header.writeUInt32LE(pcm.length + 36, 4); header.write("WAVEfmt ", 8);
    header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
    header.writeUInt32LE(24_000, 24); header.writeUInt32LE(48_000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
    header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
    await writeFile(wav, Buffer.concat([header, pcm]));
    const video = join(directory, "video.mp4");
    await muxAudioIntoVideo(videoOnly, wav, video);
    const probe = await probeMedia(video);
    assert.deepEqual(probe.streams.map((stream) => stream.codec_type).sort(), ["audio", "video"]);
    assert.equal((await probeMedia(wav)).streams[0]?.sample_rate, "24000");
    assert.doesNotThrow(() => decodeMediaFully(video));

    const packets = JSON.parse(runProcess("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pos,size", "-of", "json", video])) as { packets: { pos: string; size: string }[] };
    const first = packets.packets[0]!;
    const bytes = await readFile(video);
    bytes.fill(0, Number(first.pos), Number(first.pos) + Number(first.size));
    const broken = join(directory, "broken.mp4");
    await writeFile(broken, bytes);
    // Remuxing can pass damaged compressed bytes; the QC gate must decode them.
    assert.doesNotThrow(() => runProcess("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-xerror", "-i", broken,
      "-map", "0:v:0", "-map", "0:a:0", "-c", "copy", "-f", "null", "-"]));
    assert.throws(() => decodeMediaFully(broken), /ffmpeg exited/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const header = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  const trailer = Buffer.alloc(4);
  trailer.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([header, body, trailer]);
}

function solidPng(color: readonly number[]): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(16, 0);
  header.writeUInt32BE(16, 4);
  header[8] = 8;
  header[9] = 2; // 8-bit RGB, no interlace.
  const rows = Buffer.alloc(16 * (1 + 16 * 3));
  for (let row = 0; row < 16; row += 1) {
    for (let pixel = 0; pixel < 16; pixel += 1) {
      for (let channel = 0; channel < 3; channel += 1) rows[row * 49 + 1 + pixel * 3 + channel] = color[channel]!;
    }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(rows)), pngChunk("IEND", Buffer.alloc(0))]);
}

// Decode pixels independently of FFmpeg, so the check proves frame selection.
function decodeRgbPng(png: Buffer): Buffer {
  assert.ok(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
  const parts: Buffer[] = [];
  let width = 0;
  let height = 0;
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8);
      assert.equal(data[9], 2);
      assert.equal(data[12], 0);
    }
    if (type === "IDAT") parts.push(data);
    offset += length + 12;
  }
  const rows = inflateSync(Buffer.concat(parts));
  const stride = width * 3;
  const pixels = Buffer.alloc(stride * height);
  for (let row = 0; row < height; row += 1) {
    const filter = rows[row * (stride + 1)]!;
    assert.ok(filter >= 0 && filter <= 4);
    for (let column = 0; column < stride; column += 1) {
      const index = row * stride + column;
      const left = column >= 3 ? pixels[index - 3]! : 0;
      const above = row > 0 ? pixels[index - stride]! : 0;
      const upperLeft = row > 0 && column >= 3 ? pixels[index - stride - 3]! : 0;
      const estimate = left + above - upperLeft;
      const distance = [Math.abs(estimate - left), Math.abs(estimate - above), Math.abs(estimate - upperLeft)];
      const paeth = distance[0]! <= distance[1]! && distance[0]! <= distance[2]! ? left : distance[1]! <= distance[2]! ? above : upperLeft;
      const predictor = [0, left, above, Math.floor((left + above) / 2), paeth][filter]!;
      pixels[index] = (rows[row * (stride + 1) + column + 1]! + predictor) & 255;
    }
  }
  return pixels;
}
