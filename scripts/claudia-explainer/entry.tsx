import React from "react";
import { Composition, registerRoot } from "remotion";
import type { ZodObject } from "zod";
import { ClaudiaExplainer } from "./video.js";
import type { ExplainerProps } from "./types.js";

registerRoot(() => <Composition<ZodObject, ExplainerProps>
  id="ClaudiaExplainer" component={ClaudiaExplainer} width={1280} height={720}
  fps={24} durationInFrames={1} defaultProps={{} as ExplainerProps}
  calculateMetadata={({props}) => ({durationInFrames: props.durationInFrames, fps: props.fps})}
/>);
