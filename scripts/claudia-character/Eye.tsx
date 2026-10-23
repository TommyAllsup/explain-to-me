import React from 'react';

const C = {
  hair: '#25252c', white: '#fffdf8', iris: '#647268', skinDeep: '#a97263',
};
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const mix = (a: number, b: number, t: number) => t === 1 ? b : t === 0 ? a : a + (b - a) * t;
const fmt = (n: number) => Number(n.toFixed(5));

/** Lid control points, rather than a scaled eyeball, determine the visible aperture. */
export function eyeGeometry(blink: number, openness: number, squint: number) {
  const closure = clamp(blink, 0, 1);
  const open = clamp(openness, .78, 1.16);
  const squeeze = clamp(squint, 0, 1);
  // The closing seam sits just below the iris centre. The upper lid covers about
  // twice the distance of the lower lid, and both meet exactly at full closure.
  const upperA = mix(-12.2 * open + .8 * squeeze, 2.6, closure);
  const upperB = mix(-10.2 * open + .7 * squeeze, 2.3, closure);
  const lowerA = mix(9.6 * open - 3.2 * squeeze, 2.6, closure);
  const lowerB = mix(8 * open - 2.7 * squeeze, 2.3, closure);
  const upperLid = `M-21 0C-9 ${fmt(upperA)} 9 ${fmt(upperB)} 22 0`;
  const lowerLid = `M-21 0C-9 ${fmt(lowerA)} 9 ${fmt(lowerB)} 22 0`;
  const upperMidY = .375 * (upperA + upperB);
  const lowerMidY = .375 * (lowerA + lowerB);
  return {
    closure,
    closed: closure === 1,
    upperLid,
    lowerLid,
    aperturePath: `${upperLid}C9 ${fmt(lowerB)} -9 ${fmt(lowerA)} -21 0Z`,
    upperMidY,
    lowerMidY,
    aperture: lowerMidY - upperMidY,
  };
}

export type EyeProps = {
  id: string;
  x: number;
  y: number;
  gazeX: number;
  gazeY: number;
  blink: number;
  openness: number;
  squint: number;
  browLift: number;
  /** Positive values raise the viewer-right end relative to the viewer-left. */
  browTilt: number;
};

export function Eye({ id, x, y, gazeX, gazeY, blink, openness, squint, browLift, browTilt }: EyeProps) {
  const lid = eyeGeometry(blink, openness, squint);
  const clipId = `eye-aperture-${id}`;
  const irisX = clamp(gazeX, -6, 6);
  const irisY = clamp(gazeY, -3.2, 3.2);
  const lift = clamp(browLift, -3, 3);
  const tilt = clamp(browTilt, -4, 4);
  // A low, shallow arch stays partly visible beneath Claudia's heavy fringe.
  const browStart = -14 - lift + tilt / 2;
  const browEnd = -15 - lift - tilt / 2;
  return <g transform={`translate(${x} ${y})`}>
    <path d={`M-19 ${fmt(browStart)}Q-3 ${fmt(-20 - lift)} 17 ${fmt(browEnd)}`} stroke={C.hair} strokeWidth="3.6" fill="none" strokeLinecap="round"/>
    <defs>
      <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
        <path d={lid.aperturePath}/>
      </clipPath>
    </defs>
    {!lid.closed && <g clipPath={`url(#${clipId})`}>
      <path d={lid.aperturePath} fill={C.white}/>
      <ellipse cx={irisX} cy={irisY} rx="7.3" ry="9" fill={C.iris}/>
      <ellipse cx={irisX} cy={irisY} rx="3.5" ry="6.5" fill={C.hair}/>
      <circle cx={irisX - 2.1} cy={irisY - 3.2} r="1.9" fill={C.white}/>
    </g>}
    <path d={lid.upperLid} stroke={C.hair} strokeWidth="2.7" fill="none" strokeLinecap="round"/>
    <path d={lid.lowerLid} stroke={C.skinDeep} strokeWidth="1.1" opacity={1 - lid.closure} fill="none"/>
    <path d="m-21 0-5-3" stroke={C.hair} strokeWidth="1.7" strokeLinecap="round"/>
  </g>;
}
