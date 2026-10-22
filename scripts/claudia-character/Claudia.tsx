import React from 'react';
import { Body } from './Body.js';
import { Mouth } from './Mouth.js';
import type { MouthPose } from './lipsync.js';
import type { ActingPose } from './acting.js';
import { upperBodyTransform } from './posture.js';

const C = {
  line: '#343139', hair: '#25252c', hairLight: '#3a3942', hairShine: '#53505a',
  skin: '#ecc3aa', skinLight: '#f6d8c2', skinShade: '#cc9581', skinDeep: '#a97263',
  blush: '#db9e90', cream: '#f4f0e8', white: '#fffdf8', fold: '#dedbd3',
  seam: '#bab9b4', top: '#383a41', topShade: '#292c32', clay: '#c7774e',
  eye: '#647268', lip: '#9d5e58', mouth: '#603f43', tongue: '#c98781',
};
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

export function Claudia({ mouth, acting }: {mouth: MouthPose; acting: ActingPose}) {
  const blink = acting.blink;
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 760" width="100%" height="100%" role="img" aria-label="Claudia explaining with a relaxed posture" style={{overflow: 'visible'}}>
    <g strokeLinejoin="round" strokeLinecap="round">
      <Body pose={acting.body}/>
      <g transform={upperBodyTransform(acting.body)}>
      <g transform={`translate(305 347) rotate(${acting.headTilt}) scale(.94) translate(-305 -347) translate(0 ${acting.nod})`}>
        {/* Back of bob: restrained facets rather than a circular mascot head. */}
        <path d="M203 171Q194 122 233 92 264 68 311 77 364 73 392 114Q416 146 406 191L417 268Q421 315 396 340L356 329 332 345 271 335 248 345Q208 339 185 315 197 289 191 255 187 222 203 171Z" fill={C.hair} stroke={C.line} strokeWidth="2.5"/>
        <path d="M211 172Q198 221 206 259L202 313 221 330Q212 278 228 228L239 154Z" fill={C.hairLight}/>
        <path d="M391 162Q405 218 399 264L405 314 389 329Q391 272 379 235Z" fill={C.hairLight}/>
        {/* Expose the neck through the bob, rather than drawing a dark neck band. */}
        <path d="M277 297 274 350Q304 365 338 348L338 293Z" fill={C.skinShade}/>
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
        <Eye x={264} y={220} blink={blink} direction={acting.gaze + .5} raised={acting.brow}/>
        <Eye x={337} y={217} blink={blink} direction={acting.gaze + .5} raised={-acting.brow * .35}/>
        <path d="M308 220 301 246Q299 252 305 254L311 253" fill="none" stroke={C.skinDeep} strokeWidth="1.65"/>
        <path d="M296 255 299 256M313 254 316 252" fill="none" stroke={C.skinDeep} strokeWidth="1.3"/>
        <path d="M308 233 307 244" fill="none" stroke={C.skinLight} strokeWidth="2.6"/>
        <Mouth pose={mouth} smile={acting.smile}/>
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
    </g>
  </svg>;
}
