import type { BodyPose } from "./posture.js";
import type { FacialPose } from "./expressions.js";
export type ActingPose = { reveal: number; invite: number; body: BodyPose; headTilt: number; nod: number; face: FacialPose };
