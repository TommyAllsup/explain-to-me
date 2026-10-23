import assert from "node:assert/strict";
import test from "node:test";
import { bodyRig, NECK, NEUTRAL_BODY, PELVIS, upperBodyTransform, warpTorsoPath, warpTorsoPoint, type BodyPose, type Point } from "./posture.js";

const poses: BodyPose[] = [
  NEUTRAL_BODY,
  { chestX: 9, chestY: -2, chestRoll: 1.6, shoulder: .8, upperArm: 1, forearm: 1, handOpen: .9, passiveLag: .6 },
  { chestX: -7, chestY: 1.5, chestRoll: -1.2, shoulder: -.3, upperArm: .4, forearm: .6, handOpen: .8, passiveLag: -.7 },
];
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
function close(actual: number, expected: number, tolerance = 1e-9): void {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} should be within ${tolerance} of ${expected}`);
}

test("torso deformation plants the pelvis and hem while preserving the neutral drawing", () => {
  const landmarks = [NECK, {x:207, y:380}, {x:398, y:380}, {x:220, y:492}, {x:305, y:574}, PELVIS, {x:210, y:724}];
  for (const point of landmarks) assert.deepEqual(warpTorsoPoint(point, NEUTRAL_BODY), point);
  for (const pose of poses) {
    for (const point of [PELVIS, {x:243, y:684}, {x:210, y:724}, {x:391, y:720}]) {
      assert.deepEqual(warpTorsoPoint(point, pose), point, "The upper-body gesture must not move the planted hips or hem");
    }
    assert.deepEqual(bodyRig(pose), bodyRig(pose), "Geometry must be repeatable without accumulating transforms");
  }
  assert.ok(distance(warpTorsoPoint(NECK, poses[1]!), NECK) > 1, "The chest must still move above the planted pelvis");
});

test("articulated arms retain bone lengths and stay connected to the jacket shoulders", () => {
  for (const pose of poses) {
    const rig = bodyRig(pose);
    assert.deepEqual(rig.near.shoulder, warpTorsoPoint({x:398, y:380}, pose));
    assert.deepEqual(rig.far.shoulder, warpTorsoPoint({x:207, y:380}, pose));
    close(distance(rig.near.shoulder, rig.near.elbow), Math.hypot(2, 105));
    close(distance(rig.near.elbow, rig.near.wrist), 105);
    close(distance(rig.far.shoulder, rig.far.elbow), Math.hypot(-19, 105));
    close(distance(rig.far.elbow, rig.far.wrist), Math.hypot(22, 103));
  }
});

test("the rigid head transform and deformed neck share one attachment point", () => {
  for (const pose of poses) {
    // Evaluate the emitted SVG transform independently, right to left.
    const values = [...upperBodyTransform(pose).matchAll(/[-+]?(?:\d*\.\d+|\d+\.?\d*)/gu)].map((match) => Number(match[0]));
    assert.equal(values.length, 5);
    const [tx, ty, degrees, cx, cy] = values as [number, number, number, number, number];
    const angle = degrees * Math.PI / 180;
    const expected = {
      x: cx + (NECK.x - cx) * Math.cos(angle) - (NECK.y - cy) * Math.sin(angle) + tx,
      y: cy + (NECK.x - cx) * Math.sin(angle) + (NECK.y - cy) * Math.cos(angle) + ty,
    };
    const attached = warpTorsoPoint(NECK, pose);
    close(attached.x, expected.x, 1e-4);
    close(attached.y, expected.y, 1e-4);
  }
});

test("absolute authored SVG commands preserve curves, implicit lines and subpath closure", () => {
  const original = "M305,675 325 675H335V700Q340 705 345 710C350 715 355 720 360 725ZM300 680H310Z";
  const expected = "M 305 675 L 325 675 L 335 675 L 335 700 Q 340 705 345 710 C 350 715 355 720 360 725 Z M 300 680 L 310 680 Z";
  for (const pose of poses) assert.equal(warpTorsoPath(original, pose), expected);
  assert.equal(warpTorsoPath("M3.05e2 6.75e2L300 7e2Z", NEUTRAL_BODY), "M 305 675 L 300 700 Z");
  assert.equal(warpTorsoPath("M305 675L310 690ZH325V700", NEUTRAL_BODY), "M 305 675 L 310 690 Z L 325 675 L 325 700");
});

test("torso path deformation includes Bézier control points and compressed signed coordinates", () => {
  const pose = {...NEUTRAL_BODY, chestX: 10, chestY: -2};
  assert.equal(
    warpTorsoPath("M300 340Q310 350 320 360C325 365 330 370 335 375L-5-7Z", pose),
    "M 310 338 Q 320 348 330 358 C 335 363 340 368 345 373 L 5 -9 Z",
  );
});

test("unsupported or incomplete authored path commands fail instead of creating broken anatomy", () => {
  for (const path of ["m305 675", "M305", "M305 675Q310 350 320", "M305 675LQ310 350 320 360", "M305 675A4 4 0 0 0 310 680"]) {
    assert.throws(() => warpTorsoPath(path, NEUTRAL_BODY), /Unsupported|Incomplete|Invalid/u);
  }
});
