/** Timings use local seconds within one exact PCM16 / 24 kHz / mono chunk. */
export type AlignedNarrationWord = { text: string; start: number; end: number };
export type AlignedNarrationPhoneme = { phoneme: string; start: number; end: number };
export interface AlignedNarrationChunk {
  id: string;
  /** Spoken text, after pronunciation substitutions; captions retain display text. */
  text: string;
  sampleRate: 24000;
  samples: number;
  pcmSha256: string;
  words: AlignedNarrationWord[];
  phonemes: AlignedNarrationPhoneme[];
}
export interface NarrationAlignment {
  version: 1;
  chunks: AlignedNarrationChunk[];
}
