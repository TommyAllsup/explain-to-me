/** Frame-centred RMS with fast attack / release. Quiet frames close the mouth. */
export function mouthEnvelope(pcm: Buffer, fps = 24): number[] {
  if (!pcm.length || pcm.length % 2 || !Number.isInteger(fps) || fps < 1) throw new Error("Expected PCM16 audio and integer fps");
  const count = pcm.length / 2;
  const levels: number[] = [];
  for (let frame = 0; frame < Math.ceil(count * fps / 24_000); frame++) {
    const from = Math.floor(frame * 24_000 / fps);
    const end = Math.min(count, Math.floor((frame + 1) * 24_000 / fps));
    let sum = 0;
    for (let i = from; i < end; i++) sum += (pcm.readInt16LE(i * 2) / 32768) ** 2;
    levels.push(Math.sqrt(sum / Math.max(1, end - from)));
  }
  const sorted = [...levels].sort((a, b) => a - b);
  const ceiling = Math.max(.02, sorted[Math.floor(sorted.length * .9)] ?? .02);
  let previous = 0;
  return levels.map((level) => {
    const desired = level < .004 ? 0 : Math.min(1, (level / ceiling) ** .65);
    previous = desired === 0 ? 0 : previous + (desired - previous) * (desired > previous ? .85 : .65);
    return Math.round(previous * 10000) / 10000;
  });
}
