import React from 'react';

export type ClaudiaGesture = 'greet' | 'explain' | 'think' | 'settle';
export type ClaudiaProps = {
  /** Seconds on the composition timeline. All motion is derived from this value. */
  time: number;
  /** Normalized, smoothed speech amplitude; this is not phoneme-based lip sync. */
  mouth: number;
  gesture: ClaudiaGesture;
  /** Seconds since this cue began; omitted means the full authored pose. */
  gestureTime?: number;
  /** Seconds until this cue ends; eases back to the shared neutral pose. */
  gestureRemaining?: number;
  emphasis?: number;
};

const C = {
  line: '#343139', hair: '#25252c', hairLight: '#3a3942', hairShine: '#53505a',
  skin: '#ecc3aa', skinLight: '#f6d8c2', skinShade: '#cc9581', skinDeep: '#a97263',
  blush: '#db9e90', cream: '#f4f0e8', white: '#fffdf8', fold: '#dedbd3',
  seam: '#bab9b4', top: '#383a41', topShade: '#292c32', clay: '#c7774e',
  eye: '#647268', lip: '#9d5e58', mouth: '#603f43', tongue: '#c98781',
};
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const ease = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t); };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** A short symmetrical eyelid close, reproducible at any requested frame. */
function blinkAt(time: number) {
  return Math.max(...[2.65, 6.1, 9.8, 13.55, 17.2, 21.6, 25.8].map((at) => {
    const distance = Math.abs(time - at);
    return ease(1 - distance / 0.13);
  }));
}

/** Hands are drawn in the same local coordinate system as their forearm. */
function Hand({ pose }: { pose: 'open' | 'relaxed' | 'think' }) {
  if (pose === 'think') {
    return <g stroke={C.line} strokeWidth="1.65" strokeLinejoin="round" strokeLinecap="round">
      <path d="M-10 125 -13 143Q-23 151-20 163L-8 180Q-4 185 1 181L5 170 12 176Q19 179 22 173L25 157Q26 150 18 147L14 130Z" fill={C.skin}/>
      <path d="M-10 153 -17 183Q-19 192-13 194  -8 196-6 188L5 161Q9 154 6 150" fill={C.skinLight}/>
      <path d="m4 158 15 4m-18 4 15 4m-10-19 13 5" fill="none" stroke={C.skinDeep}/>
      <path d="M-11 131-14 146-8 151 8 149 14 134" fill={C.skinShade} stroke="none"/>
    </g>;
  }
  if (pose === 'relaxed') {
    return <g stroke={C.line} strokeWidth="1.65" strokeLinejoin="round" strokeLinecap="round">
      <path d="M-11 125-15 145-18 158Q-20 166-16 169-11 171-9 162L-5 153 -7 187Q-7 194-2 194 3 194 4 184L5 171 7 192Q8 197 12 195 15 194 15 187L14 169 18 184Q20 189 24 186 27 184 24 174L20 151 12 128Z" fill={C.skin}/>
      <path d="M-10 133-12 146Q-3 151 15 143L12 130Z" fill={C.skinShade} stroke="none"/>
      <path d="M-4 153 3 158 13 157m-8 14 1-13m8 11-1-11" stroke={C.skinDeep} fill="none"/>
    </g>;
  }
  return <g stroke={C.line} strokeWidth="1.65" strokeLinejoin="round" strokeLinecap="round">
    <path d="M-12 125-15 142-24 151-32 157Q-38 162-33 167-30 169-25 167L-14 161-16 183-20 199Q-21 205-16 206-11 207-9 201L-3 182-4 211Q-4 218 1 218 6 218 7 211L10 183 13 208Q14 214 19 212 22 211 22 204L21 178 28 192Q31 197 35 194 38 192 35 186L27 163Q23 151 16 145L12 127Z" fill={C.skin}/>
    <path d="M-12 130-14 143Q-3 148 15 141L12 129Z" fill={C.skinShade} stroke="none"/>
    <path d="M-13 161Q-7 155 3 159M-5 176 0 164Q8 161 17 169M10 183 11 172M21 178 18 169" fill="none" stroke={C.skinDeep} strokeWidth="1.2"/>
    <path d="M-6 149Q5 151 14 149" fill="none" stroke={C.skinLight} strokeWidth="3"/>
  </g>;
}

/** Shoulder → upper sleeve → elbow → forearm → wrist, with nested pivots. */
function Arm({ x, y, upper, bend, hand, wrist = 0 }: {
  x: number; y: number; upper: number; bend: number;
  hand: 'open' | 'relaxed' | 'think'; wrist?: number;
}) {
  return <g transform={`translate(${x} ${y}) rotate(${upper})`}>
    <path d="M-18-10Q-34-5-33 25L-25 110Q-24 139-16 155L17 155Q23 136 22 108L25 24Q24 0 11-9Z" fill={C.cream} stroke={C.line} strokeWidth="2.1"/>
    <path d="M-26 27-20 111-15 148 0 151-9 98-7 19Z" fill={C.fold}/>
    <path d="M14 20 12 108M-15 115Q0 121 14 113" stroke={C.seam} strokeWidth="1.3" fill="none"/>
    <g transform={`translate(0 143) rotate(${bend})`}>
      <g transform={`translate(0 123) rotate(${wrist}) translate(0 -123)`}>
        <Hand pose={hand}/>
      </g>
      <path d="M-17-11Q-25-4-23 17L-18 93-16 132Q0 140 17 132L21 89 22 17Q22-4 14-11Z" fill={C.cream} stroke={C.line} strokeWidth="2.1"/>
      <path d="M-18 8-15 92-10 128 0 133-3 87 0 15Z" fill={C.fold}/>
      <path d="M-14 18Q-1 22 12 14M-16 115Q0 122 19 115M11 35 10 96" fill="none" stroke={C.seam} strokeWidth="1.3"/>
      <path d="M-17 122Q0 130 18 122L17 134Q0 142-17 134Z" fill={C.white} stroke={C.line} strokeWidth="1.7"/>
      <path d="M-11 126 12 130" stroke={C.seam} strokeWidth="1.1"/>
      <circle cx="10" cy="134" r="2" fill={C.line}/>
    </g>
  </g>;
}

function Eye({ x, y, blink, direction, raised = 0 }: {
  x: number; y: number; blink: number; direction: number; raised?: number;
}) {
  const opening = Math.max(0.04, 1 - blink);
  return <g transform={`translate(${x} ${y})`}>
    <path d={`M-21 ${-17 - raised} Q-5 ${-26 - raised} 16 ${-19 - raised}`} stroke={C.hair} strokeWidth="4" fill="none" strokeLinecap="round"/>
    <g transform={`scale(1 ${opening})`}>
      <path d="M-21 0Q-6-13 13-5L22 0Q4 11-13 6Z" fill={C.white}/>
      <ellipse cx={direction} cy="0" rx="7.3" ry="9" fill={C.eye}/>
      <ellipse cx={direction} cy="0" rx="3.5" ry="6.5" fill={C.hair}/>
      <circle cx={direction - 2.1} cy="-3.2" r="1.9" fill={C.white}/>
    </g>
    <path d={`M-22 ${blink * 2} Q-6 ${-10 * opening} 12 ${-5 * opening} L23 0`} stroke={C.hair} strokeWidth="2.7" fill="none" strokeLinecap="round"/>
    <path d={`M-14 ${5 * opening} Q3 ${10 * opening} 17 ${3 * opening}`} stroke={C.skinDeep} strokeWidth="1.1" fill="none"/>
    <path d="m-21 0-5-3" stroke={C.hair} strokeWidth="1.7" strokeLinecap="round"/>
  </g>;
}

export function Claudia({ time, mouth, gesture, gestureTime, gestureRemaining, emphasis = 0 }: ClaudiaProps) {
  const speaking = clamp(mouth);
  const beat = clamp(emphasis);
  const breathing = Math.sin(time * 1.7) * 1.2;
  const blink = blinkAt(time);
  const entrance = Math.min(
    gestureTime === undefined ? 1 : ease(gestureTime / 0.4),
    gestureRemaining === undefined ? 1 : ease(gestureRemaining / 0.35),
  );
  const thinking = gesture === 'think' ? entrance : 0;
  const greeting = gesture === 'greet' ? entrance : 0;
  const explaining = gesture === 'explain' ? entrance : 0;
  const expressive = thinking + greeting + explaining;
  const headTilt = -thinking * 5 + Math.sin(time * 0.8) * 1.1 + beat * 1.2;
  const upper = mix(-6, -23, expressive) + Math.sin(time * 1.2) * 1.5;
  const targetBend = gesture === 'think' ? 174 : gesture === 'greet' ? -124 + Math.sin(time * 4.8) * 4 : gesture === 'explain' ? -119 - beat * 5 : -13;
  const bend = mix(-13, targetBend, entrance);
  const mouthOpen = speaking * 15.5;
  const lipWidth = 15.5 - speaking * 2.5;

  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 760" width="100%" height="100%" role="img" aria-label={`Claudia ${gesture === 'think' ? 'thinking' : 'explaining'}`} style={{ overflow: 'visible' }}>
    <g transform={`translate(0 ${breathing})`} strokeLinejoin="round" strokeLinecap="round">
      {/* Silhouette and the far arm sit behind the tailored body. */}
      <Arm x={202} y={383} upper={8 + Math.sin(time * 0.9) * 0.9} bend={-10 - beat * 3} hand="relaxed"/>
      <path d="M243 684Q294 665 353 685L382 775H219Z" fill={C.topShade} stroke={C.line} strokeWidth="2"/>
      <path d="M305 707 302 775" fill="none" stroke="#55565c" strokeWidth="2"/>
      <path d="M261 340Q224 345 198 366L186 390 213 493Q227 556 220 616L209 724Q255 747 296 723L311 695 327 725Q368 741 392 720L375 598Q364 549 382 488L409 385Q395 360 348 344Z" fill={C.cream} stroke={C.line} strokeWidth="2.3"/>
      <path d="M218 390Q221 488 239 555L236 646 222 725 209 724 220 614Q227 558 213 493L194 415Z" fill={C.fold}/>
      <path d="M371 396Q348 487 353 552L370 714 392 720 375 598Q363 545 380 494L397 413Z" fill={C.fold}/>
      <path d="M268 346Q300 365 340 347L349 472 331 615 301 699 266 613 248 461Z" fill={C.top}/>
      <path d="M268 346Q303 382 340 347L339 373Q303 405 266 371Z" fill={C.topShade}/>
      <path d="M278 402 282 564M325 403 317 575" fill="none" stroke="#505159" strokeWidth="1.6"/>
      {/* Neck is under both collar and jaw, so the head can tilt naturally. */}
      <path d="M276 297 273 345Q270 359 284 374Q300 387 319 373L343 350Q330 327 338 293Z" fill={C.skin} stroke={C.line} strokeWidth="1.9"/>
      <path d="M277 305 275 337Q290 354 319 348L335 323 337 296Z" fill={C.skinShade}/>
      <path d="M284 351Q297 367 317 351" stroke={C.skinLight} strokeWidth="2.5" fill="none"/>
      <path d="M265 339 248 353 238 397 267 410 256 432 301 535 283 409 280 376Z" fill={C.white} stroke={C.line} strokeWidth="1.8"/>
      <path d="M342 337 360 353 371 397 342 410 353 430 303 534 321 409 330 375Z" fill={C.white} stroke={C.line} strokeWidth="1.8"/>
      <path d="M248 353 267 410M360 353 342 410M301 536 297 703" fill="none" stroke={C.seam} strokeWidth="1.2"/>
      <path d="M235 604 273 610 270 624 234 617ZM333 608 369 601 370 615 336 623Z" fill={C.cream} stroke={C.seam} strokeWidth="1.3"/>
      <circle cx="306" cy="574" r="4.3" fill={C.line}/>
      <circle cx="305" cy="644" r="4.3" fill={C.line}/>
      <path d="M226 708Q258 727 287 707M332 708Q357 724 380 711" stroke={C.seam} strokeWidth="1.2" fill="none"/>
      {/* Front arm is a real two-bone chain, with the hand parented to its wrist. */}
      <Arm x={395} y={383} upper={upper} bend={bend} hand={thinking ? 'think' : expressive ? 'open' : 'relaxed'} wrist={-8 * thinking - 18 * explaining - 6 * greeting}/>
      <g transform={`rotate(${headTilt} 305 347) translate(0 ${-beat * 1.8})`}>
        {/* Back of bob: restrained facets rather than a circular mascot head. */}
        <path d="M203 171Q194 122 233 92 264 68 311 77 364 73 392 114Q416 146 406 191L417 268Q421 315 396 340L356 329 332 345 271 335 248 345Q208 339 185 315 197 289 191 255 187 222 203 171Z" fill={C.hair} stroke={C.line} strokeWidth="2.5"/>
        <path d="M211 172Q198 221 206 259L202 313 221 330Q212 278 228 228L239 154Z" fill={C.hairLight}/>
        <path d="M391 162Q405 218 399 264L405 314 389 329Q391 272 379 235Z" fill={C.hairLight}/>
        {/* Expose the neck through the bob, rather than drawing a dark neck band. */}
        <path d="M277 297 275 333Q302 345 335 329L338 293Z" fill={C.skinShade}/>
        {/* Ear and face planes. */}
        <path d="M370 219Q389 206 391 228 392 248 374 257L365 241Z" fill={C.skinShade} stroke={C.line} strokeWidth="1.8"/>
        <path d="M377 226Q385 220 384 232L377 242" fill="none" stroke={C.skinDeep} strokeWidth="1.6"/>
        <path d="M226 164Q239 123 287 118 338 113 367 154L376 217Q377 244 363 268L342 296Q328 315 309 318 291 317 270 302L243 279Q226 261 223 231Z" fill={C.skin} stroke={C.line} strokeWidth="2"/>
        <path d="M228 178 240 213 237 249Q251 279 275 296L310 318Q291 317 270 302L243 279Q227 261 223 231Z" fill={C.skinShade}/>
        <path d="M359 168 365 220 358 246 363 268Q377 243 376 216L367 154Z" fill={C.skinShade}/>
        <path d="M254 200Q276 181 294 195L294 232 278 246 250 230Z" fill={C.skinLight} opacity=".55"/>
        <path d="M321 192 351 198 356 228 330 240 317 229Z" fill={C.skinLight} opacity=".45"/>
        <path d="M280 291Q302 304 325 296" fill="none" stroke={C.skinLight} strokeWidth="4"/>
        <ellipse cx="253" cy="251" rx="13" ry="5.5" fill={C.blush} opacity=".42"/>
        <ellipse cx="346" cy="248" rx="14" ry="5.5" fill={C.blush} opacity=".4"/>
        {/* Almond eyes, adult proportions, and deliberately small highlights. */}
        <Eye x={264} y={220} blink={blink} direction={thinking ? 1.5 : 0.5} raised={thinking * 3}/>
        <Eye x={337} y={217} blink={blink} direction={thinking ? 1.5 : 0.5} raised={thinking * -1.5 + beat}/>
        <path d="M308 220 301 246Q299 252 305 254L311 253" fill="none" stroke={C.skinDeep} strokeWidth="1.65"/>
        <path d="M296 255 299 256M313 254 316 252" fill="none" stroke={C.skinDeep} strokeWidth="1.3"/>
        <path d="M308 233 307 244" fill="none" stroke={C.skinLight} strokeWidth="2.6"/>
        {/* A neutral-to-speaking mouth. Amplitude shapes the jaw opening only. */}
        <path d={`M${307 - lipWidth} 276Q300 ${273 - speaking} 305 274Q310 272 ${307 + lipWidth} 275Q310 ${280 + mouthOpen} 300 ${280 + mouthOpen * 0.6}Q294 ${278 + mouthOpen * 0.4} ${307 - lipWidth} 276Z`} fill={speaking > 0.04 ? C.mouth : C.lip} stroke={C.lip} strokeWidth="1.2"/>
        {speaking > 0.12 && <path d={`M${294 + speaking * 2} 276Q307 278 318 275L316 ${278 + speaking * 2}Q306 281 296 278Z`} fill={C.white}/>}
        {speaking > 0.35 && <path d={`M299 ${278 + mouthOpen * 0.69} Q307 ${275 + mouthOpen * 0.61} 315 ${278 + mouthOpen * 0.7} Q307 ${282 + mouthOpen * 0.75} 299 ${278 + mouthOpen * 0.69} Z`} fill={C.tongue}/>}
        <path d={`M299 ${283 + mouthOpen * 0.6} Q306 ${285 + mouthOpen * 0.65} 313 ${282 + mouthOpen * 0.6}`} fill="none" stroke={C.lip} strokeWidth="1.2" opacity=".75"/>
        <path d="M287 276 289 274M324 274 326 272" fill="none" stroke={C.skinDeep} strokeWidth="1"/>
        {/* Freckles read as freckles, not cheek decoration. */}
        <g fill={C.skinDeep} opacity=".6">
          <circle cx="250" cy="242" r="1.05"/><circle cx="257" cy="247" r="1"/><circle cx="263" cy="241" r=".9"/><circle cx="272" cy="246" r="1.1"/>
          <circle cx="285" cy="244" r=".85"/><circle cx="319" cy="241" r=".85"/><circle cx="329" cy="243" r="1"/><circle cx="339" cy="239" r="1"/><circle cx="349" cy="242" r="1.1"/>
        </g>
        {/* Heavy asymmetric fringe and a single warm streak on her right. */}
        <path d="M207 175Q204 126 239 104 271 81 316 90 359 83 382 122L391 180 374 199Q368 197 365 192L360 195 356 185 354 196 334 198 330 188 329 198 306 199 301 188 300 199 275 198 271 185 269 197Q253 199 245 194L245 181 225 211Z" fill={C.hair} stroke={C.line} strokeWidth="2"/>
        <path d="M254 102Q238 133 228 170L229 195 244 181Q244 147 270 96Z" fill={C.clay}/>
        <path d="M259 105Q242 137 236 166" fill="none" stroke="#de9b70" strokeWidth="3" opacity=".7"/>
        <path d="M277 100Q300 90 322 99M297 111 303 148M328 107Q341 122 345 148M356 112Q370 129 373 153" fill="none" stroke={C.hairShine} strokeWidth="2" opacity=".52"/>
        <path d="M217 176Q214 235 218 276L208 315 236 328Q232 300 239 278L231 240 239 197Z" fill={C.hair} stroke={C.line} strokeWidth="1.6"/>
        <path d="M222 206Q223 244 227 265L221 302" fill="none" stroke={C.hairShine} strokeWidth="2" opacity=".55"/>
        <path d="M375 181 368 211 377 242 369 284 370 326 392 316 385 270 392 224 387 187Z" fill={C.hair} stroke={C.line} strokeWidth="1.6"/>
        <path d="M384 214 381 239 382 267 378 300" fill="none" stroke={C.hairShine} strokeWidth="2" opacity=".45"/>
        {/* Eight-point star clip, on her left; clay is reserved for hair and clip. */}
        <g transform="translate(384 181) rotate(12)">
          <path d="M0-16 4-7 11-11 9-3 16 0 8 4 11 12 3 9 0 17-4 9-12 12-9 3-16 0-8-4-11-12-3-8Z" fill={C.clay} stroke="#9c5c40" strokeWidth="1"/>
          <path d="M0-10 2-3 9 0 2 2 0 10-2 3-9 0-2-2Z" fill="#dea178" opacity=".65"/>
        </g>
        {/* Lightweight headset follows the ear and clears the moving mouth. */}
        <path d="M382 217Q388 233 382 247Q373 263 341 273" fill="none" stroke={C.line} strokeWidth="2.5"/>
        <path d="M382 219Q389 234 383 241" fill="none" stroke="#77747c" strokeWidth="1"/>
        <rect x="331" y="268" width="13" height="7" rx="3.5" transform="rotate(-11 337 271)" fill={C.line}/>
      </g>
    </g>
  </svg>;
}
