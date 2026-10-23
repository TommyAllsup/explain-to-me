import React from "react";
import { Composition, registerRoot } from "remotion";
import type { ZodObject } from "zod";
import { CharacterTest, type CharacterTestProps } from "./video.js";

registerRoot(() => <Composition<ZodObject, CharacterTestProps>
  id="ClaudiaCharacterTest" component={CharacterTest} width={1280} height={720}
  fps={24} durationInFrames={1} defaultProps={{} as CharacterTestProps}
  calculateMetadata={({props}) => ({durationInFrames: props.durationInFrames, fps: props.fps})}
/>);
