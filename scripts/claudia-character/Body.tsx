import React from 'react';

const C = {
  line: '#343139', skin: '#ecc3aa', skinLight: '#f6d8c2',
  skinShade: '#cc9581', skinDeep: '#a97263', cream: '#f4f0e8',
  white: '#fffdf8', fold: '#dedbd3', seam: '#bab9b4',
  top: '#383a41', topShade: '#292c32',
};
type Point = { x: number; y: number };
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k });
const unit = (a: Point): Point => mul(a, 1 / Math.hypot(a.x, a.y));
const normal = (a: Point): Point => ({ x: -a.y, y: a.x });
const p = (a: Point) => `${a.x.toFixed(3)} ${a.y.toFixed(3)}`;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (n: number) => Math.max(0, Math.min(1, n));

/** A single continuous hand silhouette; articulation never replaces its topology. */
function Hand({ wrist, angle, open = 0, mirror = false }: {
  wrist: Point; angle: number; open?: number; mirror?: boolean;
}) {
  const o = clamp(open);
  const thumbX = mix(-13, -25, o);
  const fingerEnd = mix(41, 54, o);
  // The resting hand is partly edge-on with curled fingers. Its palm gradually
  // turns toward the viewer as the gesture opens, without swapping drawings.
  const palmTurn = mix(.58, 1, o) * (mirror ? -1 : 1);
  return <g transform={`translate(${p(wrist)}) rotate(${angle}) scale(${palmTurn} 1)`} strokeLinejoin="round" strokeLinecap="round">
    <path d={`M-11-7C-11 3-12 9-15 14
      Q${thumbX - 3} 21 ${thumbX} 25Q${thumbX + 3} 28-12 21
      L-10 37Q-9 ${fingerEnd + 1}-5 ${fingerEnd}
      Q-2 ${fingerEnd}-3 ${fingerEnd - 6}
      Q-2 ${fingerEnd + 7} 2 ${fingerEnd + 6}
      Q6 ${fingerEnd + 5} 5 ${fingerEnd - 1}
      Q7 ${fingerEnd + 5} 11 ${fingerEnd + 2}
      Q13 ${fingerEnd} 12 ${fingerEnd - 5}
      Q16 ${fingerEnd} 18 ${fingerEnd - 4}
      Q20 ${fingerEnd - 8} 16 33L14 21Q14 11 11-7Z`}
      fill={C.skin} stroke={C.line} strokeWidth="1.6"/>
    <path d="M-10-4-11 6Q-1 12 12 6L11-4Z" fill={C.skinShade}/>
    <path d={`M-11 21Q-3 ${mix(13, 18, o)} 7 20M-4 33-3 ${fingerEnd - 7}M4 34 5 ${fingerEnd - 2}M11 34 12 ${fingerEnd - 7}`}
      stroke={C.skinDeep} strokeWidth="1.05" fill="none" opacity={mix(.25, .8, o)}/>
    <path d="M-5 11Q1 9 7 12" stroke={C.skinLight} strokeWidth="2.5" fill="none"/>
  </g>;
}

/**
 * Cloth follows the arm as one contour. The tangent through the elbow is shared
 * by both Bézier sections, so neither edge acquires a hinge or a capsule seam.
 */
function Sleeve({ shoulder, elbow, wrist, handAngle, open = 0, far = false }: {
  shoulder: Point; elbow: Point; wrist: Point; handAngle: number;
  open?: number; far?: boolean;
}) {
  const upper = unit(sub(elbow, shoulder));
  const lower = unit(sub(wrist, elbow));
  const joint = unit(add(upper, lower));
  const upperLength = Math.hypot(elbow.x - shoulder.x, elbow.y - shoulder.y);
  const lowerLength = Math.hypot(wrist.x - elbow.x, wrist.y - elbow.y);
  const side = (direction: number) => {
    const s = add(shoulder, mul(normal(upper), 30 * direction));
    const e = add(elbow, mul(normal(joint), 23 * direction));
    const w = add(wrist, mul(normal(lower), 15 * direction));
    return { s, e, w,
      s1: add(s, mul(upper, upperLength * .4)),
      e0: sub(e, mul(joint, upperLength * .31)),
      e1: add(e, mul(joint, lowerLength * .29)),
      w0: sub(w, mul(lower, lowerLength * .38)),
    };
  };
  const a = side(1), b = side(-1);
  const cuff = sub(wrist, mul(lower, 11));
  const ca = add(cuff, mul(normal(lower), 15.5));
  const cb = sub(cuff, mul(normal(lower), 15.5));
  // A broad, low-contrast fold is the only interior elbow marking.
  const foldStart = add(elbow, mul(normal(joint), far ? -13 : 12));
  const foldMid = add(elbow, mul(lower, 14));
  const foldEnd = add(elbow, mul(normal(joint), far ? 7 : -8));
  return <g>
    <Hand wrist={wrist} angle={handAngle} open={open} mirror={far}/>
    <path d={`M${p(a.s)}C${p(a.s1)} ${p(a.e0)} ${p(a.e)}C${p(a.e1)} ${p(a.w0)} ${p(a.w)}
      Q${p(add(wrist, mul(lower, 5)))} ${p(b.w)}C${p(b.w0)} ${p(b.e1)} ${p(b.e)}
      C${p(b.e0)} ${p(b.s1)} ${p(b.s)}Q${p(sub(shoulder, mul(upper, 23)))} ${p(a.s)}Z`}
      fill={C.cream} stroke={C.line} strokeWidth="2"/>
    <path d={`M${p(a.s)}C${p(a.s1)} ${p(a.e0)} ${p(a.e)}C${p(a.e1)} ${p(a.w0)} ${p(a.w)}
      L${p(add(wrist, mul(normal(lower), 4)))}Q${p(add(elbow, mul(lower, 23)))} ${p(add(elbow, mul(normal(joint), 10)))}
      Q${p(add(shoulder, mul(upper, 53)))} ${p(add(shoulder, mul(normal(upper), 12)))}Z`}
      fill={C.fold} opacity=".8"/>
    <path d={`M${p(foldStart)}Q${p(foldMid)} ${p(foldEnd)}`} fill="none" stroke={C.seam} strokeWidth="1.1" opacity=".65"/>
    <path d={`M${p(ca)}Q${p(add(cuff, mul(lower, 3)))} ${p(cb)}L${p(b.w)}
      Q${p(add(wrist, mul(lower, 5)))} ${p(a.w)}Z`}
      fill={C.white} stroke={C.line} strokeWidth="1.4"/>
    <circle cx={add(wrist, mul(normal(lower), -8)).x} cy={add(wrist, mul(normal(lower), -8)).y} r="1.8" fill={C.line}/>
  </g>;
}

/**
 * The shoulder and elbow stay anchored. Only the near forearm opens, once per
 * authored phrase; there is no autonomous motion, wrist wave, or idle arm loop.
 */
export function Body({ reveal = 0, invite = 0 }: { reveal?: number; invite?: number }) {
  const open = clamp(reveal + invite * .62);
  const nearElbow = { x: 400, y: 485 };
  const armAngle = mix(4.4, 55, open) * Math.PI / 180;
  const nearWrist = { x: nearElbow.x + Math.sin(armAngle) * 105, y: nearElbow.y + Math.cos(armAngle) * 105 };
  return <g strokeLinejoin="round" strokeLinecap="round">
    <path d="M243 684Q294 665 353 685L382 775H219Z" fill={C.topShade} stroke={C.line} strokeWidth="2"/>
    <path d="M305 707 302 775" fill="none" stroke="#55565c" strokeWidth="2"/>
    <Sleeve shoulder={{ x: 207, y: 380 }} elbow={{ x: 188, y: 485 }} wrist={{ x: 210, y: 588 }} handAngle={9} far/>
    <Sleeve shoulder={{ x: 398, y: 380 }} elbow={nearElbow} wrist={nearWrist} handAngle={mix(-15, -55, open)} open={open}/>
    {/* The torso overlaps the sleeves at the shoulder and underarm. */}
    <path d="M261 340Q227 345 204 364L189 390Q204 408 215 419L220 492Q229 550 221 615L210 724Q254 745 296 723L310 696 326 725Q366 741 391 720L377 610Q366 550 379 490L391 419Q407 407 416 390L403 366Q382 350 348 344Z" fill={C.cream}/>
    <path d="M261 340Q227 345 204 364M348 344Q382 350 403 366M215 419L220 492Q229 550 221 615L210 724Q254 745 296 723L310 696 326 725Q366 741 391 720L377 610Q366 550 379 490L391 419" fill="none" stroke={C.line} strokeWidth="2.2"/>
    <path d="M216 418 229 491Q242 552 236 613L224 724 210 724 221 615Q230 551 220 492Z" fill={C.fold}/>
    <path d="M379 419 368 493Q355 553 364 612L377 725 391 720 377 610Q366 550 379 490L391 419Z" fill={C.fold}/>
    <path d="M269 346Q300 365 340 347L349 472 331 615 301 699 266 613 248 461Z" fill={C.top}/>
    <path d="M269 346Q303 382 340 347L339 373Q303 405 266 371Z" fill={C.topShade}/>
    <path d="M278 402 282 564M325 403 317 575" fill="none" stroke="#505159" strokeWidth="1.5"/>
    {/* The neck joins the existing head at the jaw, inside the jacket collar. */}
    <path d="M276 297 273 345Q270 359 284 374Q300 387 319 373L343 350Q330 327 338 293Z" fill={C.skin} stroke={C.line} strokeWidth="1.8"/>
    <path d="M277 305 275 337Q290 354 319 348L335 323 337 296Z" fill={C.skinShade}/>
    <path d="M284 351Q297 367 317 351" stroke={C.skinLight} strokeWidth="2.5" fill="none"/>
    <path d="M265 339 248 353 238 397 267 410 256 432 301 535 283 409 280 376Z" fill={C.white} stroke={C.line} strokeWidth="1.7"/>
    <path d="M342 337 360 353 371 397 342 410 353 430 303 534 321 409 330 375Z" fill={C.white} stroke={C.line} strokeWidth="1.7"/>
    <path d="M248 353 267 410M360 353 342 410M301 536 297 703" fill="none" stroke={C.seam} strokeWidth="1.2"/>
    <path d="M235 604 273 610 270 624 234 617ZM333 608 369 601 370 615 336 623Z" fill={C.cream} stroke={C.seam} strokeWidth="1.3"/>
    <circle cx="306" cy="574" r="4.1" fill={C.line}/>
    <circle cx="305" cy="644" r="4.1" fill={C.line}/>
    <path d="M226 708Q258 727 287 707M332 708Q357 724 380 711" stroke={C.seam} strokeWidth="1.2" fill="none"/>
  </g>;
}
