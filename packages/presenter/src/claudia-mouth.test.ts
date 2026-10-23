import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Mouth, mouthGeometry } from "./claudia/Mouth.js";
import type { MouthPose } from "./claudia/lipsync.js";

const vowel: MouthPose = { open: .45, width: .6, round: 0, closure: 0, teeth: .6, tongue: .4 };

test("warmth changes mouth corners without changing the speech opening", () => {
  for (const pose of [vowel, { ...vowel, round: .9 }, { ...vowel, closure: .7 }]) {
    const neutral = mouthGeometry(pose, 0);
    const smiling = mouthGeometry(pose, .8);
    assert.equal(smiling.height, neutral.height);
    assert.equal(smiling.opening, neutral.opening);
    assert.equal(smiling.top, neutral.top);
    assert.equal(smiling.bottom, neutral.bottom);
    assert.ok(smiling.curve > neutral.curve, "The smile should register in the mouth corners");
    assert.notEqual(smiling.path, neutral.path);
  }
});

test("rounded articulation takes priority over the widening and corner lift of a smile", () => {
  const spread = mouthGeometry(vowel, 1);
  const rounded = mouthGeometry({ ...vowel, round: 1 }, 1);
  const roundedNeutral = mouthGeometry({ ...vowel, round: 1 }, 0);
  assert.ok(rounded.width < spread.width * .75, "A rounded vowel must not become a wide smiling vowel");
  assert.ok(rounded.curve < spread.curve * .25, "Rounding should suppress most of the corner lift");
  assert.equal(rounded.width, roundedNeutral.width, "A fully rounded vowel should retain its speech width");
  assert.equal(rounded.height, roundedNeutral.height);
});

test("full lip contact survives smiling and renders no visible mouth interior", () => {
  // Even conflicting residual vowel/interior controls must yield to a bilabial
  // seal, so a smile cannot expose teeth during an /m/, /b/ or /p/ contact frame.
  const sealed: MouthPose = { ...vowel, open: 1, round: 1, closure: 1, teeth: 1, tongue: 1 };
  const geometry = mouthGeometry(sealed, 1);
  assert.equal(geometry.height, 0);
  assert.equal(geometry.opening, 0);
  assert.equal(geometry.closed, true);
  const markup = renderToStaticMarkup(
    React.createElement("svg", {}, React.createElement(Mouth, { pose: sealed, smile: 1 })),
  );
  assert.doesNotMatch(markup, /<g clip-path=/u, "No mouth-interior group may render behind a closed contour");
  assert.doesNotMatch(markup, /<ellipse\b/u, "The tongue must not render at full contact");
  assert.doesNotMatch(markup, /fill="#(?:f4e9dc|ba7970|65413f|a56a63)"/u,
    "The closed contour must have no teeth, tongue or mouth-cavity fill");
});
