import React from "react";
import {
  AbsoluteFill,
  Easing,
  Sequence,
  interpolate,
  spring,
  Img,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { AssetProvenance, LocalAssetIntent, ProductionManifest, Scene } from "../../../packages/contracts/src/production-manifest.js";
import type { Timeline } from "../../../packages/timeline/src/timeline.js";

export type VideoProps = {
  manifest: ProductionManifest;
  timeline: Timeline;
  width?: number;
  height?: number;
  fps?: number;
  assetFilesById?: Record<string, string>;
};

type TimedScene = Timeline["scenes"][number];
type TimedChunk = Timeline["chunks"][number];
type CueWindow = { sceneId: string; target: string; startMs: number; endMs: number };

const C = {
  paper: "#f4efe4",
  sheet: "#fbf8f0",
  ink: "#182c2d",
  muted: "#657575",
  teal: "#087e78",
  tealLight: "#d8ece6",
  orange: "#d96836",
  orangeLight: "#f6e2d4",
  line: "#c9d1c9",
};

const FONT = '"Avenir Next", Avenir, "Segoe UI", "Helvetica Neue", sans-serif';
const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function countWrappedLines(text: string, fontSize: number, maxWidth: number): number {
  const paragraphs = text.split("\n");
  const capacity = Math.max(1, maxWidth / (fontSize * 0.59));
  let count = 0;
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      count += 1;
      continue;
    }
    let chars = 0;
    let lines = 1;
    for (const word of words) {
      const wordParts = Math.max(1, Math.ceil(word.length / capacity));
      const wordChars = word.length / wordParts;
      if (chars > 0 && chars + 1 + wordChars > capacity) {
        lines += wordParts;
        chars = wordChars % capacity;
      } else {
        lines += wordParts - 1;
        chars += (chars ? 1 : 0) + wordChars;
      }
    }
    count += lines;
  }
  return count;
}

function fitFontSize(
  text: string,
  maxWidth: number,
  maxHeight: number,
  preferred: number,
  minimum: number,
  lineHeight = 1.22,
): number {
  for (let size = preferred; size >= minimum; size -= 0.5) {
    if (countWrappedLines(text, size, maxWidth) * size * lineHeight <= maxHeight) return size;
  }
  return minimum;
}

function fitDenseFontSize(text: string, maxWidth: number, maxHeight: number, preferred: number, lineHeight: number): number {
  let size = preferred;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (countWrappedLines(text, size, maxWidth) * size * lineHeight <= maxHeight) return size;
    size *= 0.9;
  }
  return size;
}

function sceneWords(scene: Scene): string {
  const visual = scene.visual;
  return [
    scene.title,
    visual.subtitle,
    ...(visual.lines ?? []),
    ...(visual.nodes ?? []).map((node) => node.label),
    visual.left?.title,
    ...(visual.left?.lines ?? []),
    visual.right?.title,
    ...(visual.right?.lines ?? []),
    visual.code,
    ...scene.narration.map((chunk) => chunk.text),
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("en-US");
}

function sceneAccent(scene: Scene): string {
  const text = sceneWords(scene);
  if (/text\s*(?:to|→)\s*(?:audio|speech)|\btts\b|speech synthesis|voice generation/.test(text)) {
    return C.orange;
  }
  return C.teal;
}

/** Resolve the sentence-start fallback to its measured chunk interval without estimating token offsets. */
export function resolveCueWindows(manifest: ProductionManifest, timeline: Timeline): CueWindow[] {
  const byId = new Map<string, TimedChunk>();
  for (const chunk of timeline.chunks) byId.set(chunk.id, chunk);
  const windows: CueWindow[] = [];
  for (const scene of manifest.scenes) {
    for (const cue of scene.cues ?? []) {
      if (cue.timingFallback !== "sentence-start") continue;
      const chunk = byId.get(cue.chunkId);
      if (!chunk) continue;
      windows.push({
        sceneId: scene.id,
        target: cue.target,
        startMs: chunk.startMs,
        endMs: chunk.endMs,
      });
    }
  }
  return windows;
}

function PaperBackdrop({ accent }: { accent: string }) {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: C.paper,
        backgroundImage:
          "linear-gradient(rgba(24,44,45,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(24,44,45,.035) 1px, transparent 1px)",
        backgroundSize: "40px 40px",
        color: C.ink,
        fontFamily: FONT,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 22,
          border: "1px solid rgba(24,44,45,.16)",
          borderRadius: 9,
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 22,
          left: 58,
          width: 54,
          height: 4,
          backgroundColor: accent,
          borderRadius: 4,
        }}
      />
      <div
        style={{
          position: "absolute",
          right: 57,
          top: 54,
          width: 11,
          height: 11,
          border: `2px solid ${accent}`,
          borderRadius: "50%",
          opacity: 0.8,
        }}
      />
    </AbsoluteFill>
  );
}

function Topline({ scene, index, count, accent }: { scene: Scene; index: number; count: number; accent: string }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 48,
        left: 74,
        right: 74,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        color: C.muted,
        fontSize: 15,
        letterSpacing: 2.1,
        fontWeight: 700,
        textTransform: "uppercase",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
        <span style={{ color: accent, fontVariantNumeric: "tabular-nums" }}>{String(index + 1).padStart(2, "0")}</span>
        <span style={{ width: 28, height: 1, backgroundColor: C.line }} />
        <span>{scene.kind}</span>
      </div>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{String(index + 1).padStart(2, "0")} / {String(count).padStart(2, "0")}</span>
    </div>
  );
}

function MainTitle({ text, width, height, accent, top = 88 }: { text: string; width: number; height: number; accent: string; top?: number }) {
  const size = fitFontSize(text, width, height, 56, 12, 1.08);
  return (
    <div style={{ position: "relative", width, minHeight: height, marginTop: top }}>
      <div
        style={{
          color: C.ink,
          fontFamily: SERIF,
          fontWeight: 700,
          fontSize: size,
          lineHeight: 1.08,
          letterSpacing: -1.5,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {text}
      </div>
      <div style={{ width: 72, height: 4, backgroundColor: accent, marginTop: 19, borderRadius: 4 }} />
    </div>
  );
}

function SupportingCopy({
  lines,
  width,
  height,
  color = C.ink,
  accent = C.teal,
  preferred = 27,
}: {
  lines: string[];
  width: number;
  height: number;
  color?: string;
  accent?: string;
  preferred?: number;
}) {
  if (lines.length === 0) return null;
  const text = lines.join("\n");
  const gap = lines.length > 4 ? 2 : 13;
  const size = fitFontSize(text, width - 40, height - gap * (lines.length - 1), preferred, 3, 1.2);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap }}>
      {lines.map((line, index) => (
        <div key={`${index}-${line}`} style={{ display: "flex", alignItems: "flex-start", gap: 15 }}>
          <span
            style={{
              flex: "0 0 auto",
              width: Math.min(7, Math.max(2, size * 0.24)),
              height: Math.min(7, Math.max(2, size * 0.24)),
              borderRadius: "50%",
              backgroundColor: accent,
              marginTop: size * 0.43,
            }}
          />
          <div style={{ fontSize: size, lineHeight: 1.2, color, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{line}</div>
        </div>
      ))}
    </div>
  );
}

function ContentFrame({ children, maxWidth = 1050 }: { children: React.ReactNode; maxWidth?: number }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 87,
        bottom: 111,
        left: 92,
        right: 92,
        width: `min(${maxWidth}px, calc(100% - 184px))`,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {children}
    </div>
  );
}

function HeroScene({ scene, accent, width }: { scene: Scene; accent: string; width: number }) {
  const lines = scene.visual.lines ?? [];
  const maxTextWidth = Math.min(1010, width - 210);
  const titleSize = fitFontSize(scene.title, maxTextWidth, 175, 76, 22, 1.04);
  return (
    <ContentFrame maxWidth={1080}>
      <div style={{ marginTop: 26, color: accent, fontSize: 15, letterSpacing: 2.5, fontWeight: 800, textTransform: "uppercase" }}>
        {scene.visual.subtitle ?? "A visual explanation"}
      </div>
      <div
        style={{
          marginTop: 20,
          fontFamily: SERIF,
          fontWeight: 700,
          letterSpacing: -2.4,
          lineHeight: 1.02,
          fontSize: titleSize,
          maxWidth: maxTextWidth,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {scene.title}
      </div>
      <div style={{ width: 113, height: 5, backgroundColor: accent, marginTop: 24, borderRadius: 5 }} />
      {lines.length > 0 && (
        <div style={{ maxWidth: 850, marginTop: 24 }}>
          <SupportingCopy lines={lines} width={850} height={130} accent={accent} preferred={25} />
        </div>
      )}
      <div style={{ position: "absolute", right: 22, bottom: 18, width: 190, height: 190, opacity: 0.72 }}>
        <svg viewBox="0 0 190 190" width="190" height="190" aria-hidden="true">
          <circle cx="95" cy="95" r="74" fill="none" stroke={C.line} strokeWidth="1.5" />
          <circle cx="95" cy="95" r="49" fill="none" stroke={accent} strokeWidth="2" strokeDasharray="7 8" />
          <path d="M25 95h42m56 0h42M95 25v42m0 56v42" stroke={C.line} strokeWidth="1.5" />
          <circle cx="95" cy="95" r="9" fill={accent} />
        </svg>
      </div>
    </ContentFrame>
  );
}

function StatementScene({ scene, accent, width }: { scene: Scene; accent: string; width: number }) {
  const supporting = scene.visual.lines ?? [];
  const quote = scene.visual.subtitle;
  const areaWidth = Math.min(960, width - 215);
  const titleHeight = supporting.length ? 132 : 250;
  return (
    <ContentFrame maxWidth={1000}>
      <div style={{ position: "relative", display: "flex", flexDirection: "column", justifyContent: "center", flex: 1 }}>
        <div style={{ fontSize: 16, color: accent, fontWeight: 800, textTransform: "uppercase", letterSpacing: 2.2, marginBottom: 13 }}>
          {quote ?? "The core idea"}
        </div>
        <div style={{ fontFamily: SERIF, fontWeight: 700, letterSpacing: -1.8, lineHeight: 1.08, fontSize: fitFontSize(scene.title, areaWidth, titleHeight, 62, 14, 1.1), maxWidth: areaWidth, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {scene.title}
        </div>
        {supporting.length > 0 && (
          <div style={{ marginTop: 27, borderLeft: `4px solid ${accent}`, paddingLeft: 25, maxWidth: 900 }}>
            <SupportingCopy lines={supporting} width={850} height={185} accent={accent} preferred={27} />
          </div>
        )}
        <div style={{ position: "absolute", right: 0, top: 20, width: 83, height: 83, borderTop: `2px solid ${accent}`, borderRight: `2px solid ${accent}`, opacity: 0.6 }} />
      </div>
    </ContentFrame>
  );
}

type NodePosition = { id: string; label: string; x: number; y: number; w: number; h: number };

function directionAccent(id: string, label: string, fallback: string): string {
  const subject = `${id} ${label}`.toLocaleLowerCase("en-US").replace(/[_-]+/g, " ");
  if (/text input|speech output|text to audio|tts|synthesis/.test(subject)) return C.orange;
  if (/audio input|text output|audio to text|whisper|transcri|recognition/.test(subject)) return C.teal;
  return fallback;
}

function getNodePositions(nodes: NonNullable<Scene["visual"]["nodes"]>, width: number, height: number): NodePosition[] {
  if (nodes.length === 0) return [];
  const cols = nodes.length <= 4 ? nodes.length : Math.min(6, nodes.length);
  const rows = Math.ceil(nodes.length / cols);
  const gapX = cols > 4 ? 18 : cols > 1 ? Math.min(54, width * 0.055) : 0;
  const nodeWidth = Math.min(258, (width - gapX * (cols - 1)) / cols);
  const rowGap = rows > 4 ? 9 : rows > 1 ? 28 : 0;
  const nodeHeight = rows === 1 ? 112 : Math.min(112, (height - rowGap * (rows - 1)) / rows);
  const totalWidth = cols * nodeWidth + (cols - 1) * gapX;
  return nodes.map((node, index) => {
    const row = rows === 1 ? 0 : Math.floor(index / cols);
    const rowCount = Math.min(cols, nodes.length - row * cols);
    const actualRowWidth = rowCount * nodeWidth + (rowCount - 1) * gapX;
    const rowLeft = (width - actualRowWidth) / 2;
    const col = index % cols;
    return { id: node.id, label: node.label, x: rowLeft + col * (nodeWidth + gapX), y: row * (nodeHeight + rowGap), w: nodeWidth, h: nodeHeight };
  });
}

function DiagramScene({ scene, accent, width, activeTargets, reveal }: { scene: Scene; accent: string; width: number; activeTargets: Set<string>; reveal: number }) {
  const nodes = scene.visual.nodes ?? [];
  const text = [...(scene.visual.lines ?? []), scene.visual.subtitle].filter(Boolean) as string[];
  const height = text.length > 0 ? 272 : 350;
  const points = getNodePositions(nodes, Math.min(1040, width - 184), height);
  const diagramWidth = Math.min(1040, width - 184);
  const byId = new Map(points.map((point) => [point.id, point]));
  const edges = (scene.visual.edges ?? []).flatMap((edge) => {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) return [];
    const sameRow = Math.abs(from.y - to.y) < 1;
    const fromCenter = from.x + from.w / 2;
    const toCenter = to.x + to.w / 2;
    const x1 = sameRow && toCenter < fromCenter ? from.x : sameRow ? from.x + from.w : fromCenter;
    const y1 = sameRow ? from.y + from.h / 2 : from.y + from.h;
    const x2 = sameRow && toCenter < fromCenter ? to.x + to.w : sameRow ? to.x : toCenter;
    const y2 = sameRow ? to.y + to.h / 2 : to.y;
    return [{ ...edge, x1, y1, x2, y2, color: directionAccent(`${edge.from} ${edge.to}`, `${from.label} ${to.label}`, accent) }];
  });
  return (
    <ContentFrame maxWidth={1060}>
      <MainTitle text={scene.title} width={1060} height={100} accent={accent} top={3} />
      <div style={{ position: "relative", width: diagramWidth, maxWidth: "100%", height, margin: "28px auto 0", flex: "0 0 auto" }}>
        <svg style={{ position: "absolute", inset: 0, overflow: "visible" }} width={diagramWidth} height={height} viewBox={`0 0 ${diagramWidth} ${height}`} aria-hidden="true">
          {edges.map((edge, index) => (
            <g key={`${edge.from}-${edge.to}-${index}`}>
              <line x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2} stroke={C.line} strokeWidth="3" strokeLinecap="round" />
              <circle cx={edge.x1} cy={edge.y1} r="4" fill={edge.color} opacity={0.9} />
              <path d={`M ${edge.x2 - 6} ${edge.y2 - 7} L ${edge.x2 + 1} ${edge.y2} L ${edge.x2 - 6} ${edge.y2 + 7}`} fill="none" stroke={edge.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity={reveal} />
            </g>
          ))}
        </svg>
        {points.map((node, index) => {
          const active = activeTargets.has(node.id);
          const nodeColor = directionAccent(node.id, node.label, accent);
          const delay = Math.max(0, reveal - index * 0.16);
          const size = fitFontSize(node.label, node.w - 38, node.h - 24, 27, 1, 1.1);
          return (
            <div
              key={node.id}
              style={{
                position: "absolute",
                left: node.x,
                top: node.y,
                width: node.w,
                height: node.h,
                boxSizing: "border-box",
                border: `2px solid ${nodeColor}`,
                borderRadius: 18,
                backgroundColor: active ? (nodeColor === C.orange ? C.orangeLight : C.tealLight) : C.sheet,
                boxShadow: active ? `0 9px 25px ${nodeColor}22` : "0 8px 18px rgba(24,44,45,.06)",
                padding: "15px 18px",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                textAlign: "center",
                opacity: clamp01(delay * 1.7),
                transform: `translateY(${(1 - clamp01(delay * 1.7)) * 14}px) scale(${0.97 + clamp01(delay * 1.7) * 0.03})`,
                fontSize: size,
                lineHeight: 1.1,
                fontWeight: 750,
                overflowWrap: "anywhere",
                whiteSpace: "pre-wrap",
              }}
            >
              {node.label}
            </div>
          );
        })}
      </div>
      {text.length > 0 && (
        <div style={{ margin: "17px auto 0", width: "100%", maxWidth: 930 }}>
          <SupportingCopy lines={text} width={920} height={88} accent={accent} preferred={21} />
        </div>
      )}
    </ContentFrame>
  );
}

function ComparePanel({ title, lines, accent, active, width, height }: { title: string; lines: string[]; accent: string; active: boolean; width: number; height: number }) {
  const titleSize = fitFontSize(title, width - 52, 64, 31, 10, 1.1);
  return (
    <div
      style={{
        width,
        height,
        boxSizing: "border-box",
        backgroundColor: C.sheet,
        border: `2px solid ${active ? accent : "rgba(24,44,45,.18)"}`,
        borderRadius: 21,
        padding: "24px 26px",
        display: "flex",
        flexDirection: "column",
        boxShadow: active ? `0 12px 28px ${accent}20` : "0 10px 24px rgba(24,44,45,.05)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 40 }}>
        <span style={{ width: 11, height: 11, flex: "0 0 auto", borderRadius: "50%", backgroundColor: accent }} />
        <div style={{ fontSize: titleSize, lineHeight: 1.1, color: C.ink, fontWeight: 800, overflowWrap: "anywhere" }}>{title}</div>
      </div>
      <div style={{ height: 1, margin: "17px 0 19px", backgroundColor: "rgba(24,44,45,.13)" }} />
      {lines.length > 0 ? (
        <SupportingCopy lines={lines} width={width - 55} height={height - 125} accent={accent} preferred={24} />
      ) : (
        <div style={{ color: C.muted, fontSize: 18, lineHeight: 1.35 }}>As described in the narration</div>
      )}
    </div>
  );
}

function ComparisonScene({ scene, width, activeTargets }: { scene: Scene; width: number; activeTargets: Set<string> }) {
  const left = scene.visual.left ?? { title: "Audio → Text", lines: [] };
  const right = scene.visual.right ?? { title: "Text → Audio", lines: [] };
  const gap = 26;
  const panelWidth = Math.min(502, (Math.min(width - 184, 1050) - gap) / 2);
  const panelHeight = 314;
  return (
    <ContentFrame maxWidth={1050}>
      <MainTitle text={scene.title} width={1050} height={96} accent={C.teal} top={3} />
      <div style={{ display: "flex", justifyContent: "center", gap, marginTop: 28 }}>
        <ComparePanel title={left.title} lines={left.lines} accent={C.teal} active={activeTargets.has("left")} width={panelWidth} height={panelHeight} />
        <ComparePanel title={right.title} lines={right.lines} accent={C.orange} active={activeTargets.has("right")} width={panelWidth} height={panelHeight} />
      </div>
      {scene.visual.subtitle && <div style={{ marginTop: 15, color: C.muted, textAlign: "center", fontSize: 18 }}>{scene.visual.subtitle}</div>}
    </ContentFrame>
  );
}

function CodeScene({ scene, accent, activeTargets, width, height }: { scene: Scene; accent: string; activeTargets: Set<string>; width: number; height: number }) {
  const code = scene.visual.code ?? "";
  const codeLines = code.split("\n").length;
  const directionLines = scene.visual.lines ?? [];
  const codeWidth = Math.min(970, width - 230);
  const badgeRows = Math.ceil(directionLines.length / 2);
  const badgeHeight = directionLines.length > 0 ? badgeRows * 34 + Math.max(0, badgeRows - 1) * 8 + 13 : 0;
  const codeHeight = Math.max(80, Math.min(312, height - 198 - 96 - 55 - badgeHeight));
  const fontSize = fitDenseFontSize(code, codeWidth - 66, codeHeight - 48, 23, 1.36);
  const highlighted = activeTargets.has("code");
  return (
    <ContentFrame maxWidth={1020}>
      <MainTitle text={scene.title} width={1020} height={94} accent={accent} top={2} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "26px auto 12px", width: codeWidth, maxWidth: "100%", color: C.muted, fontSize: 13, letterSpacing: 1.8, fontWeight: 800, textTransform: "uppercase" }}>
        <span>{scene.visual.subtitle ?? "Exact code"}</span>
        <span>{String(codeLines).padStart(2, "0")} lines</span>
      </div>
      <div
        style={{
          width: codeWidth,
          maxWidth: "100%",
          height: codeHeight,
          margin: "0 auto",
          boxSizing: "border-box",
          padding: "23px 29px",
          backgroundColor: "#192e31",
          borderRadius: 20,
          border: `2px solid ${highlighted ? accent : "rgba(24,44,45,.25)"}`,
          boxShadow: "0 18px 35px rgba(24,44,45,.14)",
          color: "#eff4e9",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div style={{ position: "absolute", top: 15, right: 19, display: "flex", gap: 6 }}>
          {[C.orange, "#e4bd58", C.teal].map((color) => <span key={color} style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: color }} />)}
        </div>
        <pre
          style={{
            margin: 0,
            color: "inherit",
            fontFamily: '"SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace',
            fontSize,
            lineHeight: 1.36,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            wordBreak: "break-word",
          }}
        >
          {code}
        </pre>
      </div>
      {directionLines.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 8, margin: "13px auto 0", width: codeWidth, maxWidth: "100%" }}>
          {directionLines.map((line, index) => {
            const direction = line.toLocaleLowerCase("en-US");
            const lineAccent = /text\s*(?:to|→)\s*(?:audio|speech)|\btts\b|speech synthesis/.test(direction) ? C.orange : C.teal;
            return (
              <div key={`${index}-${line}`} style={{ flex: "1 1 42%", maxWidth: "49%", minWidth: 0, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 9, minHeight: 34, padding: "5px 12px", border: `1px solid ${lineAccent}55`, borderRadius: 999, backgroundColor: lineAccent === C.orange ? C.orangeLight : C.tealLight, color: C.ink, fontSize: fitFontSize(line, codeWidth * 0.43 - 35, 22, 18, 3, 1.1), lineHeight: 1.1, fontWeight: 750, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
                <span style={{ width: 7, height: 7, flex: "0 0 auto", borderRadius: "50%", backgroundColor: lineAccent }} />
                {line}
              </div>
            );
          })}
        </div>
      )}
    </ContentFrame>
  );
}

function OutroScene({ scene, accent, width }: { scene: Scene; accent: string; width: number }) {
  const lines = scene.visual.lines ?? [];
  const maxWidth = Math.min(930, width - 220);
  return (
    <ContentFrame maxWidth={1000}>
      <div style={{ marginTop: 24, color: accent, fontSize: 15, letterSpacing: 2.2, fontWeight: 800, textTransform: "uppercase" }}>{scene.visual.subtitle ?? "Remember this"}</div>
      <div style={{ marginTop: 18, fontFamily: SERIF, fontSize: fitFontSize(scene.title, maxWidth, 180, 64, 13, 1.08), lineHeight: 1.08, letterSpacing: -1.8, fontWeight: 700, maxWidth, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{scene.title}</div>
      {lines.length > 0 && (
        <div style={{ marginTop: 29, maxWidth: 880 }}>
          <SupportingCopy lines={lines} width={850} height={160} accent={accent} preferred={26} />
        </div>
      )}
      <svg style={{ position: "absolute", right: 20, bottom: 6 }} width="170" height="130" viewBox="0 0 170 130" aria-hidden="true">
        <path d="M14 103 C43 26, 96 17, 154 40" fill="none" stroke={accent} strokeWidth="3" strokeLinecap="round" />
        <path d="M137 25 L155 40 L133 49" fill="none" stroke={accent} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="28" cy="105" r="7" fill={accent} />
      </svg>
    </ContentFrame>
  );
}

function BulletsScene({ scene, accent, width, height, durationInFrames }: {
  scene: Scene;
  accent: string;
  width: number;
  height: number;
  durationInFrames: number;
}) {
  const frame = useCurrentFrame();
  const lines = (scene.visual.lines ?? []).slice(0, 12);
  const maxWidth = Math.min(1020, width - 210);
  const listHeight = Math.max(80, height - 365);
  const size = fitFontSize(lines.join("\n"), maxWidth - 42, listHeight - lines.length * 7, 38, 10, 1.16);
  const progress = clamp01((frame + 1) / Math.max(1, durationInFrames));
  const visibleCount = Math.min(lines.length, Math.max(1, Math.ceil(progress * lines.length)));
  const titleSize = fitFontSize(scene.title, maxWidth, 100, 58, 18, 1.08);
  return (
    <ContentFrame maxWidth={1080}>
      <div style={{ marginTop: 17, color: accent, fontSize: 14, letterSpacing: 2.2, fontWeight: 800, textTransform: "uppercase" }}>
        {scene.visual.subtitle ?? "Key points"}
      </div>
      <div style={{ marginTop: 10, maxWidth, fontFamily: SERIF, fontSize: titleSize, lineHeight: 1.08, letterSpacing: -1.5, fontWeight: 700, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
        {scene.title}
      </div>
      <div style={{ width: 72, height: 4, backgroundColor: accent, marginTop: 14, borderRadius: 4 }} />
      <div style={{ flex: 1, minHeight: 0, marginTop: 14, display: "flex", flexDirection: "column", justifyContent: "center", gap: lines.length > 6 ? 7 : 12 }}>
        {lines.slice(0, visibleCount).map((line, index) => (
          <div key={`${index}-${line}`} style={{ display: "flex", alignItems: "flex-start", gap: 17 }}>
            <span style={{ flex: "0 0 auto", width: Math.max(7, size * 0.25), height: Math.max(7, size * 0.25), marginTop: size * 0.47, borderRadius: "50%", backgroundColor: accent }} />
            <div style={{ color: C.ink, fontSize: size, lineHeight: 1.16, fontWeight: 560, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{line}</div>
          </div>
        ))}
      </div>
    </ContentFrame>
  );
}

function ImageScene({ scene, accent, width, height, assetFilesById }: {
  scene: Scene;
  accent: string;
  width: number;
  height: number;
  assetFilesById: Record<string, string>;
}) {
  const maxWidth = Math.min(1100, width - 190);
  const details = scene.visual.lines ?? [];
  const detailHeight = Math.min(height * 0.34, Math.max(48, details.length * 24));
  const titleSize = fitFontSize(scene.title, maxWidth, 86, 46, 18, 1.08);
  const assetFileName = scene.visual.assetId ? assetFilesById[scene.visual.assetId] : undefined;
  const safeAssetFileName = typeof assetFileName === "string" && /^asset-\d{2}\.(?:png|jpg|webp)$/.test(assetFileName)
    ? assetFileName
    : undefined;
  return (
    <ContentFrame maxWidth={1140}>
      {scene.visual.subtitle && (
        <div style={{ marginTop: 10, color: accent, fontSize: 14, letterSpacing: 1.9, fontWeight: 800, textTransform: "uppercase", overflowWrap: "anywhere" }}>
          {scene.visual.subtitle}
        </div>
      )}
      <div style={{ marginTop: scene.visual.subtitle ? 8 : 14, maxWidth, fontFamily: SERIF, fontSize: titleSize, lineHeight: 1.08, letterSpacing: -1.4, fontWeight: 700, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
        {scene.title}
      </div>
      <div style={{ width: 72, height: 4, backgroundColor: accent, marginTop: 12, borderRadius: 4 }} />
      <div style={{ flex: 1, minHeight: 100, marginTop: 12, display: "flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box", padding: 9, border: `1px solid ${C.line}`, borderRadius: 15, backgroundColor: C.sheet, overflow: "hidden" }}>
        {safeAssetFileName && (
          <Img
            src={staticFile(safeAssetFileName)}
            alt={scene.visual.subtitle ?? scene.title}
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
          />
        )}
      </div>
      {details.length > 0 && (
        <div style={{ flex: "0 0 auto", height: detailHeight, marginTop: 8 }}>
          <SupportingCopy lines={details} width={maxWidth} height={detailHeight} accent={accent} preferred={17} />
        </div>
      )}
    </ContentFrame>
  );
}

type PresenterAsset = { fileName: string; provenance: AssetProvenance };

/** A presenter is an approved local still, never a URL or a best-effort decoration. */
export function resolvePresenterAsset(
  scene: Scene,
  asset: LocalAssetIntent | undefined,
  assetFilesById: Record<string, string>,
): PresenterAsset | undefined {
  const presenter = scene.visual.presenter;
  if (!presenter) return undefined;
  if (!["title", "statement", "bullets", "outro"].includes(scene.kind)) {
    throw new Error(`Scene ${scene.id}: a presenter is supported only on title, statement, bullets, and outro scenes.`);
  }
  if (asset?.id !== presenter.assetId || !asset.provenance) {
    throw new Error(`Scene ${scene.id}: presenter ${presenter.assetId} requires approved asset provenance.`);
  }
  const fileName = assetFilesById[presenter.assetId];
  if (!fileName || !/^asset-\d{2}\.(?:png|jpg|webp)$/.test(fileName)) {
    throw new Error(`Scene ${scene.id}: presenter ${presenter.assetId} is missing its staged local image.`);
  }
  return { fileName, provenance: asset.provenance };
}

function readableFontSize(text: string, width: number, height: number, preferred: number, minimum: number, lineHeight: number, label: string): number {
  const size = fitFontSize(text, width, height, preferred, minimum, lineHeight);
  if (countWrappedLines(text, size, width) * size * lineHeight > height) {
    throw new Error(`${label} does not fit beside the presenter at a readable size. Shorten the text, split the scene, or remove its presenter.`);
  }
  return size;
}

/** Shared with layout checks so presenter content never borrows the caption lane. */
export function getPresenterLayout(scene: Scene, provenance: AssetProvenance, width: number, height: number) {
  if (width < 960 || height < 540) throw new Error("Presenter scenes require a canvas of at least 960 × 540 pixels.");
  const left = 92;
  const top = 100;
  const bottom = height - 130;
  const panelWidth = Math.min(320, (width - 184) * 0.3);
  const panelLeft = width - 92 - panelWidth;
  const contentWidth = panelLeft - left - 48;
  const areaHeight = bottom - top;
  const lines = scene.visual.lines ?? [];
  const subtitle = scene.visual.subtitle ?? ({ title: "A visual explanation", statement: "The core idea", bullets: "Key points", outro: "Remember this" } as Record<string, string>)[scene.kind] ?? "";
  const subtitleSize = readableFontSize(subtitle, contentWidth, 44, 17, 16, 1.2, `Scene ${scene.id} subtitle`);
  const subtitleHeight = countWrappedLines(subtitle, subtitleSize, contentWidth) * subtitleSize * 1.2;
  const titleBudget = lines.length ? Math.min(190, areaHeight * 0.4) : areaHeight - subtitleHeight - 55;
  const titleSize = readableFontSize(scene.title, contentWidth, titleBudget, scene.kind === "title" ? 64 : 54, 32, 1.08, `Scene ${scene.id} title`);
  const titleHeight = countWrappedLines(scene.title, titleSize, contentWidth) * titleSize * 1.08;
  const bodyHeight = areaHeight - subtitleHeight - 18 - titleHeight - 22 - 4 - 25;
  const bodyGap = 12;
  const bodySize = lines.length
    ? readableFontSize(lines.join("\n"), contentWidth - 32, bodyHeight - bodyGap * (lines.length - 1), scene.kind === "bullets" ? 30 : 27, 22, 1.22, `Scene ${scene.id} supporting text`)
    : 27;
  const panelInnerWidth = panelWidth - 38;
  const nameSize = readableFontSize(provenance.character, panelInnerWidth, 56, 22, 18, 1.15, `Presenter ${provenance.character} name`);
  const nameHeight = countWrappedLines(provenance.character, nameSize, panelInnerWidth) * nameSize * 1.15;
  const creditSize = 16;
  const creditHeight = countWrappedLines(provenance.credit, creditSize, panelInnerWidth) * creditSize * 1.25;
  const imageHeight = areaHeight - 36 - nameHeight - creditHeight - (provenance.aiGenerated ? 25 : 0) - 34;
  if (imageHeight < 120) {
    throw new Error(`Presenter ${provenance.character} credit leaves insufficient room for its image. Use a taller canvas or a shorter credit.`);
  }
  return { left, top, bottom, panelLeft, panelWidth, contentWidth, areaHeight, subtitle, subtitleSize, subtitleHeight, titleSize, titleHeight, bodySize, bodyGap, nameSize, nameHeight, creditSize, creditHeight, imageHeight };
}

function PresenterScene({ scene, presenter, accent, width, height, frame, durationInFrames }: {
  scene: Scene;
  presenter: PresenterAsset;
  accent: string;
  width: number;
  height: number;
  frame: number;
  durationInFrames: number;
}) {
  const layout = getPresenterLayout(scene, presenter.provenance, width, height);
  const lines = scene.visual.lines ?? [];
  const progress = clamp01((frame + 1) / Math.max(1, durationInFrames));
  const visibleCount = scene.kind === "bullets" ? Math.min(lines.length, Math.max(1, Math.ceil(progress * lines.length))) : lines.length;
  return (
    <>
      <div data-presenter-content={scene.id} style={{ position: "absolute", left: layout.left, top: layout.top, width: layout.contentWidth, height: layout.areaHeight, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ flex: "0 0 auto", minHeight: layout.subtitleHeight, color: accent, fontSize: layout.subtitleSize, lineHeight: 1.2, letterSpacing: 1.2, fontWeight: 800, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{layout.subtitle}</div>
        <div style={{ flex: "0 0 auto", marginTop: 18, fontFamily: SERIF, fontSize: layout.titleSize, lineHeight: 1.08, letterSpacing: -1.4, fontWeight: 700, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{scene.title}</div>
        <div style={{ flex: "0 0 auto", width: 72, height: 4, marginTop: 22, backgroundColor: accent, borderRadius: 4 }} />
        {lines.length > 0 && (
          <div style={{ marginTop: 25, display: "flex", flexDirection: "column", gap: layout.bodyGap }}>
            {lines.map((line, index) => (
              <div key={`${index}-${line}`} style={{ display: "flex", alignItems: "flex-start", gap: 18, visibility: index < visibleCount ? "visible" : "hidden" }}>
                <span style={{ flex: "0 0 auto", width: 7, height: 7, borderRadius: "50%", backgroundColor: accent, marginTop: layout.bodySize * 0.43 }} />
                <div style={{ fontSize: layout.bodySize, lineHeight: 1.22, fontWeight: 560, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{line}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div data-presenter-panel={scene.visual.presenter?.assetId} style={{ position: "absolute", left: layout.panelLeft, top: layout.top, width: layout.panelWidth, height: layout.areaHeight, boxSizing: "border-box", padding: 18, display: "flex", flexDirection: "column", borderLeft: `2px solid ${accent}`, backgroundColor: C.sheet, borderRadius: "0 14px 14px 0" }}>
        <div style={{ flex: "0 0 auto", minHeight: layout.nameHeight, fontFamily: SERIF, fontSize: layout.nameSize, lineHeight: 1.15, fontWeight: 700, overflowWrap: "anywhere" }}>{presenter.provenance.character}</div>
        <div style={{ flex: 1, minHeight: 120, marginTop: 14, marginBottom: 20 }}>
          <Img src={staticFile(presenter.fileName)} alt={presenter.provenance.character} style={{ width: "100%", height: "100%", objectFit: "contain", objectPosition: "center" }} />
        </div>
        <div style={{ flex: "0 0 auto", minHeight: layout.creditHeight, color: C.muted, fontSize: layout.creditSize, lineHeight: 1.25, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{presenter.provenance.credit}</div>
        {presenter.provenance.aiGenerated && <div style={{ flex: "0 0 auto", marginTop: 8, color: accent, fontSize: 14, lineHeight: "17px", fontWeight: 750 }}>AI-generated image</div>}
      </div>
    </>
  );
}

function SceneView({
  scene,
  index,
  count,
  activeTargets,
  width,
  height,
  durationInFrames,
  assetFilesById,
  presenterAsset,
}: {
  scene: Scene;
  index: number;
  count: number;
  activeTargets: Set<string>;
  width: number;
  height: number;
  durationInFrames: number;
  assetFilesById: Record<string, string>;
  presenterAsset: LocalAssetIntent | undefined;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const accent = sceneAccent(scene);
  const entrance = spring({ frame, fps, config: { damping: 22, stiffness: 100, mass: 0.72 } });
  const reveal = clamp01(interpolate(frame, [0, Math.max(1, fps * 0.65)], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) }));
  const presenter = resolvePresenterAsset(scene, presenterAsset, assetFilesById);
  let content: React.ReactNode;
  if (presenter) {
    content = <PresenterScene scene={scene} presenter={presenter} accent={accent} width={width} height={height} frame={frame} durationInFrames={durationInFrames} />;
  } else switch (scene.kind) {
    case "title":
      content = <HeroScene scene={scene} accent={accent} width={width} />;
      break;
    case "statement":
      content = <StatementScene scene={scene} accent={accent} width={width} />;
      break;
    case "diagram":
      content = <DiagramScene scene={scene} accent={accent} width={width} activeTargets={activeTargets} reveal={reveal} />;
      break;
    case "comparison":
      content = <ComparisonScene scene={scene} width={width} activeTargets={activeTargets} />;
      break;
    case "code":
      content = <CodeScene scene={scene} accent={accent} width={width} height={height} activeTargets={activeTargets} />;
      break;
    case "outro":
      content = <OutroScene scene={scene} accent={accent} width={width} />;
      break;
    case "bullets":
      content = <BulletsScene scene={scene} accent={accent} width={width} height={height} durationInFrames={durationInFrames} />;
      break;
    case "image":
      content = <ImageScene scene={scene} accent={accent} width={width} height={height} assetFilesById={assetFilesById} />;
      break;
  }
  const contentScale = scene.kind === "image" ? 1.002 - 0.002 * clamp01(entrance) : 1.012 - 0.012 * clamp01(entrance);
  const initialOffsetY = scene.kind === "image" ? 3 : 19;
  return (
    <AbsoluteFill>
      <PaperBackdrop accent={accent} />
      <Topline scene={scene} index={index} count={count} accent={accent} />
      <div style={{ position: "absolute", inset: 0, opacity: clamp01(entrance), transform: `translateY(${interpolate(entrance, [0, 1], [initialOffsetY, 0])}px) scale(${contentScale})`, transformOrigin: "50% 52%" }}>
        {content}
      </div>
      <div style={{ position: "absolute", left: 75, right: 75, bottom: 105, height: 2, background: "rgba(24,44,45,.12)" }}>
        <div style={{ width: `${reveal * 100}%`, height: "100%", backgroundColor: accent }} />
      </div>
    </AbsoluteFill>
  );
}

function currentChunk(chunks: TimedChunk[], frame: number, fps: number): TimedChunk | undefined {
  const elapsedMs = (frame / fps) * 1000;
  return chunks.find((chunk) => elapsedMs >= chunk.startMs && elapsedMs < chunk.endMs);
}

function Caption({ chunk, accent, width, height }: { chunk: TimedChunk | undefined; accent: string; width: number; height: number }) {
  if (!chunk) return null;
  const captionText = chunk.text;
  const size = fitFontSize(captionText, width - 68, height - 20, 22, 3, 1.18);
  return (
    <div
      style={{
        position: "absolute",
        left: 55,
        right: 55,
        bottom: 27,
        height: 66,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        padding: "9px 22px 9px 27px",
        backgroundColor: "rgba(251,248,240,.97)",
        border: "1px solid rgba(24,44,45,.17)",
        borderRadius: 13,
        boxShadow: "0 4px 16px rgba(24,44,45,.07)",
      }}
    >
      <div style={{ position: "absolute", left: 0, top: 13, bottom: 13, width: 4, backgroundColor: accent, borderRadius: 4 }} />
      <div style={{ width: "100%", maxHeight: height - 20, fontSize: size, color: C.ink, fontWeight: 620, lineHeight: 1.18, textAlign: "center", overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{captionText}</div>
    </div>
  );
}

export const Video: React.FC<VideoProps> = ({ manifest, timeline, width = 1280, height = 720, assetFilesById = {} }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cueWindows = resolveCueWindows(manifest, timeline);
  const sceneById = new Map(manifest.scenes.map((scene) => [scene.id, scene]));
  const assetById = new Map((manifest.assets ?? []).map((asset) => [asset.id, asset]));
  const timedChunk = currentChunk(timeline.chunks, frame, fps);
  const currentScene = timedChunk ? sceneById.get(timedChunk.sceneId) : undefined;
  const captionAccent = currentScene ? sceneAccent(currentScene) : C.teal;
  const activeByScene = new Map<string, Set<string>>();
  const nowMs = (frame / fps) * 1000;
  for (const cue of cueWindows) {
    if (nowMs >= cue.startMs && nowMs < cue.endMs) {
      const targets = activeByScene.get(cue.sceneId) ?? new Set<string>();
      targets.add(cue.target);
      activeByScene.set(cue.sceneId, targets);
    }
  }
  return (
    <AbsoluteFill style={{ backgroundColor: C.paper, width, height }}>
      {timeline.scenes.map((timedScene: TimedScene, index) => {
        const scene = sceneById.get(timedScene.sceneId);
        if (!scene || timedScene.durationInFrames <= 0) return null;
        return (
          <Sequence key={scene.id} from={timedScene.from} durationInFrames={timedScene.durationInFrames} name={scene.title}>
            <SceneView scene={scene} index={index} count={manifest.scenes.length} activeTargets={activeByScene.get(scene.id) ?? new Set<string>()} width={width} height={height} durationInFrames={timedScene.durationInFrames} assetFilesById={assetFilesById} presenterAsset={scene.visual.presenter ? assetById.get(scene.visual.presenter.assetId) : undefined} />
          </Sequence>
        );
      })}
      <Caption chunk={timedChunk} accent={captionAccent} width={width} height={height} />
    </AbsoluteFill>
  );
};
