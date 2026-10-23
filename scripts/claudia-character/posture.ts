export type Point = { x: number; y: number };
export type BodyPose = {
  chestX: number; chestY: number; chestRoll: number;
  shoulder: number; upperArm: number; forearm: number; handOpen: number; passiveLag: number;
};
export const NEUTRAL_BODY: BodyPose = {
  chestX: 0, chestY: 0, chestRoll: 0, shoulder: 0,
  upperArm: 0, forearm: 0, handOpen: 0, passiveLag: 0,
};
export const PELVIS = { x: 305, y: 675 };
export const NECK = { x: 305, y: 347 };
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t); };
const radians = (degrees: number) => degrees * Math.PI / 180;
const number = (n: number) => Number(n.toFixed(5));

function rotate(point: Point, angle: number): Point {
  const cos = Math.cos(radians(angle)), sin = Math.sin(radians(angle));
  const x = point.x - PELVIS.x, y = point.y - PELVIS.y;
  return { x: PELVIS.x + x * cos - y * sin, y: PELVIS.y + x * sin + y * cos };
}

/** Continuous skin deformation: hips stay planted; upper chest moves rigidly. */
export function warpTorsoPoint(point: Point, pose: BodyPose): Point {
  const weight = smooth((PELVIS.y - point.y) / (PELVIS.y - 390));
  const turned = rotate(point, pose.chestRoll);
  const side = smooth(Math.abs(point.x - NECK.x) / 93);
  const clavicle = smooth((point.y - 300) / 70) * (1 - smooth((point.y - 410) / 100));
  const lift = pose.shoulder * side * clavicle;
  return {
    x: point.x + weight * (turned.x - point.x + pose.chestX) + lift * (point.x >= NECK.x ? 2 : -.5),
    y: point.y + weight * (turned.y - point.y + pose.chestY) + lift * (point.x >= NECK.x ? -4.2 : 1.2),
  };
}

/** The head is rigid and inherits the exact upper-spine transform at its root. */
export function upperBodyTransform(pose: BodyPose): string {
  return `translate(${number(pose.chestX)} ${number(pose.chestY)}) rotate(${number(pose.chestRoll)} ${PELVIS.x} ${PELVIS.y})`;
}

function bone(root: Point, length: number, angleFromDown: number): Point {
  return { x: root.x + Math.sin(radians(angleFromDown)) * length, y: root.y + Math.cos(radians(angleFromDown)) * length };
}

export function bodyRig(pose: BodyPose) {
  const nearShoulder = warpTorsoPoint({x:398, y:380}, pose);
  const farShoulder = warpTorsoPoint({x:207, y:380}, pose);
  // Shoulder roots share the jacket deformation. Both arm segments retain
  // their lengths while the chest, upper arm, forearm and fingers overlap.
  const nearElbow = bone(nearShoulder, Math.hypot(2, 105), Math.atan2(2, 105) * 180 / Math.PI + pose.upperArm * 4.7 - pose.chestRoll);
  const nearWrist = bone(nearElbow, 105, 4.4 + pose.forearm * 45 - pose.chestRoll);
  const farElbow = bone(farShoulder, Math.hypot(-19, 105), Math.atan2(-19, 105) * 180 / Math.PI - pose.chestRoll + pose.passiveLag * 1.3);
  const farWrist = bone(farElbow, Math.hypot(22, 103), Math.atan2(22, 103) * 180 / Math.PI - pose.chestRoll - pose.passiveLag * 1.8);
  return {
    near: { shoulder: nearShoulder, elbow: nearElbow, wrist: nearWrist,
      handAngle: -15 - pose.forearm * 40 + pose.chestRoll + (pose.forearm - pose.handOpen) * 5,
      open: clamp(pose.handOpen) },
    far: { shoulder: farShoulder, elbow: farElbow, wrist: farWrist,
      handAngle: 9 + pose.chestRoll - pose.passiveLag * 1.2, open: 0 },
  };
}

/**
 * Warp the original absolute SVG paths, including all their control points.
 * Expanding implicit commands keeps the jacket, lapels and folds in the same
 * deformation field. Only the command subset used by this authored rig is accepted.
 */
export function warpTorsoPath(path: string, pose: BodyPose): string {
  const tokens = path.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/gu) ?? [];
  const sizes: Record<string, number> = {M:2, L:2, C:6, Q:4, H:1, V:1};
  let index = 0, command = "", cursor = {x:0, y:0}, start = cursor;
  const output: string[] = [];
  while (index < tokens.length) {
    if (/^[a-zA-Z]$/u.test(tokens[index]!)) {
      command = tokens[index++]!;
      if (command === "Z") { output.push("Z"); cursor = start; command = ""; continue; }
      if (!(command in sizes)) throw new Error(`Unsupported torso path command ${command}`);
    }
    const size = sizes[command];
    if (!size || index + size > tokens.length) throw new Error("Incomplete torso path");
    const values = tokens.slice(index, index + size).map(Number);
    if (values.some((v) => !Number.isFinite(v))) throw new Error("Invalid torso path coordinates");
    index += size;
    let points: Point[];
    if (command === "H") points = [{x:values[0]!, y:cursor.y}];
    else if (command === "V") points = [{x:cursor.x, y:values[0]!}];
    else points = Array.from({length:size / 2}, (_, i) => ({x:values[i * 2]!, y:values[i * 2 + 1]!}));
    cursor = points.at(-1)!;
    if (command === "M") start = cursor;
    output.push(command === "H" || command === "V" ? "L" : command,
      ...points.flatMap((point) => { const moved = warpTorsoPoint(point, pose); return [String(number(moved.x)), String(number(moved.y))]; }));
    if (command === "M") command = "L";
  }
  return output.join(" ");
}
