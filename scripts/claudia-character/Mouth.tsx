import React from "react";
import type { MouthPose } from "./lipsync.js";

/** Expression affects the corners; speech retains control of contact and rounding. */
export function mouthGeometry(pose: MouthPose, smile = 0) {
  const warmth = Math.max(0, Math.min(1, smile));
  const seal = Math.max(0, 1 - pose.closure);
  const opening = Math.max(0, Math.min(pose.open, seal));
  const width = (10.4 + pose.width * 8.5) * (1 - pose.round * .4) * (1 + warmth * .045 * (1 - pose.round));
  const height = opening * 16 + pose.round * 5.5 * seal;
  const curve = warmth * 3.3 * (1 - opening * .75) * (1 - pose.round * .85);
  const cx = 307, cy = 277;
  const left = cx - width, right = cx + width;
  const top = cy - height * .25;
  const bottom = cy + height * .75;
  const closed = height <= .015;
  const contour = Math.min(1, height / 2);
  const path = closed
    ? `M ${left} ${cy - curve} Q ${cx} ${cy + curve * .3} ${right} ${cy - curve * .65}`
    : `M ${left} ${cy - curve} C ${cx - width * .55} ${top - curve * .2} ${cx - width * .25} ${top - .8 * contour} ${cx} ${top} C ${cx + width * .35} ${top - .5 * contour} ${cx + width * .6} ${top} ${right} ${cy - curve * .65} C ${cx + width * .65} ${bottom} ${cx - width * .6} ${bottom + .5 * contour} ${left} ${cy - curve} Z`;
  return {seal, opening, width, height, curve, cx, cy, left, right, top, bottom, path, closed};
}

/** One deforming mouth contour: the teeth and tongue are clipped inside it. */
export function Mouth({pose, smile = 0}: {pose: MouthPose; smile?: number}) {
  const {seal, opening, width, cx, left, right, top, bottom, path, closed} = mouthGeometry(pose, smile);
  return <g>
    <defs><clipPath id="claudia-mouth"><path d={path}/></clipPath></defs>
    <path d={path} fill={closed ? "none" : opening > .045 ? "#65413f" : "#a56a63"} stroke="#98615b" strokeWidth={closed ? 1.4 : 1.15}/>
    {!closed && <g clipPath="url(#claudia-mouth)">
      <path d={`M ${left + 1} ${top - 2} Q ${cx} ${top - .5} ${right - 1} ${top - 2} L ${right - 3} ${top + 2.8} Q ${cx} ${top + 4} ${left + 3} ${top + 2.8} Z`}
        fill="#f4e9dc" opacity={Math.min(.95, pose.teeth * .95 + (1 - pose.round) * opening * .65)}/>
      <ellipse cx={cx} cy={bottom + 2.5 - pose.tongue * 2} rx={width * .6} ry={3.3 + pose.tongue * 2}
        fill="#ba7970" opacity={Math.min(.85, pose.tongue + opening * .35)}/>
      {/* On f/v the bottom lip lifts to the top teeth instead of making an oval. */}
      <path d={`M ${left} ${bottom + 3} Q ${cx} ${bottom - 2.7} ${right} ${bottom + 3}`} stroke="#b77e73" strokeWidth={pose.teeth * seal * 2.4} fill="none"/>
    </g>}
    <path d={`M ${cx - width * .6} ${bottom + 2.2} Q ${cx} ${bottom + 3.5} ${cx + width * .5} ${bottom + 2}`} fill="none" stroke="#c38b7d" strokeWidth="1" opacity=".65"/>
  </g>;
}
